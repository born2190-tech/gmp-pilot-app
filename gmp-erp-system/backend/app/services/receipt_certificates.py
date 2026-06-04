"""Сертификаты качества производителя (CoA) при приёмке.

Для склада субстанций CoA обязателен по каждой строке приемки — post_receipt
блокируется, пока к каждой строке не приложен свой сертификат. Файлы хранятся на диске рядом с
прочими скан-копиями, в БД — путь + sha256.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.core.config import settings
from app.models.inventory import ReceiptCertificate, ReceiptDocument, ReceiptLine
from app.services.audit import write_audit
from app.services.permissions import require_permission


CERT_MAX_BYTES = 15 * 1024 * 1024  # 15 MiB
CERT_MIMES = {"image/jpeg", "image/jpg", "image/png", "application/pdf"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _cert_root() -> Path:
    base = Path(settings.qc_scan_root).resolve().parent
    return base / "receipt-certificates"


def _safe_seg(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value)[:64]


async def upload_certificate(
    db: Session,
    user: CurrentUser,
    receipt_id: UUID,
    file: UploadFile,
    certificate_no: str | None = None,
    note: str | None = None,
    receipt_line_id: UUID | None = None,
) -> ReceiptCertificate:
    require_permission(user, "CREATE_RECEIPT")
    receipt = db.get(ReceiptDocument, receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt not found")
    receipt_line = None
    if receipt_line_id:
        receipt_line = db.get(ReceiptLine, receipt_line_id)
        if not receipt_line:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt line not found")
        if receipt_line.receipt_id != receipt.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Receipt line does not belong to this receipt")
    if file.content_type not in CERT_MIMES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG or PDF certificates are accepted",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(raw) > CERT_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Certificate exceeds 15 MiB limit")

    sha = hashlib.sha256(raw).hexdigest()
    when = now_utc()
    folder = _cert_root() / str(when.year) / f"{when.month:02d}" / _safe_seg(str(receipt.id))
    folder.mkdir(parents=True, exist_ok=True)
    ext = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "application/pdf": "pdf"}.get(
        file.content_type or "", "bin"
    )
    file_path = folder / f"{when.strftime('%Y%m%dT%H%M%S')}-{sha[:8]}.{ext}"
    file_path.write_bytes(raw)

    cert = ReceiptCertificate(
        receipt_id=receipt.id,
        receipt_line_id=receipt_line.id if receipt_line else None,
        certificate_no=(certificate_no or "").strip() or None,
        note=(note or "").strip() or None,
        file_path=str(file_path),
        mime_type=file.content_type or "application/octet-stream",
        file_size=len(raw),
        sha256_hash=sha,
        uploaded_by=user.id,
        uploaded_at=when,
    )
    db.add(cert)
    write_audit(
        db,
        user,
        object_type="receipt_certificate",
        object_id=str(cert.id) if cert.id else "(pending)",
        action_type="UPLOAD_RECEIPT_COA",
        new_value={
            "receipt_no": receipt.document_no,
            "receipt_line_id": str(cert.receipt_line_id) if cert.receipt_line_id else None,
            "certificate_no": cert.certificate_no,
            "sha256": sha,
            "size": len(raw),
        },
    )
    db.commit()
    db.refresh(cert)
    return cert


def list_certificates(db: Session, user: CurrentUser, receipt_id: UUID) -> list[ReceiptCertificate]:
    require_permission(user, "VIEW_WAREHOUSE")
    return (
        db.query(ReceiptCertificate)
        .filter(ReceiptCertificate.receipt_id == receipt_id)
        .order_by(ReceiptCertificate.uploaded_at.desc())
        .all()
    )


def has_certificate(db: Session, receipt_id: UUID) -> bool:
    return db.query(ReceiptCertificate.id).filter(ReceiptCertificate.receipt_id == receipt_id).first() is not None


def missing_certificate_lines(db: Session, receipt_id: UUID) -> list[ReceiptLine]:
    """Строки прихода, по которым нет своего CoA.

    Legacy-сертификаты без receipt_line_id не засчитываются для новых
    многострочных приходов: пользователь должен явно привязать CoA к материалу.
    """
    lines = db.query(ReceiptLine).filter(ReceiptLine.receipt_id == receipt_id).order_by(ReceiptLine.created_at).all()
    covered_line_ids = {
        row[0]
        for row in (
            db.query(ReceiptCertificate.receipt_line_id)
            .filter(ReceiptCertificate.receipt_id == receipt_id, ReceiptCertificate.receipt_line_id.isnot(None))
            .distinct()
            .all()
        )
    }
    return [line for line in lines if line.id not in covered_line_ids]


def has_certificate_for_each_line(db: Session, receipt_id: UUID) -> bool:
    return len(missing_certificate_lines(db, receipt_id)) == 0


def load_certificate_file(db: Session, user: CurrentUser, certificate_id: UUID) -> tuple[bytes, str]:
    require_permission(user, "VIEW_WAREHOUSE")
    cert = db.get(ReceiptCertificate, certificate_id)
    if not cert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certificate not found")
    path = Path(cert.file_path)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Certificate file missing on disk")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != cert.sha256_hash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Certificate integrity check failed (sha256 mismatch)")
    return raw, cert.mime_type
