"""Подбор счёта учёта по (вид × зона) и перенос стоимости между счетами.

Счёт партии меняется по мере прохождения зон качества:
приём → карантин, допуск ОКА → допущенные, брак → брак, выдача в цех → НЗП.
При смене счёта пишется движение ACCOUNT_TRANSFER, оценённое по себестоимости
партии, — оно отражается в оборотной ведомости (расход со счёта / приход на счёт).
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import InventoryMovement, Lot
from app.models.master_data import InventoryAccount
from app.services.audit import write_audit
from app.services.permissions import require_permission

# Карта статуса качества партии → зона счёта.
_ZONE_BY_STATUS = {
    "quarantine": "QUARANTINE",
    "sampled": "QUARANTINE",
    "under_test": "QUARANTINE",
    "released": "RELEASED",
    "rejected": "REJECTED",
}


def zone_for_status(quality_status: str | None) -> str:
    return _ZONE_BY_STATUS.get(quality_status or "", "QUARANTINE")


def list_accounts(db: Session) -> list[InventoryAccount]:
    return db.query(InventoryAccount).order_by(InventoryAccount.code).all()


def get_account(db: Session, account_id: uuid.UUID) -> InventoryAccount:
    acc = db.get(InventoryAccount, account_id)
    if not acc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return acc


def create_account(db: Session, user: CurrentUser, payload) -> InventoryAccount:
    require_permission(user, "MANAGE_MASTER_DATA")
    if db.query(InventoryAccount).filter(InventoryAccount.code == payload.code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Account code already exists")
    acc = InventoryAccount(
        code=payload.code,
        name=payload.name,
        account_group=payload.account_group,
        zone=payload.zone,
        is_active=payload.is_active,
    )
    db.add(acc)
    write_audit(db, user, object_type="inventory_account", object_id=payload.code,
                action_type="CREATE_ACCOUNT", new_value={"code": payload.code, "name": payload.name})
    db.commit()
    db.refresh(acc)
    return acc


def update_account(db: Session, user: CurrentUser, account_id: uuid.UUID, payload) -> InventoryAccount:
    require_permission(user, "MANAGE_MASTER_DATA")
    acc = get_account(db, account_id)
    if payload.code != acc.code and db.query(InventoryAccount).filter(InventoryAccount.code == payload.code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Account code already exists")
    acc.code = payload.code
    acc.name = payload.name
    acc.account_group = payload.account_group
    acc.zone = payload.zone
    acc.is_active = payload.is_active
    write_audit(db, user, object_type="inventory_account", object_id=str(acc.id),
                action_type="UPDATE_ACCOUNT", new_value={"code": acc.code, "name": acc.name})
    db.commit()
    db.refresh(acc)
    return acc


def delete_account(db: Session, user: CurrentUser, account_id: uuid.UUID) -> None:
    require_permission(user, "MANAGE_MASTER_DATA")
    acc = get_account(db, account_id)
    in_use = db.query(Lot.id).filter(Lot.account_id == acc.id).first()
    if in_use:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Account is used by lots — deactivate instead")
    write_audit(db, user, object_type="inventory_account", object_id=str(acc.id),
                action_type="DELETE_ACCOUNT", old_value={"code": acc.code})
    db.delete(acc)
    db.commit()


def resolve_account(db: Session, group: str | None, zone: str) -> InventoryAccount | None:
    """Активный счёт для пары (вид × зона)."""
    if not group:
        return None
    return (
        db.query(InventoryAccount)
        .filter(
            InventoryAccount.account_group == group,
            InventoryAccount.zone == zone,
            InventoryAccount.is_active.is_(True),
        )
        .first()
    )


def move_lot_account(
    db: Session,
    lot: Lot,
    new_zone: str,
    *,
    user_id: uuid.UUID,
    workstation_id: str,
    document_type: str,
    document_id: uuid.UUID,
    reason: str | None = None,
) -> None:
    """Переносит партию на счёт целевой зоны и пишет ACCOUNT_TRANSFER.

    Группа берётся из текущего счёта партии (если задан) либо из материала.
    Если целевой счёт не найден или совпадает с текущим — ничего не делает.
    """
    group: str | None = None
    if lot.account_id:
        current = db.get(InventoryAccount, lot.account_id)
        group = current.account_group if current else None
    if group is None:
        from app.models.master_data import Material

        material = db.get(Material, lot.material_id)
        group = material.account_group if material else None

    target = resolve_account(db, group, new_zone)
    if target is None or target.id == lot.account_id:
        if target is not None:
            lot.account_id = target.id
        return

    from_account_id = lot.account_id
    db.add(
        InventoryMovement(
            movement_type="ACCOUNT_TRANSFER",
            document_type=document_type,
            document_id=document_id,
            lot_id=lot.id,
            from_warehouse_id=lot.warehouse_id,
            from_location_id=lot.location_id,
            to_warehouse_id=lot.warehouse_id,
            to_location_id=lot.location_id,
            from_account_id=from_account_id,
            to_account_id=target.id,
            # Переносится полная стоимость остатка — qty для оценки оборота,
            # фактический остаток партии не меняется.
            quantity_delta=lot.quantity,
            quantity_after=lot.quantity,
            unit=lot.unit,
            reason=reason,
            user_id=user_id,
            workstation_id=workstation_id,
        )
    )
    lot.account_id = target.id
