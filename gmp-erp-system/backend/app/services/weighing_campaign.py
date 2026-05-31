"""Межсерийная кампания взвешивания (СОП-497, task #14).

Начальник цеха собирает серии дня в кампанию; ведётся сводная ведомость
материалов ПО СЕРИЯМ. Вес фиксируется отдельно по каждой серии, подписи
Склад/ДП/ДОК ставятся независимой e-аутентификацией подписанта и РАСТЕКАЮТСЯ в
секцию распределения (distribution_list) посерийного BMR — каждый BMR остаётся
полным и независимым для PDF.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
import re
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import CurrentUser
from app.models.inventory import (
    BmrEntry,
    BmrInstance,
    BmrInstanceSection,
    ProductionBatch,
    WeighingCampaign,
)
from app.schemas.weighing_campaign import (
    WeighingCampaignAddSeries,
    WeighingCampaignCreate,
    WeighingCampaignSaveNet,
    WeighingCampaignSignCell,
)
from app.services.audit import write_audit
from app.services.signature import validate_independent_signature

_MANAGE = ("MANAGE_PRODUCTION",)
# Кладовщик (POST_RECEIPT) тоже участвует в кампании (выдача/вес) и может смотреть.
_VIEW = ("MANAGE_PRODUCTION", "VIEW_PRODUCTION", "QA_DECISION", "EXECUTE_BMR", "POST_RECEIPT")

# Роль ячейки → требуемое право подписанта + код роли подписи в BMR.
_ROLE_PERMS = {
    "warehouse": (("POST_RECEIPT",), "warehouse"),
    "dp": (("EXECUTE_BMR", "MANAGE_PRODUCTION"), "operator"),
    "qa": (("QA_DECISION",), "qa"),
}
# Раскладка полей одного ингредиента в distribution_list (6 полей по порядку):
# 0 № серии сырья, 1 № аналит. листа, 2 вес нетто, 3 Склад, 4 ДП, 5 ДОК.
_NET_OFFSET = 2
_SIGN_OFFSET = {"warehouse": 3, "dp": 4, "qa": 5}
# Роль запроса → ключ подписи в ячейке ведомости (wh/dp/qa).
_CELL_KEY = {"warehouse": "wh", "dp": "dp", "qa": "qa"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _require_any(user: CurrentUser, codes: tuple[str, ...]) -> None:
    if not any(c in user.permissions for c in codes):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Требуется одно из прав: {', '.join(codes)}")


def _slug(name: str) -> str:
    return re.sub(r"[^a-zа-я0-9]+", "_", name.strip().lower()).strip("_")


def _next_code(db: Session, campaign_date: date) -> str:
    prefix = f"WC-{campaign_date.strftime('%Y%m%d')}"
    n = db.query(func.count(WeighingCampaign.id)).filter(WeighingCampaign.code.like(f"{prefix}%")).scalar() or 0
    return f"{prefix}-{n + 1:02d}"


def _weighing_section(instance: BmrInstance) -> BmrInstanceSection | None:
    """Секция distribution_list стадии взвешивания посерийного BMR."""
    fallback = None
    for section in instance.sections:
        config = section.config or {}
        if config.get("kind") != "distribution_list":
            continue
        if config.get("stage") == "weighing":
            return section
        fallback = fallback or section
    return fallback


def _ingredients(section: BmrInstanceSection) -> list[dict]:
    """Ингредиенты distribution_list с базовым индексом полей (4 поля на позицию)."""
    out: list[dict] = []
    base = 0
    for group in (section.config or {}).get("groups", []):
        for item in group.get("items", []):
            out.append({
                "name": item.get("name"),
                "unit": "кг",
                "qty": item.get("qty"),
                "section_id": str(section.id),
                "field_base": base,
            })
            base += 6
    return out


def _batch_meta(db: Session, batch_id: UUID) -> dict | None:
    batch = db.get(ProductionBatch, batch_id)
    if not batch:
        return None
    instance = db.query(BmrInstance).filter(BmrInstance.production_batch_id == batch.id).first()
    return {
        "batch_id": str(batch.id),
        "bmr_instance_id": str(instance.id) if instance else None,
        "batch_no": batch.batch_no,
        "product_name": batch.product_name,
        "product_code": batch.product_code,
    }


def _rebuild_ledger(db: Session, campaign: WeighingCampaign) -> None:
    """Пересобирает сводную ведомость из distribution_list посерийных BMR,
    сохраняя уже введённые веса/подписи по ячейкам."""
    old = {row["key"]: row for row in (campaign.ledger or [])}
    rows: dict[str, dict] = {}
    order: list[str] = []
    for b in campaign.batches or []:
        instance_id = b.get("bmr_instance_id")
        if not instance_id:
            continue
        instance = db.get(BmrInstance, UUID(instance_id))
        if not instance:
            continue
        section = _weighing_section(instance)
        if not section:
            continue
        for ing in _ingredients(section):
            key = _slug(ing["name"] or "")
            if key not in rows:
                prev = old.get(key, {})
                rows[key] = {
                    "key": key,
                    "ingredient": ing["name"],
                    "unit": ing["unit"],
                    "lot_no": prev.get("lot_no"),
                    "cells": {},
                }
                order.append(key)
            prev_cell = (old.get(key, {}).get("cells", {}) or {}).get(b["batch_id"], {})
            rows[key]["cells"][b["batch_id"]] = {
                "planned": ing["qty"],
                "net": prev_cell.get("net"),
                "section_id": ing["section_id"],
                "field_base": ing["field_base"],
                "wh": prev_cell.get("wh"),
                "dp": prev_cell.get("dp"),
                "qa": prev_cell.get("qa"),
            }
    campaign.ledger = [rows[k] for k in order]


def _find_row(campaign: WeighingCampaign, ingredient_key: str) -> dict:
    for row in campaign.ledger or []:
        if row["key"] == ingredient_key:
            return row
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ингредиент не найден в ведомости")


def _find_cell(campaign: WeighingCampaign, ingredient_key: str, batch_id: str) -> dict:
    row = _find_row(campaign, ingredient_key)
    cell = (row.get("cells") or {}).get(batch_id)
    if not cell:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Серия не входит в эту строку ведомости")
    return cell


def _bmr_entry(db: Session, instance_id: UUID, section_id: UUID, field_index: int) -> BmrEntry:
    entry = (
        db.query(BmrEntry)
        .filter(BmrEntry.instance_id == instance_id, BmrEntry.section_id == section_id, BmrEntry.field_index == field_index)
        .first()
    )
    if entry is None:
        entry = BmrEntry(instance_id=instance_id, section_id=section_id, field_index=field_index)
        db.add(entry)
    return entry


def _instance_for_batch(db: Session, batch_id: str) -> UUID | None:
    inst = db.query(BmrInstance).filter(BmrInstance.production_batch_id == UUID(batch_id)).first()
    return inst.id if inst else None


# ---------------------------------------------------------------------------

def list_campaigns(db: Session, user: CurrentUser) -> list[dict]:
    _require_any(user, _VIEW)
    out: list[dict] = []
    for c in db.query(WeighingCampaign).order_by(WeighingCampaign.campaign_date.desc(), WeighingCampaign.code.desc()).all():
        out.append({
            "id": c.id, "code": c.code, "title": c.title, "campaign_date": c.campaign_date,
            "room": c.room, "status": c.status, "series_count": len(c.batches or []), "updated_at": c.updated_at,
        })
    return out


def get_campaign(db: Session, user: CurrentUser, campaign_id: UUID) -> WeighingCampaign:
    _require_any(user, _VIEW)
    c = db.get(WeighingCampaign, campaign_id)
    if not c:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Кампания не найдена")
    return c


def create_campaign(db: Session, user: CurrentUser, payload: WeighingCampaignCreate) -> WeighingCampaign:
    _require_any(user, _MANAGE)
    campaign = WeighingCampaign(
        code=_next_code(db, payload.campaign_date),
        title=(payload.title or f"Кампания взвешивания {payload.campaign_date.strftime('%d.%m.%Y')}").strip(),
        campaign_date=payload.campaign_date,
        room=payload.room,
        status="draft",
        created_by=user.id,
        batches=[],
        ledger=[],
    )
    db.add(campaign)
    db.flush()
    _set_series(db, campaign, [str(b) for b in payload.batch_ids])
    write_audit(db, user, object_type="weighing_campaign", object_id=str(campaign.id),
                action_type="CREATE_WEIGHING_CAMPAIGN", new_value={"code": campaign.code, "series": len(campaign.batches)})
    db.commit()
    db.refresh(campaign)
    return campaign


def _set_series(db: Session, campaign: WeighingCampaign, batch_ids: list[str]) -> None:
    existing = {b["batch_id"] for b in (campaign.batches or [])}
    batches = list(campaign.batches or [])
    for bid in batch_ids:
        if bid in existing:
            continue
        meta = _batch_meta(db, UUID(bid))
        if meta:
            batches.append(meta)
            existing.add(bid)
    campaign.batches = batches
    _rebuild_ledger(db, campaign)


def add_series(db: Session, user: CurrentUser, campaign_id: UUID, payload: WeighingCampaignAddSeries) -> WeighingCampaign:
    _require_any(user, _MANAGE)
    campaign = get_campaign(db, user, campaign_id)
    if campaign.status == "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Кампания закрыта")
    _set_series(db, campaign, [str(b) for b in payload.batch_ids])
    write_audit(db, user, object_type="weighing_campaign", object_id=str(campaign.id),
                action_type="UPDATE_WEIGHING_CAMPAIGN", new_value={"series": len(campaign.batches)})
    db.commit()
    db.refresh(campaign)
    return campaign


def remove_series(db: Session, user: CurrentUser, campaign_id: UUID, batch_id: UUID) -> WeighingCampaign:
    _require_any(user, _MANAGE)
    campaign = get_campaign(db, user, campaign_id)
    if campaign.status == "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Кампания закрыта")
    campaign.batches = [b for b in (campaign.batches or []) if b["batch_id"] != str(batch_id)]
    _rebuild_ledger(db, campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


def set_lot(db: Session, user: CurrentUser, campaign_id: UUID, ingredient_key: str, lot_no: str | None) -> WeighingCampaign:
    """Одна входящая партия (FEFO) на несколько серий: лот общий на ингредиент."""
    _require_any(user, _MANAGE + ("POST_RECEIPT",))
    campaign = get_campaign(db, user, campaign_id)
    if campaign.status == "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Кампания закрыта")
    row = _find_row(campaign, ingredient_key)
    row["lot_no"] = (lot_no or "").strip() or None
    flag_modified(campaign, "ledger")
    db.commit()
    db.refresh(campaign)
    return campaign


def save_net(db: Session, user: CurrentUser, campaign_id: UUID, payload: WeighingCampaignSaveNet) -> WeighingCampaign:
    """Вес нетто фиксируется ОТДЕЛЬНО по каждой серии; растекается в BMR серии."""
    _require_any(user, ("EXECUTE_BMR", "MANAGE_PRODUCTION", "POST_RECEIPT"))
    campaign = get_campaign(db, user, campaign_id)
    if campaign.status == "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Кампания закрыта")
    cell = _find_cell(campaign, payload.ingredient_key, str(payload.batch_id))
    if cell.get("wh"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Вес уже подписан Складом — правка запрещена")
    cell["net"] = payload.net
    instance_id = _instance_for_batch(db, str(payload.batch_id))
    if instance_id and cell.get("section_id"):
        entry = _bmr_entry(db, instance_id, UUID(cell["section_id"]), int(cell["field_base"]) + _NET_OFFSET)
        entry.value = {"v": payload.net, "source": "weighing_campaign"}
        entry.filled_by = user.id
        entry.filled_at = now_utc()
    flag_modified(campaign, "ledger")
    db.commit()
    db.refresh(campaign)
    return campaign


def sign_cell(db: Session, user: CurrentUser, campaign_id: UUID, payload: WeighingCampaignSignCell) -> WeighingCampaign:
    """Подпись ячейки (Склад/ДП/ДОК) независимой e-аутентификацией; растекание в BMR."""
    campaign = get_campaign(db, user, campaign_id)
    if campaign.status == "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Кампания закрыта")
    cell = _find_cell(campaign, payload.ingredient_key, str(payload.batch_id))
    required, bmr_role = _ROLE_PERMS[payload.role]
    # Порядок: вес → Склад → ДП → ДОК (как в листе распределения BMR).
    if payload.role == "warehouse" and cell.get("net") in (None, ""):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Сначала зафиксируйте вес нетто")
    if payload.role == "dp" and not cell.get("wh"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Сначала подпись Склада")
    if payload.role == "qa" and not cell.get("dp"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Сначала подпись ДП")
    cell_key = _CELL_KEY[payload.role]
    if cell.get(cell_key):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ячейка уже подписана этой ролью")

    signer = validate_independent_signature(
        db, user, payload, "SIGN_WEIGHING_CAMPAIGN", "weighing_campaign", str(campaign.id), required,
    )
    signed_at = now_utc().isoformat()
    cell[cell_key] = {"by": signer.full_name, "at": signed_at}

    instance_id = _instance_for_batch(db, str(payload.batch_id))
    if instance_id and cell.get("section_id"):
        field_index = int(cell["field_base"]) + _SIGN_OFFSET[payload.role]
        entry = _bmr_entry(db, instance_id, UUID(cell["section_id"]), field_index)
        entry.value = {"signed_by": signer.full_name, "role": bmr_role, "signed_at": signed_at}
        entry.filled_by = signer.id
        entry.filled_at = now_utc()

    flag_modified(campaign, "ledger")
    write_audit(db, user, object_type="weighing_campaign", object_id=str(campaign.id),
                action_type="SIGN_WEIGHING_CAMPAIGN",
                new_value={"ingredient": payload.ingredient_key, "role": payload.role}, reason=payload.reason)
    db.commit()
    db.refresh(campaign)
    return campaign


def set_status(db: Session, user: CurrentUser, campaign_id: UUID, new_status: str) -> WeighingCampaign:
    _require_any(user, _MANAGE)
    if new_status not in ("draft", "active", "completed"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимый статус")
    campaign = get_campaign(db, user, campaign_id)
    campaign.status = new_status
    write_audit(db, user, object_type="weighing_campaign", object_id=str(campaign.id),
                action_type="STATUS_WEIGHING_CAMPAIGN", new_value={"status": new_status})
    db.commit()
    db.refresh(campaign)
    return campaign
