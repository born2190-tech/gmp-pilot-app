"""Сервис справочника спецификаций (НД) на материалы.

Спецификация — это набор показателей качества с нормами и методами для
входного контроля. Аналитический лист ОКК подставляет параметры выбранной
спецификации. Резолвер сопоставляет спецификацию с партией по `material_id`
либо по ключевым словам/наименованию.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import Lot
from app.models.master_data import Material
from app.models.quality import MaterialSpecification, SpecificationParameter
from app.schemas.quality import MaterialSpecificationInput
from app.services.audit import write_audit
from app.services.permissions import require_permission


def list_specifications(db: Session, include_inactive: bool = True) -> list[MaterialSpecification]:
    query = db.query(MaterialSpecification)
    if not include_inactive:
        query = query.filter(MaterialSpecification.is_active.is_(True))
    return query.order_by(MaterialSpecification.material_name).all()


def get_specification(db: Session, spec_id: UUID) -> MaterialSpecification:
    spec = db.get(MaterialSpecification, spec_id)
    if not spec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Specification not found")
    return spec


def _replace_parameters(db: Session, spec: MaterialSpecification, payload: MaterialSpecificationInput) -> None:
    db.query(SpecificationParameter).filter(SpecificationParameter.specification_id == spec.id).delete()
    db.flush()
    for idx, p in enumerate(payload.parameters, start=1):
        db.add(
            SpecificationParameter(
                specification_id=spec.id,
                category=p.category,
                ordinal=idx,
                parameter_name=p.parameter_name,
                specification=p.specification,
                method_reference=p.method_reference,
                unit=p.unit,
            )
        )


def create_specification(db: Session, user: CurrentUser, payload: MaterialSpecificationInput) -> MaterialSpecification:
    require_permission(user, "MANAGE_SPECIFICATIONS")
    spec = MaterialSpecification(
        nd_code=payload.nd_code,
        revision=payload.revision,
        material_name=payload.material_name,
        material_id=payload.material_id,
        match_keywords=payload.match_keywords,
        sop_form=payload.sop_form,
        micro_required=payload.micro_required,
        micro_method_ref=payload.micro_method_ref,
        is_active=payload.is_active,
        effective_date=payload.effective_date,
        notes=payload.notes,
        created_by=user.id,
    )
    db.add(spec)
    db.flush()
    _replace_parameters(db, spec, payload)
    write_audit(
        db, user, object_type="material_specification", object_id=str(spec.id),
        action_type="CREATE_SPECIFICATION",
        new_value={"nd_code": spec.nd_code, "material": spec.material_name, "parameters": len(payload.parameters)},
    )
    db.commit()
    db.refresh(spec)
    return spec


def update_specification(db: Session, user: CurrentUser, spec_id: UUID, payload: MaterialSpecificationInput) -> MaterialSpecification:
    require_permission(user, "MANAGE_SPECIFICATIONS")
    spec = get_specification(db, spec_id)
    spec.nd_code = payload.nd_code
    spec.revision = payload.revision
    spec.material_name = payload.material_name
    spec.material_id = payload.material_id
    spec.match_keywords = payload.match_keywords
    spec.sop_form = payload.sop_form
    spec.micro_required = payload.micro_required
    spec.micro_method_ref = payload.micro_method_ref
    spec.is_active = payload.is_active
    spec.effective_date = payload.effective_date
    spec.notes = payload.notes
    _replace_parameters(db, spec, payload)
    write_audit(
        db, user, object_type="material_specification", object_id=str(spec.id),
        action_type="UPDATE_SPECIFICATION",
        new_value={"nd_code": spec.nd_code, "material": spec.material_name, "parameters": len(payload.parameters)},
    )
    db.commit()
    db.refresh(spec)
    return spec


def delete_specification(db: Session, user: CurrentUser, spec_id: UUID) -> None:
    require_permission(user, "MANAGE_SPECIFICATIONS")
    spec = get_specification(db, spec_id)
    write_audit(
        db, user, object_type="material_specification", object_id=str(spec.id),
        action_type="DELETE_SPECIFICATION",
        old_value={"nd_code": spec.nd_code, "material": spec.material_name},
    )
    db.delete(spec)
    db.commit()


def resolve_for_lot(db: Session, lot: Lot) -> MaterialSpecification | None:
    """Подбирает активную спецификацию для партии.

    Приоритет: точное совпадение по material_id, затем совпадение по
    ключевым словам/наименованию материала (без учёта регистра).
    """
    active = (
        db.query(MaterialSpecification)
        .filter(MaterialSpecification.is_active.is_(True))
        .all()
    )
    if not active:
        return None

    # 1. По material_id.
    if lot.material_id:
        for spec in active:
            if spec.material_id and spec.material_id == lot.material_id:
                return spec

    # 2. По ключевым словам / наименованию материала.
    material = db.get(Material, lot.material_id) if lot.material_id else None
    hay = " ".join(filter(None, [
        (material.name if material else "") or "",
        (material.code if material else "") or "",
    ])).lower()
    if not hay.strip():
        return None
    for spec in active:
        tokens: list[str] = []
        if spec.match_keywords:
            tokens.extend(t.strip().lower() for t in spec.match_keywords.replace(",", " ").split())
        if spec.material_name:
            tokens.append(spec.material_name.lower())
        for token in tokens:
            if token and (token in hay or hay in token):
                return spec
    return None
