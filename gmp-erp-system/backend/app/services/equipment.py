"""Реестр КИП: CRUD + расчёт статуса калибровки.

Статус калибровки прибора (по последней действующей записи):
- `ok`       — действует, осталось > 30 дней
- `expiring` — действует, осталось <= 30 дней
- `expired`  — последняя калибровка просрочена
- `missing`  — нет ни одной записи

При сохранении аналитического листа допускаются только приборы со
статусом `ok` или `expiring` (просроченная/отсутствующая калибровка
блокирует — GMP Annex 15).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.equipment import Equipment, EquipmentCalibration
from app.schemas.equipment import (
    CALIBRATION_STATUS_EXPIRED,
    CALIBRATION_STATUS_EXPIRING,
    CALIBRATION_STATUS_MISSING,
    CALIBRATION_STATUS_OK,
    EquipmentCalibrationCreate,
    EquipmentCalibrationItem,
    EquipmentCreate,
    EquipmentDetail,
    EquipmentItem,
    EquipmentUpdate,
)
from app.services.audit import write_audit
from app.services.permissions import require_permission


EXPIRING_WINDOW_DAYS = 30


def _latest_calibration(db: Session, equipment_id: UUID) -> EquipmentCalibration | None:
    return (
        db.query(EquipmentCalibration)
        .filter(EquipmentCalibration.equipment_id == equipment_id)
        .order_by(EquipmentCalibration.valid_until.desc())
        .first()
    )


def _calibration_status(latest: EquipmentCalibration | None, today: date | None = None) -> str:
    if latest is None:
        return CALIBRATION_STATUS_MISSING
    today = today or date.today()
    if latest.valid_until < today:
        return CALIBRATION_STATUS_EXPIRED
    if latest.valid_until <= today + timedelta(days=EXPIRING_WINDOW_DAYS):
        return CALIBRATION_STATUS_EXPIRING
    return CALIBRATION_STATUS_OK


def _to_item(equipment: Equipment, latest: EquipmentCalibration | None) -> EquipmentItem:
    return EquipmentItem(
        id=equipment.id,
        code=equipment.code,
        name=equipment.name,
        category=equipment.category,
        manufacturer=equipment.manufacturer,
        model=equipment.model,
        serial_no=equipment.serial_no,
        location=equipment.location,
        is_active=equipment.is_active,
        notes=equipment.notes,
        calibration_status=_calibration_status(latest),
        calibration_valid_until=latest.valid_until if latest else None,
        calibration_certificate_no=latest.certificate_no if latest else None,
    )


def list_equipment(
    db: Session,
    *,
    only_active: bool = False,
    category: str | None = None,
) -> list[EquipmentItem]:
    query = db.query(Equipment)
    if only_active:
        query = query.filter(Equipment.is_active.is_(True))
    if category:
        query = query.filter(Equipment.category == category)
    rows = query.order_by(Equipment.code).all()
    return [_to_item(row, _latest_calibration(db, row.id)) for row in rows]


def get_equipment_detail(db: Session, equipment_id: UUID) -> EquipmentDetail:
    equipment = db.get(Equipment, equipment_id)
    if equipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Equipment not found")
    calibrations = (
        db.query(EquipmentCalibration)
        .filter(EquipmentCalibration.equipment_id == equipment_id)
        .order_by(EquipmentCalibration.valid_until.desc())
        .all()
    )
    latest = calibrations[0] if calibrations else None
    item = _to_item(equipment, latest)
    return EquipmentDetail(
        **item.model_dump(),
        calibrations=[EquipmentCalibrationItem.model_validate(row) for row in calibrations],
    )


def create_equipment(db: Session, user: CurrentUser, payload: EquipmentCreate) -> EquipmentDetail:
    require_permission(user, "EQUIPMENT_MANAGE")
    code = payload.code.strip().upper()
    if db.query(Equipment).filter(Equipment.code == code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Equipment code already exists")

    equipment = Equipment(
        code=code,
        name=payload.name.strip(),
        category=(payload.category or None),
        manufacturer=payload.manufacturer,
        model=payload.model,
        serial_no=payload.serial_no,
        location=payload.location,
        notes=payload.notes,
        is_active=True,
    )
    db.add(equipment)
    db.flush()
    write_audit(
        db,
        user,
        object_type="equipment",
        object_id=str(equipment.id),
        action_type="CREATE",
        new_value={"code": equipment.code, "name": equipment.name, "category": equipment.category},
        reason="Equipment registered",
    )
    db.commit()
    db.refresh(equipment)
    return get_equipment_detail(db, equipment.id)


def update_equipment(
    db: Session, user: CurrentUser, equipment_id: UUID, payload: EquipmentUpdate
) -> EquipmentDetail:
    require_permission(user, "EQUIPMENT_MANAGE")
    equipment = db.get(Equipment, equipment_id)
    if equipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Equipment not found")

    changes: dict[str, object] = {}
    for field in ("name", "category", "manufacturer", "model", "serial_no", "location", "notes", "is_active"):
        value = getattr(payload, field)
        if value is not None and getattr(equipment, field) != value:
            changes[field] = value
            setattr(equipment, field, value)
    if not changes:
        return get_equipment_detail(db, equipment_id)

    write_audit(
        db,
        user,
        object_type="equipment",
        object_id=str(equipment.id),
        action_type="UPDATE",
        new_value=changes,
        reason="Equipment updated",
    )
    db.commit()
    return get_equipment_detail(db, equipment_id)


def add_calibration(
    db: Session, user: CurrentUser, equipment_id: UUID, payload: EquipmentCalibrationCreate
) -> EquipmentDetail:
    require_permission(user, "EQUIPMENT_MANAGE")
    equipment = db.get(Equipment, equipment_id)
    if equipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Equipment not found")
    if payload.valid_until < payload.valid_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="valid_until must be on or after valid_from",
        )

    row = EquipmentCalibration(
        equipment_id=equipment.id,
        certificate_no=payload.certificate_no,
        performed_by=payload.performed_by,
        valid_from=payload.valid_from,
        valid_until=payload.valid_until,
        notes=payload.notes,
        recorded_by=user.id,
        recorded_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.flush()
    write_audit(
        db,
        user,
        object_type="equipment_calibration",
        object_id=str(row.id),
        action_type="CREATE",
        new_value={
            "equipment_id": str(equipment.id),
            "certificate_no": payload.certificate_no,
            "valid_from": payload.valid_from.isoformat(),
            "valid_until": payload.valid_until.isoformat(),
        },
        reason="Equipment calibration recorded",
    )
    db.commit()
    return get_equipment_detail(db, equipment.id)


def resolve_equipment_for_report(
    db: Session, equipment_ids: list[UUID]
) -> list[Equipment]:
    """Загружает приборы по UUID и проверяет, что у каждого валидная калибровка.

    Допускается `ok` или `expiring`; `expired` / `missing` отбрасываются с 422.
    Дубликаты ID игнорируются, порядок сохраняется.
    """
    if not equipment_ids:
        return []
    seen: set[UUID] = set()
    ordered: list[UUID] = []
    for eq_id in equipment_ids:
        if eq_id in seen:
            continue
        seen.add(eq_id)
        ordered.append(eq_id)

    rows = db.query(Equipment).filter(Equipment.id.in_(ordered)).all()
    by_id = {row.id: row for row in rows}
    missing = [eq_id for eq_id in ordered if eq_id not in by_id]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Equipment not found: {', '.join(str(x) for x in missing)}",
        )

    blocked: list[str] = []
    for eq_id in ordered:
        equipment = by_id[eq_id]
        if not equipment.is_active:
            blocked.append(f"{equipment.code} (неактивен)")
            continue
        latest = _latest_calibration(db, eq_id)
        st = _calibration_status(latest)
        if st in (CALIBRATION_STATUS_EXPIRED, CALIBRATION_STATUS_MISSING):
            blocked.append(f"{equipment.code} ({st})")

    if blocked:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Калибровка прибора недействительна: " + "; ".join(blocked),
        )
    return [by_id[eq_id] for eq_id in ordered]


def calibration_status_for(db: Session, equipment_id: UUID) -> str:
    return _calibration_status(_latest_calibration(db, equipment_id))
