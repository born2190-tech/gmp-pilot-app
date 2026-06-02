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
from app.models.quality import QCReport, QCReportParameter, QCReportScan
from app.services.audit import write_audit
from app.services.document_qr import DOC_QC_REPORT, canonical_hash, validate_scan_document_qr
from app.services.permissions import require_any_permission, require_permission
from app.services.signature import validate_signature


SCAN_MAX_BYTES = 15 * 1024 * 1024
SCAN_MIMES = {"image/jpeg", "image/jpg", "image/png", "application/pdf"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _scan_root() -> Path:
    # Под смонтированным томом (qc_scan_root = /data/qc-scans), иначе сканы
    # терялись при пересборке контейнера (писались в эфемерный /data).
    return Path(settings.qc_scan_root).resolve() / "qc-report-scans"


def _safe_seg(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value)[:64]


def compute_qc_report_state_hash(db: Session, report: QCReport) -> str:
    params = (
        db.query(QCReportParameter)
        .filter(QCReportParameter.report_id == report.id)
        .order_by(QCReportParameter.created_at, QCReportParameter.id)
        .all()
    )
    payload = {
        "report_no": report.report_no,
        "lot_id": str(report.lot_id),
        "status": report.status,
        "method_reference": report.method_reference,
        "analysis_started_at": report.analysis_started_at.isoformat() if report.analysis_started_at else None,
        "analysis_finished_at": report.analysis_finished_at.isoformat() if report.analysis_finished_at else None,
        "overall_result": report.overall_result,
        "equipment": report.equipment,
        "room_temp": report.room_temp,
        "humidity": report.humidity,
        "micro_required": report.micro_required,
        "micro_method_reference": report.micro_method_reference,
        "micro_started_at": report.micro_started_at.isoformat() if report.micro_started_at else None,
        "micro_finished_at": report.micro_finished_at.isoformat() if report.micro_finished_at else None,
        "equipments": sorted(f"{item.code}:{item.name}" for item in report.equipments),
        "parameters": [
            {
                "category": p.category,
                "parameter_name": p.parameter_name,
                "specification": p.specification,
                "result_value": p.result_value,
                "unit": p.unit,
                "method_reference": p.method_reference,
                "complies": p.complies,
                "equipment_id": str(p.equipment_id) if p.equipment_id else None,
            }
            for p in params
        ],
    }
    return canonical_hash(payload)


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

    validate_scan_document_qr(
        raw=raw,
        mime_type=file.content_type,
        expected_doc_type=DOC_QC_REPORT,
        expected_document_id=report.id,
        expected_lot_id=report.lot_id,
        expected_state_hash=compute_qc_report_state_hash(db, report),
    )

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
    # Просмотр скана аналит. листа: загрузивший (ОКК), верификатор ДОК и
    # просматривающие роли. Раньше требовался только VIEW_WAREHOUSE — из-за чего
    # ДОК-верификатор не мог открыть документ для проверки.
    require_any_permission(user, ("VERIFY_QC_SCAN", "ENTER_QC_RESULT", "VIEW_QC", "VIEW_QA", "VIEW_WAREHOUSE"))
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


# ---------------------------------------------------------------------------
# ДОК (QA) 4-eyes verification of the wet-ink-signed analytical sheet (Ф-11)
# ---------------------------------------------------------------------------

def verify_report_scan(
    db: Session,
    user: CurrentUser,
    scan_id: UUID,
    *,
    signature_1_ok: bool,
    signature_2_ok: bool,
    signature_3_ok: bool,
    remarks: str | None,
    username: str,
    password: str,
    meaning: str,
    reason: str | None,
) -> QCReportScan:
    require_permission(user, "VERIFY_QC_SCAN")
    scan = db.get(QCReportScan, scan_id)
    if not scan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
    if scan.status != "pending_verification":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan is not pending verification")
    if scan.uploaded_by == user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user who uploaded the scan cannot verify it (4-eyes rule)",
        )
    report = db.get(QCReport, scan.report_id)
    # Подписи Ф-11: 1) исполнитель (химик), 2) микробиолог (только если есть
    # микробиология), 3) утвердил (нач. ДКК). Подпись микробиолога требуется
    # лишь когда в протоколе есть микробиологический раздел.
    need_micro = bool(report and report.micro_required)
    missing = (not signature_1_ok) or (not signature_3_ok) or (need_micro and not signature_2_ok)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Подтвердите все требуемые подписи аналитического листа",
        )

    from app.schemas.inventory import SignatureRequest

    signature = SignatureRequest(username=username, password=password, meaning=meaning, reason=reason)
    validate_signature(db, user, signature, "VERIFY_QC_REPORT_SCAN", "qc_report_scan", str(scan.id))
    scan.status = "verified"
    scan.verified_by = user.id
    scan.verified_at = now_utc()
    scan.signature_1_ok = signature_1_ok
    scan.signature_2_ok = signature_2_ok
    scan.signature_3_ok = signature_3_ok
    scan.remarks = (remarks or "").strip() or None
    write_audit(
        db,
        user,
        object_type="qc_report_scan",
        object_id=str(scan.id),
        action_type="VERIFY_QC_REPORT_SCAN",
        new_value={
            "report_no": report.report_no if report else None,
            "version": scan.version,
            "remarks": scan.remarks,
        },
        reason=reason,
    )
    db.commit()
    db.refresh(scan)
    return scan


def reject_report_scan(
    db: Session,
    user: CurrentUser,
    scan_id: UUID,
    *,
    remarks: str,
    username: str,
    password: str,
    meaning: str,
    reason: str | None,
) -> QCReportScan:
    require_permission(user, "VERIFY_QC_SCAN")
    scan = db.get(QCReportScan, scan_id)
    if not scan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
    if scan.status != "pending_verification":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan is not pending verification")
    if scan.uploaded_by == user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user who uploaded the scan cannot reject it either — escalate to another QA officer",
        )
    if not remarks.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rejection requires remarks")

    from app.schemas.inventory import SignatureRequest

    signature = SignatureRequest(username=username, password=password, meaning=meaning, reason=reason)
    validate_signature(db, user, signature, "REJECT_QC_REPORT_SCAN", "qc_report_scan", str(scan.id))

    report = db.get(QCReport, scan.report_id)
    scan.status = "rejected"
    scan.verified_by = user.id
    scan.verified_at = now_utc()
    scan.remarks = remarks.strip()
    write_audit(
        db,
        user,
        object_type="qc_report_scan",
        object_id=str(scan.id),
        action_type="REJECT_QC_REPORT_SCAN",
        new_value={
            "report_no": report.report_no if report else None,
            "version": scan.version,
            "remarks": scan.remarks,
        },
        reason=reason,
    )
    db.commit()
    db.refresh(scan)
    return scan


def is_report_verified(db: Session, report_id: UUID) -> bool:
    """True if the latest analytical-sheet scan for the report is ДОК-verified."""
    last = latest_scan(db, report_id)
    return bool(last and last.status == "verified")
