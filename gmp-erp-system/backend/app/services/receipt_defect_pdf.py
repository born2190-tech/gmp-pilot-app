"""PDF for one receipt defect act (СОП-209 Ф-12).

Single-act layout: novugen + СОП-209 Ф-12 header, identification block
(act #, severity, date, receipt, material, recorded by), description box,
embedded photos one-per-page (up to N), signature lines for warehouse,
ДКК and QA.
"""
from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models.inventory import ReceiptDefect, ReceiptDefectPhoto, ReceiptDocument, ReceiptLine
from app.models.identity import User
from app.models.master_data import Material


_LOGO_PATH = Path(__file__).resolve().parent.parent / "static" / "assets" / "novugen-logo.png"

_FONT_CANDIDATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "DefBody",
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ),
    ),
    (
        "DefBold",
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
        return "DefBody", "DefBold"
    for alias, candidates in _FONT_CANDIDATES:
        for candidate in candidates:
            if Path(candidate).is_file():
                pdfmetrics.registerFont(TTFont(alias, candidate))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    _FONTS_REGISTERED = True
    return "DefBody", "DefBold"


SEVERITY_LABEL = {
    "critical": "Критический — материал подлежит возврату",
    "significant": "Значительный — повреждение тары без нарушения содержимого",
    "minor": "Незначительный — косметические дефекты",
}

STATUS_LABEL = {
    "pending": "Открыт",
    "escalated": "Передан в ДКК / ДОК",
    "resolved": "Закрыт",
    "returned": "Возвращён поставщику",
}


def render_receipt_defect_pdf(
    defect: ReceiptDefect,
    receipt: ReceiptDocument,
    line: ReceiptLine | None,
    material: Material | None,
    recorded_by: User | None,
    resolved_by: User | None,
    photos_with_bytes: list[tuple[ReceiptDefectPhoto, bytes]],
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
        title=f"Акт о дефекте {defect.act_no}",
    )

    body = ParagraphStyle("body", fontName=body_font, fontSize=10, leading=13)
    small = ParagraphStyle("small", fontName=body_font, fontSize=8, leading=10)
    cell = ParagraphStyle("cell", fontName=body_font, fontSize=9, leading=11)
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
            ParagraphStyle("logo", fontName=bold_font, fontSize=14, leading=18, alignment=1),
        )

    header = Table(
        [
            [
                logo_cell,
                Paragraph(
                    "СОП-209 Процедура по обеспечению сохранности ЛС при транспортировке, "
                    "погрузке–разгрузке и складировании на хранение<br/>"
                    "<font size=8>Приложение Ф-12 — Журнал регистрации внешних дефектов при приёмке тары</font>",
                    sop_title,
                ),
                Paragraph("Редакция №12<br/>Лист 1 из 1", sop_meta),
            ]
        ],
        colWidths=[35 * mm, 110 * mm, 35 * mm],
        rowHeights=[18 * mm],
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

    elements.append(Paragraph(f"АКТ О ВНЕШНЕМ ДЕФЕКТЕ ТАРЫ № {defect.act_no}", title))
    elements.append(Spacer(1, 3 * mm))

    sev = SEVERITY_LABEL.get(defect.severity, defect.severity)
    st = STATUS_LABEL.get(defect.status, defect.status)
    material_name = material.name if material else "—"
    material_code = material.code if material else ""
    recorded_text = (
        f"{recorded_by.full_name or recorded_by.username} · {defect.recorded_at.strftime('%d.%m.%Y %H:%M')}"
        if recorded_by
        else defect.recorded_at.strftime("%d.%m.%Y %H:%M")
    )
    resolved_text = (
        f"{(resolved_by.full_name or resolved_by.username) if resolved_by else '—'}"
        + (f" · {defect.resolved_at.strftime('%d.%m.%Y %H:%M')}" if defect.resolved_at else "")
    )

    meta = Table(
        [
            [Paragraph("<b>Приёмный документ</b>", cell), Paragraph(receipt.document_no, cell),
             Paragraph("<b>Дата приёмки</b>", cell), Paragraph(receipt.received_date.strftime("%d.%m.%Y"), cell)],
            [Paragraph("<b>Материал</b>", cell), Paragraph(f"{material_name}<br/><font size=7 color='#475569'>{material_code}</font>", cell),
             Paragraph("<b>Серия поставщика</b>", cell), Paragraph(line.supplier_lot or "—", cell) if line else Paragraph("—", cell)],
            [Paragraph("<b>Серьёзность дефекта</b>", cell), Paragraph(sev, cell),
             Paragraph("<b>Статус акта</b>", cell), Paragraph(st, cell)],
            [Paragraph("<b>Зафиксировал</b>", cell), Paragraph(recorded_text, cell),
             Paragraph("<b>Закрыл</b>", cell), Paragraph(resolved_text, cell)],
        ],
        colWidths=[40 * mm, 55 * mm, 40 * mm, 45 * mm],
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
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f8fafc")),
            ]
        )
    )
    elements.append(meta)
    elements.append(Spacer(1, 5 * mm))

    elements.append(Paragraph("<b>Описание дефекта</b>", body))
    elements.append(Spacer(1, 1 * mm))
    desc_table = Table(
        [[Paragraph(defect.description.replace("\n", "<br/>"), body)]],
        colWidths=[180 * mm],
    )
    desc_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.4, colors.black),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    elements.append(desc_table)

    if defect.resolution_comment:
        elements.append(Spacer(1, 4 * mm))
        elements.append(Paragraph("<b>Заключение / комментарий QA</b>", body))
        elements.append(Spacer(1, 1 * mm))
        res_table = Table(
            [[Paragraph(defect.resolution_comment.replace("\n", "<br/>"), body)]],
            colWidths=[180 * mm],
        )
        res_table.setStyle(
            TableStyle(
                [
                    ("BOX", (0, 0), (-1, -1), 0.4, colors.black),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        elements.append(res_table)

    elements.append(Spacer(1, 8 * mm))
    sig_lines = [
        "Зафиксировал (сотрудник склада): _______________________  подпись __________  «___» ____________ г.",
        "Передал в ДКК: ____________________________________  подпись __________  «___» ____________ г.",
        "Заключение ДОК: ___________________________________  подпись __________  «___» ____________ г.",
    ]
    for s in sig_lines:
        elements.append(Paragraph(s, body))
        elements.append(Spacer(1, 5 * mm))

    elements.append(Spacer(1, 4 * mm))
    elements.append(
        Paragraph(
            f"<i>Внутренний акт · сформирован системой {datetime.utcnow().strftime('%d.%m.%Y %H:%M')} UTC · "
            f"Фотофиксация — {len(photos_with_bytes)} шт.</i>",
            ParagraphStyle("footer", fontName=body_font, fontSize=8, leading=10, textColor=colors.grey),
        )
    )

    # Photo pages (one per photo, PDF skipped — only image MIMEs render here)
    for photo, raw in photos_with_bytes:
        if not (photo.mime_type or "").startswith("image/"):
            continue
        try:
            pil = PILImage.open(io.BytesIO(raw))
            pil.load()
            buf = io.BytesIO()
            # Re-encode to JPEG to keep PDF small and avoid CMYK issues.
            if pil.mode not in ("RGB", "L"):
                pil = pil.convert("RGB")
            pil.save(buf, format="JPEG", quality=82)
            buf.seek(0)
            elements.append(PageBreak())
            elements.append(Paragraph(f"<b>Фотофиксация — {photo.uploaded_at.strftime('%d.%m.%Y %H:%M')}</b>", body))
            elements.append(Spacer(1, 3 * mm))
            elements.append(Image(buf, width=180 * mm, height=240 * mm, kind="proportional"))
        except Exception:
            continue

    doc.build(elements)
    return buffer.getvalue()
