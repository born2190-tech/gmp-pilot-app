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
from difflib import SequenceMatcher
from io import BytesIO

from docx import Document
from docx.oxml.ns import qn

from app.core.database import SessionLocal
from app.models.identity import User
from app.models.inventory import BmrSection, BmrTemplate, Product
from app.models.master_data import Material


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\x00", " ")).strip()


def _short_label(s: str, limit: int = 80) -> str:
    """Метка поля — короткая. Длинные ячейки-инструкции/расчёты не годятся как
    подпись поля (полный текст всё равно остаётся в ячейке таблицы и виден при
    заполнении). Режем по границе слова и добавляем многоточие."""
    s = _clean(s)
    if len(s) <= limit:
        return s
    cut = s[:limit].rsplit(" ", 1)[0] or s[:limit]
    return f"{cut.rstrip(' ·,;:')}…"


def _section_title(raw: str | None, fallback: str) -> str:
    title = _clean(raw)
    if not title or not re.search(r"[A-Za-zА-Яа-я0-9]", title):
        return fallback
    return title


def _sig_fields() -> list[dict]:
    return [
        {"label": "Выполнено · ДП", "type": "signature_operator"},
        {"label": "Проверено · ДОК", "type": "signature_qa"},
    ]


def _process_fields() -> list[dict]:
    return [
        {"label": "Дата-время начала", "type": "datetime"},
        {"label": "Дата-время окончания", "type": "datetime"},
        {"label": "Предыдущий ЛС", "type": "text"},
        {"label": "Предыдущая серия", "type": "text"},
    ]


def _norm_key(raw: str | None) -> str:
    text = (raw or "").lower().replace("ё", "е")
    text = re.sub(r"\*+", " ", text)
    text = text.replace("(", " ").replace(")", " ")
    text = re.sub(r"[^a-zа-я0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _material_alias_key(name: str | None) -> str:
    key = _norm_key(name)
    aliases = [
        (("метформин", "гидрохлорид"), "API-MET"),
        (("ситаглиптин", "фосфат"), "API-SITA"),
        (("повидон",), "EXC-POV"),
        (("лаурил", "сульфат"), "EXC-SLS"),
        (("кроскармеллоз",), "EXC-SOD"),
        (("коллоид", "кремн"), "EXC-AEROSIL"),
        (("aerosil",), "EXC-AEROSIL"),
        (("микрокристаллическ", "целлюлоз"), "EXC-MCC"),
        (("pharmasel",), "EXC-MCC"),
        (("стеарат", "магни"), "EXC-MGST"),
        (("opadry", "blue"), "EXC-OPA-BLUE"),
        (("opadry",), "COAT-OPADRY"),
        (("очищенная", "вода"), "UTIL-WATER"),
    ]
    for needles, code in aliases:
        if all(n in key for n in needles):
            return code
    return ""


def _field_pack(name: str) -> list[dict]:
    return [
        {"label": f"{name} · № серии сырья", "type": "text"},
        {"label": f"{name} · № аналит. листа", "type": "text"},
        {"label": f"{name} · вес нетто", "type": "number", "unit": "кг"},
        {"label": f"{name} · Выдал (Склад)", "type": "signature_warehouse"},
        {"label": f"{name} · Проверил (ДП)", "type": "signature_operator"},
        {"label": f"{name} · Проверил (ДОК)", "type": "signature_qa"},
    ]


def _distribution_fields(groups: list[dict]) -> list[dict]:
    fields: list[dict] = []
    for group in groups:
        for item in group.get("items", []):
            fields.extend(_field_pack(item.get("name") or "Материал"))
    return fields


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


def _cell_text(cell) -> str:
    return _clean(" ".join(p.text for p in cell.paragraphs))


def _strip_signature_text(text: str) -> str:
    text = re.sub(r"\s*(Выполнил|Проверил)\s+(ДП|ДОК).*$", "", text, flags=re.IGNORECASE)
    return _clean(text)


def _field_type(label: str) -> str:
    low = label.lower()
    if any(k in low for k in ("вес", "количество", "выход", "скорость", "температур", "влажност", "давлен")):
        return "number"
    return "text"


def _field_unit(label: str) -> str | None:
    low = label.lower()
    if "кг" in low:
        return "кг"
    if "(г" in low or " г" in low:
        return "г"
    if "%" in low:
        return "%"
    if "об/мин" in low:
        return "об/мин"
    if "минут" in low:
        return "мин"
    return None


def _label_needs_input(label: str) -> bool:
    low = label.lower().strip(" :")
    return any(k in low for k in (
        "время начала", "время окончания", "дата начала", "дата окончания",
        "количество", "вес", "выход", "отклонение", "другие", "согласование",
    ))


def _nested_table(table, prefix: str, fields: list[dict]) -> dict:
    raw = [[_cell_text(c) for c in r.cells] for r in table.rows]
    headers = [_clean(h) for h in (raw[0] if raw else [])]
    ncols = max((len(r) for r in raw), default=0)
    # Объединённые ячейки шапки в Word python-docx отдаёт повторно по каждому
    # столбцу слияния (напр. «Статус отказа» в 3 ячейках). Схлопываем подряд
    # идущие одинаковые непустые заголовки в один столбец, иначе на каждую такую
    # ячейку плодится дубль-поле.
    keep: list[int] = []
    for ci in range(ncols):
        h = headers[ci] if ci < len(headers) else ""
        prev = headers[ci - 1] if 0 < ci <= len(headers) else ""
        if ci > 0 and h and h == prev:
            continue
        keep.append(ci)

    out_rows = []
    for ri, full_row in enumerate(raw):
        row = [_clean(full_row[ci]) if ci < len(full_row) else "" for ci in keep]
        nonempty = [c for c in row if c]
        merged_text = len(nonempty) > 1 and len(set(nonempty)) == 1
        row_label = next((c for c in row if c), "")
        out_cells = []
        for ci in keep:
            text = _clean(full_row[ci]) if ci < len(full_row) else ""
            cell: dict = {"text": text}
            header = headers[ci] if ci < len(headers) else ""
            # Метку поля НЕ префиксуем длинным заголовком секции — он и так
            # показан над таблицей. В метке оставляем только строку и колонку.
            label_base = _clean(" · ".join(x for x in (prefix, row_label, header) if x))
            create_input = False
            if ri > 0 and not nonempty and header:
                create_input = True
                label_base = _clean(" · ".join(x for x in (prefix, f"строка {ri}", header) if x))
            elif ri > 0 and not merged_text and not text and nonempty:
                create_input = True
            elif ri > 0 and text and not merged_text and _label_needs_input(text):
                create_input = True
                label_base = _clean(" · ".join(x for x in (prefix, text) if x))
            elif len(raw) == 1 and text and _label_needs_input(text):
                create_input = True
                label_base = _clean(" · ".join(x for x in (prefix, text) if x))

            if create_input:
                field_index = len(fields)
                fields.append({
                    "label": _short_label(label_base or prefix or f"Поле {field_index + 1}"),
                    "type": _field_type(label_base or text),
                    "unit": _field_unit(label_base or text),
                })
                cell["field_index"] = field_index
                cell["type"] = fields[-1]["type"]
                if fields[-1].get("unit"):
                    cell["unit"] = fields[-1]["unit"]
            out_cells.append(cell)
        out_rows.append({"cells": out_cells})
    return {"rows": out_rows}


def _unique_nested_tables(cells) -> list:
    tables = []
    seen: set[int] = set()
    for cell in cells:
        for nested in cell.tables:
            key = id(nested._tbl)
            if key in seen:
                continue
            seen.add(key)
            tables.append(nested)
    return tables


def _generic_process_table(table, prefix: str) -> dict:
    fields: list[dict] = []
    parsed = _nested_table(table, prefix, fields)
    nested = [
        _nested_table(nt, "Вложенная таблица", fields)
        for nt in _unique_nested_tables(cell for row in table.rows for cell in row.cells)
    ]
    out = {"rows": parsed.get("rows", []), "fields": fields}
    if nested:
        out["tables"] = nested
    return out


def _row_nested_tables(row, prefix: str, fields: list[dict]) -> list[dict]:
    return [_nested_table(nt, prefix, fields) for nt in _unique_nested_tables(row.cells)]


def _plain_table(table) -> dict:
    return {
        "rows": [
            {"cells": [{"text": _cell_text(cell)} for cell in row.cells]}
            for row in table.rows
        ],
        "fields": [],
    }


def _room_labels(room_no: str | None) -> list[str]:
    labels: list[str] = []
    for num in re.findall(r"\d{2,3}", room_no or ""):
        label = f"Комн. {num}"
        if label not in labels:
            labels.append(label)
    return labels


def _formula_fingerprint(rows: list[dict]) -> str:
    return "|".join(_norm_key(row.get("group") or row.get("name") or "") for row in rows)


def _formula_score(rows: list[dict]) -> int:
    score = 0
    for row in rows:
        score += len(row.get("name") or row.get("group") or "")
        score += len(row.get("per_tab") or "")
        score += len(row.get("per_series") or "")
    return score


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


def _steps(table) -> tuple[list[dict], list[dict]]:
    """Таблица '№ | ТЕХНОЛОГИЧЕСКИЕ ЭТАПЫ | Подпись' → шаги."""
    steps = []
    fields: list[dict] = []
    for row in table.rows:
        raw_cells = [_cell_text(c) for c in row.cells]
        cells = [c for c in raw_cells if c]
        if not cells:
            continue
        head = " ".join(cells).lower()
        if "технолог" in head and "этап" in head:
            continue
        no = cells[0]
        text = cells[1] if len(cells) > 1 else ""
        if re.match(r"^\d+(\.\d+)*$", no):
            tables = _row_nested_tables(row, f"Этап {no}", fields)
            if len(text) <= 2 and tables and steps and steps[-1].get("no") == no:
                steps[-1].setdefault("tables", []).extend(tables)
                continue
            if len(text) <= 2 and not tables:
                continue
            step = {"no": no, "text": _strip_signature_text(text) or "Контрольная таблица"}
            if tables:
                step["tables"] = tables
            step["dp_field_index"] = len(fields)
            fields.append({"label": f"Этап {no} · Выполнено ДП", "type": "signature_operator"})
            step["dok_field_index"] = len(fields)
            fields.append({"label": f"Этап {no} · Проверено ДОК", "type": "signature_qa"})
            steps.append(step)
    return steps, fields


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
    seen_materials: set[tuple[str, str]] = set()
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
        item_key = (_norm_key(name), _clean(cells[5]))
        # В Word одна и та же позиция часто идёт второй строкой без количества
        # для ручного вписывания второй серии. В eBMR это даёт дубли при FEFO,
        # поэтому пустой дубль не переносим как отдельный ингредиент.
        if not _clean(cells[5]) and any(k[0] == item_key[0] for k in seen_materials):
            continue
        seen_materials.add(item_key)
        out.append({"name": name, "spec": _clean(cells[3]),
                    "per_tab": _clean(cells[4]), "per_series": _clean(cells[5])})
    # схлопываем подряд идущие дубли (одна и та же строка повторяется в шаблоне)
    dedup = []
    for it in out:
        if dedup and dedup[-1] == it:
            continue
        dedup.append(it)
    return dedup


def _formula_lookup(rows: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in rows:
        name = row.get("name")
        if name:
            out.setdefault(_norm_key(name), row)
    return out


def _find_formula(name: str, formula_by_name: dict[str, dict]) -> dict:
    key = _norm_key(name)
    if key in formula_by_name:
        return formula_by_name[key]
    key_tokens = set(key.split())
    best: tuple[float, dict] = (0.0, {})
    for formula_key, row in formula_by_name.items():
        formula_tokens = set(formula_key.split())
        if key_tokens and formula_tokens and (
            key_tokens.issubset(formula_tokens) or formula_tokens.issubset(key_tokens)
        ):
            return row
        score = SequenceMatcher(None, key, formula_key).ratio()
        if score > best[0]:
            best = (score, row)
    return best[1] if best[0] >= 0.72 else {}


def _distribution(rows: list[list[str]], formula_by_name: dict[str, dict]) -> list[dict]:
    groups: list[dict] = []
    current: dict | None = None
    seen_in_group: set[str] = set()

    for r in rows[1:]:
        cells = (r + [""] * 8)[:8]
        nonempty = [_clean(c) for c in cells if _clean(c)]
        if not nonempty:
            continue
        flat = " ".join(nonempty).lower()
        if "аналит" in flat and ("серия" in flat or "наименован" in flat):
            continue
        if "подпись" in flat or "выдано" in flat or "проверено" in flat:
            continue

        # Групповая строка в исходном BMR заполнена одним и тем же текстом во
        # всех объединённых ячейках.
        if len(nonempty) >= 3 and len(set(nonempty)) == 1 and not _clean(cells[2]):
            title = nonempty[0]
            current = {"title": title, "items": []}
            groups.append(current)
            seen_in_group = set()
            continue
        if len(nonempty) >= 3 and len(set(nonempty)) == 1 and _clean(cells[2]) == nonempty[0]:
            title = nonempty[0]
            current = {"title": title, "items": []}
            groups.append(current)
            seen_in_group = set()
            continue

        name = _clean(cells[2])
        if not name or "наименован" in name.lower():
            continue
        norm = _norm_key(name)
        if norm in seen_in_group:
            continue
        seen_in_group.add(norm)
        formula = _find_formula(name, formula_by_name)
        qty = _clean(cells[3]).replace("_", "").strip() or formula.get("per_series") or ""
        spec = formula.get("spec") or ""
        if current is None:
            current = {"title": "Материалы", "items": []}
            groups.append(current)
        current["items"].append({"name": name.replace("*", "").strip(), "spec": spec, "qty": qty})

    return [g for g in groups if g.get("items")]


def _dedupe_labels(fields: list[dict]) -> None:
    """Делает метки полей уникальными в пределах секции. Повторяющиеся блоки
    колонок (напр. несколько тар в ряд) или одинаковые строки-проверки дают
    совпадающие метки («строка 2 · Общий вес» ×4) — нумеруем повторы, чтобы в
    обзоре полей не было визуального дублирования."""
    seen: dict[str, int] = {}
    for f in fields:
        label = f.get("label") or ""
        n = seen.get(label, 0) + 1
        seen[label] = n
        if n > 1:
            f["label"] = f"{label} ({n})"


def _enrich_material_codes(db, sections: list[dict]) -> None:
    materials = db.query(Material).all()
    by_code = {m.code: m for m in materials}
    by_name = {_norm_key(m.name): m for m in materials}

    def resolve(name: str) -> str:
        alias = _material_alias_key(name)
        if alias and alias in by_code:
            return alias
        key = _norm_key(name)
        if key in by_name:
            return by_name[key].code
        key_tokens = set(key.split())
        for material_key, material in by_name.items():
            material_tokens = set(material_key.split())
            if key_tokens and material_tokens and (
                key_tokens.issubset(material_tokens) or material_tokens.issubset(key_tokens)
            ):
                return material.code
        return ""

    for section in sections:
        cfg = section.get("config") or {}
        if cfg.get("kind") == "production_formula":
            for row in cfg.get("rows", []):
                if row.get("name"):
                    row["material_code"] = resolve(row.get("name") or "")
            continue
        if cfg.get("kind") != "distribution_list":
            continue
        field_base = 0
        for group in cfg.get("groups", []):
            for item in group.get("items", []):
                item["field_base"] = field_base
                item["material_code"] = resolve(item.get("name") or "")
                field_base += 6


def build_sections(doc: Document) -> list[dict]:
    sections: list[dict] = []
    ordinal = 0
    cur_stage = "identity"
    cur_room = None
    cur_rooms: list[str] = []
    pending_title = ""
    formula_by_name: dict[str, dict] = {}
    seen_formula_sections: dict[str, int] = {}
    seen_formula_scores: dict[str, int] = {}
    seen_distribution_fingerprints: set[str] = set()

    def add(stype: str, title: str, kind: str, extra: dict):
        nonlocal ordinal
        cfg = {"kind": kind, "stage": cur_stage, "room": cur_room, **extra}
        if cur_rooms and "rooms" not in cfg:
            cfg["rooms"] = cur_rooms
        if cur_room and not cur_rooms and "room_assignment_required" not in cfg:
            cfg["room_assignment_required"] = True
            cfg["room_source_text"] = cur_room
        sections.append({"ordinal": ordinal, "section_type": stype, "title": _section_title(title, "Контрольная таблица")[:255], "config": cfg})
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
            room_labels = _room_labels(ph["room_no"])
            cur_rooms = room_labels
            cur_room = " / ".join(room_labels) if room_labels else (ph["room"] or cur_room)
            proc = ph["process"]
            room_slug = re.sub(r"[^a-zа-я0-9]+", "_", (ph["room"] or ph["room_no"]).lower()).strip("_")[:24]
            proc_slug = re.sub(r"[^a-zа-я0-9]+", "_", proc.lower()).strip("_")[:32]
            if not proc_slug:
                proc_slug = "process"
            if "очистка" in proc.lower():
                # line clearance уникален по комнате (иначе все слипаются)
                cur_stage = f"line_clearance_{room_slug or proc_slug}"
            elif "взвеш" in proc.lower():
                cur_stage = "weighing"
            else:
                cur_stage = f"{proc_slug}_{room_slug}" if room_slug else proc_slug
            header_extra = {"room_no": ph["room_no"], "rooms": room_labels, "process": proc, "stage_title": proc, "fields": _process_fields()}
            if not room_labels:
                header_extra["room_assignment_required"] = True
                header_extra["room_source_text"] = ph["room"] or ph["room_no"] or ""
            add("stage", f"Процесс: {proc} · {ph['room']} {ph['room_no']}".strip(), "process_header", header_extra)
            pending_title = ""
            continue

        # Справочные таблицы шапки BMR. Они нужны руководителю/ДОК как часть
        # master-copy, но не должны становиться заданиями оператора на планшете.
        if "утверждение" in flat and "департамент производства" in flat:
            extra = {**_plain_table(val), "operator_visible": False}
            add("reference_table", "Матрица утверждения BMR", "reference_table", extra)
            pending_title = ""
            continue
        if "ф.и.о" in flat and "инициалы" in flat and "департамент" in flat:
            extra = {**_plain_table(val), "operator_visible": False}
            add("reference_table", "Журнал подписей BMR", "reference_table", extra)
            pending_title = ""
            continue
        if "version" in flat and "reason" in flat:
            extra = {**_plain_table(val), "operator_visible": False}
            add("reference_table", "История изменений BMR", "reference_table", extra)
            pending_title = ""
            continue

        # производственная формула
        if "состав" in flat and ("кол-во" in flat or "количество на серию" in flat):
            formula_rows = _formula(rows)
            if formula_rows and not formula_by_name:
                formula_by_name = _formula_lookup(formula_rows)
            extra = {"rows": formula_rows, "fields": []}
            fingerprint = _formula_fingerprint(formula_rows)
            score = _formula_score(formula_rows)
            if fingerprint in seen_formula_sections:
                section = sections[seen_formula_sections[fingerprint]]
                if score > seen_formula_scores.get(fingerprint, 0):
                    section["config"]["rows"] = formula_rows
                    seen_formula_scores[fingerprint] = score
            elif not dup("production_formula", "production_formula", extra):
                seen_formula_sections[fingerprint] = len(sections)
                seen_formula_scores[fingerprint] = score
                add("production_formula", pending_title or "Производственная формула", "production_formula", extra)
            pending_title = ""
            continue

        # лист расположения / распределения
        if "лист располож" in pending_title.lower() or ("наименован" in flat and "серия субстанц" in flat):
            groups = _distribution(rows, formula_by_name)
            fingerprint = repr(groups)
            if fingerprint in seen_distribution_fingerprints:
                pending_title = ""
                continue
            seen_distribution_fingerprints.add(fingerprint)
            extra = {"stage": "weighing", "groups": groups, "fields": _distribution_fields(groups)}
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
        if (
            ("оборудован" in flat or "название оборудования" in flat)
            and ("модель" in flat or "модел" in flat or "поверк" in flat or "серия" in flat or "марка" in flat)
        ):
            extra = {"rows": _equipment(rows), "fields": []}
            if not dup("equipment", "equipment", extra):
                add("equipment", pending_title or "Оборудование / приборы", "equipment", extra)
            pending_title = ""
            continue

        # технологические этапы (шаги процесса) с подписями
        st, st_fields = _steps(val)
        if st and ("технолог" in flat or "этап" in flat or len(st) >= 1):
            extra = {"steps": st, "fields": st_fields}
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

        # Самостоятельные таблицы контроля/расчётов без шапки «Технологические
        # этапы»: металлоискатель, параметры прессования, IPC, блистеровка,
        # упаковочные материалы, итог выхода, финальные подписи и т.п.
        meaningful_source = f"{pending_title.lower()} {flat}"
        meaningful = any(word in meaningful_source for word in (
            "металлоиск", "стандартные параметры", "в процессе", "внешний вид",
            "склеивание", "упаковочные материалы", "итого", "фактический выход",
            "рассмотрено", "подпись", "составлено", "этикетка статуса", "распечатка",
            "расчет эффективности", "параметр испытаний", "признаваемые критерии",
            "этапы процесса", "наименование документа", "статус", "пуансон",
            "матрица", "отбор проб",
        ))
        if meaningful:
            title = _section_title(pending_title, "Контрольная таблица")
            # Префикс полей пустой: длинный текст-инструкция уже хранится в title
            # секции и показывается над таблицей; дублировать его в каждую метку
            # поля не нужно (иначе «<вся инструкция> · строка N · Дата»).
            parsed = _generic_process_table(val, "")
            if parsed["rows"]:
                extra = parsed
                if "расчет эффективности" in meaningful_source and cur_stage == "identity":
                    extra = {**parsed, "stage": "weighing", "room": "Комн. 39", "rooms": ["Комн. 39"]}
                add("process_table", title, "process_table", extra)
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
        for s in sections:
            _dedupe_labels(s["config"].get("fields") or [])
        _enrich_material_codes(db, sections)
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
