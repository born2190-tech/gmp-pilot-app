"""PDF protocol for a posted inventory count.

Reuses the same novugen + СОП header style as the QC notification PDF.
One protocol per wave, archive-grade: every line printed with system /
actual / variance and who counted/verified, plus a signature block for
counter(s), verifier and the QA officer who signed it off.
"""
from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
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

from app.models.inventory import InventoryCountWave, InventoryCountWaveLine
from app.models.identity import User
from app.models.master_data import Warehouse


_LOGO_PATH = Path(__file__).resolve().parent.parent / "static" / "assets" / "novugen-logo.png"

_FONT_CANDIDATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "InvBody",
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ),
    ),
    (
        "InvBold",
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
        return "InvBody", "InvBold"
    for alias, candidates in _FONT_CANDIDATES:
        for candidate in candidates:
            if Path(candidate).is_file():
                pdfmetrics.registerFont(TTFont(alias, candidate))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    _FONTS_REGISTERED = True
    return "InvBody", "InvBold"


def _fmt_qty(value: float | None) -> str:
    if value is None:
        return "—"
    if value == int(value):
        return str(int(value))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _fmt_pct(value: float | None) -> str:
    if value is None or value == 0:
        return "0.00%"
    return f"{value:+.2f}%"


def _line_status_label(status: str) -> str:
    return {
        "pending": "не посчитано",
        "counted": "посчитано",
        "within_tolerance": "в допуске",
        "needs_verification": "сверка",
        "verified": "подтверждено",
        "rejected": "отклонено",
    }.get(status, status)


def _coord(line: InventoryCountWaveLine) -> str:
    parts = [
        f"Ст.{line.lot.rack_no}" if line.lot.rack_no else "",
        f"Сек.{line.lot.sector_no}" if line.lot.sector_no else "",
        f"Я.{line.lot.tier_no}" if line.lot.tier_no else "",
        f"М.{line.lot.place_no}" if line.lot.place_no else "",
        f"П.{line.lot.pallet_no}" if line.lot.pallet_no else "",
    ]
    return " · ".join(p for p in parts if p) or "—"


def render_inventory_count_pdf(
    wave: InventoryCountWave,
    warehouse: Warehouse,
    lines: list[InventoryCountWaveLine],
    counter_users: list[User],
    verifier_user: User | None,
    posted_by_user: User | None,
    user_names: dict[str, str] | None = None,
) -> bytes:
    names = user_names or {}
    body_font, bold_font = _register_fonts()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=10 * mm,
        bottomMargin=12 * mm,
        title=f"Акт инвентаризации {wave.wave_no}",
    )

    body = ParagraphStyle("body", fontName=body_font, fontSize=9, leading=11)
    small = ParagraphStyle("small", fontName=body_font, fontSize=8, leading=10)
    bold = ParagraphStyle("bold", fontName=bold_font, fontSize=9, leading=11)
    cell = ParagraphStyle("cell", fontName=body_font, fontSize=8, leading=10)
    cell_bold = ParagraphStyle("cellb", fontName=bold_font, fontSize=8, leading=10, alignment=1)
    title = ParagraphStyle("title", fontName=bold_font, fontSize=14, leading=18, alignment=1)
    sop_title = ParagraphStyle("sopt", fontName=bold_font, fontSize=9, leading=11, alignment=1)
    sop_meta = ParagraphStyle("sopm", fontName=body_font, fontSize=9, leading=11, alignment=1)

    elements: list = []

    # Header
    if _LOGO_PATH.is_file():
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
                    "АКТ ИНВЕНТАРИЗАЦИИ ОСТАТКОВ НА СКЛАДЕ<br/>"
                    "<font size=8>Внутренний документ предприятия, GMP-совместимый протокол пересчёта</font>",
                    sop_title,
                ),
                Paragraph("Дата формирования<br/>" + datetime.utcnow().strftime("%d.%m.%Y %H:%M"), sop_meta),
            ],
        ],
        colWidths=[35 * mm, 180 * mm, 50 * mm],
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
    elements.append(Spacer(1, 4 * mm))

    elements.append(Paragraph(f"АКТ № {wave.wave_no}", title))
    elements.append(Spacer(1, 3 * mm))

    started_str = wave.started_at.strftime("%d.%m.%Y %H:%M") if wave.started_at else "—"
    posted_str = wave.posted_at.strftime("%d.%m.%Y %H:%M") if wave.posted_at else "—"
    counters_text = ", ".join(u.full_name or u.username for u in counter_users) or "—"
    verifier_text = verifier_user.full_name if verifier_user else "—"
    posted_text = posted_by_user.full_name if posted_by_user else "—"

    meta = Table(
        [
            [
                Paragraph("<b>Склад:</b> " + (warehouse.name if warehouse else "—"), body),
                Paragraph(f"<b>Область:</b> {wave.scope_description}", body),
                Paragraph(f"<b>Допуск:</b> ±{wave.tolerance_pct}%", body),
            ],
            [
                Paragraph(f"<b>Начато:</b> {started_str}", body),
                Paragraph(f"<b>Проведено:</b> {posted_str}", body),
                Paragraph(f"<b>Статус:</b> {wave.status}", body),
            ],
            [
                Paragraph(f"<b>Счётчики:</b> {counters_text}", body),
                Paragraph(f"<b>Верификатор:</b> {verifier_text}", body),
                Paragraph(f"<b>Подписал (ДОК):</b> {posted_text}", body),
            ],
        ],
        colWidths=[88 * mm, 88 * mm, 89 * mm],
    )
    meta.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.4, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.2, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    elements.append(meta)
    elements.append(Spacer(1, 5 * mm))

    # Body table
    table_data: list[list] = [
        [
            Paragraph("№", cell_bold),
            Paragraph("Серия", cell_bold),
            Paragraph("Материал", cell_bold),
            Paragraph("Адрес<br/>(Ф-3)", cell_bold),
            Paragraph("Учёт", cell_bold),
            Paragraph("Факт", cell_bold),
            Paragraph("Δ", cell_bold),
            Paragraph("Δ, %", cell_bold),
            Paragraph("Счётчик", cell_bold),
            Paragraph("Верификатор", cell_bold),
        ]
    ]

    for idx, line in enumerate(lines, start=1):
        lot = line.lot
        variance = line.variance if line.variance is not None else 0.0
        counter_name = names.get(str(line.counted_by)) if line.counted_by else ""
        verifier_name = names.get(str(line.verified_by)) if line.verified_by else ""
        table_data.append(
            [
                Paragraph(str(idx), cell),
                Paragraph(lot.internal_lot if lot else "—", cell),
                Paragraph(
                    (lot.material.name if lot and lot.material else "—")
                    + "<br/><font size=7 color='#475569'>"
                    + (lot.material.code if lot and lot.material else "")
                    + "</font>",
                    cell,
                ),
                Paragraph(_coord(line), cell),
                Paragraph(f"{_fmt_qty(line.system_quantity)} {line.unit}", cell),
                Paragraph(f"{_fmt_qty(line.actual_quantity)} {line.unit}", cell),
                Paragraph(f"{variance:+.3f}".rstrip("0").rstrip(".") or "0", cell),
                Paragraph(_fmt_pct(line.variance_pct), cell),
                Paragraph(counter_name or "—", cell),
                Paragraph(verifier_name or "—", cell),
            ]
        )

    body_table = Table(
        table_data,
        colWidths=[10 * mm, 28 * mm, 55 * mm, 32 * mm, 22 * mm, 22 * mm, 20 * mm, 18 * mm, 30 * mm, 28 * mm],
        repeatRows=1,
    )
    body_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
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
    elements.append(Spacer(1, 8 * mm))

    # Totals
    total_lines = len(lines)
    counted = sum(1 for line in lines if line.actual_quantity is not None)
    variance_lines = sum(
        1 for line in lines if line.status in {"needs_verification", "verified", "rejected"}
    )
    total_variance = sum(line.variance or 0 for line in lines)
    totals_text = (
        f"<b>Итого позиций:</b> {total_lines}   "
        f"<b>Посчитано:</b> {counted}   "
        f"<b>С расхождением:</b> {variance_lines}   "
        f"<b>Сумма расхождений:</b> {_fmt_qty(total_variance)}"
    )
    elements.append(Paragraph(totals_text, body))
    elements.append(Spacer(1, 8 * mm))

    # Signatures
    sig_lines = [
        "Счётчик(и):  _______________________________  подпись __________  «___» ____________ г.",
        f"Верификатор:  {verifier_text}  _________________________  подпись __________  «___» ____________ г.",
        f"Подписал ДОК:  {posted_text}  _________________________  подпись __________  «___» ____________ г.",
    ]
    for line_text in sig_lines:
        elements.append(Paragraph(line_text, body))
        elements.append(Spacer(1, 6 * mm))

    elements.append(Spacer(1, 4 * mm))
    elements.append(
        Paragraph(
            f"<i>Внутренний протокол инвентаризации · сформирован системой {datetime.utcnow().strftime('%d.%m.%Y %H:%M')} UTC</i>",
            ParagraphStyle("footer", fontName=body_font, fontSize=8, leading=10, textColor=colors.grey),
        )
    )

    doc.build(elements)
    return buffer.getvalue()
