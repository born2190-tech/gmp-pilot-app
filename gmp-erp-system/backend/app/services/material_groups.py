from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.master_data import Material


def group_for_material_code(code: str | None) -> str | None:
    normalized = (code or "").strip().upper()
    if normalized.startswith(("API", "SUB-", "TIG", "GLZ", "CLP", "ETR", "ESO", "TCG")):
        return "SUBSTANCE_API"
    if normalized.startswith(("EXC", "AUX", "COAT", "UTIL")):
        return "EXCIPIENT"
    if normalized.startswith(("PACK", "PKG", "IM-", "ИМ")):
        return "PACKAGING"
    return None


def assign_default_material_group(material: Material) -> None:
    if material.account_group:
        return
    group = group_for_material_code(material.code)
    if group:
        material.account_group = group


def assign_default_material_groups(db: Session) -> None:
    for material in db.query(Material).all():
        assign_default_material_group(material)
