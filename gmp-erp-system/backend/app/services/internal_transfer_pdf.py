"""PDF renderer for «Заявка на внутреннее перемещение» — Приложение Ф-3 к П-4.

Bilingual RU/EN layout taken verbatim from the latest revision of П-4 Ф-3:
title block (novugen + "FE LLC NOVUGEN PHARMA"), product/batch header,
two tables (Сырьё и вспомогательные / Упаковочные материалы) and the
three signatures (Foreman / Technologist / Quality Assurance).

Fields the system does not capture (Pack size, Carton size, Норма
расхода на 1 таблетку, Фактическое количество) are intentionally left
blank — the form is printed and filled by hand at the operator
workstation, then scanned back into the ERP per ALCOA+.
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

from app.models.inventory import ProductionRequisition
from app.models.master_data import Material


_LOGO_PATH = Path(__file__).resolve().parent.parent / "static" / "assets" / "novugen-logo.png"


_FONT_CANDIDATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "ITBody",
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ),
    ),
    (
        "ITBold",
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
    body = "ITBody"
    bold = "ITBold"
    if _FONTS_REGISTERED:
        return body, bold
    for alias, candidates in _FONT_CANDIDATES:
        for candidate in candidates:
            if Path(candidate).is_file():
                pdfmetrics.registerFont(TTFont(alias, candidate))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    _FONTS_REGISTERED = True
    return body, bold


def _fmt_qty(value: float) -> str:
    if value is None:
        return ""
    if value == int(value):
        return str(int(value))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def render_internal_transfer_pdf(
    req: ProductionRequisition,
    materials_by_id: dict,
) -> bytes:
    body_font, bold_font = _register_fonts()
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
        title=f"Заявка на перемещение {req.requisition_no}",
    )

    body = ParagraphStyle("body", fontName=body_font, fontSize=9, leading=11)
    bold = ParagraphStyle("bold", fontName=bold_font, fontSize=9, leading=11)
    cell = ParagraphStyle("cell", fontName=body_font, fontSize=8, leading=10)
    cell_b = ParagraphStyle("cell_b", fontName=bold_font, fontSize=8, leading=10, alignment=1)
    section = ParagraphStyle(
        "section",
        fontName=bold_font,
        fontSize=9,
        leading=11,
        alignment=1,
        textColor=colors.white,
    )
    title_style = ParagraphStyle("title", fontName=bold_font, fontSize=13, leading=16, alignment=1)
    sop_meta = ParagraphStyle("sop_meta", fontName=body_font, fontSize=8, leading=10, alignment=1)
    org_name = ParagraphStyle("org_name", fontName=bold_font, fontSize=11, leading=14, alignment=1)
    footer = ParagraphStyle(
        "footer",
        fontName=body_font,
        fontSize=8,
        leading=10,
        textColor=colors.grey,
    )

    elements: list = []

    # --- header (logo + appendix mark) ----------------------------------------
    if _LOGO_PATH.is_file():
        logo_cell: object = Image(str(_LOGO_PATH), width=32 * mm, height=11 * mm, kind="proportional")
    else:
        logo_cell = Paragraph(
            "<b>novugen</b>",
            ParagraphStyle("logo", fontName=bold_font, fontSize=18, leading=22, alignment=1),
        )

    header = Table(
        [
            [
                logo_cell,
                Paragraph("FE LLC NOVUGEN PHARMA", org_name),
                Paragraph("Приложение Ф-3 к П-4<br/>Edition №5", sop_meta),
            ],
        ],
        colWidths=[40 * mm, 100 * mm, 42 * mm],
        rowHeights=[14 * mm],
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
    elements.append(Spacer(1, 3 * mm))

    elements.append(
        Paragraph(
            "Заявка на внутреннее перемещение / Internal Transfer Request (П-4 Ф-3)",
            title_style,
        )
    )
    elements.append(Spacer(1, 4 * mm))

    # --- product / batch meta -------------------------------------------------
    prod_date = req.production_date.strftime("%d.%m.%Y") if req.production_date else "____________"
    req_date = (req.submitted_at or req.created_at).strftime("%d.%m.%Y")

    meta_rows = [
        [
            Paragraph(f"<b>Заявка №:</b> {req.requisition_no}", body),
            Paragraph(f"<b>Дата / Date:</b> {req_date}", body),
        ],
        [
            Paragraph(f"<b>Product name / Наименование продукции:</b> {req.product_name or ''}", body),
            Paragraph(f"<b>Production order:</b> {req.production_order_no or '________________'}", body),
        ],
        [
            Paragraph(f"<b>Batch number / Серия:</b> {req.product_series or '________________'}", body),
            Paragraph(f"<b>Production date:</b> {prod_date}", body),
        ],
        [
            Paragraph("<b>Batch Size (Packs):</b> __________________", body),
            Paragraph("<b>Pack size:</b> ____________", body),
        ],
        [
            Paragraph("<b>Batch Size (No. of Tablets):</b> __________", body),
            Paragraph("<b>Carton size:</b> __________", body),
        ],
        [
            Paragraph("<b>Batch Size (Kgs):</b> ____________________", body),
            Paragraph("<b>Statuс / Статус:</b> " + str(req.status), body),
        ],
    ]
    meta = Table(meta_rows, colWidths=[95 * mm, 87 * mm])
    meta.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.4, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    elements.append(meta)
    elements.append(Spacer(1, 4 * mm))

    # --- split lines into raw / packaging -------------------------------------
    raw_lines = []
    pkg_lines = []
    for line in req.lines:
        material = materials_by_id.get(line.material_id)
        item_type = (material.item_type if material else "").lower()
        is_pkg = item_type in ("packaging", "label", "container")
        bucket = pkg_lines if is_pkg else raw_lines
        bucket.append((line, material))

    def _section_header(text: str) -> Table:
        t = Table([[Paragraph(text, section)]], colWidths=[182 * mm], rowHeights=[7 * mm])
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#0f172a")),
                    ("BOX", (0, 0), (-1, -1), 0.4, colors.black),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ]
            )
        )
        return t

    def _materials_table(entries, is_packaging: bool) -> Table:
        header_row = [
            Paragraph("№", cell_b),
            Paragraph("Наименование<br/>Name", cell_b),
            Paragraph("Ед.<br/>Unit", cell_b),
            Paragraph(
                "Норма расхода<br/>на 1000 блистеров"
                if is_packaging
                else "Норма расхода<br/>на 1 таблетку<br/>Rate per 1 tablet",
                cell_b,
            ),
            Paragraph("Ед.<br/>Unit", cell_b),
            Paragraph("Норма расхода<br/>на серию<br/>Rate per batch", cell_b),
            Paragraph("Фактическое<br/>количество<br/>Actual qty", cell_b),
        ]
        rows = [header_row]
        for index, (line, material) in enumerate(entries, start=1):
            name = material.name if material else "—"
            unit = line.unit or (material.default_unit if material else "")
            rows.append(
                [
                    Paragraph(str(index), cell),
                    Paragraph(name, cell),
                    Paragraph(unit, cell),
                    Paragraph("", cell),  # to be filled by Technologist
                    Paragraph(unit, cell),
                    Paragraph(_fmt_qty(line.requested_quantity), cell),
                    Paragraph("", cell),  # to be filled at point of issue
                ]
            )
        # Pad with empty rows so it looks like the printed form
        empty_padding = max(0, 3 - len(entries))
        for _ in range(empty_padding):
            rows.append([Paragraph("", cell)] * 7)

        t = Table(
            rows,
            colWidths=[10 * mm, 55 * mm, 14 * mm, 32 * mm, 14 * mm, 27 * mm, 30 * mm],
            repeatRows=1,
        )
        t.setStyle(
            TableStyle(
                [
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                    ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.black),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        return t

    # Raw materials section
    elements.append(_section_header("Сырьё и вспомогательные вещества / Raw materials"))
    elements.append(_materials_table(raw_lines, is_packaging=False))
    elements.append(Spacer(1, 2 * mm))
    elements.append(
        Paragraph(
            "* Qty as per 100% potency, increase / decrease in qty to be adjusted with Lactose "
            "monohydrate as per actual potency.<br/>"
            "** 10% additional qty taken in order to compensate losses during coating.",
            ParagraphStyle("note", fontName=body_font, fontSize=7.5, leading=9, textColor=colors.HexColor("#475569")),
        )
    )
    elements.append(Spacer(1, 4 * mm))

    # Packaging section
    elements.append(_section_header("Упаковочные материалы / Packaging materials"))
    elements.append(_materials_table(pkg_lines, is_packaging=True))
    elements.append(Spacer(1, 6 * mm))

    # --- signatures -----------------------------------------------------------
    sig_data = [
        [
            Paragraph("<b>Requested by Foreman</b><br/>Заявил мастер", body),
            Paragraph("<b>Reviewed by Technologist</b><br/>Проверил технолог", body),
            Paragraph("<b>Approved by Quality Assurance</b><br/>Утвердил ОКК", body),
        ],
        [
            Paragraph("ФИО / Name: ________________<br/>Signature: ________________<br/>Date: ____________", body),
            Paragraph("ФИО / Name: ________________<br/>Signature: ________________<br/>Date: ____________", body),
            Paragraph("ФИО / Name: ________________<br/>Signature: ________________<br/>Date: ____________", body),
        ],
    ]
    sig = Table(sig_data, colWidths=[60 * mm, 60 * mm, 62 * mm], rowHeights=[10 * mm, 22 * mm])
    sig.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
            ]
        )
    )
    elements.append(sig)
    elements.append(Spacer(1, 3 * mm))

    today = datetime.utcnow().strftime("%d.%m.%Y %H:%M")
    elements.append(
        Paragraph(
            f"<i>Сформировано: {today} UTC &nbsp;·&nbsp; П-4 Ф-3 (Edition №5)</i>",
            footer,
        )
    )

    doc.build(elements)
    return buffer.getvalue()
