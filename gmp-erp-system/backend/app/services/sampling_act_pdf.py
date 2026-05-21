"""PDF-рендерер акта отбора средней пробы.

Поддерживает два шаблона:
* СОП-533 Ф-10 — сырьё, вспомогательные и упаковочные материалы
  (3 назначения пробы: ФХ / Микро / Арбитраж).
* СОП-548 Ф-10 — готовая продукция
  (многоступенчатый отбор + 4 назначения: ФХ / Микро / Арбитраж / Стабильность).

Структура повторяет печатную форму из СОПа: шапка ДКК novugen, «АКТ №»,
состав комиссии (3 члена), мета-блок реквизитов партии и условий отбора,
таблица отобранных количеств, три подписи + М.П.
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


_LOGO_PATH = Path(__file__).resolve().parent.parent / "static" / "assets" / "novugen-logo.png"

_FONT_CANDIDATES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "SAMBody",
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ),
    ),
    (
        "SAMBold",
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
        ),
    ),
)

_FONTS_REGISTERED = False

ORG_ADDRESS = (
    "Республика Узбекистан, Сырдарьинская область, Сырдарьинский район, "
    "АПВ С. Рахимова, ул. М. Захидова, д-39 · Тел: 95 475-20-30, 95 476-20-30 · novugen_uz@mail.ru"
)

PURPOSE_LABEL = {
    "PHYSICOCHEMICAL": "Физико-химический анализ",
    "MICROBIOLOGICAL": "Микробиологический анализ",
    "ARCHIVE": "Арбитражное хранение",
    "STABILITY": "Долгосрочная стабильность",
}


def _register_fonts() -> tuple[str, str]:
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return "SAMBody", "SAMBold"
    for alias, candidates in _FONT_CANDIDATES:
        for candidate in candidates:
            if Path(candidate).is_file():
                pdfmetrics.registerFont(TTFont(alias, candidate))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    _FONTS_REGISTERED = True
    return "SAMBody", "SAMBold"


def _fmt_qty(value) -> str:
    if value is None:
        return ""
    if value == int(value):
        return str(int(value))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _fmt_date(value) -> str:
    if not value:
        return "—"
    if hasattr(value, "strftime"):
        return value.strftime("%d.%m.%Y")
    return str(value)


def render_sampling_act_pdf(act: dict) -> bytes:
    """`act` — dict из sampling_acts.build_item()."""
    body_font, bold_font = _register_fonts()
    is_fg = act.get("sop_form") == "548"
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
        title=f"Акт отбора {act.get('act_no', '')}",
    )

    body = ParagraphStyle("body", fontName=body_font, fontSize=9, leading=11)
    small = ParagraphStyle("small", fontName=body_font, fontSize=7.5, leading=9)
    cell = ParagraphStyle("cell", fontName=body_font, fontSize=8, leading=10)
    cell_b = ParagraphStyle("cell_b", fontName=bold_font, fontSize=8, leading=10, alignment=1)
    title_style = ParagraphStyle("title", fontName=bold_font, fontSize=15, leading=18, alignment=1)
    subtitle = ParagraphStyle("subtitle", fontName=body_font, fontSize=9.5, leading=12, alignment=1)
    org_name = ParagraphStyle("org", fontName=bold_font, fontSize=10, leading=12, alignment=1)
    meta_center = ParagraphStyle("meta_c", fontName=body_font, fontSize=7.5, leading=9, alignment=1)

    elements: list = []

    # ── Шапка ──────────────────────────────────────────────────────────
    if _LOGO_PATH.is_file():
        logo_cell: object = Image(str(_LOGO_PATH), width=30 * mm, height=11 * mm, kind="proportional")
    else:
        logo_cell = Paragraph("<b>novugen</b>", ParagraphStyle("logo", fontName=bold_font, fontSize=16, alignment=1))

    header = Table(
        [
            [
                logo_cell,
                Paragraph(
                    "ИП ООО «NOVUGEN PHARMA» (Узбекистан)<br/>"
                    "ДЕПАРТАМЕНТ КОНТРОЛЯ КАЧЕСТВА (ДКК)",
                    org_name,
                ),
                Paragraph(f"СОП-{act.get('sop_form')} Ф-10<br/>Редакция 04", meta_center),
            ],
        ],
        colWidths=[34 * mm, 110 * mm, 38 * mm],
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
    elements.append(Paragraph(ORG_ADDRESS, small))
    elements.append(Spacer(1, 3 * mm))

    # ── Заголовок ──────────────────────────────────────────────────────
    elements.append(Paragraph(f"АКТ № {act.get('act_no', '')}", title_style))
    if is_fg:
        elements.append(Paragraph("Отбора средней пробы готовой продукции (ГП) для испытания", subtitle))
    else:
        elements.append(
            Paragraph(
                "Отбор средней пробы сырья, вспомогательных материалов, "
                "промежуточных продуктов для входного контроля",
                subtitle,
            )
        )
    elements.append(Spacer(1, 3 * mm))

    # ── Комиссия ───────────────────────────────────────────────────────
    wh_label = "Зав. склада Г/П" if is_fg else "Помощник зав. склада"
    commission = [
        ("Начальник ДКК", act.get("head_qc_name")),
        (wh_label, act.get("warehouse_member_name")),
        ("Представитель ДКК", act.get("qc_representative_name")),
    ]
    comm_lines = "<br/>".join(
        f"&nbsp;&nbsp;{role}: <b>{name or '__________________________'}</b>" for role, name in commission
    )
    elements.append(Paragraph("Комиссия в составе:", body))
    elements.append(Paragraph(comm_lines, body))
    elements.append(
        Paragraph(
            "произвела в установленном порядке отбор "
            + ("готовой продукции:" if is_fg else "исходного сырья:"),
            body,
        )
    )
    elements.append(Spacer(1, 2.5 * mm))

    # ── Мета-блок ──────────────────────────────────────────────────────
    nd_line = act.get("specification_ref") or "—"
    if is_fg and act.get("registration_no"):
        nd_line = f"{nd_line}; Рег.уд.: {act.get('registration_no')}"

    transport = "в контейнере со льдом" if act.get("transport_with_ice") else "в контейнере без льда"
    env = (
        f"Температура: {_fmt_qty(act.get('temperature_c'))} °C; "
        f"Влажность: {_fmt_qty(act.get('humidity_pct'))} %"
    )

    pairs = [
        ("Наименование", act.get("material_name") or "—"),
        ("Серия", act.get("internal_lot") or "—"),
        ("Изготовитель", act.get("manufacturer_name") or "—"),
        ("Извещение №", str(act.get("qc_notification_id") or "—")),
        ("Дата отбора", _fmt_date(act.get("sampling_date"))),
        ("Место отбора", act.get("sampling_location") or "—"),
        ("Состояние образца", act.get("sample_condition") or "соответствует НД/сертификату"),
        ("НД (спецификация)", nd_line),
        ("Условия среды", env),
        ("Транспортировка", transport),
    ]
    if not is_fg and (act.get("scale_model") or act.get("scale_calibration_no")):
        scale = act.get("scale_model") or ""
        if act.get("scale_calibration_no"):
            scale = f"{scale} / поверка № {act.get('scale_calibration_no')}"
        pairs.append(("Весы", scale))

    meta_rows = [[Paragraph(k, cell), Paragraph(str(v), cell)] for k, v in pairs]
    meta = Table(meta_rows, colWidths=[45 * mm, 137 * mm])
    meta.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.4, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
            ]
        )
    )
    elements.append(meta)
    elements.append(Spacer(1, 3 * mm))

    # ── Многоступенчатый отбор (548) ──────────────────────────────────
    if is_fg:
        ms = Table(
            [
                [
                    Paragraph("Метод отбора: многоступенчатый (СОП-548 §6.4, формула 0.4·√n)", cell_b),
                ],
                [
                    Paragraph(
                        f"Гофрокороба: всего {act.get('containers_outer_total') or '—'}, "
                        f"отобрано {act.get('containers_outer_sampled') or '—'} &nbsp;·&nbsp; "
                        f"Пеналы/блистеры: всего {act.get('containers_inner_total') or '—'}, "
                        f"отобрано {act.get('containers_inner_sampled') or '—'}",
                        cell,
                    )
                ],
            ],
            colWidths=[182 * mm],
        )
        ms.setStyle(
            TableStyle(
                [
                    ("BOX", (0, 0), (-1, -1), 0.4, colors.black),
                    ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        elements.append(ms)
        elements.append(Spacer(1, 3 * mm))

    # ── Таблица отобранных количеств ──────────────────────────────────
    table_data = [
        [
            Paragraph("№", cell_b),
            Paragraph("Назначение пробы", cell_b),
            Paragraph("Количество", cell_b),
            Paragraph("Ед. изм.", cell_b),
        ]
    ]
    lines = act.get("lines") or []
    for idx, line in enumerate(lines, start=1):
        purpose = getattr(line, "purpose", None) or (line.get("purpose") if isinstance(line, dict) else "")
        qty = getattr(line, "quantity", None) if not isinstance(line, dict) else line.get("quantity")
        unit = getattr(line, "unit", None) if not isinstance(line, dict) else line.get("unit")
        table_data.append(
            [
                Paragraph(str(idx), cell),
                Paragraph(PURPOSE_LABEL.get(purpose, purpose), cell),
                Paragraph(_fmt_qty(qty), cell),
                Paragraph(unit or "", cell),
            ]
        )

    body_table = Table(table_data, colWidths=[12 * mm, 100 * mm, 40 * mm, 30 * mm], repeatRows=1)
    body_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (2, 1), (2, -1), "RIGHT"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    elements.append(body_table)
    elements.append(Spacer(1, 8 * mm))

    # ── Подписи ────────────────────────────────────────────────────────
    sigs = [
        f"1. _______________________ ({commission[0][1] or 'ФИО'})  &nbsp;&nbsp;&nbsp; М.П.",
        f"2. _______________________ ({commission[1][1] or 'ФИО'})",
        f"3. _______________________ ({commission[2][1] or 'ФИО'})",
    ]
    elements.append(Paragraph("Подписи:", body))
    for s in sigs:
        elements.append(Paragraph(s, body))
        elements.append(Spacer(1, 5 * mm))

    today = datetime.utcnow().strftime("%d.%m.%Y %H:%M")
    elements.append(Spacer(1, 2 * mm))
    elements.append(
        Paragraph(
            f"<i>Сформировано: {today} UTC · СОП-{act.get('sop_form')} Ф-10</i>",
            ParagraphStyle("footer", fontName=body_font, fontSize=8, leading=10, textColor=colors.grey),
        )
    )

    doc.build(elements)
    return buffer.getvalue()
