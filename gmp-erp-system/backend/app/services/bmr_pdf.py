"""PDF master-copy электронного BMR/ЗПС (СОП-11) — Phase D.

Рендерит заполненный экземпляр BMR (структура шаблона + значения и подписи) в
PDF для печати/хранения как достоверной копии. Шрифт — Times New Roman
(Liberation Serif в Docker), как у аналитического листа Ф-11.
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
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

_FONT_CANDIDATES = (
    ("BMRBody", (
        "C:/Windows/Fonts/times.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/liberation/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    )),
    ("BMRBold", (
        "C:/Windows/Fonts/timesbd.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
        "/usr/share/fonts/liberation/LiberationSerif-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    )),
)
_REGISTERED = False
_GRID = colors.HexColor("#94a3b8")


def _fonts() -> tuple[str, str]:
    global _REGISTERED
    if _REGISTERED:
        return "BMRBody", "BMRBold"
    for alias, candidates in _FONT_CANDIDATES:
        for c in candidates:
            if Path(c).is_file():
                pdfmetrics.registerFont(TTFont(alias, c))
                break
        else:
            return "Helvetica", "Helvetica-Bold"
    _REGISTERED = True
    return "BMRBody", "BMRBold"


def _fmt_dt(value) -> str:
    if not value:
        return ""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return value.strftime("%d.%m.%Y %H:%M") if hasattr(value, "strftime") else str(value)


def _value_str(field: dict, entry: dict | None) -> str:
    if not entry or entry.get("value") is None:
        return "—"
    val = entry["value"]
    ftype = field.get("type")
    if ftype in ("signature_operator", "signature_qa", "signature_warehouse"):
        if isinstance(val, dict) and val.get("signed_by"):
            return f"{val['signed_by']} · {_fmt_dt(val.get('signed_at'))}"
        return "—"
    v = val.get("v") if isinstance(val, dict) else val
    if v is None or v == "":
        return "—"
    if ftype == "checkbox":
        return "✔" if v in (True, "true", "True", 1) else "—"
    return str(v)


def render_bmr_pdf(data: dict) -> bytes:
    body_font, bold_font = _fonts()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
        title=f"BMR {data.get('batch_no', '')}",
    )
    h1 = ParagraphStyle("h1", fontName=bold_font, fontSize=13, leading=16, alignment=1)
    org = ParagraphStyle("org", fontName=body_font, fontSize=9, leading=11, alignment=1)
    sec = ParagraphStyle("sec", fontName=bold_font, fontSize=10.5, leading=13)
    cell_l = ParagraphStyle("cl", fontName=body_font, fontSize=9, leading=11)
    cell_b = ParagraphStyle("cb", fontName=bold_font, fontSize=9, leading=11)
    small = ParagraphStyle("sm", fontName=body_font, fontSize=8, leading=10, textColor=colors.grey)

    elements: list = []
    elements.append(Paragraph("ИП ООО «NOVUGEN PHARMA» (Узбекистан)", org))
    elements.append(Paragraph("ЖУРНАЛ ЗАПИСИ ПРОИЗВОДСТВА СЕРИИ (BMR / ЗПС)", h1))
    elements.append(Spacer(1, 2 * mm))
    meta = Table(
        [[Paragraph("Серия:", cell_b), Paragraph(data.get("batch_no") or "—", cell_l),
          Paragraph("Шаблон:", cell_b), Paragraph(f"v{data.get('template_version', '')}", cell_l)],
         [Paragraph("Наименование:", cell_b), Paragraph(data.get("title") or "—", cell_l),
          Paragraph("Статус:", cell_b), Paragraph(data.get("status") or "—", cell_l)]],
        colWidths=[28 * mm, 80 * mm, 28 * mm, 50 * mm],
    )
    meta.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, _GRID),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    elements.append(meta)
    elements.append(Spacer(1, 3 * mm))

    participants = data.get("participants") or []
    if participants:
        elements.append(Paragraph("Журнал участников серии", sec))
        prows = [[Paragraph("Ф.И.О.", cell_b), Paragraph("Должность", cell_b),
                  Paragraph("Роль", cell_b), Paragraph("Этапы", cell_b), Paragraph("Участие", cell_b)]]
        for p in participants:
            marks = []
            if p.get("assigned"):
                marks.append("назначен")
            if p.get("signed"):
                marks.append("подписал")
            prows.append([
                Paragraph(p.get("full_name") or "—", cell_l),
                Paragraph(p.get("role") or "—", cell_l),
                Paragraph(", ".join(p.get("duties") or []) or "—", cell_l),
                Paragraph(", ".join(p.get("stages") or []) or "—", cell_l),
                Paragraph(" · ".join(marks) or "—", cell_l),
            ])
        ptbl = Table(prows, colWidths=[44 * mm, 40 * mm, 18 * mm, 60 * mm, 24 * mm], repeatRows=1)
        ptbl.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, _GRID),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        elements.append(ptbl)
        elements.append(Spacer(1, 3 * mm))

    entries = {(str(e["section_id"]), e["field_index"]): e for e in data.get("entries", [])}
    for s in data.get("sections", []):
        elements.append(Spacer(1, 2 * mm))
        elements.append(Paragraph(f"{s.get('ordinal', '')}. {s.get('title', '')}", sec))
        fields = (s.get("config") or {}).get("fields", [])
        if not fields:
            elements.append(Paragraph("—", cell_l))
            continue
        rows = [[Paragraph("Показатель / поле", cell_b), Paragraph("Значение / подпись", cell_b)]]
        for fi, f in enumerate(fields):
            label = f.get("label", "")
            if f.get("unit"):
                label += f", {f['unit']}"
            rows.append([Paragraph(label, cell_l), Paragraph(_value_str(f, entries.get((str(s["id"]), fi))), cell_l)])
        tbl = Table(rows, colWidths=[100 * mm, 86 * mm], repeatRows=1)
        tbl.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, _GRID),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        elements.append(tbl)

    elements.append(Spacer(1, 4 * mm))
    today = datetime.utcnow().strftime("%d.%m.%Y %H:%M")
    elements.append(Paragraph(f"Сформировано: {today} UTC · СОП-11 · электронный BMR (достоверная копия)", small))

    doc.build(elements)
    return buffer.getvalue()
