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
    ProductionBatch,
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


def view_scope_for(user: CurrentUser) -> str | None:
    """Тип склада, которым ограничено представление требования для данного
    пользователя. Производство/ДОК видят документ целиком (None); склад-
    пользователь — только свою часть (строки своего склада)."""
    if "VIEW_PRODUCTION" in user.permissions or "MANAGE_PRODUCTION" in user.permissions:
        return None
    return user.warehouse_scope or None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_warehouse_type(db: Session, material_id: uuid.UUID) -> str:
    """Determine which warehouse handles this material based on item_type."""
    material = _get_required(db, Material, material_id, "Material")
    from app.services.material_types import is_packaging_item_type
    if is_packaging_item_type(material.item_type):
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

def _parse_qty(raw) -> float:
    try:
        return float(str(raw or "0").replace(" ", "").replace(" ", "").replace(",", ".") or 0)
    except (ValueError, TypeError):
        return 0.0


def prefill_requisition(db: Session, user: CurrentUser, batch_id: uuid.UUID) -> dict:
    """Автозаполнение требования по серии: реквизиты из production_batch + строки
    материалов из листа распределения утверждённого BMR-шаблона продукта
    (material_code → Material, кол-во/серию). Дубли материала суммируются.
    Возвращает черновик (оператор проверяет/правит и отправляет обычным create)."""
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION"))
    from app.models.inventory import BmrTemplate  # локально: избегаем цикла импорта

    batch = _get_required(db, ProductionBatch, batch_id, "Production batch")
    template = (
        db.query(BmrTemplate)
        .filter(BmrTemplate.product_id == batch.product_id, BmrTemplate.status == "approved")
        .order_by(BmrTemplate.version.desc())
        .first()
        if batch.product_id else None
    )
    agg: dict[str, dict] = {}
    order: list[str] = []
    if template:
        for section in template.sections:
            config = section.config or {}
            if config.get("kind") != "distribution_list" or config.get("stage") != "weighing":
                continue
            for group in config.get("groups", []):
                for item in group.get("items", []):
                    code = item.get("material_code")
                    if not code or code == "UTIL-WATER":
                        continue
                    material = db.query(Material).filter(Material.code == code).first()
                    if not material:
                        continue
                    key = str(material.id)
                    if key not in agg:
                        agg[key] = {
                            "material_id": material.id,
                            "material_name": material.name,
                            "material_code": material.code,
                            "requested_quantity": 0.0,
                            "unit": material.default_unit or "kg",
                        }
                        order.append(key)
                    agg[key]["requested_quantity"] += _parse_qty(item.get("qty"))
    return {
        "product_name": batch.product_name,
        "product_series": batch.batch_no,
        "production_date": batch.production_date,
        "production_order_no": batch.bmr_no,
        "production_batch_id": batch.id,
        "has_template": template is not None,
        "lines": [agg[k] for k in order],
    }


def verify_requisition_scan(db: Session, user: CurrentUser, requisition_id: uuid.UUID, raw: bytes, mime_type: str | None) -> ProductionRequisition:
    """Ф4: подтверждение передачи накладной сканом её КР-кода. Распознаёт QR из
    загруженного скана, сверяет тип/идентификатор/хэш состояния с выданной
    накладной и ставит отметку scan_verified."""
    import hashlib
    from app.services.document_qr import validate_scan_document_qr

    _require_any_permission(user, ("POST_RECEIPT", "VIEW_PRODUCTION", "MANAGE_PRODUCTION"))
    req = _get_required(db, ProductionRequisition, requisition_id, "Requisition")
    if req.status not in ("issued", "partially_issued"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Сканировать накладную можно только после её выдачи складом")
    state_hash = hashlib.sha256(f"{req.requisition_no}|{req.status}|{len(req.lines)}".encode("utf-8")).hexdigest()
    validate_scan_document_qr(
        raw=raw,
        mime_type=mime_type,
        expected_doc_type="requisition",
        expected_document_id=req.id,
        expected_state_hash=state_hash,
    )
    req.scan_verified_at = now_utc()
    req.scan_verified_by = user.id
    write_audit(
        db, user, object_type="production_requisition", object_id=str(req.id),
        action_type="VERIFY_REQUISITION_SCAN", new_value={"requisition_no": req.requisition_no},
    )
    db.commit()
    db.refresh(req)
    return req


def _spill_distribution_to_bmr(db: Session, req: ProductionRequisition, alloc_lines: list, user: CurrentUser) -> None:
    """Ф2: при выдаче накладной заполняет лист распределения BMR серии данными
    выданных партий — № серии сырья (supplier_lot), № аналит. листа (report_no),
    вес (план/серию) и подпись «Выдал (Склад)». Уже заполненные/подписанные
    ячейки не перезаписываются."""
    if not req.production_batch_id:
        return
    from app.models.inventory import BmrEntry, BmrInstance
    from app.models.identity import User
    from app.models.quality import QCReport

    instance = db.query(BmrInstance).filter(BmrInstance.production_batch_id == req.production_batch_id).first()
    if not instance:
        return
    section = next(
        (s for s in instance.sections
         if (s.config or {}).get("kind") == "distribution_list" and (s.config or {}).get("stage") == "weighing"),
        None,
    )
    if not section:
        return
    # material_code → [(field_base, planned_qty)]
    code_map: dict[str, list[tuple[int, str | None]]] = {}
    base = 0
    for group in (section.config or {}).get("groups", []):
        for item in group.get("items", []):
            code_map.setdefault(item.get("material_code"), []).append((base, item.get("qty")))
            base += 6

    signer = db.get(User, user.id)
    signer_name = signer.full_name if signer else user.username
    now = now_utc()

    def _set(field_index: int, value: dict) -> None:
        entry = (
            db.query(BmrEntry)
            .filter(BmrEntry.instance_id == instance.id, BmrEntry.section_id == section.id, BmrEntry.field_index == field_index)
            .first()
        )
        if entry and entry.value and (entry.value.get("signed_by") or entry.value.get("v") not in (None, "")):
            return  # уже заполнено/подписано — не трогаем
        if entry is None:
            entry = BmrEntry(instance_id=instance.id, section_id=section.id, field_index=field_index)
            db.add(entry)
        entry.value = value
        entry.filled_by = user.id
        entry.filled_at = now

    for alloc in alloc_lines:
        line = db.get(RequisitionLine, alloc.requisition_line_id)
        material = db.get(Material, line.material_id) if line else None
        if not material:
            continue
        targets = code_map.get(material.code)
        if not targets:
            continue
        lot = db.get(Lot, alloc.lot_id)
        supplier_lot = (lot.supplier_lot or lot.internal_lot) if lot else None
        qc = (
            db.query(QCReport).filter(QCReport.lot_id == alloc.lot_id).order_by(QCReport.created_at.desc()).first()
            if lot else None
        )
        report_no = qc.report_no if qc else None
        for field_base, planned in targets:
            if supplier_lot:
                _set(field_base + 0, {"v": supplier_lot, "source": "requisition"})
            if report_no:
                _set(field_base + 1, {"v": report_no, "source": "requisition"})
            planned_qty = _parse_qty(planned)
            if planned_qty:
                _set(field_base + 2, {"v": planned_qty, "source": "requisition"})
            _set(field_base + 3, {"signed_by": signer_name, "role": "warehouse", "signed_at": now.isoformat()})
    db.flush()


def create_requisition(db: Session, user: CurrentUser, payload: RequisitionCreate) -> ProductionRequisition:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION"))

    # Auto-generate requisition number
    count = db.query(func.count(ProductionRequisition.id)).scalar() or 0
    req_no = f"REQ-{now_utc().strftime('%Y%m%d')}-{count + 1:04d}"

    # Привязка к производственной серии (СОП-409): реквизиты берём из серии.
    product_name = payload.product_name
    product_series = payload.product_series
    production_date = payload.production_date
    batch_id = None
    if payload.production_batch_id:
        batch = _get_required(db, ProductionBatch, payload.production_batch_id, "Production batch")
        batch_id = batch.id
        product_name = batch.product_name
        product_series = batch.batch_no
        production_date = batch.production_date

    req = ProductionRequisition(
        requisition_no=req_no,
        status="submitted",
        production_batch_id=batch_id,
        product_name=product_name,
        product_series=product_series,
        production_date=production_date,
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
    _spill_distribution_to_bmr(db, req, alloc_lines, user)

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
    scope = view_scope_for(user)
    if scope:
        # Склад видит только требования, в которых есть строки его склада.
        query = query.filter(
            ProductionRequisition.lines.any(RequisitionLine.warehouse_type == scope)
        )
    return query.all()


def get_requisition(db: Session, user: CurrentUser, requisition_id: uuid.UUID) -> ProductionRequisition:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_WAREHOUSE"))
    return _get_required(db, ProductionRequisition, requisition_id, "Requisition")


def list_requisitions_for_batch(db: Session, user: CurrentUser, batch_id: uuid.UUID) -> list[ProductionRequisition]:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "EXECUTE_BMR", "VIEW_WAREHOUSE", "VIEW_QA", "QA_DECISION"))
    return (
        db.query(ProductionRequisition)
        .filter(ProductionRequisition.production_batch_id == batch_id)
        .order_by(ProductionRequisition.created_at.desc())
        .all()
    )


def build_requisition_item(db: Session, req: ProductionRequisition, scope: str | None = None) -> dict:
    """Build full nested response dict with allocation details.

    Если задан ``scope`` (тип склада), возвращаются только строки этого склада
    — «часть требования» для склад-пользователя. Производство/ДОК получают
    документ целиком (scope=None)."""
    all_lines = list(req.lines)
    visible_lines = [l for l in all_lines if l.warehouse_type == scope] if scope else all_lines
    result_lines = []
    for line in visible_lines:
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
    batch_no = None
    if req.production_batch_id:
        batch = db.get(ProductionBatch, req.production_batch_id)
        batch_no = batch.batch_no if batch else None
    return {
        "id": req.id,
        "requisition_no": req.requisition_no,
        "status": req.status,
        "production_batch_id": req.production_batch_id,
        "batch_no": batch_no,
        "product_name": req.product_name,
        "product_series": req.product_series,
        "production_date": req.production_date,
        "production_order_no": req.production_order_no,
        "notes": req.notes,
        "submitted_at": req.submitted_at,
        "scan_verified_at": req.scan_verified_at,
        "created_at": req.created_at,
        "lines": result_lines,
        "view_scope": scope,
        "is_partial_view": bool(scope) and len(visible_lines) != len(all_lines),
        "total_lines": len(all_lines),
    }
