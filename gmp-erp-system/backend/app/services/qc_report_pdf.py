"""PDF-рендерер аналитического листа ОКК.

Форма Ф-11: СОП-533 («Аналитический лист входного контроля сырья и
вспомогательного материала») для субстанций/упаковки и СОП-548
(«Аналитический паспорт на ГП») для готовой продукции.

Структура строго повторяет утверждённую печатную форму ДКК «NOVUGEN PHARMA»:
шапка с логотипом и кодом СОП, адресный блок, реквизиты серии/анализа,
таблица результатов (№ / ТЕСТ / РЕЗУЛЬТАТ / СПЕЦИФИКАЦИЯ / СООТ-Е НД),
заключение, блок подписей и предупредительная сноска.
"""
from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


_LOGO_PATH = Path(__file__).resolve().parent.parent / "static" / "assets" / "novugen-logo.png"

_FONT_CANDIDATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("QCRBody", (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/arial.ttf",
    )),
    ("QCRBold", (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    )),
)

_FONTS_REGISTERED = False

ORG_ADDRESS = (
    "Адрес принимаемой претензии: Республика Узбекистан, Сырдарьинская область, "
    "Сырдарьинский район, АПВ С. Рахимова, ул. М. Захидова, д-39 · "
    "Тел: 97 475-20-30, 95 476-20-30 · novugen_uz@mail.ru"
)

_GRID = colors.HexColor("#94a3b8")
_DARK = colors.black


def _register_fonts() -> tuple[str, str]:
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return "QCRBody", "QCRBold"
    for alias, candidates in _FONT_CANDIDATES:
        for candidate in candidates:
            if Path(candidate).is_file():
                pdfmetrics.registerFont(TTFont(alias, candidate))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    _FONTS_REGISTERED = True
    return "QCRBody", "QCRBold"


def _fmt_dt(value) -> str:
    if not value:
        return "—"
    if hasattr(value, "strftime"):
        return value.strftime("%d.%m.%Y")
    return str(value)


def render_qc_report_pdf(data: dict) -> bytes:
    """`data` — dict с полями протокола, партии и параметров (см. эндпоинт)."""
    body_font, bold_font = _register_fonts()
    is_fg = data.get("sop_form") == "548"
    sop_form = data.get("sop_form") or "533"
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=12 * mm, rightMargin=12 * mm, topMargin=10 * mm, bottomMargin=12 * mm,
        title=f"Аналитический лист {data.get('report_no', '')}",
    )

    # ── Стили ────────────────────────────────────────────────────────────
    label = ParagraphStyle("label", fontName=bold_font, fontSize=8, leading=10)
    value = ParagraphStyle("value", fontName=body_font, fontSize=8, leading=10)
    small = ParagraphStyle("small", fontName=body_font, fontSize=6.8, leading=8.2)
    cell = ParagraphStyle("cell", fontName=body_font, fontSize=8, leading=9.5)
    cell_head = ParagraphStyle("cell_head", fontName=bold_font, fontSize=8.5, leading=10, alignment=1)
    test_name = ParagraphStyle("test_name", fontName=bold_font, fontSize=8.2, leading=9.8)
    test_ref = ParagraphStyle("test_ref", fontName=body_font, fontSize=7, leading=8.4,
                              textColor=colors.HexColor("#334155"))
    cmpl = ParagraphStyle("cmpl", fontName=body_font, fontSize=8, leading=10, alignment=1)
    org_name = ParagraphStyle("org", fontName=bold_font, fontSize=11, leading=13, alignment=1)
    org_sub = ParagraphStyle("org_sub", fontName=body_font, fontSize=8, leading=10, alignment=1)
    title_style = ParagraphStyle("title", fontName=bold_font, fontSize=11, leading=13.5, alignment=1)
    code_style = ParagraphStyle("code", fontName=body_font, fontSize=7.5, leading=9, alignment=2)

    elements: list = []

    # ── Шапка: лого | департамент + название формы | код СОП ─────────────
    if _LOGO_PATH.is_file():
        logo_cell: object = Image(str(_LOGO_PATH), width=28 * mm, height=12 * mm, kind="proportional")
    else:
        logo_cell = Paragraph("<b>novugen</b>",
                              ParagraphStyle("logo", fontName=bold_font, fontSize=15, alignment=1))

    subtitle = (
        "Аналитический паспорт<br/>на готовую продукцию"
        if is_fg else
        "Аналитический лист<br/>Входного контроля сырья и вспомогательного материала"
    )
    center_block = [
        Paragraph("ИПООО «NOVUGEN PHARMA» (Узбекистан)", org_sub),
        Paragraph("ДЕПАРТАМЕНТ КОНТРОЛЯ КАЧЕСТВА", org_name),
        Spacer(1, 1.5 * mm),
        Paragraph(subtitle, title_style),
    ]
    header = Table(
        [[logo_cell, center_block, Paragraph(f"СОП-{sop_form}, Ф-11", code_style)]],
        colWidths=[32 * mm, 116 * mm, 38 * mm],
    )
    header.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, _DARK),
        ("LINEAFTER", (0, 0), (0, 0), 0.6, _DARK),
        ("VALIGN", (0, 0), (0, 0), "MIDDLE"),
        ("VALIGN", (1, 0), (1, 0), "MIDDLE"),
        ("VALIGN", (2, 0), (2, 0), "TOP"),
        ("ALIGN", (0, 0), (0, 0), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (2, 0), (2, 0), 3),
    ]))
    elements.append(header)

    # ── Адресная строка ──────────────────────────────────────────────────
    addr = Table([[Paragraph(ORG_ADDRESS, small)]], colWidths=[186 * mm])
    addr.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, _DARK),
        ("LINEABOVE", (0, 0), (-1, 0), 0, colors.white),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(addr)
    elements.append(Spacer(1, 2 * mm))

    # ── Реквизиты серии и анализа (4 колонки, часть строк во всю ширину) ──
    def L(text: str):
        return Paragraph(text, label)

    def V(text) -> Paragraph:
        return Paragraph("—" if text in (None, "") else str(text), value)

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

    EMPTY = Paragraph("", value)
    # (row_cells, spans) — span=True означает значение во всю ширину (col1..3).
    meta_rows: list[tuple[list, bool]] = [
        ([L("Наименование сырья:"), V(data.get("material_name")), EMPTY, EMPTY], True),
        ([L("Место проведения испытания:"), V("Лаборатория ДКК"), EMPTY, EMPTY], True),
        ([L("Производитель/Поставщик:"), V(data.get("manufacturer_name")), EMPTY, EMPTY], True),
        ([L("Серия:"), V(data.get("internal_lot")), L("Размер серии:"), V(data.get("lot_size"))], False),
        ([L("Дата производства:"), V(_fmt_dt(data.get("production_date"))),
          L("Место отбора:"), V(data.get("sampling_location"))], False),
        ([L("Годен до:"), V(_fmt_dt(data.get("expiry_date"))),
          L("Дата отбора и начала анализа:"), V(_fmt_dt(data.get("sampling_date")))], False),
        ([L("Отчёт №:"), V(data.get("report_no")),
          L("Дата окончания анализа:"), V(_fmt_dt(data.get("analysis_finished_at")))], False),
        ([L("Место отбора (процедура):"),
          V("СОП-533 Процедура отбора средней пробы исходного сырья"), EMPTY, EMPTY], True),
        ([L("НД:"), V(spec_line), EMPTY, EMPTY], True),
        ([L("Дата анализа:"), V(_fmt_dt(data.get("analysis_started_at"))), EMPTY, EMPTY], True),
        ([L("Состояние образца:"), V(sample_condition), EMPTY, EMPTY], True),
        ([L("Условия проведения испытания:"), V(conditions_text), EMPTY, EMPTY], True),
    ]
    meta_data = [r[0] for r in meta_rows]
    meta = Table(meta_data, colWidths=[44 * mm, 56 * mm, 44 * mm, 42 * mm])
    meta_style = [
        ("BOX", (0, 0), (-1, -1), 0.8, _DARK),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, _GRID),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]
    for r, (_, is_span) in enumerate(meta_rows):
        if is_span:
            meta_style.append(("SPAN", (1, r), (3, r)))
    meta.setStyle(TableStyle(meta_style))
    elements.append(meta)
    elements.append(Spacer(1, 2.5 * mm))

    # ── Подпись над таблицей ─────────────────────────────────────────────
    elements.append(Paragraph(
        "Результаты анализа в таблице",
        ParagraphStyle("cap", fontName=bold_font, fontSize=8.5, leading=11),
    ))
    elements.append(Spacer(1, 1 * mm))

    # ── Таблица результатов ──────────────────────────────────────────────
    rows = [[
        Paragraph("№", cell_head), Paragraph("ТЕСТ", cell_head),
        Paragraph("РЕЗУЛЬТАТ", cell_head), Paragraph("СПЕЦИФИКАЦИЯ", cell_head),
        Paragraph("СООТ-Е НД", cell_head),
    ]]
    for idx, p in enumerate(all_params, start=1):
        unit = f" {p['unit']}" if p.get("unit") else ""
        test_cell = [Paragraph((p.get("parameter_name") or "").upper(), test_name)]
        if p.get("method_reference"):
            test_cell.append(Paragraph(f"({p['method_reference']})", test_ref))
        verdict = "Соответствует" if p.get("complies") else "Не соответствует"
        rows.append([
            Paragraph(str(idx), cmpl),
            test_cell,
            Paragraph(f"{p.get('result_value', '') or ''}{unit}".strip() or "—", cell),
            Paragraph(p.get("specification") or "—", cell),
            Paragraph(verdict, cmpl),
        ])
    table = Table(rows, colWidths=[9 * mm, 50 * mm, 45 * mm, 57 * mm, 25 * mm], repeatRows=1)
    table_style = [
        ("BOX", (0, 0), (-1, -1), 0.8, _DARK),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, _DARK),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for r in range(1, len(rows)):
        if not all_params[r - 1].get("complies"):
            table_style.append(("TEXTCOLOR", (4, r), (4, r), colors.HexColor("#b91c1c")))
    table.setStyle(TableStyle(table_style))
    elements.append(table)
    elements.append(Spacer(1, 2 * mm))

    # ── Дополнительная информация + примечание (в одной рамке) ───────────
    add_info = data.get("additional_info") or "Отсутствует"
    note_verdict = "СООТВЕТСТВУЕТ СПЕЦИФИКАЦИИ" if complies_all else "НЕ СООТВЕТСТВУЕТ СПЕЦИФИКАЦИИ"
    subject = "Готовая продукция" if is_fg else "Сырьё"
    note_style = ParagraphStyle("note", fontName=bold_font, fontSize=8.5, leading=11)
    info_box = Table(
        [
            [Paragraph(f"<b>Дополнительная информация:</b> {add_info}", value)],
            [Paragraph(f"<b>ПРИМЕЧАНИЕ:</b> {subject} {note_verdict}", note_style)],
        ],
        colWidths=[186 * mm],
    )
    info_box.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, _DARK),
        ("LINEBELOW", (0, 0), (-1, 0), 0.4, _GRID),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    elements.append(info_box)

    # ── Блок подписей (3 колонки в рамке) ────────────────────────────────
    sig_label = ParagraphStyle("sig_l", fontName=bold_font, fontSize=8, leading=10)
    sig_line = ParagraphStyle("sig_line", fontName=body_font, fontSize=8, leading=14)
    sign = Table(
        [[
            [Paragraph("Ответственный исполнитель:", sig_label), Spacer(1, 9 * mm),
             Paragraph("___________________ / ____________", sig_line),
             Paragraph("(подпись / ФИО)", small)],
            [Paragraph("Проверил:", sig_label), Spacer(1, 9 * mm),
             Paragraph("___________________ / ____________", sig_line),
             Paragraph("(подпись / ФИО)", small)],
            [Paragraph("Утвердил:", sig_label),
             Paragraph("Начальник ДКК", value), Spacer(1, 5 * mm),
             Paragraph("___________________ / ____________", sig_line),
             Paragraph("(подпись / ФИО)", small)],
        ]],
        colWidths=[62 * mm, 62 * mm, 62 * mm],
    )
    sign.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, _DARK),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, _GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    elements.append(sign)
    elements.append(Spacer(1, 5 * mm))

    # ── Предупредительная сноска ─────────────────────────────────────────
    warn = ParagraphStyle(
        "warn", fontName=bold_font, fontSize=8, leading=10, alignment=1,
        textColor=colors.HexColor("#b91c1c"),
    )
    elements.append(Paragraph(
        "Полученные результаты относятся только к образцу, подвергнутому испытанию!", warn))
    elements.append(Paragraph(
        "Запрещается вносить в «Аналитический лист» какие-либо исправления!", warn))

    today = datetime.utcnow().strftime("%d.%m.%Y %H:%M")
    elements.append(Spacer(1, 2 * mm))
    elements.append(Paragraph(
        f"<i>Сформировано: {today} UTC · СОП-{sop_form}, Ф-11</i>",
        ParagraphStyle("footer", fontName=body_font, fontSize=7, leading=9, textColor=colors.grey),
    ))

    doc.build(elements)
    return buffer.getvalue()
