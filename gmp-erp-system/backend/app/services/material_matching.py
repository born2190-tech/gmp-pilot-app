from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models.master_data import Material, MaterialAlias


def normalize_material_key(raw: str | None) -> str:
    text = (raw or "").lower().replace("ё", "е")
    text = re.sub(r"\*+", " ", text)
    text = re.sub(r"[^a-zа-я0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


DEFAULT_ALIASES_BY_CODE: dict[str, tuple[str, ...]] = {
    "API-MET": (
        "Метформин гидрохлорид",
        "Metformin hydrochloride",
        "Metformin HCl",
        "Metformin Hydrochloride USP",
        "Метформин HCl",
    ),
    "API-SITA": (
        "Ситаглиптин фосфат",
        "Ситаглиптин фосфат моногидрат",
        "Sitagliptin phosphate",
        "Sitagliptin phosphate monohydrate",
    ),
    "EXC-POV": ("Повидон К-30", "Povidone K-30", "Povidone K30", "Kollidon K-30"),
    "EXC-SLS": ("Натрий лаурил сульфат", "Sodium lauryl sulfate", "Kolliphor SLS Fine"),
    "EXC-AEROSIL": (
        "Коллоидный диоксид кремния",
        "Коллоидный силикон кремния",
        "Aerosil 200",
        "Aerosil 200M",
        "Colloidal silicon dioxide",
    ),
    "EXC-MCC": (
        "Микрокристаллическая целлюлоза",
        "Microcrystalline cellulose",
        "MCC",
        "Pharmasel 102",
        "Pharmacel 102",
    ),
    "EXC-SOD": (
        "Натрия кроскармеллоза",
        "Croscarmellose sodium",
        "Primellose",
    ),
    "EXC-MGST": ("Стеарат магния", "Magnesium stearate", "Ligamed MF-2V"),
    "EXC-OPA-BLUE": ("Opadry II Blue 85G205027", "Opadry Blue 85G205027", "85G205027"),
    "COAT-OPADRY": ("Opadry 85F12273 Yellow", "Opadry Yellow 85F12273", "85F12273"),
    "UTIL-WATER": ("Очищенная вода", "Purified water", "Water purified"),
    "PKG-FOIL-F01F7BBA": ("Алюминиевая фольга, толщина 0,15мм, ширина 195 мм",),
    "PKG-FOIL-0A9293BD": ("Алюминиевая фольга (флексопечать) «НовуСита-М» 850мг/50мг",),
    "PKG-CARTON-68804B9D": ("Пенал «НовуСита-М» 850мг/50мг",),
    "PKG-LEAFLET-BBFA8320": ("Инструкция по применению",),
    "PKG-LABEL-9DE38D63": ("Групповая этикетка",),
    "PKG-BOX-C8AAF03E": ("Гофра коробка",),
}


def ensure_material_alias(db: Session, material: Material, alias: str, source: str = "system") -> MaterialAlias | None:
    normalized = normalize_material_key(alias)
    if not normalized:
        return None
    existing = db.query(MaterialAlias).filter(MaterialAlias.normalized_alias == normalized).first()
    if existing:
        return existing if existing.material_id == material.id else None
    row = MaterialAlias(
        material_id=material.id,
        alias=alias.strip(),
        normalized_alias=normalized,
        source=source,
    )
    db.add(row)
    db.flush()
    return row


def ensure_default_material_aliases(db: Session) -> None:
    materials = {m.code.upper(): m for m in db.query(Material).all()}

    for code, aliases in DEFAULT_ALIASES_BY_CODE.items():
        material = materials.get(code)
        if not material:
            continue
        ensure_material_alias(db, material, material.code, "material_code")
        ensure_material_alias(db, material, material.name, "material_name")
        for alias in aliases:
            ensure_material_alias(db, material, alias, "default")

    for material in materials.values():
        ensure_material_alias(db, material, material.code, "material_code")
        ensure_material_alias(db, material, material.name, "material_name")
    db.flush()


def find_material_by_code_or_alias(
    db: Session,
    *,
    code: str | None = None,
    name: str | None = None,
    seed_defaults: bool = True,
) -> Material | None:
    if seed_defaults:
        ensure_default_material_aliases(db)

    normalized_code = (code or "").strip().upper()
    if normalized_code:
        material = db.query(Material).filter(Material.code == normalized_code).first()
        if material:
            return material
        alias = db.query(MaterialAlias).filter(MaterialAlias.normalized_alias == normalize_material_key(normalized_code)).first()
        if alias:
            return db.get(Material, alias.material_id)

    normalized_name = normalize_material_key(name)
    if normalized_name:
        alias = db.query(MaterialAlias).filter(MaterialAlias.normalized_alias == normalized_name).first()
        if alias:
            return db.get(Material, alias.material_id)
        material = next(
            (m for m in db.query(Material).all() if normalize_material_key(m.name) == normalized_name),
            None,
        )
        if material:
            return material
    return None
