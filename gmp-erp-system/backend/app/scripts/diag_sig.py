"""Диагностика: где в таблицах BMR подпись/ввод идут текстом, а не полем."""
from __future__ import annotations

import sys

from app.core.database import SessionLocal
from app.models.inventory import BmrSection

SIG = ("подпись", "выполнено дп", "проверено док", "выполнил", "проверил", "подписал", " дп", " док")
DATA = ("___", "(г или кг)", "(кг)", "(г)", "вес", "кол-во", "количество")


def looks_sig(t: str) -> bool:
    low = t.lower()
    return any(k in low for k in SIG)


def main(tid: str) -> None:
    db = SessionLocal()
    sig_text = 0
    data_text = 0
    examples_sig: list[str] = []
    examples_data: list[str] = []
    for s in db.query(BmrSection).filter(BmrSection.template_id == tid).all():
        cfg = s.config or {}
        # собрать все «таблицы»: process_table rows + step tables
        tables = []
        if cfg.get("rows"):
            tables.append(cfg["rows"])
        for st in cfg.get("steps", []) or []:
            for tb in st.get("tables", []) or []:
                if tb.get("rows"):
                    tables.append(tb["rows"])
        for tb in cfg.get("tables", []) or []:
            if tb.get("rows"):
                tables.append(tb["rows"])
        for rows in tables:
            for row in rows:
                for cell in row.get("cells", []):
                    txt = str(cell.get("text") or "")
                    has_field = "field_index" in cell
                    if looks_sig(txt) and not has_field:
                        sig_text += 1
                        if len(examples_sig) < 20:
                            examples_sig.append(f"#{s.ordinal} «{s.title[:30]}» :: {txt[:40]}")
                    elif (not has_field) and any(k in txt.lower() for k in DATA) and "___" in txt:
                        data_text += 1
                        if len(examples_data) < 20:
                            examples_data.append(f"#{s.ordinal} :: {txt[:50]}")
    print(f"Ячеек-подписей БЕЗ поля (идут текстом): {sig_text}")
    for e in examples_sig:
        print("  SIG •", e)
    print(f"\nЯчеек-данных с прочерком БЕЗ поля: {data_text}")
    for e in examples_data:
        print("  DATA •", e)
    db.close()


if __name__ == "__main__":
    main(sys.argv[1])
