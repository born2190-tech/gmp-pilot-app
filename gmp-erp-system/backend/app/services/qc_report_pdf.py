"""PDF-рендерер аналитического листа ОКК.

Форма Ф-11: СОП-533 («Аналитический лист входного контроля сырья и
вспомогательного материала») для субстанций/упаковки и СОП-548
(«Аналитический паспорт на ГП») для готовой продукции.

Структура повторяет печатную форму: шапка ДКК novugen, реквизиты серии,
таблица результатов (Тест / Спецификация / Результат / Соответствие НД),
заключение и подписи.
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
    "Республика Узбекистан, Сырдарьинская область, Сырдарьинский район, "
    "АПВ С. Рахимова, ул. М. Захидова, д-39 · Тел: 95 475-20-30 · novugen_uz@mail.ru"
)


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
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=14 * mm, rightMargin=14 * mm, topMargin=12 * mm, bottomMargin=14 * mm,
        title=f"Аналитический лист {data.get('report_no', '')}",
    )

    body = ParagraphStyle("body", fontName=body_font, fontSize=9, leading=11)
    small = ParagraphStyle("small", fontName=body_font, fontSize=7.5, leading=9)
    cell = ParagraphStyle("cell", fontName=body_font, fontSize=8, leading=10)
    cell_b = ParagraphStyle("cell_b", fontName=bold_font, fontSize=8, leading=10, alignment=1)
    title_style = ParagraphStyle("title", fontName=bold_font, fontSize=13, leading=16, alignment=1)
    org_name = ParagraphStyle("org", fontName=bold_font, fontSize=10, leading=12, alignment=1)
    meta_center = ParagraphStyle("meta_c", fontName=body_font, fontSize=7.5, leading=9, alignment=1)

    elements: list = []

    # Шапка
    if _LOGO_PATH.is_file():
        logo_cell: object = Image(str(_LOGO_PATH), width=30 * mm, height=11 * mm, kind="proportional")
    else:
        logo_cell = Paragraph("<b>novugen</b>", ParagraphStyle("logo", fontName=bold_font, fontSize=16, alignment=1))

    header = Table(
        [[
            logo_cell,
            Paragraph("ИП ООО «NOVUGEN PHARMA» (Узбекистан)<br/>ДЕПАРТАМЕНТ КОНТРОЛЯ КАЧЕСТВА (ДКК)", org_name),
            Paragraph(f"СОП-{data.get('sop_form')} Ф-11", meta_center),
        ]],
        colWidths=[34 * mm, 110 * mm, 38 * mm], rowHeights=[14 * mm],
    )
    header.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    elements.append(header)
    elements.append(Paragraph(ORG_ADDRESS, small))
    elements.append(Spacer(1, 3 * mm))

    elements.append(Paragraph(
        "АНАЛИТИЧЕСКИЙ ПАСПОРТ НА ГП" if is_fg else "АНАЛИТИЧЕСКИЙ ЛИСТ ВХОДНОГО КОНТРОЛЯ",
        title_style,
    ))
    elements.append(Spacer(1, 3 * mm))

    # Мета-блок
    pairs = [
        ("Отчёт №", data.get("report_no") or "—"),
        ("Наименование", data.get("material_name") or "—"),
        ("Серия", data.get("internal_lot") or "—"),
        ("Производитель", data.get("manufacturer_name") or "—"),
        ("Дата производства", _fmt_dt(data.get("production_date"))),
        ("Срок годности", _fmt_dt(data.get("expiry_date"))),
        ("Дата отбора", _fmt_dt(data.get("sampling_date"))),
        ("Метод-ссылка", data.get("method_reference") or "—"),
        ("Начало анализа", _fmt_dt(data.get("analysis_started_at"))),
        ("Окончание анализа", _fmt_dt(data.get("analysis_finished_at"))),
    ]
    meta = Table([[Paragraph(k, cell), Paragraph(str(v), cell)] for k, v in pairs],
                 colWidths=[45 * mm, 137 * mm])
    meta.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.4, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
    ]))
    elements.append(meta)
    elements.append(Spacer(1, 3 * mm))

    # Условия проведения анализа / оборудование.
    cond_pairs = []
    if data.get("room_temp"):
        cond_pairs.append(("Температура в помещении", str(data.get("room_temp"))))
    if data.get("humidity"):
        cond_pairs.append(("Относительная влажность", str(data.get("humidity"))))
    if data.get("equipment"):
        cond_pairs.append(("Оборудование (КИП)", str(data.get("equipment"))))
    if cond_pairs:
        cond = Table([[Paragraph(k, cell), Paragraph(v, cell)] for k, v in cond_pairs],
                     colWidths=[45 * mm, 137 * mm])
        cond.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
        ]))
        elements.append(cond)
        elements.append(Spacer(1, 3 * mm))

    section_style = ParagraphStyle("section", fontName=bold_font, fontSize=10, leading=13)

    def _results_table(params: list) -> Table:
        rows = [[
            Paragraph("№", cell_b), Paragraph("Тест", cell_b),
            Paragraph("Спецификация", cell_b), Paragraph("Результат", cell_b),
            Paragraph("Соотв. НД", cell_b),
        ]]
        for idx, p in enumerate(params, start=1):
            unit = f" {p['unit']}" if p.get("unit") else ""
            rows.append([
                Paragraph(str(idx), cell),
                Paragraph(p.get("parameter_name", ""), cell),
                Paragraph(p.get("specification", ""), cell),
                Paragraph(f"{p.get('result_value', '')}{unit}", cell),
                Paragraph("Да" if p.get("complies") else "НЕТ", cell_b),
            ])
        table = Table(rows, colWidths=[10 * mm, 52 * mm, 50 * mm, 45 * mm, 25 * mm], repeatRows=1)
        table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.black),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (4, 1), (4, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        return table

    # Раздельные списки ФХ / микро; при их отсутствии — общий список.
    pc_params = data.get("pc_parameters")
    micro_params = data.get("micro_parameters")
    if pc_params is None and micro_params is None:
        pc_params = data.get("parameters", [])
        micro_params = []
    pc_params = pc_params or []
    micro_params = micro_params or []

    all_params = list(pc_params) + list(micro_params)

    # Физико-химические показатели.
    elements.append(Paragraph("1. Физико-химические показатели", section_style))
    elements.append(Spacer(1, 2 * mm))
    elements.append(_results_table(pc_params))
    elements.append(Spacer(1, 4 * mm))

    # Микробиологическая чистота (СОП-514).
    if data.get("micro_required", True):
        title_micro = "2. Микробиологическая чистота (СОП-514)"
        micro_ref = data.get("micro_method_reference")
        if micro_ref:
            title_micro += f" — {micro_ref}"
        elements.append(Paragraph(title_micro, section_style))
        micro_window = []
        if data.get("micro_started_at"):
            micro_window.append(f"начало {_fmt_dt(data.get('micro_started_at'))}")
        if data.get("micro_finished_at"):
            micro_window.append(f"окончание {_fmt_dt(data.get('micro_finished_at'))}")
        if micro_window:
            elements.append(Paragraph(" · ".join(micro_window), small))
        elements.append(Spacer(1, 2 * mm))
        if micro_params:
            elements.append(_results_table(micro_params))
        else:
            elements.append(Paragraph("Результаты микробиологического анализа вносятся отдельно.", body))
        elements.append(Spacer(1, 4 * mm))
    else:
        elements.append(Paragraph(
            "2. Микробиологическая чистота — не требуется согласно НД.", body))
        elements.append(Spacer(1, 4 * mm))

    # Заключение
    overall = (data.get("overall_result") or "").lower()
    if overall in ("pass", "passed", "complies", "соответствует"):
        verdict = "Соответствует требованиям НД"
    elif overall in ("fail", "failed", "не соответствует"):
        verdict = "НЕ соответствует требованиям НД"
    else:
        all_ok = all(p.get("complies") for p in all_params) if all_params else False
        verdict = "Соответствует требованиям НД" if all_ok else "НЕ соответствует требованиям НД"
    elements.append(Paragraph(f"<b>Заключение:</b> {verdict}", body))
    elements.append(Spacer(1, 8 * mm))

    # Подписи
    for line in (
        "Химик-аналитик: _______________________ (ФИО) ____________",
        "Начальник ДКК: _______________________ (ФИО) ____________",
    ):
        elements.append(Paragraph(line, body))
        elements.append(Spacer(1, 5 * mm))

    today = datetime.utcnow().strftime("%d.%m.%Y %H:%M")
    elements.append(Spacer(1, 2 * mm))
    elements.append(Paragraph(
        f"<i>Сформировано: {today} UTC · СОП-{data.get('sop_form')} Ф-11</i>",
        ParagraphStyle("footer", fontName=body_font, fontSize=8, leading=10, textColor=colors.grey),
    ))

    doc.build(elements)
    return buffer.getvalue()
