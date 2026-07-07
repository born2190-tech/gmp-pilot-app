"""Склад готовой продукции — приёмка серий из цеха (СОП-205).

Поток (п.6.2): цех выпускает накладную на перемещение упакованной продукции
(Ф-1, KAR-FP) на завершённую серию → склад ГП принимает её, создавая партии
ГП (`Lot`) в зоне карантина склада FG. Дальнейший допуск карантин → хранение
(п.6.3) делается перемещением после разрешения ДКК/УЛ (следующий спринт).
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import (
    FGRelease,
    FGTransferNote,
    FGTransferNoteLine,
    InventoryMovement,
    Lot,
    ProductionBatch,
)
from app.models.master_data import Location, Manufacturer, Material, Warehouse
from app.schemas.inventory import (
    FGQuarantineLotItem,
    FGReleaseRequest,
    FGTransferNoteCreate,
    SignatureRequest,
)
from app.services.audit import write_audit
from app.services.permissions import require_permission
from app.services.signature import validate_signature

# Собственный производитель — для партий ГП, выпущенных предприятием.
OWN_MANUFACTURER_CODE = "NOVUGEN"
OWN_MANUFACTURER_NAME = "NOVUGEN PHARMA"
DEFAULT_WORKSHOP = "Цех по производству твёрдых лекарственных форм №1"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _get_required(db: Session, model: type, object_id: UUID, label: str):
    row = db.get(model, object_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return row


def get_or_create_own_manufacturer(db: Session) -> Manufacturer:
    row = db.query(Manufacturer).filter(Manufacturer.code == OWN_MANUFACTURER_CODE).first()
    if row is None:
        row = Manufacturer(code=OWN_MANUFACTURER_CODE, name=OWN_MANUFACTURER_NAME)
        db.add(row)
        db.flush()
    return row


def get_or_create_fg_material(db: Session, product_code: str, product_name: str) -> Material:
    """Материал-зеркало готового продукта.

    Партия ГП хранится в общей модели `Lot`, у которой `material_id` обязателен.
    Для каждого продукта заводим материал вида FINISHED_GOOD (код «FG-<код>»),
    чтобы переиспользовать всю складскую машинерию (движения, отгрузка, реестры)
    без изменения модели лота.
    """
    code = f"FG-{product_code}"
    row = db.query(Material).filter(Material.code == code).first()
    if row is None:
        row = Material(
            code=code,
            name=product_name,
            item_type="FINISHED_GOOD",
            default_unit="упак",
        )
        db.add(row)
        db.flush()
    return row


def _fg_warehouse(db: Session) -> Warehouse:
    wh = db.query(Warehouse).filter(Warehouse.warehouse_type == "FG_WAREHOUSE").first()
    if wh is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Склад готовой продукции не настроен")
    return wh


def _location(db: Session, warehouse: Warehouse, code: str, label: str) -> Location:
    loc = (
        db.query(Location)
        .filter(Location.warehouse_id == warehouse.id, Location.code == code)
        .first()
    )
    if loc is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"На складе ГП нет зоны {label}")
    return loc


def _quarantine_location(db: Session, warehouse: Warehouse) -> Location:
    return _location(db, warehouse, "QUARANTINE", "карантина")


def create_fg_transfer_note(db: Session, user: CurrentUser, payload: FGTransferNoteCreate) -> FGTransferNote:
    """Цех выпускает накладную на завершённую серию (СОП-205 п.6.2)."""
    require_permission(user, "MANAGE_PRODUCTION")
    batch = _get_required(db, ProductionBatch, payload.production_batch_id, "Production batch")
    if batch.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Накладную на склад ГП можно выпустить только для завершённой серии",
        )
    existing = (
        db.query(FGTransferNote)
        .filter(FGTransferNote.production_batch_id == batch.id, FGTransferNote.status != "cancelled")
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Накладная на эту серию уже существует: {existing.note_no}",
        )

    note_no = (payload.note_no or f"KAR-FP-{batch.batch_no}").strip()
    if db.query(FGTransferNote).filter(FGTransferNote.note_no == note_no).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Номер накладной уже существует")

    validate_signature(db, user, payload, "ISSUE_FG_TRANSFER", "fg_transfer_note", note_no)

    note = FGTransferNote(
        note_no=note_no,
        status="issued",
        production_batch_id=batch.id,
        product_code=batch.product_code,
        product_name=batch.product_name,
        batch_no=batch.batch_no,
        dosage_form=batch.dosage_form,
        production_date=batch.production_date,
        expiry_date=batch.expiry_date,
        from_workshop=(payload.from_workshop or DEFAULT_WORKSHOP).strip(),
        corrugated_boxes=payload.corrugated_boxes,
        issued_by=user.id,
        issued_at=now_utc(),
        notes=payload.notes,
    )
    db.add(note)
    db.flush()
    for line in payload.lines:
        db.add(
            FGTransferNoteLine(
                note_id=note.id,
                description=line.description.strip(),
                quantity=line.quantity,
                unit=(line.unit or "упак").strip(),
            )
        )

    write_audit(
        db,
        user,
        object_type="fg_transfer_note",
        object_id=str(note.id),
        action_type="ISSUE_FG_TRANSFER",
        new_value={"note_no": note.note_no, "batch_no": note.batch_no, "lines": len(payload.lines)},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(note)
    return note


def receive_fg_transfer_note(db: Session, user: CurrentUser, note_id: UUID, payload: SignatureRequest) -> FGTransferNote:
    """Склад ГП принимает накладную: создаёт партии ГП в зоне карантина."""
    require_permission(user, "RECEIVE_FINISHED_GOODS")
    note = _get_required(db, FGTransferNote, note_id, "FG transfer note")
    if note.status != "issued":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Принять можно только выпущенную (issued) накладную",
        )

    warehouse = _fg_warehouse(db)
    quarantine = _quarantine_location(db, warehouse)
    manufacturer = get_or_create_own_manufacturer(db)
    material = get_or_create_fg_material(db, note.product_code, note.product_name)

    validate_signature(db, user, payload, "RECEIVE_FINISHED_GOODS", "fg_transfer_note", note.note_no)

    lines = (
        db.query(FGTransferNoteLine)
        .filter(FGTransferNoteLine.note_id == note.id)
        .order_by(FGTransferNoteLine.created_at)
        .all()
    )
    production_year = note.production_date.year if note.production_date else now_utc().year
    received_at = now_utc()
    for idx, line in enumerate(lines, start=1):
        internal_lot = note.batch_no if len(lines) == 1 else f"{note.batch_no}/{idx}"
        if db.query(Lot.id).filter(Lot.internal_lot == internal_lot).first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Партия ГП с номером серии уже существует: {internal_lot}",
            )
        lot = Lot(
            material_id=material.id,
            manufacturer_id=manufacturer.id,
            internal_lot=internal_lot,
            item_type="FINISHED_GOOD",
            production_date=note.production_date,
            production_year=production_year,
            expiry_date=note.expiry_date,
            warehouse_id=warehouse.id,
            location_id=quarantine.id,
            quantity=line.quantity,
            initial_quantity=line.quantity,
            unit=line.unit,
            currency="UZS",
            quality_status="quarantine",
            incoming_control_notified_at=received_at,
        )
        db.add(lot)
        db.flush()
        line.lot_id = lot.id
        db.add(
            InventoryMovement(
                movement_type="RECEIPT",
                document_type="fg_transfer_note",
                document_id=note.id,
                lot_id=lot.id,
                from_warehouse_id=None,
                from_location_id=None,
                to_warehouse_id=warehouse.id,
                to_location_id=quarantine.id,
                quantity_delta=line.quantity,
                quantity_after=line.quantity,
                unit=line.unit,
                reason=payload.reason or f"Приёмка ГП по накладной {note.note_no}",
                user_id=user.id,
                workstation_id=user.workstation_id,
            )
        )

    note.status = "received"
    note.received_by = user.id
    note.received_at = received_at
    note.received_warehouse_id = warehouse.id

    write_audit(
        db,
        user,
        object_type="fg_transfer_note",
        object_id=str(note.id),
        action_type="RECEIVE_FINISHED_GOODS",
        old_value={"status": "issued"},
        new_value={"status": "received", "lots_created": len(lines), "warehouse": warehouse.code},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(note)
    return note


def cancel_fg_transfer_note(db: Session, user: CurrentUser, note_id: UUID, payload: SignatureRequest) -> FGTransferNote:
    """Цех отменяет ещё не принятую накладную."""
    require_permission(user, "MANAGE_PRODUCTION")
    note = _get_required(db, FGTransferNote, note_id, "FG transfer note")
    if note.status != "issued":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Отменить можно только выпущенную (issued) накладную",
        )
    validate_signature(db, user, payload, "CANCEL_FG_TRANSFER", "fg_transfer_note", note.note_no)
    note.status = "cancelled"
    note.cancelled_by = user.id
    note.cancelled_at = now_utc()
    note.cancel_reason = payload.reason
    write_audit(
        db,
        user,
        object_type="fg_transfer_note",
        object_id=str(note.id),
        action_type="CANCEL_FG_TRANSFER",
        old_value={"status": "issued"},
        new_value={"status": "cancelled"},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(note)
    return note


# ---------------------------------------------------------------------------
# Допуск карантин → зона хранения (СОП-205 п.6.3)
# ---------------------------------------------------------------------------


def _fg_lot(db: Session, lot_id: UUID) -> tuple[Lot, Warehouse]:
    lot = _get_required(db, Lot, lot_id, "Lot")
    warehouse = _get_required(db, Warehouse, lot.warehouse_id, "Warehouse")
    if warehouse.warehouse_type != "FG_WAREHOUSE":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Партия не на складе готовой продукции")
    return lot, warehouse


def list_fg_quarantine_lots(db: Session, user: CurrentUser) -> list[FGQuarantineLotItem]:
    """Партии ГП, физически находящиеся в зоне карантина (ожидают допуска ДКК/УЛ
    либо допущены, но ещё не перемещены в хранение). Видят склад и ОКА."""
    if not ({"VIEW_WAREHOUSE", "QA_DECISION"} & set(user.permissions)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    warehouse = _fg_warehouse(db)
    quarantine = _quarantine_location(db, warehouse)
    rows = (
        db.query(Lot)
        .filter(Lot.warehouse_id == warehouse.id, Lot.location_id == quarantine.id)
        .order_by(Lot.expiry_date)
        .all()
    )
    items: list[FGQuarantineLotItem] = []
    for lot in rows:
        material = db.get(Material, lot.material_id)
        rel = db.query(FGRelease).filter(FGRelease.lot_id == lot.id).first()
        items.append(
            FGQuarantineLotItem(
                lot_id=lot.id,
                internal_lot=lot.internal_lot,
                product_name=material.name if material else "",
                quantity=lot.quantity,
                unit=lot.unit,
                production_date=lot.production_date,
                expiry_date=lot.expiry_date,
                quality_status=lot.quality_status,
                location_code=quarantine.code,
                released=rel is not None or lot.quality_status == "released",
                analytical_passport_no=rel.analytical_passport_no if rel else None,
                certificate_no=rel.certificate_no if rel else None,
            )
        )
    return items


def release_fg_lot(db: Session, user: CurrentUser, lot_id: UUID, payload: FGReleaseRequest) -> Lot:
    """Допуск серии ГП к реализации ДКК/УЛ (Аналит. паспорт + разрешение УЛ)."""
    require_permission(user, "QA_DECISION")
    lot, _ = _fg_lot(db, lot_id)
    if lot.quality_status != "quarantine":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Допуск возможен только для карантинной партии ГП")
    if db.query(FGRelease).filter(FGRelease.lot_id == lot.id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Партия уже допущена")

    validate_signature(db, user, payload, "RELEASE_FINISHED_GOODS", "lot", str(lot.id))
    now = now_utc()
    lot.quality_status = "released"
    lot.qa_decision_at = now
    db.add(
        FGRelease(
            lot_id=lot.id,
            analytical_passport_no=payload.analytical_passport_no.strip(),
            certificate_no=(payload.certificate_no or None),
            released_by=user.id,
            released_at=now,
            notes=payload.reason,
        )
    )
    write_audit(
        db,
        user,
        object_type="lot",
        object_id=str(lot.id),
        action_type="RELEASE_FINISHED_GOODS",
        old_value={"quality_status": "quarantine"},
        new_value={"quality_status": "released", "analytical_passport_no": payload.analytical_passport_no},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(lot)
    return lot


def move_fg_to_storage(db: Session, user: CurrentUser, lot_id: UUID, payload: SignatureRequest) -> Lot:
    """Склад перемещает допущенную партию из карантина в зону хранения."""
    require_permission(user, "RECEIVE_FINISHED_GOODS")
    lot, warehouse = _fg_lot(db, lot_id)
    if lot.quality_status != "released":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Перемещение в хранение возможно только после допуска ДКК/УЛ",
        )
    storage = _location(db, warehouse, "RELEASED", "хранения")
    if lot.location_id == storage.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Партия уже в зоне хранения")

    validate_signature(db, user, payload, "MOVE_FG_STORAGE", "lot", str(lot.id))
    old_location = lot.location_id
    lot.location_id = storage.id
    db.add(
        InventoryMovement(
            movement_type="TRANSFER",
            document_type="fg_move_storage",
            document_id=lot.id,
            lot_id=lot.id,
            from_warehouse_id=warehouse.id,
            from_location_id=old_location,
            to_warehouse_id=warehouse.id,
            to_location_id=storage.id,
            quantity_delta=0,
            quantity_after=lot.quantity,
            unit=lot.unit,
            reason=payload.reason or "Карантин → зона хранения (СОП-205 п.6.3)",
            user_id=user.id,
            workstation_id=user.workstation_id,
        )
    )
    write_audit(
        db,
        user,
        object_type="lot",
        object_id=str(lot.id),
        action_type="MOVE_FG_STORAGE",
        old_value={"location_id": str(old_location)},
        new_value={"location_id": str(storage.id)},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(lot)
    return lot
