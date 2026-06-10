"""Пересобирает секции СУЩЕСТВУЮЩЕГО шаблона BMR из .docx на месте.

В отличие от import_bmr_docx.main(), НЕ создаёт новую версию: удаляет секции
указанного шаблона (template id остаётся, версия/статус не меняются) и пишет
свежие. Только для черновиков без экземпляров.

    python -m app.scripts.refresh_bmr_sections /tmp/bmr.docx <template_id>
"""
from __future__ import annotations

import sys
from io import BytesIO

from docx import Document

from sqlalchemy import text as sql_text

from app.core.database import SessionLocal
from app.models.inventory import BmrEntry, BmrInstance, BmrSection, BmrTemplate
from app.scripts.import_bmr_docx import _dedupe_labels, _enrich_material_codes, build_sections


def main(path: str, template_id: str, force: bool = False) -> None:
    doc = Document(BytesIO(open(path, "rb").read()))
    sections = build_sections(doc)

    db = SessionLocal()
    try:
        tpl = db.get(BmrTemplate, template_id)
        if not tpl:
            raise SystemExit(f"template {template_id} not found")
        if tpl.status != "draft" and not force:
            raise SystemExit(f"template {template_id} is {tpl.status}; pass --force to refresh non-draft")

        for s in sections:
            _dedupe_labels(s["config"].get("fields") or [])
        _enrich_material_codes(db, sections)

        deleted = db.query(BmrSection).filter(BmrSection.template_id == tpl.id).delete()
        for s in sections:
            db.add(BmrSection(template_id=tpl.id, ordinal=s["ordinal"], section_type=s["section_type"],
                              title=s["title"], config=s["config"]))

        # Синхронизируем снапшоты экземпляров БЕЗ заполнений (entries=0): они
        # были выданы со старыми секциями. Экземпляры с данными не трогаем.
        synced = 0
        skipped = 0
        for inst in db.query(BmrInstance).filter(BmrInstance.template_id == tpl.id).all():
            has_entries = db.query(BmrEntry.id).filter(BmrEntry.instance_id == inst.id).first()
            if has_entries:
                skipped += 1
                continue
            db.execute(sql_text("delete from bmr_instance_sections where instance_id = :iid"), {"iid": str(inst.id)})
            for s in sections:
                db.execute(
                    sql_text(
                        "insert into bmr_instance_sections (id, created_at, updated_at, instance_id, ordinal, section_type, title, config) "
                        "values (gen_random_uuid(), now(), now(), :iid, :ordinal, :stype, :title, cast(:config as jsonb))"
                    ),
                    {"iid": str(inst.id), "ordinal": s["ordinal"], "stype": s["section_type"],
                     "title": s["title"], "config": __import__("json").dumps(s["config"], ensure_ascii=False)},
                )
            synced += 1
        db.commit()
        print(f"OK refreshed template id={tpl.id} v{tpl.version} status={tpl.status}: {deleted} -> {len(sections)} sections; "
              f"instance snapshots synced={synced}, skipped(with data)={skipped}")
    finally:
        db.close()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], force="--force" in sys.argv[3:])
