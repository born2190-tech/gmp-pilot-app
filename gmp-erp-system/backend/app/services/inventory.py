from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import FGShipmentDocument, FGShipmentLine, InventoryMovement, Lot, ReceiptDocument, ReceiptLine
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.schemas.inventory import AdjustLotRequest, FGShipmentCreate, IssueProductionRequest, ReceiptCreate, SignatureRequest, TransferLotRequest
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


def get_lot_for_operation(db: Session, user: CurrentUser, lot_id: UUID) -> Lot:
    require_permission(user, "VIEW_WAREHOUSE")
    lot = get_required(db, Lot, lot_id, "Lot")
    warehouse = get_required(db, Warehouse, lot.warehouse_id, "Warehouse")
    require_warehouse_type_scope(user, warehouse.warehouse_type)
    return lot


def transfer_lot(db: Session, user: CurrentUser, lot_id: UUID, payload: TransferLotRequest) -> Lot:
    require_permission(user, "VIEW_WAREHOUSE")
    lot = get_lot_for_operation(db, user, lot_id)
    target_location = get_required(db, Location, payload.to_location_id, "Location")
    if target_location.warehouse_id != lot.warehouse_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target location must belong to the same warehouse")
    if target_location.id == lot.location_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lot is already in this location")

    old_location_id = lot.location_id
    lot.location_id = target_location.id
    db.add(
        InventoryMovement(
            movement_type="TRANSFER",
            document_type="warehouse_transfer",
            document_id=lot.id,
            lot_id=lot.id,
            from_warehouse_id=lot.warehouse_id,
            from_location_id=old_location_id,
            to_warehouse_id=lot.warehouse_id,
            to_location_id=target_location.id,
            quantity_delta=0,
            quantity_after=lot.quantity,
            unit=lot.unit,
            reason=payload.reason,
            user_id=user.id,
            workstation_id=user.workstation_id,
        )
    )
    write_audit(
        db,
        user,
        object_type="lot",
        object_id=str(lot.id),
        action_type="TRANSFER_LOT",
        old_value={"location_id": str(old_location_id)},
        new_value={"location_id": str(target_location.id)},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(lot)
    return lot


def adjust_lot(db: Session, user: CurrentUser, lot_id: UUID, payload: AdjustLotRequest) -> Lot:
    require_permission(user, "POST_RECEIPT")
    lot = get_lot_for_operation(db, user, lot_id)
    validate_signature(db, user, payload, "ADJUST_STOCK", "lot", str(lot.id))
    old_quantity = lot.quantity
    delta = payload.new_quantity - old_quantity
    lot.quantity = payload.new_quantity
    db.add(
        InventoryMovement(
            movement_type="ADJUSTMENT",
            document_type="stock_adjustment",
            document_id=lot.id,
            lot_id=lot.id,
            from_warehouse_id=lot.warehouse_id,
            from_location_id=lot.location_id,
            to_warehouse_id=lot.warehouse_id,
            to_location_id=lot.location_id,
            quantity_delta=delta,
            quantity_after=lot.quantity,
            unit=lot.unit,
            reason=payload.reason,
            user_id=user.id,
            workstation_id=user.workstation_id,
        )
    )
    write_audit(
        db,
        user,
        object_type="lot",
        object_id=str(lot.id),
        action_type="ADJUST_STOCK",
        old_value={"quantity": old_quantity},
        new_value={"quantity": lot.quantity, "delta": delta},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(lot)
    return lot


def issue_to_production(db: Session, user: CurrentUser, lot_id: UUID, payload: IssueProductionRequest) -> Lot:
    require_permission(user, "POST_RECEIPT")
    lot = get_lot_for_operation(db, user, lot_id)
    if lot.quality_status != "released":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only released lots can be issued to production")
    if payload.quantity > lot.quantity:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Issue quantity exceeds available stock")

    validate_signature(db, user, payload, "ISSUE_TO_PRODUCTION", "lot", str(lot.id))
    old_quantity = lot.quantity
    lot.quantity = lot.quantity - payload.quantity
    db.add(
        InventoryMovement(
            movement_type="ISSUE_PRODUCTION",
            document_type="production_issue",
            document_id=lot.id,
            lot_id=lot.id,
            from_warehouse_id=lot.warehouse_id,
            from_location_id=lot.location_id,
            to_warehouse_id=None,
            to_location_id=None,
            quantity_delta=-payload.quantity,
            quantity_after=lot.quantity,
            unit=lot.unit,
            reason=f"{payload.production_order_no}: {payload.reason or ''}".strip(),
            user_id=user.id,
            workstation_id=user.workstation_id,
        )
    )
    write_audit(
        db,
        user,
        object_type="lot",
        object_id=str(lot.id),
        action_type="ISSUE_TO_PRODUCTION",
        old_value={"quantity": old_quantity},
        new_value={"quantity": lot.quantity, "production_order_no": payload.production_order_no, "issued_quantity": payload.quantity},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(lot)
    return lot


def create_fg_shipment(db: Session, user: CurrentUser, payload: FGShipmentCreate) -> FGShipmentDocument:
    require_permission(user, "POST_RECEIPT")
    if db.query(FGShipmentDocument).filter(FGShipmentDocument.document_no == payload.document_no).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Shipment document number already exists")

    validate_signature(db, user, payload, "SHIP_FINISHED_GOODS", "fg_shipment_document", payload.document_no)
    shipment = FGShipmentDocument(
        document_no=payload.document_no,
        status="posted",
        customer_name=payload.customer_name,
        customer_tax_id=payload.customer_tax_id,
        destination_address=payload.destination_address,
        shipment_date=payload.shipment_date,
        vehicle_no=payload.vehicle_no,
        waybill_no=payload.waybill_no,
        posted_by=user.id,
        posted_at=now_utc(),
    )
    db.add(shipment)
    db.flush()

    for line in payload.lines:
        lot = get_lot_for_operation(db, user, line.lot_id)
        warehouse = get_required(db, Warehouse, lot.warehouse_id, "Warehouse")
        if warehouse.warehouse_type != "FG_WAREHOUSE":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only finished goods warehouse lots can be shipped")
        if lot.quality_status != "released":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only released finished goods can be shipped")
        if line.quantity > lot.quantity:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Shipment quantity exceeds available stock")

        old_quantity = lot.quantity
        lot.quantity = lot.quantity - line.quantity
        db.add(
            FGShipmentLine(
                shipment_id=shipment.id,
                lot_id=lot.id,
                quantity=line.quantity,
                unit=lot.unit,
                quantity_after=lot.quantity,
            )
        )
        db.add(
            InventoryMovement(
                movement_type="SHIPMENT",
                document_type="fg_shipment",
                document_id=shipment.id,
                lot_id=lot.id,
                from_warehouse_id=lot.warehouse_id,
                from_location_id=lot.location_id,
                to_warehouse_id=None,
                to_location_id=None,
                quantity_delta=-line.quantity,
                quantity_after=lot.quantity,
                unit=lot.unit,
                reason=f"{payload.customer_name}: {payload.reason or ''}".strip(),
                user_id=user.id,
                workstation_id=user.workstation_id,
            )
        )
        write_audit(
            db,
            user,
            object_type="lot",
            object_id=str(lot.id),
            action_type="SHIP_FINISHED_GOODS",
            old_value={"quantity": old_quantity},
            new_value={
                "quantity": lot.quantity,
                "shipment_document_no": payload.document_no,
                "customer_name": payload.customer_name,
                "shipped_quantity": line.quantity,
            },
            reason=payload.reason,
        )

    write_audit(
        db,
        user,
        object_type="fg_shipment_document",
        object_id=str(shipment.id),
        action_type="POST_FG_SHIPMENT",
        new_value={"document_no": shipment.document_no, "customer_name": shipment.customer_name, "lines": len(payload.lines)},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(shipment)
    return shipment
