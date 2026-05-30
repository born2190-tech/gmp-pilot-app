"""QR protection for printed GMP documents.

The QR payload binds a wet-ink-signed scan to one document record, one lot
where applicable, and the canonical state hash printed on paper. Uploads are
accepted only when the scan contains a readable and matching QR code.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from reportlab.lib.units import mm
from reportlab.platypus import Image as ReportLabImage

from app.core.config import settings


DOC_QC_NOTIFICATION = "QC_NOTIFICATION"
DOC_SAMPLING_ACT = "SAMPLING_ACT"
DOC_QC_REPORT = "QC_REPORT"

QR_PREFIX = "gmpqr:v1"


@dataclass(frozen=True)
class ParsedDocumentQr:
    doc_type: str
    document_id: str
    lot_id: str | None
    state_hash16: str
    signature: str | None
    legacy: bool = False


def canonical_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _signature_base(doc_type: str, document_id: str, lot_id: str | None, state_hash16: str) -> str:
    return f"v:1|t:{doc_type}|id:{document_id}|lot:{lot_id or ''}|h:{state_hash16}"


def _sign(doc_type: str, document_id: str, lot_id: str | None, state_hash16: str) -> str:
    raw = _signature_base(doc_type, document_id, lot_id, state_hash16)
    return hmac.new(settings.secret_key.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()[:24]


def make_document_qr_payload(
    doc_type: str,
    document_id: UUID,
    state_hash: str,
    lot_id: UUID | None = None,
) -> str:
    state_hash16 = state_hash[:16]
    document = str(document_id)
    lot = str(lot_id) if lot_id else ""
    sig = _sign(doc_type, document, lot or None, state_hash16)
    return f"{QR_PREFIX}|t:{doc_type}|id:{document}|lot:{lot}|h:{state_hash16}|s:{sig}"


def make_qr_image(payload: str, size_mm: float = 24.0) -> ReportLabImage | None:
    try:
        import qrcode  # type: ignore
    except ImportError:
        return None

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=8,
        border=1,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    pil_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    buf.seek(0)
    return ReportLabImage(buf, width=size_mm * mm, height=size_mm * mm)


def parse_qr_payload(payload: str) -> ParsedDocumentQr:
    payload = (payload or "").strip()
    # Legacy Ф-14 payload already printed before secure QR was introduced.
    if payload.startswith("qcn:"):
        parts = payload.split("|")
        document_id = parts[0].removeprefix("qcn:")
        state_hash16 = ""
        for part in parts[1:]:
            if part.startswith("h:"):
                state_hash16 = part.removeprefix("h:")
        return ParsedDocumentQr(
            doc_type=DOC_QC_NOTIFICATION,
            document_id=document_id,
            lot_id=None,
            state_hash16=state_hash16,
            signature=None,
            legacy=True,
        )

    if not payload.startswith(f"{QR_PREFIX}|"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="QR-код не относится к GMP ERP документам",
        )

    fields: dict[str, str] = {}
    for part in payload.split("|")[1:]:
        key, sep, value = part.partition(":")
        if sep:
            fields[key] = value

    required = {"t", "id", "h", "s"}
    if not required.issubset(fields):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="QR-код повреждён или содержит неполные данные",
        )

    return ParsedDocumentQr(
        doc_type=fields["t"],
        document_id=fields["id"],
        lot_id=fields.get("lot") or None,
        state_hash16=fields["h"],
        signature=fields["s"],
    )


def extract_qr_payload_from_scan(raw: bytes, mime_type: str | None) -> str | None:
    if mime_type == "application/pdf" or raw.startswith(b"%PDF-"):
        return _extract_from_pdf(raw)
    if (mime_type or "").lower() in {"image/jpeg", "image/jpg", "image/png"}:
        return _extract_from_image(raw)
    return None


def validate_scan_document_qr(
    *,
    raw: bytes,
    mime_type: str | None,
    expected_doc_type: str,
    expected_document_id: UUID,
    expected_state_hash: str,
    expected_lot_id: UUID | None = None,
) -> ParsedDocumentQr:
    payload = extract_qr_payload_from_scan(raw, mime_type)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="QR-код документа не найден или не читается. Пересканируйте документ в лучшем качестве.",
        )

    parsed = parse_qr_payload(payload)
    expected_id = str(expected_document_id)
    expected_lot = str(expected_lot_id) if expected_lot_id else None
    expected_hash16 = expected_state_hash[:16]

    if parsed.doc_type != expected_doc_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Скан относится к другому типу документа",
        )
    if parsed.document_id != expected_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Скан относится к другому документу",
        )
    if expected_lot and parsed.lot_id != expected_lot:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Скан относится к другой серии/партии",
        )
    if parsed.state_hash16 != expected_hash16:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Документ был изменён после печати. Распечатайте новую версию и загрузите её скан.",
        )

    if not parsed.legacy:
        expected_sig = _sign(parsed.doc_type, parsed.document_id, parsed.lot_id, parsed.state_hash16)
        if not hmac.compare_digest(parsed.signature or "", expected_sig):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="QR-код документа не прошёл проверку подлинности",
            )

    return parsed


def _extract_from_image(raw: bytes) -> str | None:
    try:
        from PIL import Image as PILImage
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="На сервере не установлен модуль распознавания QR",
        )

    try:
        pil = PILImage.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Файл изображения повреждён")

    img = np.array(pil)
    detector = cv2.QRCodeDetector()
    return _decode_with_detector(detector, img) or _decode_with_detector(detector, cv2.cvtColor(img, cv2.COLOR_RGB2GRAY))


def _extract_from_pdf(raw: bytes) -> str | None:
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
        import pypdfium2 as pdfium  # type: ignore
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="На сервере не установлен модуль распознавания QR",
        )

    try:
        pdf = pdfium.PdfDocument(raw)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF-файл повреждён")

    detector = cv2.QRCodeDetector()
    pages_to_scan = min(len(pdf), 3)
    for index in range(pages_to_scan):
        page = pdf[index]
        # OpenCV QR detection is scale-sensitive on dense codes. Trying a few
        # raster sizes keeps generated PDFs and real office scans both robust.
        for scale in (2.5, 3.0, 4.0, 5.0):
            bitmap = page.render(scale=scale)
            pil = bitmap.to_pil().convert("RGB")
            img = np.array(pil)
            decoded = _decode_with_detector(detector, img)
            if decoded:
                return decoded
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
            decoded = _decode_with_detector(detector, gray)
            if decoded:
                return decoded
    return None


def _decode_with_detector(detector: Any, img: Any) -> str | None:
    data, _points, _straight = detector.detectAndDecode(img)
    if data:
        return str(data)
    try:
        ok, decoded, _points, _straight = detector.detectAndDecodeMulti(img)
    except Exception:
        return None
    if ok:
        for item in decoded:
            if item:
                return str(item)
    return None
