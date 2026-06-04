"""PDF «Заключение на вторичный упаковочный материал» — Приложение Ф-2 к СОП-543.

Формируется ДКК по результатам входного контроля упаковочной партии
(склад PACKAGING_WAREHOUSE). Колонки: № / Наименование показателя /
Результаты испытания / Требования НД / Соответствие НД, итоговое заключение
и три подписи (Исполнитель / Проверил / Начальник ДКК).
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

_ORG_ADDRESS = (
    "Республика Узбекистан, Сырдарьинская область, Сырдарьинский район, "
    "АПВ с. Рахимова, ул. М. Захидова, д-39"
)

_FONT_CANDIDATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("PCBody", (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/arial.ttf",
    )),
    ("PCBold", (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    )),
)
_FONTS_REGISTERED = False


def _register_fonts() -> tuple[str, str]:
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return "PCBody", "PCBold"
    for alias, candidates in _FONT_CANDIDATES:
        for candidate in candidates:
            if Path(candidate).is_file():
                pdfmetrics.registerFont(TTFont(alias, candidate))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    _FONTS_REGISTERED = True
    return "PCBody", "PCBold"


def _fmt_date(value) -> str:
    if not value:
        return "—"
    try:
        return value.strftime("%d.%m.%Y")
    except AttributeError:
        return str(value)


def render_packaging_conclusion_pdf(data: dict, qr_payload: str | None = None) -> bytes:
    body_font, bold_font = _register_fonts()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=14 * mm, rightMargin=14 * mm, topMargin=12 * mm, bottomMargin=14 * mm,
        title=f"Заключение на ВУМ {data.get('report_no', '')}",
    )

    body = ParagraphStyle("body", fontName=body_font, fontSize=9, leading=11)
    cell = ParagraphStyle("cell", fontName=body_font, fontSize=8.5, leading=10.5)
    cell_b = ParagraphStyle("cell_b", fontName=bold_font, fontSize=8.5, leading=10.5, alignment=1)
    cell_c = ParagraphStyle("cell_c", fontName=body_font, fontSize=8.5, leading=10.5, alignment=1)
    title_style = ParagraphStyle("title", fontName=bold_font, fontSize=12, leading=15, alignment=1)
    org_name = ParagraphStyle("org", fontName=bold_font, fontSize=11, leading=14, alignment=1)
    small = ParagraphStyle("small", fontName=body_font, fontSize=7.5, leading=9.5, alignment=1)
    footer = ParagraphStyle("footer", fontName=body_font, fontSize=8, leading=10, textColor=colors.grey)

    elements: list = []

    # header
    if _LOGO_PATH.is_file():
        logo_cell: object = Image(str(_LOGO_PATH), width=32 * mm, height=11 * mm, kind="proportional")
    else:
        logo_cell = Paragraph("<b>novugen</b>", ParagraphStyle("logo", fontName=bold_font, fontSize=16, leading=20, alignment=1))

    # Фольга — первичная упаковка (ПУМ) по СОП-561; остальное — ВУМ по СОП-543.
    is_primary = data.get("packaging_type") == "foil"
    appendix = "Приложение Ф-1 к СОП-561" if is_primary else "Приложение Ф-2 к СОП-543"
    doc_title = (
        "АНАЛИТИЧЕСКИЙ ЛИСТ входного контроля первичного упаковочного материала"
        if is_primary
        else "ЗАКЛЮЧЕНИЕ на ВТОРИЧНЫЙ УПАКОВОЧНЫЙ МАТЕРИАЛ"
    )

    from app.services.document_qr import make_qr_image
    qr_image = make_qr_image(qr_payload, size_mm=17.0) if qr_payload else None
    right_cell: object = Paragraph(appendix, small)
    if qr_image is not None:
        right_cell = [Paragraph(appendix, small), qr_image, Paragraph("КР-код документа", footer)]

    header = Table(
        [[logo_cell,
          [Paragraph("ИП ООО «NOVUGEN PHARMA» (Узбекистан)", org_name),
           Paragraph("ДЕПАРТАМЕНТ КОНТРОЛЯ КАЧЕСТВА", body),
           Paragraph(doc_title, title_style)],
          right_cell]],
        colWidths=[40 * mm, 100 * mm, 42 * mm],
        rowHeights=[26 * mm if qr_image is not None else 18 * mm],
    )
    header.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    elements.append(header)
    elements.append(Paragraph(f"Адрес предприятия: {_ORG_ADDRESS}", footer))
    elements.append(Spacer(1, 3 * mm))

    # meta
    meta_rows = [
        [Paragraph(f"<b>№ заключения / Аналит. протокол:</b> {data.get('report_no', '')}", body),
         Paragraph(f"<b>Тип материала:</b> {data.get('packaging_type_label') or '—'}", body)],
        [Paragraph(f"<b>Наименование:</b> {data.get('material_name') or '—'}", body),
         Paragraph(f"<b>Производитель:</b> {data.get('manufacturer_name') or '—'}", body)],
        [Paragraph(f"<b>Серия:</b> {data.get('internal_lot') or '—'}", body),
         Paragraph(f"<b>Кол-во в партии:</b> {data.get('lot_size') or '—'}", body)],
        [Paragraph(f"<b>Дата начала анализа:</b> {_fmt_date(data.get('analysis_started_at'))}", body),
         Paragraph(f"<b>Дата окончания:</b> {_fmt_date(data.get('analysis_finished_at'))}", body)],
        [Paragraph(f"<b>НД:</b> {data.get('method_reference') or data.get('packaging_nd_ref') or '—'}", body),
         Paragraph(f"<b>Дата отбора:</b> {_fmt_date(data.get('sampling_date'))}", body)],
    ]
    meta = Table(meta_rows, colWidths=[95 * mm, 87 * mm])
    meta.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.4, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    elements.append(meta)
    elements.append(Spacer(1, 4 * mm))

    # parameters table
    rows = [[
        Paragraph("№", cell_b), Paragraph("Наименование показателя", cell_b),
        Paragraph("Результаты испытания", cell_b), Paragraph("Требования НД", cell_b),
        Paragraph("Соответствие НД", cell_b),
    ]]
    params = data.get("parameters") or []
    for i, p in enumerate(params, start=1):
        complies = p.get("complies")
        verdict = "Соответствует" if complies else "Не соответствует"
        rows.append([
            Paragraph(str(i), cell_c),
            Paragraph(p.get("parameter_name") or "", cell),
            Paragraph(f"{p.get('result_value') or '—'}{(' ' + p['unit']) if p.get('unit') and p.get('unit') != '—' else ''}", cell),
            Paragraph(p.get("specification") or "", cell),
            Paragraph(verdict, cell_c),
        ])
    table = Table(rows, colWidths=[10 * mm, 62 * mm, 38 * mm, 50 * mm, 22 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.black),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    elements.append(table)
    elements.append(Spacer(1, 4 * mm))

    # conclusion
    complies_all = data.get("overall_result") == "complies"
    _subject = "ПЕРВИЧНЫЙ УПАКОВОЧНЫЙ МАТЕРИАЛ" if is_primary else "ВТОРИЧНЫЙ УПАКОВОЧНЫЙ МАТЕРИАЛ"
    verdict_text = f"{_subject} {'СООТВЕТСТВУЕТ' if complies_all else 'НЕ СООТВЕТСТВУЕТ'} НД"
    concl = Table(
        [[Paragraph(f"<b>ЗАКЛЮЧЕНИЕ:</b> {verdict_text}", body)]],
        colWidths=[182 * mm],
    )
    concl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ecfdf5") if complies_all else colors.HexColor("#fef2f2")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    elements.append(concl)
    elements.append(Spacer(1, 6 * mm))

    # signatures
    sig = Table([
        [Paragraph("<b>Ответственный исполнитель</b>", body),
         Paragraph("<b>Проверил</b>", body),
         Paragraph("<b>Утвердил · Начальник ДКК</b>", body)],
        [Paragraph("ФИО: ____________<br/>Подпись: ________<br/>Дата: __________", body),
         Paragraph("ФИО: ____________<br/>Подпись: ________<br/>Дата: __________", body),
         Paragraph("ФИО: ____________<br/>Подпись: ________<br/>Дата: __________", body)],
    ], colWidths=[60 * mm, 60 * mm, 62 * mm], rowHeights=[8 * mm, 22 * mm])
    sig.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
    ]))
    elements.append(sig)
    elements.append(Spacer(1, 3 * mm))
    elements.append(Paragraph(
        "Полученные результаты относятся только к образцу, подвергнутому испытаниям. "
        "Запрещается вносить в «Заключение» какие-либо исправления.", footer))
    today = datetime.utcnow().strftime("%d.%m.%Y %H:%M")
    elements.append(Paragraph(f"<i>Сформировано: {today} UTC · Ф-2 к СОП-543</i>", footer))

    doc.build(elements)
    return buffer.getvalue()
