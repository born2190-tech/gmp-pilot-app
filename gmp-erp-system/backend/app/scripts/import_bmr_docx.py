"""Импорт BMR/ЗПС из .docx фабричного формата NOVUGEN в структурированный
шаблон (BmrTemplate + BmrSection). Документ регулярный: повторяющиеся блоки
— `Процесс: … / Комната …` → тех.этапы; «ОТЧЁТ … ОКРУЖАЮЩЕЙ СРЕДЫ» → среда;
«ОБОРУДОВАНИЕ/ПРИБОРЫ» → оборудование; «ПРОИЗВОДСТВЕННАЯ ФОРМУЛА» → формула;
«ЛИСТ РАСПОЛОЖЕНИЯ» → лист распределения. Блоки часто повторяются ×3 по
рынкам — последовательные дубликаты схлопываем.

Результат — ЧЕРНОВИК шаблона (status=draft) для проверки технологом/ДОК
перед утверждением (СОП-11). Запуск:
    python -m app.scripts.import_bmr_docx /tmp/bmr.docx SIT-MET "НовуСита-М …"
"""
from __future__ import annotations

import re
import sys
from io import BytesIO

from docx import Document
from docx.oxml.ns import qn

from app.core.database import SessionLocal
from app.models.identity import User
from app.models.inventory import BmrSection, BmrTemplate, Product


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\x00", " ")).strip()


def _sig_fields() -> list[dict]:
    return [
        {"label": "Выполнено · ДП", "type": "signature_operator"},
        {"label": "Проверено · ДОК", "type": "signature_qa"},
    ]


def _iter_blocks(doc: Document):
    """Идёт по телу в порядке: ('p', text) | ('t', table)."""
    paras = {p._p: p for p in doc.paragraphs}
    tbls = {t._tbl: t for t in doc.tables}
    for child in doc.element.body.iterchildren():
        if child.tag == qn("w:p"):
            p = paras.get(child)
            if p is not None and _clean(p.text):
                yield ("p", _clean(p.text))
        elif child.tag == qn("w:tbl"):
            t = tbls.get(child)
            if t is not None:
                yield ("t", t)


def _rows(t) -> list[list[str]]:
    return [[_clean(c.text) for c in r.cells] for r in t.rows]


def _process_header(rows: list[list[str]]) -> dict | None:
    """Таблица 'Процесс: X / Комната … / Комната №: N' (ячейки объединённые)."""
    flat = " ".join(_clean(c) for r in rows for c in r)
    low = flat.lower()
    # Настоящая шапка стадии: 'Процесс: …' + 'Комната' + строка 'Дата/Время начала'.
    # Иначе слово «процесс» внутри шагов («в процессе…») ложно детектится.
    if not (re.search(r"процесс\s*:", low) and "комната" in low and ("дата нач" in low or "время нач" in low)):
        return None
    proc = room = room_no = ""
    m = re.search(r"процесс\s*:?\s*(.+?)\s*(?:комната|дата|$)", flat, re.IGNORECASE)
    if m:
        proc = _clean(m.group(1))
    m = re.search(r"комната\s*№\s*:?\s*([^|]*?)(?:\s*(?:дата|время|предыд)|$)", flat, re.IGNORECASE)
    if m:
        room_no = _clean(m.group(1))
    m = re.search(r"комната\s*:?\s*(?!№)(.+?)\s*(?:комната\s*№|дата|$)", flat, re.IGNORECASE)
    if m:
        room = _clean(m.group(1))
    return {"process": proc, "room": room, "room_no": room_no}


def _steps(rows: list[list[str]]) -> list[dict]:
    """Таблица '№ | ТЕХНОЛОГИЧЕСКИЕ ЭТАПЫ | Подпись' → шаги."""
    steps = []
    for r in rows:
        cells = [c for c in r if c]
        if len(cells) < 2:
            continue
        head = " ".join(cells).lower()
        if "технолог" in head and "этап" in head:
            continue
        no = cells[0]
        text = cells[1] if len(cells) > 1 else ""
        if re.match(r"^\d+(\.\d+)*$", no) and len(text) > 2:
            steps.append({"no": no, "text": text})
        elif len(text) > 5 and not re.search(r"подпис", no.lower()):
            steps.append({"no": no, "text": text})
    return steps


def _env_params(rows: list[list[str]]) -> list[dict]:
    params = []
    for r in rows[1:]:
        name = _clean(r[0]) if r else ""
        if name and "параметр" not in name.lower():
            params.append({"name": name, "limit": ""})
    return params


def _equipment(rows: list[list[str]]) -> list[dict]:
    out = []
    for r in rows[1:]:
        cells = (r + ["", "", "", "", ""])[:6]
        name = _clean(cells[1]) or _clean(cells[0])
        if not name or name.lower() in ("№", "no"):
            continue
        out.append({"name": name, "model": _clean(cells[2]), "serial": _clean(cells[3]),
                    "sop": _clean(cells[4]), "calib": _clean(cells[5])})
    return out


def _formula(rows: list[list[str]]) -> list[dict]:
    out = []
    for r in rows[1:]:
        cells = (r + [""] * 6)[:6]
        name = _clean(cells[2])
        if not name:
            continue
        # строка-группа: все смысловые ячейки одинаковы
        vals = [c for c in cells if c]
        if len(set(vals)) == 1:
            out.append({"group": name})
            continue
        out.append({"name": name, "spec": _clean(cells[3]),
                    "per_tab": _clean(cells[4]), "per_series": _clean(cells[5])})
    # схлопываем подряд идущие дубли (одна и та же строка повторяется в шаблоне)
    dedup = []
    for it in out:
        if dedup and dedup[-1] == it:
            continue
        dedup.append(it)
    return dedup


def _distribution(rows: list[list[str]]) -> list[dict]:
    items = []
    for r in rows[1:]:
        cells = [c for c in r if c]
        nm = _clean(r[2]) if len(r) > 2 else (cells[0] if cells else "")
        if nm and "наименован" not in nm.lower():
            items.append({"name": nm})
    return [{"title": "Материалы", "items": items}] if items else []


def build_sections(doc: Document) -> list[dict]:
    sections: list[dict] = []
    ordinal = 0
    cur_stage = "identity"
    cur_room = None
    pending_title = ""

    def add(stype: str, title: str, kind: str, extra: dict):
        nonlocal ordinal
        cfg = {"kind": kind, "stage": cur_stage, "room": cur_room, **extra}
        sections.append({"ordinal": ordinal, "section_type": stype, "title": title[:255], "config": cfg})
        ordinal += 1

    def dup(stype, kind, extra) -> bool:
        if not sections:
            return False
        last = sections[-1]
        return last["section_type"] == stype and last["config"].get("kind") == kind and \
            {k: v for k, v in last["config"].items() if k not in ("stage", "room")} == {"kind": kind, **extra}

    for typ, val in _iter_blocks(doc):
        if typ == "p":
            pending_title = val
            continue
        rows = _rows(val)
        if not rows:
            continue
        flat = " ".join(" ".join(r) for r in rows).lower()

        ph = _process_header(rows)
        if ph:
            cur_room = ph["room"] or cur_room
            proc = ph["process"]
            room_slug = re.sub(r"[^a-zа-я0-9]+", "_", (ph["room"] or ph["room_no"]).lower()).strip("_")[:24]
            proc_slug = re.sub(r"[^a-zа-я0-9]+", "_", proc.lower()).strip("_")[:32]
            if not proc_slug:
                proc_slug = "process"
            if "очистка" in proc.lower():
                # line clearance уникален по комнате (иначе все слипаются)
                cur_stage = f"line_clearance_{room_slug or proc_slug}"
            else:
                cur_stage = f"{proc_slug}_{room_slug}" if room_slug else proc_slug
            add("stage", f"Процесс: {proc} · {ph['room']} {ph['room_no']}".strip(), "process_header",
                {"room_no": ph["room_no"], "process": proc, "fields": []})
            pending_title = ""
            continue

        # производственная формула
        if "состав" in flat and ("кол-во" in flat or "количество на серию" in flat):
            extra = {"rows": _formula(rows), "fields": []}
            if not dup("production_formula", "production_formula", extra):
                add("production_formula", pending_title or "Производственная формула", "production_formula", extra)
            pending_title = ""
            continue

        # лист расположения / распределения
        if "лист располож" in pending_title.lower() or ("наименован" in flat and "серия субстанц" in flat):
            extra = {"groups": _distribution(rows), "fields": []}
            if not dup("distribution_list", "distribution_list", extra):
                add("distribution_list", pending_title or "Лист расположения", "distribution_list", extra)
            pending_title = ""
            continue

        # окружающая среда
        if "параметр" in flat and ("начало" in flat or "окончание" in flat):
            extra = {"params": _env_params(rows), "fields": _sig_fields()}
            if not dup("environment", "environment", extra):
                add("environment", pending_title or "Отчёт об условиях окружающей среды", "environment", extra)
            pending_title = ""
            continue

        # оборудование
        if "оборудован" in (pending_title.lower() + flat) and ("модель" in flat or "поверк" in flat or "серия" in flat):
            extra = {"rows": _equipment(rows), "fields": []}
            if not dup("equipment", "equipment", extra):
                add("equipment", pending_title or "Оборудование / приборы", "equipment", extra)
            pending_title = ""
            continue

        # технологические этапы (шаги процесса) с подписями
        st = _steps(rows)
        if st and ("технолог" in flat or "этап" in flat or len(st) >= 2):
            extra = {"steps": st, "fields": _sig_fields()}
            add("checklist", pending_title or "Технологические этапы", "checklist", extra)
            pending_title = ""
            continue

        # шапка идентификации
        if "код продукта" in flat:
            kv = {}
            for r in rows:
                if len(r) >= 3 and r[0]:
                    kv[r[0]] = _clean(r[2])
            add("product_header", "Шапка ЗПС / идентификация", "product_header", {"fields": [], "identity": kv})
            pending_title = ""
            continue

        # утверждено ДОК — добавим подпись-секцию к текущей стадии
        if "утверждено док" in flat:
            add("stage", "Утверждение line clearance — ДОК", "qa_clearance",
                {"fields": [{"label": "Утверждено · ДОК", "type": "signature_qa"}]})
            pending_title = ""
            continue

        pending_title = ""
    return sections


def main(path: str, code: str, name: str) -> None:
    data = open(path, "rb").read()
    doc = Document(BytesIO(data))
    sections = build_sections(doc)

    db = SessionLocal()
    try:
        author = db.query(User).filter(User.username == "head_qc").first() or db.query(User).first()
        product = db.query(Product).filter(Product.code == code).first()
        if not product:
            product = Product(code=code, name=name, dosage_form="Таблетки, покрытые оболочкой", market_code="UZ", market_name="Узбекистан")
            db.add(product)
            db.flush()
        # новая версия (draft)
        from sqlalchemy import func as f
        ver = (db.query(f.max(BmrTemplate.version)).filter(BmrTemplate.product_id == product.id).scalar() or 0) + 1
        tpl = BmrTemplate(product_id=product.id, title=f"ЗПС {name} — импорт из docx", version=ver,
                          status="draft", created_by=author.id,
                          notes="Импортировано из .docx (фабричный формат). ЧЕРНОВИК — проверьте все стадии/параметры/оборудование перед утверждением (СОП-11).")
        db.add(tpl)
        db.flush()
        for s in sections:
            db.add(BmrSection(template_id=tpl.id, ordinal=s["ordinal"], section_type=s["section_type"],
                              title=s["title"], config=s["config"]))
        db.commit()
        stages = []
        for s in sections:
            st = s["config"].get("stage")
            if st and st not in stages:
                stages.append(st)
        print(f"OK template id={tpl.id} v{ver} status=draft product={code} sections={len(sections)}")
        print("stages:", ", ".join(stages))
    finally:
        db.close()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else sys.argv[2])
