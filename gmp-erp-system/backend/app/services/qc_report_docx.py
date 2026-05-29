"""Word-рендерер аналитического листа ОКК (форма Ф-11).

Повторяет структуру PDF-версии (`qc_report_pdf.render_qc_report_pdf`), но в
формате .docx: шапка с логотипом и кодом СОП, адресный блок, реквизиты серии
и анализа, таблица результатов, заключение, блок подписей и предупреждение.

Шрифт всего документа — Times New Roman, кегль 12.
"""
from __future__ import annotations

import io
from datetime import datetime

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

from app.services.qc_report_pdf import ORG_ADDRESS, _LOGO_PATH, _fmt_dt

_FONT = "Times New Roman"
_RED = RGBColor(0xB9, 0x1C, 0x1C)
_GREY = RGBColor(0x33, 0x41, 0x55)
_HEAD_FILL = "E2E8F0"


# ── низкоуровневые помощники форматирования ──────────────────────────────────
def _set_run_font(run, *, size: float = 12, bold: bool = False, italic: bool = False,
                  color: RGBColor | None = None) -> None:
    run.font.name = _FONT
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs"):
        rfonts.set(qn(attr), _FONT)


def _para(cell_or_doc, text: str = "", *, size: float = 12, bold: bool = False,
          italic: bool = False, align=None, color: RGBColor | None = None,
          space_after: float = 0):
    """Добавляет абзац (в ячейку или документ) с заданным форматированием."""
    p = cell_or_doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(0)
    if align is not None:
        p.alignment = align
    if text:
        run = p.add_run(text)
        _set_run_font(run, size=size, bold=bold, italic=italic, color=color)
    return p


def _cell_text(cell, text: str = "", *, size: float = 12, bold: bool = False,
               align=None, color: RGBColor | None = None) -> None:
    """Записывает одну строку текста в ячейку (очищая дефолтный абзац)."""
    cell.paragraphs[0].text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.space_before = Pt(0)
    if align is not None:
        p.alignment = align
    run = p.add_run(text)
    _set_run_font(run, size=size, bold=bold, color=color)


def _shade_cell(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def _set_borders(table, *, sz: int = 8, color: str = "000000",
                 inner_color: str = "94A3B8", inner_sz: int = 4) -> None:
    tbl_pr = table._element.tblPr
    borders = OxmlElement("w:tblBorders")
    edges = {
        "top": (sz, color), "bottom": (sz, color), "left": (sz, color), "right": (sz, color),
        "insideH": (inner_sz, inner_color), "insideV": (inner_sz, inner_color),
    }
    for edge, (width, clr) in edges.items():
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(width))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), clr)
        borders.append(el)
    tbl_pr.append(borders)


def _no_borders(table) -> None:
    tbl_pr = table._element.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "bottom", "left", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "none")
        borders.append(el)
    tbl_pr.append(borders)


def _set_col_widths(table, widths_cm: list[float]) -> None:
    table.autofit = False
    table.allow_autofit = False
    for row in table.rows:
        for idx, w in enumerate(widths_cm):
            if idx < len(row.cells):
                row.cells[idx].width = Cm(w)


# ── основной рендер ──────────────────────────────────────────────────────────
def render_qc_report_docx(data: dict) -> bytes:
    is_fg = data.get("sop_form") == "548"
    sop_form = data.get("sop_form") or "533"

    doc = Document()
    # дефолтный стиль — Times New Roman 12
    normal = doc.styles["Normal"]
    normal.font.name = _FONT
    normal.font.size = Pt(12)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), _FONT)

    section = doc.sections[0]
    section.orientation = WD_ORIENT.PORTRAIT
    section.left_margin = Cm(1.2)
    section.right_margin = Cm(1.2)
    section.top_margin = Cm(1.0)
    section.bottom_margin = Cm(1.2)
    usable = 18.6  # см

    # ── Шапка: лого | департамент + форма | код СОП ──────────────────────
    header = doc.add_table(rows=1, cols=3)
    header.alignment = WD_TABLE_ALIGNMENT.CENTER
    _set_borders(header, inner_color="000000", inner_sz=6)
    _set_col_widths(header, [3.2, 11.6, 3.8])
    logo_cell, mid_cell, code_cell = header.rows[0].cells
    for c in (logo_cell, mid_cell, code_cell):
        c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER

    logo_cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    if _LOGO_PATH.is_file():
        try:
            logo_cell.paragraphs[0].add_run().add_picture(str(_LOGO_PATH), width=Cm(2.8))
        except Exception:
            _cell_text(logo_cell, "novugen", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    else:
        _cell_text(logo_cell, "novugen", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)

    mid_cell.paragraphs[0].text = ""
    _para(mid_cell, "ИПООО «NOVUGEN PHARMA» (Узбекистан)", align=WD_ALIGN_PARAGRAPH.CENTER)
    _para(mid_cell, "ДЕПАРТАМЕНТ КОНТРОЛЯ КАЧЕСТВА", size=13, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    subtitle = (
        "Аналитический паспорт на готовую продукцию"
        if is_fg else
        "Аналитический лист входного контроля сырья и вспомогательного материала"
    )
    _para(mid_cell, subtitle, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    _cell_text(code_cell, f"СОП-{sop_form}, Ф-11", size=10, align=WD_ALIGN_PARAGRAPH.RIGHT)

    # ── Адресная строка ──────────────────────────────────────────────────
    addr = doc.add_table(rows=1, cols=1)
    _set_borders(addr)
    _set_col_widths(addr, [usable])
    _cell_text(addr.rows[0].cells[0], ORG_ADDRESS, size=9)

    _para(doc, "", size=4)

    # ── Подготовка данных ────────────────────────────────────────────────
    spec_ref = data.get("method_reference") or ""
    material_name = data.get("material_name") or "—"
    spec_line = (
        f"{spec_ref} Спецификация на «{material_name}»".strip()
        if spec_ref else f"Спецификация на «{material_name}»"
    )
    conditions = []
    if data.get("room_temp"):
        conditions.append(f"Температура помещения: {data.get('room_temp')}")
    if data.get("humidity"):
        conditions.append(f"Влажность: {data.get('humidity')}")
    conditions_text = "; ".join(conditions) if conditions else "—"

    overall = (data.get("overall_result") or "").lower()
    pc_params = data.get("pc_parameters")
    micro_params = data.get("micro_parameters")
    if pc_params is None and micro_params is None:
        pc_params = data.get("parameters", [])
        micro_params = []
    pc_params = list(pc_params or [])
    micro_params = list(micro_params or [])
    all_params = pc_params + micro_params

    if overall in ("pass", "passed", "complies", "соответствует"):
        complies_all = True
    elif overall in ("fail", "failed", "не соответствует"):
        complies_all = False
    else:
        complies_all = all(p.get("complies") for p in all_params) if all_params else False
    sample_condition = "Соответствует требованиям НД" if complies_all else "Не соответствует требованиям НД"

    def _v(text) -> str:
        return "—" if text in (None, "") else str(text)

    # ── Реквизиты серии и анализа (4 колонки; часть строк — во всю ширину) ─
    meta_rows: list[tuple[str, str, str, str, bool]] = [
        ("Наименование сырья:", _v(data.get("material_name")), "", "", True),
        ("Место проведения испытания:", "Лаборатория ДКК", "", "", True),
        ("Производитель/Поставщик:", _v(data.get("manufacturer_name")), "", "", True),
        ("Серия:", _v(data.get("internal_lot")), "Размер серии:", _v(data.get("lot_size")), False),
        ("Дата производства:", _fmt_dt(data.get("production_date")),
         "Место отбора:", _v(data.get("sampling_location")), False),
        ("Годен до:", _fmt_dt(data.get("expiry_date")),
         "Дата отбора и начала анализа:", _fmt_dt(data.get("sampling_date")), False),
        ("Отчёт №:", _v(data.get("report_no")),
         "Дата окончания анализа:", _fmt_dt(data.get("analysis_finished_at")), False),
        ("Место отбора (процедура):",
         "СОП-533 Процедура отбора средней пробы исходного сырья", "", "", True),
        ("НД:", spec_line, "", "", True),
        ("Дата анализа:", _fmt_dt(data.get("analysis_started_at")), "", "", True),
        ("Состояние образца:", sample_condition, "", "", True),
        ("Условия проведения испытания:", conditions_text, "", "", True),
    ]
    meta = doc.add_table(rows=len(meta_rows), cols=4)
    _set_borders(meta)
    _set_col_widths(meta, [4.4, 5.6, 4.4, 4.2])
    for r, (l1, v1, l2, v2, span) in enumerate(meta_rows):
        cells = meta.rows[r].cells
        for c in cells:
            c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        _cell_text(cells[0], l1, bold=True)
        if span:
            merged = cells[1].merge(cells[2]).merge(cells[3])
            _cell_text(merged, v1)
        else:
            _cell_text(cells[1], v1)
            _cell_text(cells[2], l2, bold=True)
            _cell_text(cells[3], v2)

    _para(doc, "", size=4)
    _para(doc, "Результаты анализа в таблице", bold=True, space_after=2)

    # ── Таблица результатов ──────────────────────────────────────────────
    res = doc.add_table(rows=1 + len(all_params), cols=5)
    _set_borders(res, inner_color="000000", inner_sz=6)
    _set_col_widths(res, [0.9, 5.0, 4.5, 5.7, 2.5])
    head = res.rows[0].cells
    for title, cell in zip(("№", "ТЕСТ", "РЕЗУЛЬТАТ", "СПЕЦИФИКАЦИЯ", "СООТ-Е НД"), head):
        _shade_cell(cell, _HEAD_FILL)
        cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        _cell_text(cell, title, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)

    for idx, p in enumerate(all_params, start=1):
        cells = res.rows[idx].cells
        for c in cells:
            c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        _cell_text(cells[0], str(idx), align=WD_ALIGN_PARAGRAPH.CENTER)
        # ТЕСТ: название (жирн.) + (метод-ссылка)
        cells[1].paragraphs[0].text = ""
        tp = cells[1].paragraphs[0]
        tp.paragraph_format.space_after = Pt(0)
        rn = tp.add_run((p.get("parameter_name") or "").upper())
        _set_run_font(rn, bold=True)
        if p.get("method_reference"):
            ref_p = _para(cells[1], f"({p['method_reference']})", size=10, color=_GREY)
            ref_p.paragraph_format.space_after = Pt(0)
        unit = f" {p['unit']}" if p.get("unit") else ""
        result_text = f"{p.get('result_value', '') or ''}{unit}".strip() or "—"
        _cell_text(cells[2], result_text)
        _cell_text(cells[3], p.get("specification") or "—")
        verdict = "Соответствует" if p.get("complies") else "Не соответствует"
        _cell_text(cells[4], verdict, align=WD_ALIGN_PARAGRAPH.CENTER,
                   color=None if p.get("complies") else _RED)

    _para(doc, "", size=4)

    # ── Дополнительная информация + примечание (в рамке) ─────────────────
    add_info = data.get("additional_info") or "Отсутствует"
    note_verdict = "СООТВЕТСТВУЕТ СПЕЦИФИКАЦИИ" if complies_all else "НЕ СООТВЕТСТВУЕТ СПЕЦИФИКАЦИИ"
    subject = "Готовая продукция" if is_fg else "Сырьё"
    info_box = doc.add_table(rows=2, cols=1)
    _set_borders(info_box)
    _set_col_widths(info_box, [usable])
    info_cell = info_box.rows[0].cells[0]
    info_cell.paragraphs[0].text = ""
    ip = info_cell.paragraphs[0]
    ip.paragraph_format.space_after = Pt(0)
    r1 = ip.add_run("Дополнительная информация: ")
    _set_run_font(r1, bold=True)
    r2 = ip.add_run(add_info)
    _set_run_font(r2)
    note_cell = info_box.rows[1].cells[0]
    note_cell.paragraphs[0].text = ""
    npg = note_cell.paragraphs[0]
    npg.paragraph_format.space_after = Pt(0)
    nr1 = npg.add_run("ПРИМЕЧАНИЕ: ")
    _set_run_font(nr1, bold=True)
    nr2 = npg.add_run(f"{subject} {note_verdict}")
    _set_run_font(nr2, bold=True)

    _para(doc, "", size=4)

    # ── Блок подписей (3 колонки) ────────────────────────────────────────
    sign = doc.add_table(rows=1, cols=3)
    _set_borders(sign)
    _set_col_widths(sign, [6.2, 6.2, 6.2])
    sc = sign.rows[0].cells
    for c in sc:
        c.vertical_alignment = WD_ALIGN_VERTICAL.TOP
    for cell, title, extra in (
        (sc[0], "Ответственный исполнитель:", None),
        (sc[1], "Проверил:", None),
        (sc[2], "Утвердил:", "Начальник ДКК"),
    ):
        cell.paragraphs[0].text = ""
        _para(cell, title, bold=True, space_after=2)
        if extra:
            _para(cell, extra, space_after=2)
        _para(cell, "", size=10)
        _para(cell, "___________________ / ____________", space_after=0)
        _para(cell, "(подпись / ФИО)", size=9, color=_GREY)

    _para(doc, "", size=4)

    # ── Предупредительная сноска ─────────────────────────────────────────
    _para(doc, "Полученные результаты относятся только к образцу, подвергнутому испытанию!",
          bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, color=_RED)
    _para(doc, "Запрещается вносить в «Аналитический лист» какие-либо исправления!",
          bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, color=_RED, space_after=4)

    today = datetime.utcnow().strftime("%d.%m.%Y %H:%M")
    _para(doc, f"Сформировано: {today} UTC · СОП-{sop_form}, Ф-11",
          size=8, italic=True, color=_GREY)

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()
