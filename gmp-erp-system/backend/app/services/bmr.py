"""Конструктор шаблонов электронного BMR/ЗПС (СОП-11) — Phase A."""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.identity import User
from app.models.inventory import (
    BmrEntry,
    BmrInstance,
    BmrInstanceSection,
    BmrSection,
    BmrTemplate,
    ProductionBatch,
    Product,
)
from app.schemas.bmr import (
    BmrEntriesSaveRequest,
    BmrInstanceActionRequest,
    BmrSignRequest,
    BmrTemplateApproveRequest,
    BmrTemplateCreate,
    BmrTemplateUpdate,
)
from app.services.audit import write_audit
from app.services.signature import validate_signature


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _require_any(user: CurrentUser, codes: tuple[str, ...]) -> None:
    if not any(c in user.permissions for c in codes):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"One of permissions {', '.join(codes)} is required",
        )


_VIEW = ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "MANAGE_BMR_TEMPLATES", "QA_DECISION")
_EDIT = ("MANAGE_BMR_TEMPLATES",)
_APPROVE = ("QA_DECISION",)


def _product_fields(db: Session, product_id: UUID) -> dict:
    p = db.get(Product, product_id)
    return {
        "product_code": p.code if p else None,
        "product_name": p.name if p else None,
        "market_code": p.market_code if p else None,
    }


def list_templates(db: Session, user: CurrentUser) -> list[dict]:
    _require_any(user, _VIEW)
    rows = db.query(BmrTemplate).order_by(BmrTemplate.updated_at.desc()).all()
    out: list[dict] = []
    for t in rows:
        count = db.query(func.count(BmrSection.id)).filter(BmrSection.template_id == t.id).scalar() or 0
        out.append({
            "id": t.id, "product_id": t.product_id, **_product_fields(db, t.product_id),
            "title": t.title, "version": t.version, "status": t.status,
            "effective_date": t.effective_date, "sections_count": int(count),
            "updated_at": t.updated_at,
        })
    return out


def get_template(db: Session, user: CurrentUser, template_id: UUID) -> dict:
    _require_any(user, _VIEW)
    t = db.get(BmrTemplate, template_id)
    if not t:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BMR template not found")
    return {
        "id": t.id, "product_id": t.product_id, **_product_fields(db, t.product_id),
        "title": t.title, "version": t.version, "status": t.status,
        "effective_date": t.effective_date, "notes": t.notes,
        "created_by": t.created_by, "approved_by": t.approved_by, "approved_at": t.approved_at,
        "sections": [
            {"id": s.id, "ordinal": s.ordinal, "section_type": s.section_type, "title": s.title, "config": s.config or {}}
            for s in t.sections
        ],
    }


def _next_version(db: Session, product_id: UUID) -> int:
    existing = db.query(func.max(BmrTemplate.version)).filter(BmrTemplate.product_id == product_id).scalar()
    return int(existing or 0) + 1


def create_template(db: Session, user: CurrentUser, payload: BmrTemplateCreate) -> BmrTemplate:
    _require_any(user, _EDIT)
    product = db.get(Product, payload.product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Продукт (ЛС) не найден")
    template = BmrTemplate(
        product_id=product.id,
        title=payload.title.strip(),
        version=_next_version(db, product.id),
        status="draft",
        notes=payload.notes,
        created_by=user.id,
    )
    db.add(template)
    db.flush()
    for idx, sec in enumerate(payload.sections, start=1):
        db.add(BmrSection(
            template_id=template.id, ordinal=idx,
            section_type=sec.section_type, title=sec.title.strip(), config=sec.config or {},
        ))
    write_audit(
        db, user, object_type="bmr_template", object_id=str(template.id),
        action_type="CREATE_BMR_TEMPLATE",
        new_value={"product": product.code, "title": template.title, "version": template.version},
    )
    db.commit()
    db.refresh(template)
    return template


def update_template(db: Session, user: CurrentUser, template_id: UUID, payload: BmrTemplateUpdate) -> BmrTemplate:
    _require_any(user, _EDIT)
    t = db.get(BmrTemplate, template_id)
    if not t:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BMR template not found")
    if t.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Редактировать можно только черновик. Создайте новую версию (дублирование).",
        )
    t.title = payload.title.strip()
    t.notes = payload.notes
    db.query(BmrSection).filter(BmrSection.template_id == t.id).delete()
    db.flush()
    for idx, sec in enumerate(payload.sections, start=1):
        db.add(BmrSection(
            template_id=t.id, ordinal=idx,
            section_type=sec.section_type, title=sec.title.strip(), config=sec.config or {},
        ))
    write_audit(
        db, user, object_type="bmr_template", object_id=str(t.id),
        action_type="UPDATE_BMR_TEMPLATE",
        new_value={"title": t.title, "sections": len(payload.sections)},
    )
    db.commit()
    db.refresh(t)
    return t


def duplicate_template(db: Session, user: CurrentUser, template_id: UUID) -> BmrTemplate:
    """Новая редакция: копия как новый черновик с version+1 (СОП-11 п.5.4)."""
    _require_any(user, _EDIT)
    src = db.get(BmrTemplate, template_id)
    if not src:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BMR template not found")
    copy = BmrTemplate(
        product_id=src.product_id,
        title=src.title,
        version=_next_version(db, src.product_id),
        status="draft",
        notes=src.notes,
        created_by=user.id,
    )
    db.add(copy)
    db.flush()
    for s in src.sections:
        db.add(BmrSection(template_id=copy.id, ordinal=s.ordinal, section_type=s.section_type, title=s.title, config=s.config or {}))
    write_audit(
        db, user, object_type="bmr_template", object_id=str(copy.id),
        action_type="DUPLICATE_BMR_TEMPLATE",
        new_value={"from": str(src.id), "version": copy.version},
    )
    db.commit()
    db.refresh(copy)
    return copy


def approve_template(db: Session, user: CurrentUser, template_id: UUID, payload: BmrTemplateApproveRequest) -> BmrTemplate:
    """ДОК утверждает шаблон (СОП-11 п.5.1.5). Прочие approved-версии продукта → obsolete."""
    _require_any(user, _APPROVE)
    t = db.get(BmrTemplate, template_id)
    if not t:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BMR template not found")
    if t.status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Утвердить можно только черновик")
    if not t.sections:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя утвердить пустой шаблон")
    # Старые действующие версии того же продукта — в архив.
    db.query(BmrTemplate).filter(
        BmrTemplate.product_id == t.product_id,
        BmrTemplate.status == "approved",
        BmrTemplate.id != t.id,
    ).update({BmrTemplate.status: "obsolete"})
    t.status = "approved"
    t.approved_by = user.id
    t.approved_at = now_utc()
    t.effective_date = payload.effective_date or date.today()
    write_audit(
        db, user, object_type="bmr_template", object_id=str(t.id),
        action_type="APPROVE_BMR_TEMPLATE",
        new_value={"version": t.version, "effective_date": str(t.effective_date), "sop": "SOP-11"},
    )
    db.commit()
    db.refresh(t)
    return t


# ---------------------------------------------------------------------------
# BMR instance (per batch) — Phase B
# ---------------------------------------------------------------------------

def _approved_template_for_product(db: Session, product_id: UUID) -> BmrTemplate | None:
    return (
        db.query(BmrTemplate)
        .filter(BmrTemplate.product_id == product_id, BmrTemplate.status == "approved")
        .order_by(BmrTemplate.version.desc())
        .first()
    )


def create_instance_for_batch(db: Session, user: CurrentUser, batch: ProductionBatch) -> BmrInstance | None:
    """При выдаче ЗПС создаёт экземпляр BMR из утверждённого шаблона продукта.

    Идемпотентно: если экземпляр уже есть для серии — возвращает его. Если у
    продукта нет approved-шаблона — возвращает None (бумажный BMR / шаблон не
    готов). Коммит делает вызывающая транзакция (issue_bmr)."""
    existing = db.query(BmrInstance).filter(BmrInstance.production_batch_id == batch.id).first()
    if existing:
        return existing
    template = _approved_template_for_product(db, batch.product_id) if batch.product_id else None
    if not template:
        return None
    instance = BmrInstance(
        production_batch_id=batch.id,
        template_id=template.id,
        template_version=template.version,
        title=template.title,
        status="issued",
        created_by=user.id,
    )
    db.add(instance)
    db.flush()
    for s in template.sections:
        db.add(BmrInstanceSection(
            instance_id=instance.id, ordinal=s.ordinal,
            section_type=s.section_type, title=s.title, config=s.config or {},
        ))
    write_audit(
        db, user, object_type="bmr_instance", object_id=str(instance.id),
        action_type="CREATE_BMR_INSTANCE",
        new_value={"batch_no": batch.batch_no, "template_version": template.version, "sop": "SOP-11"},
    )
    db.flush()
    return instance


def _instance_dict(db: Session, instance: BmrInstance) -> dict:
    batch = db.get(ProductionBatch, instance.production_batch_id)
    rows = (
        db.query(BmrEntry, User.full_name)
        .outerjoin(User, User.id == BmrEntry.filled_by)
        .filter(BmrEntry.instance_id == instance.id)
        .all()
    )
    return {
        "id": instance.id,
        "production_batch_id": instance.production_batch_id,
        "batch_no": batch.batch_no if batch else None,
        "template_id": instance.template_id,
        "template_version": instance.template_version,
        "title": instance.title,
        "status": instance.status,
        "started_at": instance.started_at,
        "completed_at": instance.completed_at,
        "reviewed_at": instance.reviewed_at,
        "sections": [
            {"id": s.id, "ordinal": s.ordinal, "section_type": s.section_type, "title": s.title, "config": s.config or {}}
            for s in instance.sections
        ],
        "entries": [
            {"section_id": e.section_id, "field_index": e.field_index, "value": e.value,
             "filled_by_name": name, "filled_at": e.filled_at}
            for e, name in rows
        ],
    }


# ---------------------------------------------------------------------------
# Fill / sign / complete / review — Phase C
# ---------------------------------------------------------------------------

_FILL = ("EXECUTE_BMR", "MANAGE_PRODUCTION")


def _get_instance(db: Session, instance_id: UUID) -> BmrInstance:
    inst = db.get(BmrInstance, instance_id)
    if not inst:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BMR instance not found")
    return inst


def _mark_started(inst: BmrInstance, user: CurrentUser) -> None:
    if inst.status == "issued":
        inst.status = "in_progress"
        inst.started_by = user.id
        inst.started_at = now_utc()


def save_entries(db: Session, user: CurrentUser, instance_id: UUID, payload: BmrEntriesSaveRequest) -> dict:
    _require_any(user, _FILL)
    inst = _get_instance(db, instance_id)
    if inst.status in ("completed", "reviewed"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="BMR закрыт — правка запрещена")
    section_ids = {s.id for s in inst.sections}
    for item in payload.entries:
        if item.section_id not in section_ids:
            continue
        entry = (
            db.query(BmrEntry)
            .filter(BmrEntry.section_id == item.section_id, BmrEntry.field_index == item.field_index)
            .first()
        )
        if entry is None:
            entry = BmrEntry(instance_id=inst.id, section_id=item.section_id, field_index=item.field_index)
            db.add(entry)
        entry.value = {"v": item.value}
        entry.filled_by = user.id
        entry.filled_at = now_utc()
    _mark_started(inst, user)
    db.commit()
    db.refresh(inst)
    return _instance_dict(db, inst)


def sign_field(db: Session, user: CurrentUser, instance_id: UUID, payload: BmrSignRequest) -> dict:
    inst = _get_instance(db, instance_id)
    if inst.status in ("completed", "reviewed"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="BMR закрыт — подпись запрещена")
    section = next((s for s in inst.sections if s.id == payload.section_id), None)
    if not section:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Секция не найдена")
    fields = (section.config or {}).get("fields", [])
    if payload.field_index < 0 or payload.field_index >= len(fields):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Поле не найдено")
    ftype = fields[payload.field_index].get("type")
    if ftype == "signature_qa":
        _require_any(user, ("QA_DECISION",))
        role = "qa"
    elif ftype == "signature_operator":
        _require_any(user, _FILL)
        role = "operator"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Это поле не является подписью")
    validate_signature(db, user, payload, "SIGN_BMR_FIELD", "bmr_instance", str(inst.id))
    signer = db.query(User).filter(User.username == payload.username).first()
    entry = (
        db.query(BmrEntry)
        .filter(BmrEntry.section_id == payload.section_id, BmrEntry.field_index == payload.field_index)
        .first()
    )
    if entry is None:
        entry = BmrEntry(instance_id=inst.id, section_id=payload.section_id, field_index=payload.field_index)
        db.add(entry)
    entry.value = {"signed_by": signer.full_name if signer else payload.username, "role": role, "signed_at": now_utc().isoformat()}
    entry.filled_by = user.id
    entry.filled_at = now_utc()
    _mark_started(inst, user)
    write_audit(
        db, user, object_type="bmr_instance", object_id=str(inst.id),
        action_type="SIGN_BMR_FIELD",
        new_value={"section": section.title, "role": role}, reason=payload.reason,
    )
    db.commit()
    db.refresh(inst)
    return _instance_dict(db, inst)


def complete_instance(db: Session, user: CurrentUser, instance_id: UUID, payload: BmrInstanceActionRequest) -> dict:
    """Производство фиксирует, что BMR заполнен (СОП-11 п.5.2.7.14)."""
    _require_any(user, _FILL)
    inst = _get_instance(db, instance_id)
    if inst.status not in ("in_progress", "issued"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="BMR уже завершён или проверен")
    validate_signature(db, user, payload, "COMPLETE_BMR", "bmr_instance", str(inst.id))
    inst.status = "completed"
    inst.completed_by = user.id
    inst.completed_at = now_utc()
    write_audit(db, user, object_type="bmr_instance", object_id=str(inst.id),
                action_type="COMPLETE_BMR", new_value={"status": inst.status}, reason=payload.reason)
    db.commit()
    db.refresh(inst)
    return _instance_dict(db, inst)


def review_instance(db: Session, user: CurrentUser, instance_id: UUID, payload: BmrInstanceActionRequest) -> dict:
    """ДОК рассматривает заполненный BMR (СОП-11 п.5.2.7.14)."""
    _require_any(user, ("QA_DECISION",))
    inst = _get_instance(db, instance_id)
    if inst.status != "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Проверить можно только завершённый BMR")
    validate_signature(db, user, payload, "REVIEW_BMR", "bmr_instance", str(inst.id))
    inst.status = "reviewed"
    inst.reviewed_by = user.id
    inst.reviewed_at = now_utc()
    write_audit(db, user, object_type="bmr_instance", object_id=str(inst.id),
                action_type="REVIEW_BMR", new_value={"status": inst.status}, reason=payload.reason)
    db.commit()
    db.refresh(inst)
    return _instance_dict(db, inst)


def get_instance(db: Session, user: CurrentUser, instance_id: UUID) -> dict:
    _require_any(user, _VIEW + ("EXECUTE_BMR",))
    inst = db.get(BmrInstance, instance_id)
    if not inst:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BMR instance not found")
    return _instance_dict(db, inst)


def get_instance_for_batch(db: Session, user: CurrentUser, batch_id: UUID) -> dict | None:
    _require_any(user, _VIEW + ("EXECUTE_BMR",))
    inst = db.query(BmrInstance).filter(BmrInstance.production_batch_id == batch_id).first()
    return _instance_dict(db, inst) if inst else None
