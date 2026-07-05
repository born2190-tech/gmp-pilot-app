"""PDF renderer for «ЗАЯВКА/ТРЕБОВАНИЕ» цеха (форма по П-4).

Layout 1:1 с бумажным образцом (напр. «Требование №287С», Кинолокс 011N015):
заголовок «ЗАЯВКА/ТРЕБОВАНИЕ №… от «DD» month YYYY г.», строки подписей
(Заявитель: Начальник цеха / Согласовано: Технолог / Одобрено: Plant Manager /
Заявку-Требование принял), таблица реквизитов (Цель, Наименование препарата,
Серия, Дата производства, Срок годности, Объём серии), таблица операции
(Вид операции / Отправитель / Получатель) и таблица материалов
(№ | Наименование (включая спецификации) | Серия | Ед. изм. | Кол-во).

Серия материала подставляется из выданных/аллоцированных лотов (FEFO);
до выдачи колонка пустая — её заполняет склад."""
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
    # Русская форма — десятичная запятая, как в бумажном требовании.
    return f"{value:.3f}".rstrip("0").rstrip(".").replace(".", ",")


_UNIT_RU = {"kg": "кг", "g": "г", "l": "л", "ml": "мл", "pcs": "шт."}


def _unit_ru(unit: str | None) -> str:
    u = (unit or "").strip()
    return _UNIT_RU.get(u.lower(), u)


_RU_MONTHS_GEN = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)


def render_internal_transfer_pdf(
    req: ProductionRequisition,
    materials_by_id: dict,
    qr_payload: str | None = None,
    scope: str | None = None,
    batch=None,
    requested_by_name: str | None = None,
) -> bytes:
    """``scope`` ограничивает печать частью требования для конкретного склада:
    ``PACKAGING_WAREHOUSE`` — только строки упаковочных материалов,
    ``SUBSTANCE_WAREHOUSE`` — только сырьё. ``None`` — весь документ.
    ``batch`` — ProductionBatch серии (срок годности, объём серии)."""
    show_raw = scope in (None, "SUBSTANCE_WAREHOUSE")
    show_pkg = scope in (None, "PACKAGING_WAREHOUSE")
    body_font, bold_font = _register_fonts()
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
        title=f"Заявка/Требование {req.requisition_no}",
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

    from app.services.document_qr import make_qr_image
    qr_image = make_qr_image(qr_payload, size_mm=17.0) if qr_payload else None
    appendix_cell: object = Paragraph("Форма по П-4", sop_meta)
    if qr_image is not None:
        appendix_cell = [
            Paragraph("Форма по П-4", sop_meta),
            qr_image,
            Paragraph("КР-код накладной", footer),
        ]

    header = Table(
        [
            [
                logo_cell,
                Paragraph("FE LLC NOVUGEN PHARMA", org_name),
                appendix_cell,
            ],
        ],
        colWidths=[40 * mm, 100 * mm, 42 * mm],
        rowHeights=[26 * mm if qr_image is not None else 14 * mm],
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

    # --- заголовок формы -------------------------------------------------------
    req_dt = req.submitted_at or req.created_at
    month_gen = _RU_MONTHS_GEN[req_dt.month - 1]
    elements.append(Paragraph(f"ЗАЯВКА/ТРЕБОВАНИЕ №{req.requisition_no}", title_style))
    elements.append(
        Paragraph(
            f"от «{req_dt.day:02d}» {month_gen} {req_dt.year} г.",
            ParagraphStyle("subdate", fontName=body_font, fontSize=10, leading=13, alignment=1),
        )
    )
    if scope:
        scope_label = (
            "Часть требования: упаковочные материалы (склад упаковки)"
            if scope == "PACKAGING_WAREHOUSE"
            else "Часть требования: сырьё и вспомогательные вещества (склад субстанций)"
        )
        elements.append(
            Paragraph(
                scope_label,
                ParagraphStyle("scope", fontName=bold_font, fontSize=9, leading=12, alignment=1, textColor=colors.HexColor("#b45309")),
            )
        )
    elements.append(Spacer(1, 4 * mm))

    # --- строки подписей (как в бумажной форме) --------------------------------
    def _sig_line(prefix: str, name: str | None, hint: str) -> list:
        filled = name or "____________________________"
        return [
            Paragraph(f"<b>{prefix}</b> {filled}", body),
            Paragraph(f"<i>({hint})</i>", ParagraphStyle("hint", fontName=body_font, fontSize=7.5, leading=9, alignment=1, textColor=colors.HexColor("#64748b"))),
        ]

    sig_rows = [
        _sig_line("Заявитель: Начальник цеха", requested_by_name, "Ф.И.О., подпись"),
        _sig_line("Согласовано: Технолог", None, "Ф.И.О., подпись"),
        _sig_line("Одобрено: Plant Manager", None, "Ф.И.О., подпись"),
        _sig_line("Заявку/Требование принял:", None, "Дата, должность, Ф.И.О и подпись"),
    ]
    sig_head = Table(sig_rows, colWidths=[120 * mm, 62 * mm])
    sig_head.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    elements.append(sig_head)
    elements.append(Spacer(1, 4 * mm))

    # --- таблица реквизитов -----------------------------------------------------
    def _mm_yyyy(d) -> str:
        return d.strftime("%m/%Y") if d else "________"

    expiry = getattr(batch, "expiry_date", None)
    batch_size = getattr(batch, "batch_size", None)
    batch_size_unit = getattr(batch, "batch_size_unit", None) or "шт."
    volume = f"{_fmt_qty(batch_size)} {batch_size_unit}" if batch_size else "____________"

    def _kv_table(pairs: list[tuple[str, str]]) -> Table:
        rows = [[Paragraph(f"<b>{k}</b>", body), Paragraph(v, body)] for k, v in pairs]
        t = Table(rows, colWidths=[52 * mm, 130 * mm])
        t.setStyle(
            TableStyle(
                [
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                    ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.black),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        return t

    elements.append(
        _kv_table(
            [
                ("Цель", "Получение сырья, вспомогательных и упаковочных материалов для производства препарата"),
                ("Наименования препарата", req.product_name or "____________"),
                ("Серия", req.product_series or "----"),
                ("Дата производства", _mm_yyyy(req.production_date)),
                ("Срок годности", _mm_yyyy(expiry)),
                ("Объём серии (шт.)", volume),
            ]
        )
    )
    elements.append(Spacer(1, 4 * mm))

    # --- вид операции / отправитель / получатель --------------------------------
    line_types = {line.warehouse_type for line in req.lines}
    if scope == "PACKAGING_WAREHOUSE":
        sender = "Склад упаковочных материалов"
    elif scope == "SUBSTANCE_WAREHOUSE":
        sender = "Склад субстанций и вспомогательных материалов"
    else:
        senders = []
        if "SUBSTANCE_WAREHOUSE" in line_types:
            senders.append("Склад субстанций и вспомогательных материалов")
        if "PACKAGING_WAREHOUSE" in line_types:
            senders.append("Склад упаковочных материалов")
        sender = " / ".join(senders) or "____________"
    elements.append(
        _kv_table(
            [
                ("Вид операции", "Внутреннее перемещение"),
                ("Отправитель", sender),
                ("Получатель", "1 цех"),
            ]
        )
    )
    elements.append(Spacer(1, 4 * mm))

    # --- таблица материалов (единая, как в бумаге) -------------------------------
    from app.services.material_types import is_packaging_item_type

    def _lot_series(line) -> str:
        lots: list[str] = []
        for alloc in getattr(line, "allocation_lines", None) or []:
            lot = getattr(alloc, "lot", None)
            series = (getattr(lot, "supplier_lot", None) or getattr(lot, "internal_lot", None)) if lot else None
            if series and series not in lots:
                lots.append(series)
        return ", ".join(lots)

    entries = []
    for line in req.lines:
        material = materials_by_id.get(line.material_id)
        is_pkg = is_packaging_item_type(material.item_type if material else "")
        if (is_pkg and not show_pkg) or (not is_pkg and not show_raw):
            continue
        entries.append((line, material))

    header_row = [
        Paragraph("№", cell_b),
        Paragraph("Наименование материала (включая спецификации/параметры)", cell_b),
        Paragraph("Серия", cell_b),
        Paragraph("Ед. изм.", cell_b),
        Paragraph("Кол-во", cell_b),
    ]
    rows = [header_row]
    for index, (line, material) in enumerate(entries, start=1):
        name = material.name if material else "—"
        unit = _unit_ru(line.unit or (material.default_unit if material else ""))
        rows.append(
            [
                Paragraph(str(index), cell),
                Paragraph(name, cell),
                Paragraph(_lot_series(line), cell),
                Paragraph(unit, cell),
                Paragraph(_fmt_qty(line.requested_quantity), cell),
            ]
        )
    for _ in range(max(0, 3 - len(entries))):
        rows.append([Paragraph("", cell)] * 5)

    mat_table = Table(rows, colWidths=[10 * mm, 92 * mm, 40 * mm, 16 * mm, 24 * mm], repeatRows=1)
    mat_table.setStyle(
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
    elements.append(mat_table)
    elements.append(Spacer(1, 4 * mm))

    today = datetime.utcnow().strftime("%d.%m.%Y %H:%M")
    elements.append(
        Paragraph(
            f"<i>Сформировано: {today} UTC &nbsp;·&nbsp; Форма по П-4 &nbsp;·&nbsp; статус: {req.status}</i>",
            footer,
        )
    )

    doc.build(elements)
    return buffer.getvalue()
