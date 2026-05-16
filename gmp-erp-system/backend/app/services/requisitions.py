"""Production Requisition service — FEFO allocation + issue logic."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import (
    InventoryMovement,
    Lot,
    ProductionRequisition,
    RequisitionAllocationLine,
    RequisitionLine,
)
from app.models.master_data import Material, Warehouse
from app.schemas.inventory import (
    AllocationUpdateRequest,
    IssueRequisitionRequest,
    RequisitionCreate,
)
from app.services.audit import write_audit
from app.services.permissions import require_permission
from app.services.signature import validate_signature


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _get_required(db: Session, model: type, object_id: uuid.UUID, label: str):
    row = db.get(model, object_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return row


def _require_any_permission(user: CurrentUser, permission_codes: tuple[str, ...]) -> None:
    if not any(permission_code in user.permissions for permission_code in permission_codes):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"One of permissions {', '.join(permission_codes)} is required",
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_warehouse_type(db: Session, material_id: uuid.UUID) -> str:
    """Determine which warehouse handles this material based on item_type."""
    material = _get_required(db, Material, material_id, "Material")
    if material.item_type in ("packaging", "label", "container"):
        return "PACKAGING_WAREHOUSE"
    # substance, excipient, solvent, other raw → substance warehouse
    return "SUBSTANCE_WAREHOUSE"


def _fefo_allocate(
    db: Session,
    material_id: uuid.UUID,
    requested_qty: float,
    warehouse_type: str | None = None,
) -> list[tuple[Lot, float]]:
    """
    FEFO (First Expired First Out) allocation.
    Returns list of (lot, quantity_to_take) sorted by expiry_date ASC, then created_at ASC.
    May return less than requested if stock is insufficient.
    """
    lots = (
        db.query(Lot)
        .join(Warehouse, Lot.warehouse_id == Warehouse.id)
        .filter(
            Lot.material_id == material_id,
            Lot.quality_status == "released",
            Lot.quantity > 0,
        )
    )
    if warehouse_type:
        lots = lots.filter(Warehouse.warehouse_type == warehouse_type)
    lots = lots.order_by(Lot.expiry_date.asc(), Lot.created_at.asc()).all()

    remaining = requested_qty
    result: list[tuple[Lot, float]] = []
    for lot in lots:
        if remaining <= 0:
            break
        take = min(lot.quantity, remaining)
        result.append((lot, round(take, 6)))
        remaining = round(remaining - take, 6)

    return result


def _replace_draft_allocations_for_line(
    db: Session,
    req: ProductionRequisition,
    line: RequisitionLine,
) -> float:
    db.query(RequisitionAllocationLine).filter(
        RequisitionAllocationLine.requisition_line_id == line.id,
        RequisitionAllocationLine.status == "draft",
    ).delete()

    remaining_quantity = round(line.requested_quantity - _line_issued_total(db, line.id), 6)
    if remaining_quantity <= 0:
        return 0.0

    allocated_total = 0.0
    for lot, qty in _fefo_allocate(db, line.material_id, remaining_quantity, line.warehouse_type):
        db.add(RequisitionAllocationLine(
            requisition_id=req.id,
            requisition_line_id=line.id,
            lot_id=lot.id,
            warehouse_type=line.warehouse_type,
            allocated_quantity=qty,
            status="draft",
        ))
        allocated_total = round(allocated_total + qty, 6)
    return allocated_total


def _line_issued_total(db: Session, requisition_line_id: uuid.UUID) -> float:
    return round(
        db.query(func.sum(RequisitionAllocationLine.allocated_quantity))
        .filter(
            RequisitionAllocationLine.requisition_line_id == requisition_line_id,
            RequisitionAllocationLine.status == "issued",
        )
        .scalar() or 0.0,
        6,
    )


def _recalculate_requisition_status(db: Session, req: ProductionRequisition) -> None:
    lines = db.query(RequisitionLine).filter(RequisitionLine.requisition_id == req.id).all()
    for line in lines:
        line.issued_quantity = _line_issued_total(db, line.id)
        if line.issued_quantity >= line.requested_quantity:
            line.status = "issued"
        elif line.issued_quantity > 0:
            line.status = "partially_issued"
        else:
            line.status = "pending"

    if lines and all(line.status == "issued" for line in lines):
        req.status = "issued"
    elif any(line.status in ("issued", "partially_issued") for line in lines):
        req.status = "partially_issued"
    elif req.status == "submitted" or any(line.allocation_lines for line in lines):
        req.status = "processing"


# ---------------------------------------------------------------------------
# Create requisition (production side)
# ---------------------------------------------------------------------------

def create_requisition(db: Session, user: CurrentUser, payload: RequisitionCreate) -> ProductionRequisition:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION"))

    # Auto-generate requisition number
    count = db.query(func.count(ProductionRequisition.id)).scalar() or 0
    req_no = f"REQ-{now_utc().strftime('%Y%m%d')}-{count + 1:04d}"

    req = ProductionRequisition(
        requisition_no=req_no,
        status="submitted",
        product_name=payload.product_name,
        product_series=payload.product_series,
        production_date=payload.production_date,
        production_order_no=payload.production_order_no,
        notes=payload.notes,
        submitted_by=user.id,
        submitted_at=now_utc(),
    )
    db.add(req)
    db.flush()

    created_lines: list[RequisitionLine] = []
    for line in payload.lines:
        material = _get_required(db, Material, line.material_id, "Material")
        wh_type = _resolve_warehouse_type(db, line.material_id)
        req_line = RequisitionLine(
            requisition_id=req.id,
            material_id=line.material_id,
            requested_quantity=line.requested_quantity,
            unit=line.unit or material.default_unit,
            warehouse_type=wh_type,
            issued_quantity=0.0,
            status="pending",
        )
        db.add(req_line)
        created_lines.append(req_line)

    db.flush()
    allocated_lines = 0
    for req_line in created_lines:
        if _replace_draft_allocations_for_line(db, req, req_line) > 0:
            allocated_lines += 1

    if allocated_lines:
        req.status = "processing"

    write_audit(
        db, user,
        object_type="production_requisition",
        object_id=str(req.id),
        action_type="CREATE_REQUISITION",
        new_value={
            "requisition_no": req_no,
            "product_name": payload.product_name,
            "fefo_allocated_lines": allocated_lines,
        },
    )
    db.commit()
    db.refresh(req)
    return req


# ---------------------------------------------------------------------------
# FEFO auto-allocation (warehouse side)
# ---------------------------------------------------------------------------

def auto_allocate(db: Session, user: CurrentUser, requisition_id: uuid.UUID) -> ProductionRequisition:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_WAREHOUSE"))
    req = _get_required(db, ProductionRequisition, requisition_id, "Requisition")
    if req.status not in ("submitted", "processing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Requisition is not in a state that allows allocation")

    # Delete existing DRAFT allocation lines for this warehouse's scope only
    warehouse_scope = user.warehouse_scope
    lines = db.query(RequisitionLine).filter(RequisitionLine.requisition_id == req.id).all()
    for line in lines:
        if warehouse_scope and line.warehouse_type != warehouse_scope:
            continue
        db.query(RequisitionAllocationLine).filter(
            RequisitionAllocationLine.requisition_line_id == line.id,
            RequisitionAllocationLine.status == "draft",
        ).delete()

    db.flush()

    # Run FEFO for each line this warehouse handles
    for line in lines:
        if warehouse_scope and line.warehouse_type != warehouse_scope:
            continue
        if _line_issued_total(db, line.id) >= line.requested_quantity:
            line.status = "issued"
            continue
        _replace_draft_allocations_for_line(db, req, line)

    _recalculate_requisition_status(db, req)

    write_audit(
        db, user,
        object_type="production_requisition",
        object_id=str(req.id),
        action_type="AUTO_ALLOCATE",
        new_value={"method": "FEFO", "warehouse_scope": warehouse_scope},
    )
    db.commit()
    db.refresh(req)
    return req


# ---------------------------------------------------------------------------
# Manual allocation update (warehouse side)
# ---------------------------------------------------------------------------

def update_allocation(db: Session, user: CurrentUser, requisition_id: uuid.UUID, payload: AllocationUpdateRequest) -> ProductionRequisition:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_WAREHOUSE"))
    req = _get_required(db, ProductionRequisition, requisition_id, "Requisition")
    if req.status not in ("submitted", "processing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Requisition is not in processing state")

    warehouse_scope = user.warehouse_scope

    # Removals
    for alloc_id in payload.removals:
        alloc = db.get(RequisitionAllocationLine, alloc_id)
        if alloc and alloc.status == "draft":
            if warehouse_scope and alloc.warehouse_type != warehouse_scope:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify allocation for another warehouse")
            db.delete(alloc)

    # Updates
    for upd in payload.updates:
        alloc = db.get(RequisitionAllocationLine, upd.id)
        if not alloc or alloc.status != "draft":
            continue
        if warehouse_scope and alloc.warehouse_type != warehouse_scope:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify allocation for another warehouse")
        if upd.allocated_quantity <= 0:
            db.delete(alloc)
        else:
            lot = _get_required(db, Lot, alloc.lot_id, "Lot")
            if upd.allocated_quantity > lot.quantity:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Allocated quantity {upd.allocated_quantity} exceeds lot stock {lot.quantity} for lot {lot.internal_lot}",
                )
            alloc.allocated_quantity = upd.allocated_quantity

    # Additions
    for add in payload.additions:
        req_line = _get_required(db, RequisitionLine, add.requisition_line_id, "RequisitionLine")
        lot = _get_required(db, Lot, add.lot_id, "Lot")
        if lot.quality_status != "released":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Lot {lot.internal_lot} is not released")
        if add.allocated_quantity > lot.quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Allocated quantity exceeds lot stock {lot.quantity}",
            )
        if warehouse_scope and req_line.warehouse_type != warehouse_scope:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot add allocation for another warehouse")
        # Check for duplicate lot on same line
        existing = db.query(RequisitionAllocationLine).filter(
            RequisitionAllocationLine.requisition_line_id == req_line.id,
            RequisitionAllocationLine.lot_id == lot.id,
            RequisitionAllocationLine.status == "draft",
        ).first()
        if existing:
            existing.allocated_quantity = round(existing.allocated_quantity + add.allocated_quantity, 6)
        else:
            db.add(RequisitionAllocationLine(
                requisition_id=req.id,
                requisition_line_id=req_line.id,
                lot_id=lot.id,
                warehouse_type=req_line.warehouse_type,
                allocated_quantity=add.allocated_quantity,
                status="draft",
            ))

    write_audit(
        db, user,
        object_type="production_requisition",
        object_id=str(req.id),
        action_type="UPDATE_ALLOCATION",
        new_value={"warehouse_scope": warehouse_scope},
    )
    db.commit()
    db.refresh(req)
    return req


# ---------------------------------------------------------------------------
# Issue (sign + dispatch) — warehouse manager
# ---------------------------------------------------------------------------

def issue_requisition(db: Session, user: CurrentUser, requisition_id: uuid.UUID, payload: IssueRequisitionRequest) -> ProductionRequisition:
    require_permission(user, "POST_RECEIPT")  # warehouse manager level
    req = _get_required(db, ProductionRequisition, requisition_id, "Requisition")
    if req.status not in ("submitted", "processing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Requisition is not ready for issue")

    warehouse_scope = user.warehouse_scope
    validate_signature(db, user, payload, "ISSUE_REQUISITION", "production_requisition", str(req.id))

    issued_time = now_utc()

    # Get draft allocation lines for this warehouse
    alloc_query = db.query(RequisitionAllocationLine).filter(
        RequisitionAllocationLine.requisition_id == req.id,
        RequisitionAllocationLine.status == "draft",
    )
    if warehouse_scope:
        alloc_query = alloc_query.filter(RequisitionAllocationLine.warehouse_type == warehouse_scope)

    alloc_lines = alloc_query.all()
    if not alloc_lines:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No allocation lines to issue for this warehouse")

    # Issue each allocation line
    for alloc in alloc_lines:
        lot = _get_required(db, Lot, alloc.lot_id, "Lot")
        if lot.quality_status != "released":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Lot {lot.internal_lot} is no longer released",
            )
        if alloc.allocated_quantity > lot.quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Allocated {alloc.allocated_quantity} exceeds available {lot.quantity} for lot {lot.internal_lot}",
            )

        quantity_before = lot.quantity
        lot.quantity = round(lot.quantity - alloc.allocated_quantity, 6)

        db.add(InventoryMovement(
            movement_type="ISSUE_PRODUCTION",
            document_type="production_requisition",
            document_id=req.id,
            lot_id=lot.id,
            from_warehouse_id=lot.warehouse_id,
            from_location_id=lot.location_id,
            to_warehouse_id=None,
            to_location_id=None,
            quantity_delta=-alloc.allocated_quantity,
            quantity_after=lot.quantity,
            unit=lot.unit,
            reason=payload.reason or f"Requisition {req.requisition_no}",
            user_id=user.id,
            workstation_id=user.workstation_id,
        ))

        alloc.status = "issued"
        alloc.issued_by = user.id
        alloc.issued_at = issued_time

    db.flush()
    _recalculate_requisition_status(db, req)

    write_audit(
        db, user,
        object_type="production_requisition",
        object_id=str(req.id),
        action_type="ISSUE_REQUISITION",
        new_value={
            "warehouse_scope": warehouse_scope,
            "lines_issued": len(alloc_lines),
            "requisition_status": req.status,
        },
        reason=payload.reason,
    )
    db.commit()
    db.refresh(req)
    return req


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def list_requisitions(db: Session, user: CurrentUser, status_filter: str | None = None) -> list[ProductionRequisition]:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_WAREHOUSE"))
    query = db.query(ProductionRequisition).order_by(ProductionRequisition.created_at.desc())
    if status_filter:
        query = query.filter(ProductionRequisition.status == status_filter)
    return query.all()


def get_requisition(db: Session, user: CurrentUser, requisition_id: uuid.UUID) -> ProductionRequisition:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_WAREHOUSE"))
    return _get_required(db, ProductionRequisition, requisition_id, "Requisition")


def build_requisition_item(db: Session, req: ProductionRequisition) -> dict:
    """Build full nested response dict with allocation details."""
    result_lines = []
    for line in req.lines:
        material = db.get(Material, line.material_id)
        alloc_items = []
        for alloc in line.allocation_lines:
            lot = db.get(Lot, alloc.lot_id)
            if not lot:
                continue
            from app.models.master_data import Location
            loc = db.get(Location, lot.location_id)
            alloc_items.append({
                "id": alloc.id,
                "requisition_line_id": alloc.requisition_line_id,
                "lot_id": alloc.lot_id,
                "lot_internal_lot": lot.internal_lot,
                "lot_supplier_lot": lot.supplier_lot or "",
                "lot_expiry_date": lot.expiry_date,
                "lot_location_code": loc.code if loc else "",
                "lot_rack_no": lot.rack_no,
                "lot_sector_no": lot.sector_no,
                "lot_tier_no": lot.tier_no,
                "lot_place_no": lot.place_no,
                "lot_pallet_no": lot.pallet_no,
                "lot_available": lot.quantity,
                "warehouse_type": alloc.warehouse_type,
                "allocated_quantity": alloc.allocated_quantity,
                "status": alloc.status,
            })
        result_lines.append({
            "id": line.id,
            "material_id": line.material_id,
            "material_code": material.code if material else "",
            "material_name": material.name if material else "",
            "requested_quantity": line.requested_quantity,
            "issued_quantity": line.issued_quantity,
            "unit": line.unit,
            "warehouse_type": line.warehouse_type,
            "status": line.status,
            "allocation_lines": alloc_items,
        })
    return {
        "id": req.id,
        "requisition_no": req.requisition_no,
        "status": req.status,
        "product_name": req.product_name,
        "product_series": req.product_series,
        "production_date": req.production_date,
        "production_order_no": req.production_order_no,
        "notes": req.notes,
        "submitted_at": req.submitted_at,
        "created_at": req.created_at,
        "lines": result_lines,
    }
