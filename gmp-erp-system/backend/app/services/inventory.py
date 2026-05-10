from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import InventoryMovement, Lot, ReceiptDocument, ReceiptLine
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.schemas.inventory import ReceiptCreate, SignatureRequest
from app.services.audit import write_audit
from app.services.permissions import require_permission, require_warehouse_type_scope
from app.services.signature import validate_signature


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def get_required(db: Session, model: type, object_id: UUID, label: str):
    row = db.get(model, object_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return row


def create_receipt_draft(db: Session, user: CurrentUser, payload: ReceiptCreate) -> ReceiptDocument:
    require_permission(user, "CREATE_RECEIPT")
    supplier = get_required(db, Supplier, payload.supplier_id, "Supplier")
    manufacturer = get_required(db, Manufacturer, payload.manufacturer_id, "Manufacturer")
    warehouse = get_required(db, Warehouse, payload.warehouse_id, "Warehouse")
    require_warehouse_type_scope(user, warehouse.warehouse_type)

    if db.query(ReceiptDocument).filter(ReceiptDocument.document_no == payload.document_no).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Receipt document number already exists")

    receipt = ReceiptDocument(
        document_no=payload.document_no,
        status="draft",
        supplier=supplier,
        manufacturer=manufacturer,
        warehouse=warehouse,
        received_date=payload.received_date,
    )
    db.add(receipt)
    db.flush()

    for line in payload.lines:
        material = get_required(db, Material, line.material_id, "Material")
        location = get_required(db, Location, line.location_id, "Location")
        if location.warehouse_id != warehouse.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Location does not belong to receipt warehouse")
        db.add(
            ReceiptLine(
                receipt=receipt,
                material=material,
                supplier_lot=line.supplier_lot,
                production_date=line.production_date,
                production_year=line.production_year,
                expiry_date=line.expiry_date,
                quantity=line.quantity,
                unit=line.unit,
                location=location,
            )
        )

    write_audit(
        db,
        user,
        object_type="receipt_document",
        object_id=str(receipt.id),
        action_type="CREATE_RECEIPT_DRAFT",
        new_value={"document_no": receipt.document_no, "warehouse_type": warehouse.warehouse_type},
    )
    db.commit()
    db.refresh(receipt)
    return receipt


def generate_internal_lot(receipt: ReceiptDocument, line: ReceiptLine, sequence: int) -> str:
    return f"LOT-{receipt.received_date.strftime('%Y%m%d')}-{receipt.document_no}-{sequence:02d}"


def post_receipt(db: Session, user: CurrentUser, receipt_id: UUID, signature: SignatureRequest) -> tuple[ReceiptDocument, int]:
    require_permission(user, "POST_RECEIPT")
    receipt = get_required(db, ReceiptDocument, receipt_id, "Receipt")
    warehouse = get_required(db, Warehouse, receipt.warehouse_id, "Warehouse")
    require_warehouse_type_scope(user, warehouse.warehouse_type)
    if receipt.status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft receipt can be posted")

    validate_signature(db, user, signature, "POST_RECEIPT", "receipt_document", str(receipt.id))
    receipt.status = "posted"
    receipt.posted_by = user.id
    receipt.posted_at = now_utc()

    lots_created = 0
    lines = db.query(ReceiptLine).filter(ReceiptLine.receipt_id == receipt.id).order_by(ReceiptLine.created_at).all()
    for index, line in enumerate(lines, start=1):
        material = get_required(db, Material, line.material_id, "Material")
        lot = Lot(
            material_id=line.material_id,
            supplier_id=receipt.supplier_id,
            manufacturer_id=receipt.manufacturer_id,
            supplier_lot=line.supplier_lot,
            internal_lot=generate_internal_lot(receipt, line, index),
            item_type=material.item_type,
            production_date=line.production_date,
            production_year=line.production_year,
            expiry_date=line.expiry_date,
            warehouse_id=receipt.warehouse_id,
            location_id=line.location_id,
            quantity=line.quantity,
            unit=line.unit,
            quality_status="quarantine",
            incoming_control_notified_at=now_utc(),
        )
        db.add(lot)
        db.flush()
        db.add(
            InventoryMovement(
                movement_type="RECEIPT",
                document_type="receipt_document",
                document_id=receipt.id,
                lot_id=lot.id,
                from_warehouse_id=None,
                from_location_id=None,
                to_warehouse_id=receipt.warehouse_id,
                to_location_id=line.location_id,
                quantity_delta=line.quantity,
                quantity_after=line.quantity,
                unit=line.unit,
                reason=signature.reason,
                user_id=user.id,
                workstation_id=user.workstation_id,
            )
        )
        lots_created += 1

    write_audit(
        db,
        user,
        object_type="receipt_document",
        object_id=str(receipt.id),
        action_type="POST_RECEIPT",
        old_value={"status": "draft"},
        new_value={"status": "posted", "lots_created": lots_created},
        reason=signature.reason,
    )
    db.commit()
    db.refresh(receipt)
    return receipt, lots_created
