from __future__ import annotations

import io
from datetime import date, datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.schemas.reagents import ReagentDetail


_LOGO_PATH = Path(__file__).resolve().parent.parent / "static" / "assets" / "novugen-logo.png"
_FONTS_REGISTERED = False
_FONT_CANDIDATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "ReagentBody",
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ),
    ),
    (
        "ReagentBold",
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
        ),
    ),
)


def _register_fonts() -> tuple[str, str]:
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return "ReagentBody", "ReagentBold"
    for alias, candidates in _FONT_CANDIDATES:
        for candidate in candidates:
            if Path(candidate).is_file():
                pdfmetrics.registerFont(TTFont(alias, candidate))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    _FONTS_REGISTERED = True
    return "ReagentBody", "ReagentBold"


def _fmt_date(value: date | datetime | None) -> str:
    if value is None:
        return "—"
    return value.strftime("%d.%m.%Y")


def _fmt_dt(value: datetime | None) -> str:
    if value is None:
        return "—"
    return value.strftime("%d.%m.%Y %H:%M")


def _fmt_qty(value: float, unit: str) -> str:
    if value == int(value):
        return f"{int(value)} {unit}"
    return f"{value:.4f}".rstrip("0").rstrip(".") + f" {unit}"


def render_reagent_card_pdf(reagent: ReagentDetail) -> bytes:
    body_font, bold_font = _register_fonts()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=f"Карточка реактива {reagent.code}",
    )

    body = ParagraphStyle("body", fontName=body_font, fontSize=8.5, leading=10.5)
    small = ParagraphStyle("small", fontName=body_font, fontSize=7.5, leading=9)
    title = ParagraphStyle("title", fontName=bold_font, fontSize=12, leading=15, alignment=1)
    section = ParagraphStyle("section", fontName=bold_font, fontSize=9.5, leading=12)
    cell = ParagraphStyle("cell", fontName=body_font, fontSize=8, leading=10)
    cell_bold = ParagraphStyle("cell_bold", fontName=bold_font, fontSize=8, leading=10)

    elements: list = []

    logo: object
    if _LOGO_PATH.is_file():
        logo = Image(str(_LOGO_PATH), width=30 * mm, height=10 * mm, kind="proportional")
    else:
        logo = Paragraph("<b>novugen</b>", ParagraphStyle("logo", fontName=bold_font, fontSize=14, leading=18, alignment=1))

    header = Table(
        [
            [
                logo,
                Paragraph("Карточка реактива / стандартного образца<br/><font size=8>QC Reagent / Reference Standard Card</font>", title),
                Paragraph(f"Дата печати<br/>{datetime.now().strftime('%d.%m.%Y %H:%M')}", small),
            ]
        ],
        colWidths=[35 * mm, 106 * mm, 45 * mm],
        rowHeights=[17 * mm],
    )
    header.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]
        )
    )
    elements.append(header)
    elements.append(Spacer(1, 4 * mm))

    def label(text: str) -> Paragraph:
        return Paragraph(f"<b>{text}</b>", cell_bold)

    def value(text: object | None) -> Paragraph:
        return Paragraph(str(text) if text not in (None, "") else "—", cell)

    passport_rows = [
        [label("Код"), value(reagent.code), label("Статус"), value(reagent.status)],
        [label("Наименование"), value(reagent.name), label("Тип"), value(reagent.type)],
        [label("Grade / чистота"), value(reagent.grade), label("Ответственный"), value(reagent.responsible)],
        [label("Производитель"), value(reagent.manufacturer), label("Поставщик"), value(reagent.supplier)],
        [label("Серия производителя"), value(reagent.batch_number), label("Внутренняя серия"), value(reagent.internal_batch_number)],
    ]
    passport = Table(passport_rows, colWidths=[35 * mm, 58 * mm, 35 * mm, 58 * mm])
    passport.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f8fafc")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(Paragraph("Паспорт позиции", section))
    elements.append(passport)
    elements.append(Spacer(1, 4 * mm))

    storage_rows = [
        [label("Дата поступления"), value(_fmt_date(reagent.received_date)), label("Дата вскрытия"), value(_fmt_date(reagent.opened_date))],
        [label("Срок до вскрытия"), value(_fmt_date(reagent.expiry_date_unopened)), label("Эффективный срок"), value(_fmt_date(reagent.effective_expiry_date))],
        [label("Остаток"), value(_fmt_qty(reagent.quantity, reagent.unit)), label("Срок после вскрытия"), value(f"{reagent.expiry_date_after_opening_days} дней")],
        [label("Место хранения"), value(reagent.storage_location), label("Условия хранения"), value(reagent.storage_conditions)],
    ]
    storage = Table(storage_rows, colWidths=[35 * mm, 58 * mm, 35 * mm, 58 * mm])
    storage.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f8fafc")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(Paragraph("Сроки, остаток и хранение", section))
    elements.append(storage)
    elements.append(Spacer(1, 4 * mm))

    cert_rows = [[Paragraph("№", cell_bold), Paragraph("Номер сертификата", cell_bold), Paragraph("Дата загрузки", cell_bold), Paragraph("SHA-256", cell_bold)]]
    if reagent.certificates:
        for idx, cert in enumerate(reagent.certificates[:5], start=1):
            cert_rows.append([value(idx), value(cert.certificate_no), value(_fmt_dt(cert.uploaded_at)), value(cert.sha256_hash[:16] + "…")])
    else:
        cert_rows.append([value("—"), value("Сертификат не загружен"), value("—"), value("—")])
    cert_table = Table(cert_rows, colWidths=[10 * mm, 58 * mm, 35 * mm, 83 * mm])
    cert_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    elements.append(Paragraph("Сертификаты / CoA", section))
    elements.append(cert_table)
    elements.append(Spacer(1, 4 * mm))

    movement_rows = [[Paragraph("Дата", cell_bold), Paragraph("Операция", cell_bold), Paragraph("Кол-во", cell_bold), Paragraph("Остаток", cell_bold), Paragraph("Основание", cell_bold)]]
    for mov in reagent.movements[:8]:
        movement_rows.append(
            [
                value(_fmt_dt(mov.performed_at)),
                value(mov.operation_type),
                value(_fmt_qty(mov.quantity_operation, reagent.unit)),
                value(_fmt_qty(mov.quantity_after, reagent.unit)),
                value(mov.reason or mov.analytical_sheet or "—"),
            ]
        )
    if len(movement_rows) == 1:
        movement_rows.append([value("—"), value("Движений нет"), value("—"), value("—"), value("—")])
    mov_table = Table(movement_rows, colWidths=[31 * mm, 31 * mm, 27 * mm, 27 * mm, 70 * mm])
    mov_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    elements.append(Paragraph("Последние движения", section))
    elements.append(mov_table)

    if reagent.notes:
        elements.append(Spacer(1, 4 * mm))
        elements.append(Paragraph("Примечание", section))
        elements.append(Paragraph(reagent.notes, body))

    doc.build(elements)
    return buffer.getvalue()
