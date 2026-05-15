"""ДКК scan upload + ДОК verification for Ф-14 QC notifications.

Implements the hybrid-paperless chain of custody around the wet-ink-signed
Ф-14 form (СОП-209):

    created → printed → scan_uploaded → verified → qc_in_progress → completed

State changes here are append-only — a re-scan creates a new
QCNotificationScan row with version+1; the old rows are never deleted so
the audit trail stays complete.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.core.config import settings
from app.models.master_data import Warehouse
from app.models.quality import QCNotification, QCNotificationLine, QCNotificationScan
from app.services.audit import write_audit
from app.services.permissions import require_permission
from app.services.signature import validate_signature


PDF_MAX_BYTES = 20 * 1024 * 1024  # 20 MiB — enough for a colour A4 PDF scan
PDF_MAGIC = b"%PDF-"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# State hash & QR payload
# ---------------------------------------------------------------------------

def compute_state_hash(notification: QCNotification, lines: Iterable[QCNotificationLine]) -> str:
    """Stable SHA-256 over the printed payload.

    Any change to the notification number, warehouse, notified_at or to the
    rendered line set (material/series/qty/dates/manufacturer/invoice) will
    yield a different hash, so a re-print of a tampered notification can be
    detected when its scan is uploaded.
    """
    payload = {
        "no": notification.notification_no,
        "wh": str(notification.warehouse_id),
        "at": notification.notified_at.isoformat(),
        "lines": [
            {
                "lot": str(line.lot_id),
                "mat": line.material_name,
                "batch": line.batch_number,
                "exp": line.expiry_date,
                "qty": line.quantity,
                "unit": line.unit,
                "mfr": line.manufacturer_name,
                "inv": line.invoice_info,
            }
            for line in lines
        ],
    }
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def make_qr_payload(notification_id: UUID, state_hash: str) -> str:
    """Compact text encoded into the on-page QR code."""
    return f"qcn:{notification_id}|h:{state_hash[:16]}"


# ---------------------------------------------------------------------------
# Print event
# ---------------------------------------------------------------------------

def record_print_event(
    db: Session,
    user: CurrentUser,
    notification: QCNotification,
    state_hash: str,
) -> None:
    """Stamp first-print metadata and advance status to 'printed'.

    Subsequent prints don't reset the timestamp — the very first one is the
    "released to wet-ink signing" moment. Re-prints keep the original hash
    so the QR on a re-printed copy still matches the upload check.
    """
    if notification.printed_at is None:
        notification.printed_by = user.id
        notification.printed_at = now_utc()
        notification.state_hash = state_hash
        if notification.status == "created":
            notification.status = "printed"
        write_audit(
            db,
            user,
            object_type="qc_notification",
            object_id=str(notification.id),
            action_type="PRINT_QC_NOTIFICATION",
            new_value={
                "notification_no": notification.notification_no,
                "state_hash": state_hash,
            },
        )
        db.commit()


# ---------------------------------------------------------------------------
# Storage layout
# ---------------------------------------------------------------------------

def _safe_segment(value: str) -> str:
    # Allow only alnum, dash, underscore, dot — strip anything else so a
    # notification number with "/" or "№" can't break the path.
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value)[:64]


def _scan_root() -> Path:
    return Path(settings.qc_scan_root).resolve()


def _build_file_path(notification: QCNotification, version: int, ext: str = "pdf") -> Path:
    when = now_utc()
    folder = (
        _scan_root()
        / str(when.year)
        / f"{when.month:02d}"
        / _safe_segment(str(notification.id))
    )
    folder.mkdir(parents=True, exist_ok=True)
    stamp = when.strftime("%Y%m%dT%H%M%S")
    return folder / f"v{version:02d}-{stamp}.{ext}"


# ---------------------------------------------------------------------------
# Upload (ДКК)
# ---------------------------------------------------------------------------

async def upload_scan(
    db: Session,
    user: CurrentUser,
    notification_id: UUID,
    file: UploadFile,
) -> QCNotificationScan:
    require_permission(user, "UPLOAD_QC_SCAN")
    notification = db.get(QCNotification, notification_id)
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC notification not found")
    if notification.status in {"verified", "qc_in_progress", "completed"}:
        # Allow re-upload only while not yet verified; after verification a
        # new scan would invalidate the GMP chain — require explicit revert.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Notification has been verified already — revert verification before re-uploading",
        )

    if file.content_type not in {"application/pdf", "application/x-pdf"}:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only PDF scans are accepted")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(raw) > PDF_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Scan exceeds 20 MiB limit")
    if not raw.startswith(PDF_MAGIC):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File is not a valid PDF")

    sha256 = hashlib.sha256(raw).hexdigest()

    # Bump version: max(existing)+1 so a re-scan does not overwrite.
    last_version = (
        db.query(QCNotificationScan.version)
        .filter(QCNotificationScan.notification_id == notification.id)
        .order_by(QCNotificationScan.version.desc())
        .limit(1)
        .scalar()
        or 0
    )
    version = last_version + 1
    file_path = _build_file_path(notification, version)
    file_path.write_bytes(raw)

    scan = QCNotificationScan(
        notification_id=notification.id,
        version=version,
        file_path=str(file_path),
        mime_type="application/pdf",
        file_size=len(raw),
        sha256_hash=sha256,
        status="pending_verification",
        uploaded_by=user.id,
        uploaded_at=now_utc(),
    )
    db.add(scan)

    if notification.status in {"created", "printed"}:
        notification.status = "scan_uploaded"

    write_audit(
        db,
        user,
        object_type="qc_notification_scan",
        object_id=str(scan.id),
        action_type="UPLOAD_QC_SCAN",
        new_value={
            "notification_no": notification.notification_no,
            "version": version,
            "sha256": sha256,
            "file_size": len(raw),
        },
    )
    db.commit()
    db.refresh(scan)
    return scan


# ---------------------------------------------------------------------------
# Listing and download
# ---------------------------------------------------------------------------

def list_scans(
    db: Session,
    user: CurrentUser,
    notification_id: UUID,
) -> list[QCNotificationScan]:
    if not _can_view_scans(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission to view QC scans is required")
    notification = db.get(QCNotification, notification_id)
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC notification not found")
    return (
        db.query(QCNotificationScan)
        .filter(QCNotificationScan.notification_id == notification.id)
        .order_by(QCNotificationScan.version.desc())
        .all()
    )


def load_scan_file(
    db: Session,
    user: CurrentUser,
    scan_id: UUID,
) -> tuple[QCNotificationScan, bytes]:
    if not _can_view_scans(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission to view QC scans is required")
    scan = db.get(QCNotificationScan, scan_id)
    if not scan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
    path = Path(scan.file_path)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Scan file is missing from storage")
    blob = path.read_bytes()
    actual_hash = hashlib.sha256(blob).hexdigest()
    if actual_hash != scan.sha256_hash:
        # Tamper-evident check — record an audit event and refuse to serve.
        write_audit(
            db,
            user,
            object_type="qc_notification_scan",
            object_id=str(scan.id),
            action_type="QC_SCAN_HASH_MISMATCH",
            new_value={"expected": scan.sha256_hash, "actual": actual_hash},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Scan integrity check failed — file on disk does not match stored hash",
        )
    return scan, blob


# ---------------------------------------------------------------------------
# Verify (ДОК)
# ---------------------------------------------------------------------------

def verify_scan(
    db: Session,
    user: CurrentUser,
    scan_id: UUID,
    *,
    signature_warehouse_ok: bool,
    signature_qc_ok: bool,
    signature_manager_ok: bool,
    remarks: str | None,
    username: str,
    password: str,
    meaning: str,
    reason: str | None,
) -> QCNotificationScan:
    require_permission(user, "VERIFY_QC_SCAN")
    scan = db.get(QCNotificationScan, scan_id)
    if not scan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
    if scan.status != "pending_verification":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan is not pending verification")
    if scan.uploaded_by == user.id:
        # GMP 4-eyes — uploader cannot be verifier.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user who uploaded the scan cannot verify it (4-eyes rule)",
        )
    if not (signature_warehouse_ok and signature_qc_ok and signature_manager_ok):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All three wet-ink signatures must be confirmed to verify the scan",
        )

    # e-signature over the verification act itself.
    from app.schemas.inventory import SignatureRequest

    signature = SignatureRequest(username=username, password=password, meaning=meaning, reason=reason)
    validate_signature(db, user, signature, "VERIFY_QC_SCAN", "qc_notification_scan", str(scan.id))

    scan.status = "verified"
    scan.verified_by = user.id
    scan.verified_at = now_utc()
    scan.signature_warehouse_ok = signature_warehouse_ok
    scan.signature_qc_ok = signature_qc_ok
    scan.signature_manager_ok = signature_manager_ok
    scan.remarks = (remarks or "").strip() or None

    notification = db.get(QCNotification, scan.notification_id)
    if notification and notification.status in {"printed", "scan_uploaded"}:
        notification.status = "verified"

    write_audit(
        db,
        user,
        object_type="qc_notification_scan",
        object_id=str(scan.id),
        action_type="VERIFY_QC_SCAN",
        new_value={
            "notification_no": notification.notification_no if notification else None,
            "version": scan.version,
            "remarks": scan.remarks,
        },
        reason=reason,
    )
    db.commit()
    db.refresh(scan)
    return scan


def reject_scan(
    db: Session,
    user: CurrentUser,
    scan_id: UUID,
    *,
    remarks: str,
    username: str,
    password: str,
    meaning: str,
    reason: str | None,
) -> QCNotificationScan:
    """ДОК can reject a scan (missing signature, illegible, wrong document)."""
    require_permission(user, "VERIFY_QC_SCAN")
    scan = db.get(QCNotificationScan, scan_id)
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
    validate_signature(db, user, signature, "REJECT_QC_SCAN", "qc_notification_scan", str(scan.id))

    scan.status = "rejected"
    scan.verified_by = user.id
    scan.verified_at = now_utc()
    scan.remarks = remarks.strip()

    # Notification goes back to "printed" so ДКК can re-upload a clean scan.
    notification = db.get(QCNotification, scan.notification_id)
    has_other_pending = (
        db.query(QCNotificationScan.id)
        .filter(
            QCNotificationScan.notification_id == scan.notification_id,
            QCNotificationScan.id != scan.id,
            QCNotificationScan.status == "pending_verification",
        )
        .first()
    )
    if notification and not has_other_pending and notification.status == "scan_uploaded":
        notification.status = "printed"

    write_audit(
        db,
        user,
        object_type="qc_notification_scan",
        object_id=str(scan.id),
        action_type="REJECT_QC_SCAN",
        new_value={
            "notification_no": notification.notification_no if notification else None,
            "version": scan.version,
            "remarks": scan.remarks,
        },
        reason=reason,
    )
    db.commit()
    db.refresh(scan)
    return scan


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _can_view_scans(user: CurrentUser) -> bool:
    """ДКК (upload), ДОК (verify), and anyone with VIEW_QC/VIEW_QA can view."""
    needed = {"UPLOAD_QC_SCAN", "VERIFY_QC_SCAN", "VIEW_QC", "VIEW_QA", "VIEW_WAREHOUSE"}
    return any(code in user.permissions for code in needed)


def warehouse_for(db: Session, notification: QCNotification) -> Warehouse | None:
    return db.get(Warehouse, notification.warehouse_id)
