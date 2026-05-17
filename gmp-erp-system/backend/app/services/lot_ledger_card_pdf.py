"""Lot ledger card — printable blank of form Ф-3 СОП-415.

Reproduces the warehouse-shelf paper card as closely as the original
SOP appendix: bilingual (RU/EN) header, identification block with the
ledger-card / sector / tier / place / pallet coordinates, then 30 empty
rows of the issue/return journal for the warehouse keeper to fill in by
hand. Only the identification fields are pre-populated from the system;
the journal is intentionally blank.
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

from app.models.inventory import Lot
from app.models.master_data import Material, Warehouse


_LOGO_PATH = Path(__file__).resolve().parent.parent / "static" / "assets" / "novugen-logo.png"

_FONT_CANDIDATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "LedgerBody",
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ),
    ),
    (
        "LedgerBold",
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
    if _FONTS_REGISTERED:
        return "LedgerBody", "LedgerBold"
    for alias, candidates in _FONT_CANDIDATES:
        for candidate in candidates:
            if Path(candidate).is_file():
                pdfmetrics.registerFont(TTFont(alias, candidate))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    _FONTS_REGISTERED = True
    return "LedgerBody", "LedgerBold"


def _fmt_qty(value: float | None, unit: str) -> str:
    if value is None:
        return "—"
    if value == int(value):
        return f"{int(value)} {unit}"
    return f"{value:.3f}".rstrip("0").rstrip(".") + f" {unit}"


def render_lot_ledger_card_pdf(
    lot: Lot,
    material: Material | None,
    warehouse: Warehouse | None,
    initial_quantity: float | None,
    initial_date: datetime | None,
    journal_rows: int = 30,
) -> bytes:
    body_font, bold_font = _register_fonts()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=f"Учётная карточка {lot.internal_lot}",
    )

    body = ParagraphStyle("body", fontName=body_font, fontSize=9, leading=11)
    small = ParagraphStyle("small", fontName=body_font, fontSize=8, leading=10)
    cell = ParagraphStyle("cell", fontName=body_font, fontSize=9, leading=11)
    cell_bold = ParagraphStyle("cellb", fontName=bold_font, fontSize=8.5, leading=10, alignment=1)
    header_title = ParagraphStyle("ht", fontName=bold_font, fontSize=10, leading=12, alignment=1)
    header_sub = ParagraphStyle("hs", fontName=body_font, fontSize=8, leading=10, alignment=1)

    elements: list = []

    # ── Header (logo · title · revision) ──────────────────────────────────
    if _LOGO_PATH.is_file():
        logo_cell: object = Image(str(_LOGO_PATH), width=30 * mm, height=10 * mm, kind="proportional")
    else:
        logo_cell = Paragraph(
            "<b>novugen</b>",
            ParagraphStyle("logo", fontName=bold_font, fontSize=14, leading=18, alignment=1),
        )

    header = Table(
        [
            [
                logo_cell,
                Paragraph(
                    "Учётная карточка сырья и вспомогательных материалов<br/>"
                    "<font size=8>Raw Materials and Excipients Ledger Card</font>",
                    header_title,
                ),
                Paragraph("СОП-415 Ф-3<br/>Редакция №5", header_sub),
            ]
        ],
        colWidths=[35 * mm, 110 * mm, 41 * mm],
        rowHeights=[16 * mm],
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

    # ── Identification block (matches Ф-3 layout) ─────────────────────────
    name_text = material.name if material else ""
    name_code = material.code if material else ""
    initial_qty_text = _fmt_qty(initial_quantity, lot.unit) if initial_quantity is not None else ""
    initial_date_text = initial_date.strftime("%d.%m.%Y") if initial_date else ""

    def label_cell(ru: str, en: str) -> Paragraph:
        return Paragraph(f"<b>{ru}</b><br/><font size=7 color='#475569'>{en}</font>", small)

    def value_cell(text: str) -> Paragraph:
        return Paragraph(text or "&nbsp;", cell)

    id_table = Table(
        [
            # Material name spans the full width on top
            [label_cell("Наименование", "Name"), value_cell(name_text), value_cell(name_code), value_cell("")],
            [
                label_cell("Дата получения товара", "Date of receipt of goods"),
                value_cell(initial_date_text),
                label_cell("Учётная карта №", "Account Card №"),
                value_cell(lot.rack_no or ""),
            ],
            [
                label_cell("Количество полученного товара", "Quantity of Goods Received"),
                value_cell(initial_qty_text),
                label_cell("Сектор №", "Sector №"),
                value_cell(lot.sector_no or ""),
            ],
            [
                label_cell("Серия", "Batch number"),
                value_cell(lot.internal_lot or ""),
                label_cell("Ярус №", "Tier №"),
                value_cell(lot.tier_no or ""),
            ],
            [
                label_cell("Поддон №", "Pallet №"),
                value_cell(lot.pallet_no or ""),
                label_cell("Место №", "Location №"),
                value_cell(lot.place_no or ""),
            ],
        ],
        colWidths=[55 * mm, 50 * mm, 40 * mm, 41 * mm],
    )
    id_table.setStyle(
        TableStyle(
            [
                ("SPAN", (1, 0), (3, 0)),  # material name spans 3 cells
                ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("BACKGROUND", (2, 1), (2, -1), colors.HexColor("#f8fafc")),
            ]
        )
    )
    elements.append(id_table)
    elements.append(Spacer(1, 5 * mm))

    # ── Journal table (30 empty rows) ─────────────────────────────────────
    journal_header = [
        Paragraph("№", cell_bold),
        Paragraph("Дата<br/><font size=6>Date</font>", cell_bold),
        Paragraph(
            "ОТПУЩЕНО<br/><font size=6>(кг, литр, шт.)<br/>Released (kg, l, pcs)</font>",
            cell_bold,
        ),
        Paragraph(
            "ВОЗВРАТ<br/><font size=6>(кг, литр, шт.)<br/>Returned (kg, l, pcs)</font>",
            cell_bold,
        ),
        Paragraph("ДЕПАРТАМЕНТ<br/><font size=6>Department</font>", cell_bold),
        Paragraph(
            "ОСТАТОК<br/><font size=6>(кг, литр, шт.)<br/>Balance (kg, l, pcs)</font>",
            cell_bold,
        ),
        Paragraph("Подпись<br/><font size=6>Signature</font>", cell_bold),
    ]

    journal_data: list[list] = [journal_header]
    for i in range(1, journal_rows + 1):
        journal_data.append(
            [
                Paragraph(str(i), cell),
                Paragraph("", cell),
                Paragraph("", cell),
                Paragraph("", cell),
                Paragraph("", cell),
                Paragraph("", cell),
                Paragraph("", cell),
            ]
        )

    # Total inner width: 35+25+35+35+30+30+24 = 214 mm — fits A4 portrait (186 usable)
    # Recompute to ~186 mm: 10 + 22 + 32 + 32 + 32 + 32 + 26 = 186
    journal = Table(
        journal_data,
        colWidths=[10 * mm, 22 * mm, 32 * mm, 32 * mm, 32 * mm, 32 * mm, 26 * mm],
        rowHeights=[14 * mm] + [7.5 * mm] * journal_rows,
        repeatRows=1,
    )
    journal.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    elements.append(journal)
    elements.append(Spacer(1, 3 * mm))

    # ── Footer note ──────────────────────────────────────────────────────
    wh_text = warehouse.name if warehouse else ""
    elements.append(
        Paragraph(
            f"<i>Склад: {wh_text} · Учётная карточка распечатана системой "
            f"{datetime.utcnow().strftime('%d.%m.%Y %H:%M')} UTC · Журнал заполняется вручную</i>",
            ParagraphStyle("footer", fontName=body_font, fontSize=8, leading=10, textColor=colors.grey),
        )
    )

    doc.build(elements)
    return buffer.getvalue()
