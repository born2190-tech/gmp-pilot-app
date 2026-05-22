"""Скан-копии подписанных аналитических листов (Ф-11) к протоколам ОКК.

Файл хранится на диске рядом с прочими скан-копиями, в БД — путь + sha256.
Именно этот скан отдаётся при скачивании аналитического листа.
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
from app.models.quality import QCReport, QCReportScan
from app.services.audit import write_audit
from app.services.permissions import require_permission


SCAN_MAX_BYTES = 15 * 1024 * 1024
SCAN_MIMES = {"image/jpeg", "image/jpg", "image/png", "application/pdf"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _scan_root() -> Path:
    return Path(settings.qc_scan_root).resolve().parent / "qc-report-scans"


def _safe_seg(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value)[:64]


async def upload_report_scan(db: Session, user: CurrentUser, report_id: UUID, file: UploadFile) -> QCReportScan:
    require_permission(user, "ENTER_QC_RESULT")
    report = db.get(QCReport, report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC report not found")
    if file.content_type not in SCAN_MIMES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only JPEG, PNG or PDF accepted")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(raw) > SCAN_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Scan exceeds 15 MiB limit")

    sha = hashlib.sha256(raw).hexdigest()
    when = now_utc()
    folder = _scan_root() / str(when.year) / f"{when.month:02d}" / _safe_seg(str(report.id))
    folder.mkdir(parents=True, exist_ok=True)
    ext = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "application/pdf": "pdf"}.get(
        file.content_type or "", "bin"
    )
    file_path = folder / f"{when.strftime('%Y%m%dT%H%M%S')}-{sha[:8]}.{ext}"
    file_path.write_bytes(raw)

    version = db.query(QCReportScan).filter(QCReportScan.report_id == report.id).count() + 1
    scan = QCReportScan(
        report_id=report.id,
        version=version,
        file_path=str(file_path),
        mime_type=file.content_type or "application/octet-stream",
        file_size=len(raw),
        sha256_hash=sha,
        uploaded_by=user.id,
        uploaded_at=when,
    )
    db.add(scan)
    write_audit(
        db,
        user,
        object_type="qc_report_scan",
        object_id=str(scan.id) if scan.id else "(pending)",
        action_type="UPLOAD_QC_REPORT_SCAN",
        new_value={"report_no": report.report_no, "sha256": sha, "size": len(raw), "version": version},
    )
    db.commit()
    db.refresh(scan)
    return scan


def latest_scan(db: Session, report_id: UUID) -> QCReportScan | None:
    return (
        db.query(QCReportScan)
        .filter(QCReportScan.report_id == report_id)
        .order_by(QCReportScan.version.desc())
        .first()
    )


def load_scan_file(db: Session, user: CurrentUser, scan_id: UUID) -> tuple[bytes, str]:
    require_permission(user, "VIEW_WAREHOUSE")
    scan = db.get(QCReportScan, scan_id)
    if not scan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
    path = Path(scan.file_path)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Scan file missing on disk")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != scan.sha256_hash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan integrity check failed (sha256 mismatch)")
    return raw, scan.mime_type
