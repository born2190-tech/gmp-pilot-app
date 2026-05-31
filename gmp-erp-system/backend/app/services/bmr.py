"""Конструктор шаблонов электронного BMR/ЗПС (СОП-11) — Phase A."""
from __future__ import annotations

from datetime import date, datetime, timezone
import re
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
from app.services.signature import validate_independent_signature, validate_signature


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
    db.flush()
    _ensure_previous_process_entries(db, instance)
    write_audit(
        db, user, object_type="bmr_instance", object_id=str(instance.id),
        action_type="CREATE_BMR_INSTANCE",
        new_value={"batch_no": batch.batch_no, "template_version": template.version, "sop": "SOP-11"},
    )
    db.flush()
    return instance


def _field_index_by_label(section: BmrInstanceSection, label_part: str) -> int | None:
    needle = label_part.lower()
    for index, field in enumerate((section.config or {}).get("fields", [])):
        if needle in str(field.get("label") or "").lower():
            return index
    return None


def _previous_batch_for_room(db: Session, instance: BmrInstance, room: str | None) -> ProductionBatch | None:
    if not room:
        return None
    current_batch = db.get(ProductionBatch, instance.production_batch_id)
    if not current_batch:
        return None
    return (
        db.query(ProductionBatch)
        .join(BmrInstance, BmrInstance.production_batch_id == ProductionBatch.id)
        .join(BmrInstanceSection, BmrInstanceSection.instance_id == BmrInstance.id)
        .filter(
            BmrInstance.production_batch_id != instance.production_batch_id,
            BmrInstance.created_at < instance.created_at,
            BmrInstanceSection.config["room"].astext == room,
            ProductionBatch.status != "cancelled",
        )
        .order_by(
            BmrInstance.created_at.desc(),
            ProductionBatch.completed_at.desc().nullslast(),
            ProductionBatch.started_at.desc().nullslast(),
        )
        .first()
    )


def _set_system_prefill_if_empty(
    db: Session,
    instance: BmrInstance,
    section: BmrInstanceSection,
    field_index: int | None,
    value: str | None,
) -> bool:
    if field_index is None or not value:
        return False
    entry = (
        db.query(BmrEntry)
        .filter(BmrEntry.instance_id == instance.id, BmrEntry.section_id == section.id, BmrEntry.field_index == field_index)
        .first()
    )
    if entry and _entry_is_complete(entry):
        return False
    if entry is None:
        entry = BmrEntry(instance_id=instance.id, section_id=section.id, field_index=field_index)
        db.add(entry)
    entry.value = {"v": value, "source": "system_previous_stage"}
    entry.filled_by = None
    entry.filled_at = now_utc()
    return True


def _ensure_previous_process_entries(db: Session, instance: BmrInstance) -> bool:
    changed = False
    for section in instance.sections:
        if str((section.config or {}).get("kind") or section.section_type) != "process_header":
            continue
        previous = _previous_batch_for_room(db, instance, (section.config or {}).get("room"))
        if not previous:
            continue
        changed = _set_system_prefill_if_empty(
            db, instance, section, _field_index_by_label(section, "Предыдущий ЛС"), previous.product_name
        ) or changed
        changed = _set_system_prefill_if_empty(
            db, instance, section, _field_index_by_label(section, "Предыдущая серия"), previous.batch_no
        ) or changed
    if changed:
        db.flush()
    return changed


def _instance_dict(db: Session, instance: BmrInstance, user: CurrentUser | None = None) -> dict:
    batch = db.get(ProductionBatch, instance.production_batch_id)
    sections = _visible_sections(instance, user) if user else list(instance.sections)
    section_ids = {s.id for s in sections}
    rows = []
    entries_query = (
        db.query(BmrEntry, User.full_name)
        .outerjoin(User, User.id == BmrEntry.filled_by)
        .filter(BmrEntry.instance_id == instance.id)
    )
    if not user:
        rows = entries_query.all()
    elif section_ids:
        rows = entries_query.filter(BmrEntry.section_id.in_(section_ids)).all()
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
            for s in sections
        ],
        "entries": [
            {"section_id": e.section_id, "field_index": e.field_index, "value": e.value,
             "filled_by_name": name, "filled_at": e.filled_at}
            for e, name in rows
        ],
        "assignments": instance.assignments or {},
        "stages": _stages_of(instance),
        "participants": _participants_of(db, instance),
    }


def _section_stage(section: BmrInstanceSection) -> str:
    """Код этапа секции: config.stage, иначе комната, иначе id секции."""
    config = section.config or {}
    stage = config.get("stage")
    if stage:
        return str(stage)
    return _section_room(section) or str(section.id)


def _stages_of(instance: BmrInstance) -> list[dict]:
    """Уникальные этапы экземпляра (для назначения операторов начальником цеха)."""
    out: list[dict] = []
    seen: set[str] = set()
    for section in instance.sections:
        code = _section_stage(section)
        if code in seen:
            continue
        seen.add(code)
        config = section.config or {}
        out.append({
            "stage": code,
            "title": str(config.get("stage_title") or section.title),
            "room": _section_room(section),
        })
    return out


def _participants_of(db: Session, instance: BmrInstance) -> list[dict]:
    """Журнал участников серии (task #13): назначенные начальником цеха операторы
    по этапам + лица, фактически поставившие e-подпись (ДП/ДОК). Аналог бумажного
    «Журнала подписи ЗПС» в шапке BMR — роли/ФИО/этапы/статус участия (ALCOA+)."""
    stage_title = {s["stage"]: s["title"] for s in _stages_of(instance)}
    section_stage = {section.id: _section_stage(section) for section in instance.sections}
    assignments = instance.assignments or {}

    acc: dict[str, dict] = {}

    def _rec(key: str) -> dict:
        return acc.setdefault(key, {
            "full_name": None, "username": None, "role": None,
            "duties": set(), "stages": set(), "assigned": False, "signed": False,
        })

    entries = db.query(BmrEntry).filter(BmrEntry.instance_id == instance.id).all()
    needed_ids = {str(uid) for lst in assignments.values() for uid in (lst or [])}
    needed_ids |= {str(e.filled_by) for e in entries if e.filled_by and (e.value or {}).get("signed_by")}
    users: dict[str, User] = {}
    if needed_ids:
        for u in db.query(User).filter(User.id.in_(needed_ids)).all():
            users[str(u.id)] = u

    for stage, lst in assignments.items():
        title = stage_title.get(stage, stage)
        for uid in (lst or []):
            rec = _rec(str(uid))
            rec["assigned"] = True
            rec["duties"].add("ДП")
            rec["stages"].add(title)
            u = users.get(str(uid))
            if u:
                rec["full_name"] = u.full_name
                rec["username"] = u.username
                rec["role"] = u.role.name if u.role else None

    for e in entries:
        value = e.value or {}
        if not (value.get("signed_by") and e.filled_by):
            continue
        rec = _rec(str(e.filled_by))
        rec["signed"] = True
        rec["duties"].add("ДОК" if value.get("role") == "qa" else "ДП")
        stage = section_stage.get(e.section_id)
        if stage:
            rec["stages"].add(stage_title.get(stage, stage))
        u = users.get(str(e.filled_by))
        if u:
            rec["full_name"] = rec["full_name"] or u.full_name
            rec["username"] = rec["username"] or u.username
            rec["role"] = rec["role"] or (u.role.name if u.role else None)
        if not rec["full_name"]:
            rec["full_name"] = value.get("signed_by")

    out = [{
        "full_name": r["full_name"], "username": r["username"], "role": r["role"],
        "duties": sorted(r["duties"]), "stages": sorted(r["stages"]),
        "assigned": r["assigned"], "signed": r["signed"],
    } for r in acc.values()]
    out.sort(key=lambda x: (not x["assigned"], x["full_name"] or ""))
    return out


# ---------------------------------------------------------------------------
# Fill / sign / complete / review — Phase C
# ---------------------------------------------------------------------------

_FILL = ("EXECUTE_BMR", "MANAGE_PRODUCTION")


def _room_from_workstation(workstation_id: str | None) -> str | None:
    if not workstation_id:
        return None
    match = re.search(r"(\d{2,3})$", workstation_id.strip())
    return f"Комн. {match.group(1)}" if match else None


def _is_bmr_supervisor(user: CurrentUser) -> bool:
    return "MANAGE_PRODUCTION" in user.permissions or "QA_DECISION" in user.permissions


def _section_room(section: BmrInstanceSection) -> str | None:
    room = (section.config or {}).get("room")
    return str(room).strip() if room else None


def _section_visible_for_user(section: BmrInstanceSection, user: CurrentUser) -> bool:
    if _is_bmr_supervisor(user):
        return True
    room = _section_room(section)
    if not room:
        return True
    return room == _room_from_workstation(user.workstation_id)


def _has_user_room_stage(instance: BmrInstance, user: CurrentUser) -> bool:
    if _is_bmr_supervisor(user):
        return True
    user_room = _room_from_workstation(user.workstation_id)
    if not user_room:
        return False
    return any(_section_room(section) == user_room for section in instance.sections)


def _visible_sections(instance: BmrInstance, user: CurrentUser) -> list[BmrInstanceSection]:
    if not _has_user_room_stage(instance, user):
        return []
    return [section for section in instance.sections if _section_visible_for_user(section, user)]


def _ensure_section_access(section: BmrInstanceSection, user: CurrentUser) -> None:
    if not _section_visible_for_user(section, user):
        room = _section_room(section) or "общая секция"
        user_room = _room_from_workstation(user.workstation_id) or user.workstation_id or "не определено"
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Секция относится к {room}; ваше рабочее место: {user_room}",
        )


def _ensure_instance_scope(instance: BmrInstance, user: CurrentUser) -> None:
    if _has_user_room_stage(instance, user):
        return
    user_room = _room_from_workstation(user.workstation_id) or user.workstation_id or "не определено"
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"В этой серии нет стадии для вашего рабочего места: {user_room}",
    )


def _field_label(section: BmrInstanceSection, field_index: int) -> str:
    fields = (section.config or {}).get("fields", [])
    label = fields[field_index].get("label") if 0 <= field_index < len(fields) else None
    return f"{section.title} / {label or f'поле {field_index + 1}'}"


def _is_process_end_field(section: BmrInstanceSection, field: dict) -> bool:
    config = section.config or {}
    section_kind = str(config.get("kind") or section.section_type or "").lower()
    label = str(field.get("label") or "").lower()
    return section_kind == "process_header" and field.get("type") == "datetime" and "оконч" in label


def _ordered_fields(instance: BmrInstance, user: CurrentUser) -> list[tuple[UUID, int, str]]:
    ordered: list[tuple[UUID, int, str]] = []
    final_fields: list[tuple[UUID, int, str]] = []
    for section in _visible_sections(instance, user):
        fields = (section.config or {}).get("fields", [])
        for field_index, field in enumerate(fields):
            item = (section.id, field_index, str(field.get("type") or ""))
            if _is_process_end_field(section, field):
                final_fields.append(item)
            else:
                ordered.append(item)
    return [*ordered, *final_fields]


def _entry_is_complete(entry: BmrEntry | None) -> bool:
    if not entry or not entry.value:
        return False
    value = entry.value
    if value.get("signed_by"):
        return True
    if "v" not in value:
        return False
    return value.get("v") not in (None, "")


def _completion_map(db: Session, instance_id: UUID) -> dict[tuple[UUID, int], bool]:
    rows = db.query(BmrEntry).filter(BmrEntry.instance_id == instance_id).all()
    return {(row.section_id, row.field_index): _entry_is_complete(row) for row in rows}


def _ensure_previous_complete(
    instance: BmrInstance,
    user: CurrentUser,
    section_map: dict[UUID, BmrInstanceSection],
    section_id: UUID,
    field_index: int,
    completed: dict[tuple[UUID, int], bool],
) -> None:
    ordered = _ordered_fields(instance, user)
    positions = {(sid, idx): pos for pos, (sid, idx, _ftype) in enumerate(ordered)}
    current = (section_id, field_index)
    if current not in positions:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Поле недоступно для вашего рабочего места")
    for previous_sid, previous_idx, _previous_type in ordered[: positions[current]]:
        if completed.get((previous_sid, previous_idx)):
            continue
        previous_section = section_map[previous_sid]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Сначала завершите предыдущий пункт и подпись ДОК: {_field_label(previous_section, previous_idx)}",
        )


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
    _ensure_instance_scope(inst, user)
    section_map = {s.id: s for s in inst.sections}
    ordered = _ordered_fields(inst, user)
    positions = {(sid, idx): pos for pos, (sid, idx, _ftype) in enumerate(ordered)}
    completed = _completion_map(db, inst.id)
    valid_items = []
    for item in payload.entries:
        section = section_map.get(item.section_id)
        if not section:
            continue
        _ensure_section_access(section, user)
        fields = (section.config or {}).get("fields", [])
        if item.field_index < 0 or item.field_index >= len(fields):
            continue
        field_type = str(fields[item.field_index].get("type") or "")
        if field_type.startswith("signature_"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Подписи выполняются только через действие подписи")
        if (item.section_id, item.field_index) not in positions:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Поле недоступно для вашего рабочего места")
        valid_items.append(item)
    valid_items.sort(key=lambda item: positions[(item.section_id, item.field_index)])
    for item in valid_items:
        _ensure_previous_complete(inst, user, section_map, item.section_id, item.field_index, completed)
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
        completed[(item.section_id, item.field_index)] = item.value not in (None, "")
    _mark_started(inst, user)
    db.commit()
    db.refresh(inst)
    return _instance_dict(db, inst, user)


def sign_field(db: Session, user: CurrentUser, instance_id: UUID, payload: BmrSignRequest) -> dict:
    inst = _get_instance(db, instance_id)
    if inst.status in ("completed", "reviewed"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="BMR закрыт — подпись запрещена")
    _ensure_instance_scope(inst, user)
    section = next((s for s in inst.sections if s.id == payload.section_id), None)
    if not section:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Секция не найдена")
    _ensure_section_access(section, user)
    fields = (section.config or {}).get("fields", [])
    if payload.field_index < 0 or payload.field_index >= len(fields):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Поле не найдено")
    ftype = fields[payload.field_index].get("type")
    section_map = {s.id: s for s in inst.sections}
    completed = _completion_map(db, inst.id)
    _ensure_previous_complete(inst, user, section_map, payload.section_id, payload.field_index, completed)
    if ftype == "signature_qa":
        required = ("QA_DECISION",)
        role = "qa"
    elif ftype == "signature_operator":
        required = _FILL
        role = "operator"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Это поле не является подписью")
    # Подпись = независимая e-аутентификация подписанта (один планшет на комнату, на
    # нём работают и оператор, и контролёр). Подписант вводит СВОИ креды; гейт по
    # роли ячейки делает подмену невозможной (оператор не подпишет ДОК и наоборот).
    signer = validate_independent_signature(
        db, user, payload, "SIGN_BMR_FIELD", "bmr_instance", str(inst.id), required,
    )
    # Назначение по этапам: если начальник цеха назначил операторов на этот этап,
    # ячейку ДП может подписать только назначенный оператор (контролёров не ограничиваем).
    if role == "operator":
        stage = _section_stage(section)
        assigned = (inst.assignments or {}).get(stage) or []
        if assigned and str(signer.id) not in {str(a) for a in assigned}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Этот оператор не назначен на данный этап начальником цеха",
            )
    entry = (
        db.query(BmrEntry)
        .filter(BmrEntry.section_id == payload.section_id, BmrEntry.field_index == payload.field_index)
        .first()
    )
    if entry is None:
        entry = BmrEntry(instance_id=inst.id, section_id=payload.section_id, field_index=payload.field_index)
        db.add(entry)
    entry.value = {"signed_by": signer.full_name, "role": role, "signed_at": now_utc().isoformat()}
    entry.filled_by = signer.id
    entry.filled_at = now_utc()
    _mark_started(inst, user)
    write_audit(
        db, user, object_type="bmr_instance", object_id=str(inst.id),
        action_type="SIGN_BMR_FIELD",
        new_value={"section": section.title, "role": role}, reason=payload.reason,
    )
    db.commit()
    db.refresh(inst)
    return _instance_dict(db, inst, user)


def complete_instance(db: Session, user: CurrentUser, instance_id: UUID, payload: BmrInstanceActionRequest) -> dict:
    """Производство фиксирует, что BMR заполнен (СОП-11 п.5.2.7.14)."""
    _require_any(user, ("MANAGE_PRODUCTION",))
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
    return _instance_dict(db, inst, user)


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
    return _instance_dict(db, inst, user)


def get_instance(db: Session, user: CurrentUser, instance_id: UUID) -> dict:
    _require_any(user, _VIEW + ("EXECUTE_BMR",))
    inst = db.get(BmrInstance, instance_id)
    if not inst:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BMR instance not found")
    if _ensure_previous_process_entries(db, inst):
        db.commit()
        db.refresh(inst)
    return _instance_dict(db, inst, user)


def get_instance_for_batch(db: Session, user: CurrentUser, batch_id: UUID) -> dict | None:
    _require_any(user, _VIEW + ("EXECUTE_BMR",))
    inst = db.query(BmrInstance).filter(BmrInstance.production_batch_id == batch_id).first()
    if not inst:
        return None
    if not _visible_sections(inst, user):
        return None
    if _ensure_previous_process_entries(db, inst):
        db.commit()
        db.refresh(inst)
    return _instance_dict(db, inst, user)


# ---------------------------------------------------------------------------
# Назначение операторов по этапам (начальник цеха) — task #12
# ---------------------------------------------------------------------------

def list_assignable_operators(db: Session, user: CurrentUser) -> list[dict]:
    """Кандидаты-операторы (ДП) для назначения на этапы: пользователи, чья роль
    имеет право EXECUTE_BMR. Доступно надзору (MANAGE_PRODUCTION/QA)."""
    _require_any(user, ("MANAGE_PRODUCTION", "QA_DECISION"))
    out: list[dict] = []
    for u in db.query(User).filter(User.is_active.is_(True)).order_by(User.full_name).all():
        codes = {p.code for p in u.role.permissions} if u.role else set()
        if "EXECUTE_BMR" in codes:
            out.append({
                "id": str(u.id), "username": u.username, "full_name": u.full_name,
                "role": u.role.name if u.role else None,
                "is_operator": "MANAGE_PRODUCTION" not in codes,
            })
    return out


def set_assignments(db: Session, user: CurrentUser, instance_id: UUID, mapping: dict[str, list[str]]) -> dict:
    """Начальник цеха назначает операторов по этапам ДО заполнения цехом."""
    _require_any(user, ("MANAGE_PRODUCTION",))
    inst = _get_instance(db, instance_id)
    if inst.status in ("completed", "reviewed"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="BMR закрыт — назначения заморожены")
    valid_stages = {s["stage"] for s in _stages_of(inst)}
    cleaned: dict[str, list[str]] = {}
    for stage, user_ids in (mapping or {}).items():
        if stage not in valid_stages:
            continue
        cleaned[stage] = [str(uid) for uid in (user_ids or [])]
    inst.assignments = cleaned
    write_audit(
        db, user, object_type="bmr_instance", object_id=str(inst.id),
        action_type="ASSIGN_BMR_OPERATORS",
        new_value={"stages": list(cleaned.keys())},
    )
    db.commit()
    db.refresh(inst)
    return _instance_dict(db, inst, user)
