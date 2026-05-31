"""Seed эталонной стадии электронного BMR/ЗПС «Дапига 10 мг» (СОП-11).

Заводит реальный шаблон по бумажному ЗПС (роллер-компактор), начиная с
ЭТАЛОННОЙ стадии «Опудривание» (комн. 29). Стадия собрана из блоков, которые
повторяются по всему документу: шапка процесса, контрольный список с двумя
подписями (ДП «Выполнил» / ДОК «Проверил»), таблица условий среды
(Начало/Окончание) и справка по оборудованию.

Конвенция полей (для построчной подписи на бэкенде):
- у каждой секции config содержит структурированное описание (steps/params/rows)
  И плоский `fields[]`, где сигнатурные ячейки имеют type
  signature_operator / signature_qa. Индекс записи (field_index) = позиция в
  `fields[]`. Фронтенд рисует блок из структуры и вычисляет те же индексы.

Идемпотентно: при повторном запуске сидера секции эталона переписываются, если
по шаблону ещё нет ни одного экземпляра BMR (иначе — не трогаем, неизменяемость).
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.identity import User
from app.models.inventory import BmrInstance, BmrSection, BmrTemplate, Product

ETALON_MARKER = "__etalon_dapiga_opudrivanie__"
ETALON_TITLE = "ЗПС Дапига 10 мг — роллер-компактор (эталон)"
ETALON_ROOM = "Комн. 29"


def _sig_pair() -> list[dict]:
    return [
        {"label": "Выполнено · ДП", "type": "signature_operator"},
        {"label": "Проверено · ДОК", "type": "signature_qa"},
    ]


def _checklist_steps() -> list[dict]:
    return [
        {"no": "3.1", "text": "Установите и работайте с вертикальным бункерным блендером согласно ДПСК-632."},
        {"no": "3.2", "text": "Предварительное опудривание: загрузите материалы этапа 1.4 и перемешивайте 25 мин при 15 об/мин."},
        {"no": "3.3", "text": "Опудривание: загрузите материалы этапа 3.2 и перемешивайте 5 мин при 15 об/мин."},
        {"no": "3.4", "text": "Просеять магния стеарат через сито #60 меш, собрать в двухслойный мешок, прикрепить этикетку статуса."},
        {"no": "3.6", "text": "Отбор образцов однородности смеси (минимум пять мест)."},
        {"no": "3.7", "text": "Выгрузите опудренную смесь в двухслойные полиэтиленовые пакеты, прикрепите этикетку статуса."},
    ]


def _env_params() -> list[dict]:
    return [
        {"name": "Температура", "unit": "°C", "limit": "18–25 °C"},
        {"name": "Относительная влажность", "unit": "%", "limit": "≤ 55 %"},
        {"name": "Перепад давления", "unit": "Па", "limit": "5–20 Па"},
    ]


def _env_fields_per_param() -> list[dict]:
    return [
        {"label": "Начало · наблюдение", "type": "number"},
        {"label": "Начало · ДП", "type": "signature_operator"},
        {"label": "Начало · ДОК", "type": "signature_qa"},
        {"label": "Окончание · наблюдение", "type": "number"},
        {"label": "Окончание · ДП", "type": "signature_operator"},
        {"label": "Окончание · ДОК", "type": "signature_qa"},
    ]


def _etalon_sections() -> list[dict]:
    """4 секции эталонной стадии «Опудривание» с плоским fields[]."""
    steps = _checklist_steps()
    checklist_fields: list[dict] = []
    for _ in steps:
        checklist_fields.extend(_sig_pair())

    params = _env_params()
    env_fields: list[dict] = []
    for _ in params:
        env_fields.extend(_env_fields_per_param())

    return [
        {
            "section_type": "process_header",
            "title": "Опудривание — шапка процесса",
            "config": {
                "kind": "process_header",
                "room": ETALON_ROOM,
                "process": "Опудривание",
                "room_no": "29",
                "sop": "СОП-204 · ТР-Дапига",
                "fields": [
                    {"label": "Дата-время начала", "type": "datetime"},
                    {"label": "Дата-время окончания", "type": "datetime"},
                    {"label": "Предыдущий ЛС", "type": "text"},
                    {"label": "Предыдущая серия", "type": "text"},
                ],
            },
        },
        {
            "section_type": "checklist",
            "title": "Контрольный список выполнения",
            "config": {
                "kind": "checklist",
                "room": ETALON_ROOM,
                "steps": steps,
                "fields": checklist_fields,
            },
        },
        {
            "section_type": "environment",
            "title": "Условия среды (комната опудривания)",
            "config": {
                "kind": "environment",
                "room": ETALON_ROOM,
                "params": params,
                "fields": env_fields,
            },
        },
        {
            "section_type": "equipment",
            "title": "Оборудование / инструмент",
            "config": {
                "kind": "equipment",
                "room": ETALON_ROOM,
                "rows": [
                    {"name": "Вертикальный бункерный блендер", "model": "HTD-250", "serial": "SS0620", "sop": "ДПСК-632", "calib": "Не подлежит"},
                    {"name": "Весы электронные", "model": "FCC5001", "serial": "2217900327", "sop": "ДПСК-462", "calib": "по графику"},
                    {"name": "Весы электронные", "model": "BWS100K5", "serial": "300346", "sop": "ДПСК-445", "calib": "по графику"},
                ],
                "fields": [],
            },
        },
    ]


def _find_dapiga(db: Session) -> Product | None:
    return (
        db.query(Product)
        .filter(Product.name.ilike("%Дапи%"), Product.market_code == "UZ")
        .order_by(Product.code)
        .first()
    )


def _retire_siblings(db: Session, product_id, keep_id) -> None:
    """Прочие approved-шаблоны того же продукта → obsolete, чтобы новые
    экземпляры BMR создавались из эталона (а не из старого demo-шаблона)."""
    db.query(BmrTemplate).filter(
        BmrTemplate.product_id == product_id,
        BmrTemplate.status == "approved",
        BmrTemplate.id != keep_id,
    ).update({BmrTemplate.status: "obsolete"})


def _write_sections(db: Session, template_id) -> None:
    db.query(BmrSection).filter(BmrSection.template_id == template_id).delete()
    db.flush()
    for idx, sec in enumerate(_etalon_sections(), start=1):
        db.add(BmrSection(
            template_id=template_id, ordinal=idx,
            section_type=sec["section_type"], title=sec["title"], config=sec["config"],
        ))


def seed_bmr_etalon(db: Session) -> None:
    """Идемпотентно заводит/обновляет эталонный шаблон BMR Дапиги (стадия Опудривание)."""
    product = _find_dapiga(db)
    if not product:
        return

    creator = db.query(User).filter(User.username == "sys_admin").first()
    approver = db.query(User).filter(User.username == "head_qa").first()
    if not creator:
        creator = db.query(User).first()
    if not creator:
        return

    existing = (
        db.query(BmrTemplate)
        .filter(BmrTemplate.notes == ETALON_MARKER)
        .order_by(BmrTemplate.version.desc())
        .first()
    )

    if existing:
        has_instance = (
            db.query(func.count(BmrInstance.id))
            .filter(BmrInstance.template_id == existing.id)
            .scalar()
        ) or 0
        if not has_instance:
            # Шаблон ещё не использован — безопасно переписать секции (итерация дизайна).
            existing.title = ETALON_TITLE
            existing.product_id = product.id
            _write_sections(db, existing.id)
        _retire_siblings(db, product.id, existing.id)
        db.commit()
        return

    template = BmrTemplate(
        product_id=product.id,
        title=ETALON_TITLE,
        version=1,
        status="approved",
        notes=ETALON_MARKER,
        created_by=creator.id,
        approved_by=(approver.id if approver else creator.id),
        approved_at=func.now(),
        effective_date=date.today(),
    )
    db.add(template)
    db.flush()
    _write_sections(db, template.id)
    _retire_siblings(db, product.id, template.id)
    db.commit()
