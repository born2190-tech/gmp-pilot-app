"""PDF renderer for QC notification — form Ф-14 к СОП-209.

Generated layout intentionally mirrors the printed appendix used at the
substance warehouse: title block ("novugen / СОП-209 / редакция №12 /
страница"), document caption "ИЗВЕЩЕНИЕ №...", warehouse field, the
7-column body table, and the three signature lines for the warehouse
deputy, the QC head and the plant manager.
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
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models.master_data import Warehouse
from app.models.quality import QCNotification, QCNotificationLine


_LOGO_PATH = Path(__file__).resolve().parent.parent / "static" / "assets" / "novugen-logo.png"


# Cyrillic-capable fonts. DejaVu is shipped via the `fonts-dejavu` Debian
# package inside our Docker image; on Windows dev boxes we fall back to
# Arial which always exists.
_FONT_CANDIDATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "QCBody",
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ),
    ),
    (
        "QCBold",
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
        ),
    ),
)

_FONTS_REGISTERED = False


def _register_fonts() -> tuple[str, str]:
    global _FONTS_REGISTERED
    body_font = "QCBody"
    bold_font = "QCBold"
    if _FONTS_REGISTERED:
        return body_font, bold_font
    for alias, candidates in _FONT_CANDIDATES:
        for candidate in candidates:
            if Path(candidate).is_file():
                pdfmetrics.registerFont(TTFont(alias, candidate))
                break
        else:
            # Could not locate the font — fall back to built-in Helvetica.
            # Cyrillic will render as boxes in that case; surface the issue
            # to the operator via the audit log rather than crash.
            return "Helvetica", "Helvetica-Bold"
    _FONTS_REGISTERED = True
    return body_font, bold_font


def _format_qty(value: float) -> str:
    if value == int(value):
        return str(int(value))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _make_qr_image(payload: str, size_mm: float = 22.0) -> Image | None:
    """Render a QR code as a reportlab Image, or None if qrcode is missing."""
    try:
        import qrcode  # type: ignore
    except ImportError:
        return None
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=1,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    pil_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    buf.seek(0)
    return Image(buf, width=size_mm * mm, height=size_mm * mm)


def render_qc_notification_pdf(
    notification: QCNotification,
    warehouse: Warehouse,
    lines: list[QCNotificationLine],
    qr_payload: str | None = None,
) -> bytes:
    body_font, bold_font = _register_fonts()
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=12 * mm,
        bottomMargin=15 * mm,
        title=f"Извещение {notification.notification_no}",
    )

    body_style = ParagraphStyle("body", fontName=body_font, fontSize=9, leading=11)
    bold_style = ParagraphStyle("bold", fontName=bold_font, fontSize=9, leading=11)
    cell_style = ParagraphStyle("cell", fontName=body_font, fontSize=8, leading=10)
    cell_bold = ParagraphStyle("cell_bold", fontName=bold_font, fontSize=8, leading=10, alignment=1)
    title_style = ParagraphStyle("title", fontName=bold_font, fontSize=14, leading=18, alignment=1)
    sop_title_style = ParagraphStyle("sop_title", fontName=bold_font, fontSize=9, leading=11, alignment=1)
    sop_meta_style = ParagraphStyle("sop_meta", fontName=body_font, fontSize=9, leading=11, alignment=1)

    elements: list = []

    # --- header table (organisation block) ---------------------------------
    if _LOGO_PATH.is_file():
        # 30 mm wide image — keeps the aspect ratio of the supplied PNG.
        logo_cell: object = Image(str(_LOGO_PATH), width=30 * mm, height=10 * mm, kind="proportional")
    else:
        logo_cell = Paragraph(
            "<b>novugen</b>",
            ParagraphStyle("logo", fontName=bold_font, fontSize=18, leading=22, alignment=1),
        )
    header = Table(
        [
            [
                logo_cell,
                Paragraph(
                    "СОП-209 Процедура по обеспечению сохранности ЛС "
                    "при транспортировке, погрузке–разгрузке и складировании на хранение",
                    sop_title_style,
                ),
                Paragraph("Редакция №12", sop_meta_style),
            ],
            ["", "", Paragraph("Страница: 1 из 1", sop_meta_style)],
        ],
        colWidths=[35 * mm, 110 * mm, 35 * mm],
        rowHeights=[12 * mm, 8 * mm],
    )
    header.setStyle(
        TableStyle(
            [
                ("SPAN", (0, 0), (0, 1)),
                ("SPAN", (1, 0), (1, 1)),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]
        )
    )
    elements.append(header)
    elements.append(Spacer(1, 4 * mm))

    # --- caption + notification number -------------------------------------
    # QR code with notification id + state hash — used by ДКК to attach the
    # signed scan back to the right record and detect content tampering
    # between print and signature collection.
    qr_image = _make_qr_image(qr_payload) if qr_payload else None

    if qr_image is not None:
        title_with_qr = Table(
            [
                [
                    Paragraph(f"ИЗВЕЩЕНИЕ № {notification.notification_no}", title_style),
                    qr_image,
                ],
            ],
            colWidths=[150 * mm, 30 * mm],
        )
        title_with_qr.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (0, 0), "MIDDLE"),
                    ("VALIGN", (1, 0), (1, 0), "TOP"),
                    ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        elements.append(title_with_qr)
    else:
        elements.append(Paragraph(f"ИЗВЕЩЕНИЕ № {notification.notification_no}", title_style))
    elements.append(Spacer(1, 3 * mm))

    notified_str = notification.notified_at.strftime("%d.%m.%Y")
    elements.append(
        Paragraph(
            f"Дата: <b>{notified_str}</b> &nbsp;&nbsp;&nbsp; "
            f"Наименование склада: <b>{warehouse.name}</b>",
            body_style,
        )
    )
    elements.append(Spacer(1, 4 * mm))

    # --- materials table (Ф-14: №, Наименование, Серия, Срок годности, Кол-во, Производитель/Страна, Накладная) ---
    table_data: list[list] = [
        [
            Paragraph("№", cell_bold),
            Paragraph("Наименование", cell_bold),
            Paragraph("Серия", cell_bold),
            Paragraph("Срок<br/>годности", cell_bold),
            Paragraph("Кол-во<br/>(шт)", cell_bold),
            Paragraph("Производитель,<br/>Страна", cell_bold),
            Paragraph("Номер и дата<br/>накладной", cell_bold),
        ]
    ]
    for index, line in enumerate(lines, start=1):
        table_data.append(
            [
                Paragraph(str(index), cell_style),
                Paragraph(line.material_name, cell_style),
                Paragraph(line.batch_number, cell_style),
                Paragraph(line.expiry_date, cell_style),
                Paragraph(f"{_format_qty(line.quantity)} {line.unit}", cell_style),
                Paragraph(line.manufacturer_name, cell_style),
                Paragraph(line.invoice_info, cell_style),
            ]
        )

    body_table = Table(
        table_data,
        colWidths=[10 * mm, 50 * mm, 25 * mm, 22 * mm, 20 * mm, 33 * mm, 30 * mm],
        repeatRows=1,
    )
    body_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    elements.append(body_table)
    elements.append(Spacer(1, 10 * mm))

    # --- signature lines (Ф-14) -------------------------------------------
    today_dmy = datetime.utcnow().strftime("%d.%m.%Y")
    sig_lines = [
        "От кого: Помощник Зав. Складом (ФИО) ____________________  подпись __________  «___» ____________ г.",
        "Кому: Начальник ДКК (ФИО) ____________________________  подпись __________  «___» ____________ г.",
        "Менеджера завода: (ФИО) ______________________________  подпись __________  «___» ____________ г.",
    ]
    for line in sig_lines:
        elements.append(Paragraph(line, body_style))
        elements.append(Spacer(1, 6 * mm))

    elements.append(Spacer(1, 4 * mm))
    elements.append(
        Paragraph(
            f"<i>Сформировано: {today_dmy} &nbsp;·&nbsp; Форма Ф-14 к СОП-209</i>",
            ParagraphStyle("footer", fontName=body_font, fontSize=8, leading=10, textColor=colors.grey),
        )
    )

    doc.build(elements)
    return buffer.getvalue()
