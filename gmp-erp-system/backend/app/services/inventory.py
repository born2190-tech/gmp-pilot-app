from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import FGShipmentDocument, FGShipmentLine, InventoryCountDocument, InventoryCountLine, InventoryMovement, Lot, ReceiptDocument, ReceiptLine
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.schemas.inventory import AdjustLotRequest, FGShipmentCreate, InventoryCountCreate, IssueProductionRequest, MaterialCreateInline, ReceiptCreate, ReferenceCreateInline, SignatureRequest, TransferLotRequest
from app.services.audit import write_audit
from app.services.permissions import require_permission, require_warehouse_type_scope
from app.services.signature import validate_signature


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def receipt_line_production_year(line: ReceiptLine) -> int:
    if line.production_year:
        return line.production_year
    if line.production_date:
        return line.production_date.year
    return now_utc().year


def get_required(db: Session, model: type, object_id: UUID, label: str):
    row = db.get(model, object_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return row


def normalize_code(code: str) -> str:
    return code.strip().upper()


def get_or_create_reference(db: Session, user: CurrentUser, model: type, payload: ReferenceCreateInline | None, object_type: str):
    if not payload:
        return None
    code = normalize_code(payload.code)
    row = db.query(model).filter(model.code == code).first()
    if row:
        return row
    row = model(code=code, name=payload.name.strip())
    db.add(row)
    db.flush()
    write_audit(
        db,
        user,
        object_type=object_type,
        object_id=str(row.id),
        action_type="CREATE_FROM_RECEIPT",
        new_value={"code": row.code, "name": row.name},
        reason="Inline master data created during receipt",
    )
    return row


def get_or_create_material(db: Session, user: CurrentUser, payload: MaterialCreateInline | None) -> Material | None:
    if not payload:
        return None
    code = normalize_code(payload.code)
    row = db.query(Material).filter(Material.code == code).first()
    if row:
        return row
    row = Material(code=code, name=payload.name.strip(), item_type=payload.item_type.strip(), default_unit=payload.default_unit.strip())
    db.add(row)
    db.flush()
    write_audit(
        db,
        user,
        object_type="material",
        object_id=str(row.id),
        action_type="CREATE_FROM_RECEIPT",
        new_value={"code": row.code, "name": row.name, "item_type": row.item_type, "default_unit": row.default_unit},
        reason="Inline material created during receipt",
    )
    return row


def create_receipt_draft(db: Session, user: CurrentUser, payload: ReceiptCreate) -> ReceiptDocument:
    require_permission(user, "CREATE_RECEIPT")
    warehouse = get_required(db, Warehouse, payload.warehouse_id, "Warehouse")
    require_warehouse_type_scope(user, warehouse.warehouse_type)

    if db.query(ReceiptDocument).filter(ReceiptDocument.document_no == payload.document_no).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Receipt document number already exists")

    prepared_lines = []
    for line in payload.lines:
        material = get_required(db, Material, line.material_id, "Material") if line.material_id else get_or_create_material(db, user, line.material)
        if not material:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Material is required")
        supplier = get_required(db, Supplier, line.supplier_id, "Supplier") if line.supplier_id else get_or_create_reference(db, user, Supplier, line.supplier, "supplier")
        manufacturer = get_required(db, Manufacturer, line.manufacturer_id, "Manufacturer") if line.manufacturer_id else get_or_create_reference(db, user, Manufacturer, line.manufacturer, "manufacturer")
        if not manufacturer:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manufacturer is required for each receipt line")
        location = get_required(db, Location, line.location_id, "Location")
        if location.warehouse_id != warehouse.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Location does not belong to receipt warehouse")
        prepared_lines.append((line, material, supplier, manufacturer, location))

    document_supplier = prepared_lines[0][2]
    document_manufacturer = prepared_lines[0][3]
    receipt = ReceiptDocument(
        document_no=payload.document_no,
        status="draft",
        supplier=document_supplier,
        manufacturer=document_manufacturer,
        warehouse=warehouse,
        received_date=payload.received_date,
    )
    db.add(receipt)
    db.flush()

    for line, material, supplier, manufacturer, location in prepared_lines:
        db.add(
            ReceiptLine(
                receipt=receipt,
                material=material,
                supplier=supplier,
                manufacturer=manufacturer,
                supplier_lot=line.supplier_lot or None,
                production_date=line.production_date,
                production_year=receipt_line_production_year(line),
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


def normalize_material_series(value: str | None) -> str:
    return (value or "").strip()


def generate_internal_lot(line: ReceiptLine) -> str:
    series = normalize_material_series(line.supplier_lot)
    if not series:
        return f"LOT-{line.created_at.strftime('%Y%m%d')}-{str(line.id)[:8].upper()}"
    return series


def post_receipt(db: Session, user: CurrentUser, receipt_id: UUID, signature: SignatureRequest) -> tuple[ReceiptDocument, int]:
    require_permission(user, "POST_RECEIPT")
    receipt = get_required(db, ReceiptDocument, receipt_id, "Receipt")
    warehouse = get_required(db, Warehouse, receipt.warehouse_id, "Warehouse")
    require_warehouse_type_scope(user, warehouse.warehouse_type)
    if receipt.status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft receipt can be posted")

    # СОП-209 п.6.5: critical packaging defects must be returned to the
    # supplier before the receipt can be posted. Refuse if any open
    # critical-severity defect acts exist for this receipt.
    from app.services.receipt_defects import has_blocking_defects

    if has_blocking_defects(db, receipt.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Cannot post receipt — there are unresolved critical defect acts "
                "(СОП-209 Ф-12). Material must be returned to supplier or defects "
                "must be resolved by QA first."
            ),
        )

    validate_signature(db, user, signature, "POST_RECEIPT", "receipt_document", str(receipt.id))
    receipt.status = "posted"
    receipt.posted_by = user.id
    receipt.posted_at = now_utc()

    lots_created = 0
    quarantine_time = now_utc()
    lines = db.query(ReceiptLine).filter(ReceiptLine.receipt_id == receipt.id).order_by(ReceiptLine.created_at).all()
    for line in lines:
        material = get_required(db, Material, line.material_id, "Material")
        series = generate_internal_lot(line)
        if db.query(Lot.id).filter(Lot.internal_lot == series).first():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Material series already exists: {series}")
        lot = Lot(
            material_id=line.material_id,
            supplier_id=line.supplier_id,
            manufacturer_id=line.manufacturer_id,
            supplier_lot=line.supplier_lot or None,
            internal_lot=series,
            item_type=material.item_type,
            production_date=line.production_date,
            production_year=receipt_line_production_year(line),
            expiry_date=line.expiry_date,
            warehouse_id=receipt.warehouse_id,
            location_id=line.location_id,
            quantity=line.quantity,
            initial_quantity=line.quantity,
            unit=line.unit,
            quality_status="quarantine",
            incoming_control_notified_at=quarantine_time,
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

    # GMP gate (СОП-209): пока партия не прошла входной контроль и не получила
    # статус «released» от ОКК — её нельзя двигать в зону разрешённых
    # материалов или в любую другую зону кроме карантина / забракованных.
    # Это перекрывает возможность визуально «перевести» партию в RELEASED
    # без записи в journal QC notifications.
    if lot.quality_status != "released":
        allowed_codes = {"QUARANTINE", "REJECTED", "RECEIVING"}
        if target_location.code not in allowed_codes:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot move lot — quality status is not 'released'. "
                    "Wait for QC/QA decision (СОП-209). Allowed targets: "
                    "QUARANTINE, REJECTED, RECEIVING."
                ),
            )

    # Capture old values for audit before mutating.
    old_location_id = lot.location_id
    old_phys = {
        "rack_no": lot.rack_no,
        "sector_no": lot.sector_no,
        "tier_no": lot.tier_no,
        "place_no": lot.place_no,
        "pallet_no": lot.pallet_no,
    }

    # Normalise empty strings → None so the DB stores a clean NULL.
    def _norm(value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    new_phys = {
        "rack_no": _norm(payload.rack_no),
        "sector_no": _norm(payload.sector_no),
        "tier_no": _norm(payload.tier_no),
        "place_no": _norm(payload.place_no),
        "pallet_no": _norm(payload.pallet_no),
    }

    location_changed = target_location.id != old_location_id
    phys_changed = any(old_phys[k] != new_phys[k] for k in new_phys)

    if not location_changed and not phys_changed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Nothing to transfer — both target location and physical address are unchanged",
        )

    if location_changed:
        lot.location_id = target_location.id
    for key, value in new_phys.items():
        setattr(lot, key, value)

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
        old_value={"location_id": str(old_location_id), **old_phys},
        new_value={"location_id": str(target_location.id), **new_phys},
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


def create_inventory_count(db: Session, user: CurrentUser, payload: InventoryCountCreate) -> InventoryCountDocument:
    require_permission(user, "POST_RECEIPT")
    if db.query(InventoryCountDocument).filter(InventoryCountDocument.document_no == payload.document_no).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Inventory count document number already exists")

    first_lot = get_lot_for_operation(db, user, payload.lines[0].lot_id)
    warehouse = get_required(db, Warehouse, first_lot.warehouse_id, "Warehouse")
    validate_signature(db, user, payload, "POST_INVENTORY_COUNT", "inventory_count_document", payload.document_no)
    count = InventoryCountDocument(
        document_no=payload.document_no,
        status="posted",
        warehouse_id=warehouse.id,
        count_date=payload.count_date,
        posted_by=user.id,
        posted_at=now_utc(),
    )
    db.add(count)
    db.flush()

    for line in payload.lines:
        lot = get_lot_for_operation(db, user, line.lot_id)
        if lot.warehouse_id != warehouse.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="All counted lots must belong to one warehouse")
        old_quantity = lot.quantity
        variance = line.actual_quantity - old_quantity
        lot.quantity = line.actual_quantity
        db.add(
            InventoryCountLine(
                count_id=count.id,
                lot_id=lot.id,
                system_quantity=old_quantity,
                actual_quantity=line.actual_quantity,
                variance=variance,
                unit=lot.unit,
            )
        )
        db.add(
            InventoryMovement(
                movement_type="INVENTORY_COUNT",
                document_type="inventory_count",
                document_id=count.id,
                lot_id=lot.id,
                from_warehouse_id=lot.warehouse_id,
                from_location_id=lot.location_id,
                to_warehouse_id=lot.warehouse_id,
                to_location_id=lot.location_id,
                quantity_delta=variance,
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
            action_type="POST_INVENTORY_COUNT",
            old_value={"quantity": old_quantity},
            new_value={"quantity": lot.quantity, "variance": variance, "document_no": payload.document_no},
            reason=payload.reason,
        )

    write_audit(
        db,
        user,
        object_type="inventory_count_document",
        object_id=str(count.id),
        action_type="POST_INVENTORY_COUNT",
        new_value={"document_no": count.document_no, "warehouse_type": warehouse.warehouse_type, "lines": len(payload.lines)},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(count)
    return count
