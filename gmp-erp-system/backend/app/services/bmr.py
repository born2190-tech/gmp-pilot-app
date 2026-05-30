"""Конструктор шаблонов электронного BMR/ЗПС (СОП-11) — Phase A."""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import BmrSection, BmrTemplate, Product
from app.schemas.bmr import BmrTemplateApproveRequest, BmrTemplateCreate, BmrTemplateUpdate
from app.services.audit import write_audit


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
