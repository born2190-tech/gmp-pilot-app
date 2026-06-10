"""Аудит полноты импорта BMR: сравнивает исходный .docx с тем, что реально
попало в структуру (build_sections). Печатает, сколько абзацев/таблиц/
примечаний из Word НЕ перенеслось.

    python -m app.scripts.audit_bmr_import /tmp/bmr.docx
"""
from __future__ import annotations

import json
import sys

from docx import Document

from app.scripts.import_bmr_docx import _cell_text, _clean, _iter_blocks, build_sections


def _table_texts(t) -> list[str]:
    return [_cell_text(c) for r in t.rows for c in r.cells if _cell_text(c)]


def main(path: str) -> None:
    doc = Document(path)

    paragraphs: list[str] = []
    tables = []
    for typ, val in _iter_blocks(doc):
        if typ == "p":
            paragraphs.append(val)
        else:
            tables.append(val)

    sections = build_sections(doc)
    blob = json.dumps(sections, ensure_ascii=False).lower()

    def present(s: str) -> bool:
        s = _clean(s).lower()
        # совпадение по первым 40 символам (устойчиво к обрезке меток)
        probe = s[:40]
        return bool(probe) and probe in blob

    # --- абзацы ---
    lost_paras = [p for p in paragraphs if len(p) > 12 and not present(p)]
    # --- таблицы: считаем потерянной, если НИ одна её содержательная ячейка не найдена ---
    lost_tables = []
    for t in tables:
        cells = [c for c in _table_texts(t) if len(c) > 3]
        if not cells:
            continue
        hit = sum(1 for c in cells if present(c))
        if hit == 0:
            lost_tables.append(cells[:4])
        elif hit < max(1, len(cells) // 3):
            lost_tables.append(["[ЧАСТИЧНО]"] + cells[:4])

    notes = [p for p in paragraphs if p.lower().startswith(("примеч", "note", "*"))]
    lost_notes = [n for n in notes if not present(n)]

    print("=" * 70)
    print(f"Абзацев (непустых): {len(paragraphs)} | Таблиц: {len(tables)} | Секций создано: {len(sections)}")
    print(f"Примечаний/сносок: {len(notes)} | из них НЕ перенесено: {len(lost_notes)}")
    print(f"Абзацев НЕ перенесено: {len(lost_paras)}")
    print(f"Таблиц потеряно/частично: {len(lost_tables)}")
    print("=" * 70)

    print("\n--- ПОТЕРЯННЫЕ АБЗАЦЫ (до 30 примеров) ---")
    for p in lost_paras[:30]:
        print("  •", p[:110])

    print("\n--- ПОТЕРЯННЫЕ / ЧАСТИЧНЫЕ ТАБЛИЦЫ (до 25) ---")
    for cells in lost_tables[:25]:
        print("  •", " | ".join(c[:28] for c in cells))

    print("\n--- ПОТЕРЯННЫЕ ПРИМЕЧАНИЯ/СНОСКИ (до 20) ---")
    for n in lost_notes[:20]:
        print("  •", n[:120])


if __name__ == "__main__":
    main(sys.argv[1])
