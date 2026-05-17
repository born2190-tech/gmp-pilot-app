"""Receipt defect acts (СОП-209 Ф-12 — внешние дефекты тары).

Each act documents one container/pallet with a problem found at unpacking
time. Severity follows СОП-209 п.6.5:

    critical    — container damaged and contents exposed to environment;
                  material to be returned to supplier
    significant — container damaged but contents intact
    minor       — container cosmetic dents only; integrity preserved

Workflow:
    pending  → escalated → resolved | returned

The act lives next to the receipt; while at least one critical act is
pending or escalated for a receipt, post_receipt is refused.
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
from app.models.inventory import (
    ReceiptDefect,
    ReceiptDefectPhoto,
    ReceiptDocument,
    ReceiptLine,
)
from app.services.audit import write_audit
from app.services.permissions import require_permission


PHOTO_MAX_BYTES = 10 * 1024 * 1024  # 10 MiB per photo
PHOTO_MIMES = {"image/jpeg", "image/jpg", "image/png", "application/pdf"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _photo_root() -> Path:
    # Reuses the QC scan root mount; defects live in a sibling subfolder so
    # both fit on the same backed-up volume.
    base = Path(settings.qc_scan_root).resolve().parent
    return base / "receipt-defect-photos"


def _safe_seg(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value)[:64]


def _generate_act_no(db: Session, receipt: ReceiptDocument) -> str:
    today = now_utc().strftime("%Y%m%d")
    base = f"DEF-{today}-{_safe_seg(receipt.document_no)}"
    last_seq = (
        db.query(ReceiptDefect.act_no)
        .filter(ReceiptDefect.act_no.like(f"{base}-%"))
        .order_by(ReceiptDefect.act_no.desc())
        .limit(1)
        .scalar()
    )
    seq = 1
    if last_seq:
        try:
            seq = int(last_seq.rsplit("-", 1)[-1]) + 1
        except ValueError:
            seq = 1
    return f"{base}-{seq:02d}"


# ---------------------------------------------------------------------------

def create_defect(
    db: Session,
    user: CurrentUser,
    receipt_id: UUID,
    payload,  # ReceiptDefectCreate
) -> ReceiptDefect:
    require_permission(user, "CREATE_RECEIPT")
    receipt = db.get(ReceiptDocument, receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt not found")
    if payload.receipt_line_id:
        line = db.get(ReceiptLine, payload.receipt_line_id)
        if not line or line.receipt_id != receipt.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Receipt line does not belong to this receipt")

    initial_status = "escalated" if payload.severity in {"critical", "significant"} else "pending"
    defect = ReceiptDefect(
        act_no=_generate_act_no(db, receipt),
        receipt_id=receipt.id,
        receipt_line_id=payload.receipt_line_id,
        severity=payload.severity,
        description=payload.description.strip(),
        status=initial_status,
        recorded_by=user.id,
        recorded_at=now_utc(),
    )
    db.add(defect)
    write_audit(
        db,
        user,
        object_type="receipt_defect",
        object_id=str(defect.id) if defect.id else "(pending)",
        action_type="CREATE_RECEIPT_DEFECT",
        new_value={
            "act_no": defect.act_no,
            "receipt_no": receipt.document_no,
            "severity": payload.severity,
            "status": initial_status,
        },
    )
    db.commit()
    db.refresh(defect)
    return defect


def list_defects(db: Session, user: CurrentUser, receipt_id: UUID) -> list[ReceiptDefect]:
    require_permission(user, "VIEW_WAREHOUSE")
    receipt = db.get(ReceiptDocument, receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt not found")
    return (
        db.query(ReceiptDefect)
        .filter(ReceiptDefect.receipt_id == receipt.id)
        .order_by(ReceiptDefect.recorded_at.desc())
        .all()
    )


def get_defect(db: Session, user: CurrentUser, defect_id: UUID) -> ReceiptDefect:
    require_permission(user, "VIEW_WAREHOUSE")
    defect = db.get(ReceiptDefect, defect_id)
    if not defect:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Defect act not found")
    return defect


def set_status(
    db: Session,
    user: CurrentUser,
    defect_id: UUID,
    payload,  # ReceiptDefectStatusUpdate
) -> ReceiptDefect:
    # Resolving / escalating / returning is QA-side.
    if "VIEW_QA" not in user.permissions and "VIEW_QC" not in user.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission VIEW_QA or VIEW_QC is required",
        )
    defect = db.get(ReceiptDefect, defect_id)
    if not defect:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Defect act not found")
    if defect.status in {"resolved", "returned"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Defect act is already closed")

    old_status = defect.status
    defect.status = payload.status
    defect.resolution_comment = (payload.comment or "").strip() or None
    if payload.status in {"resolved", "returned"}:
        defect.resolved_by = user.id
        defect.resolved_at = now_utc()
    write_audit(
        db,
        user,
        object_type="receipt_defect",
        object_id=str(defect.id),
        action_type=f"DEFECT_{payload.status.upper()}",
        old_value={"status": old_status},
        new_value={"status": payload.status, "comment": defect.resolution_comment},
    )
    db.commit()
    db.refresh(defect)
    return defect


# ---------------------------------------------------------------------------

async def upload_photo(
    db: Session,
    user: CurrentUser,
    defect_id: UUID,
    file: UploadFile,
) -> ReceiptDefectPhoto:
    require_permission(user, "CREATE_RECEIPT")
    defect = db.get(ReceiptDefect, defect_id)
    if not defect:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Defect act not found")
    if file.content_type not in PHOTO_MIMES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG or PDF photos are accepted",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(raw) > PHOTO_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Photo exceeds 10 MiB limit")

    sha = hashlib.sha256(raw).hexdigest()
    when = now_utc()
    folder = _photo_root() / str(when.year) / f"{when.month:02d}" / _safe_seg(str(defect.id))
    folder.mkdir(parents=True, exist_ok=True)
    ext = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "application/pdf": "pdf"}.get(
        file.content_type or "", "bin"
    )
    file_path = folder / f"{when.strftime('%Y%m%dT%H%M%S')}-{sha[:8]}.{ext}"
    file_path.write_bytes(raw)

    photo = ReceiptDefectPhoto(
        defect_id=defect.id,
        file_path=str(file_path),
        mime_type=file.content_type or "application/octet-stream",
        file_size=len(raw),
        sha256_hash=sha,
        uploaded_by=user.id,
        uploaded_at=when,
    )
    db.add(photo)
    write_audit(
        db,
        user,
        object_type="receipt_defect_photo",
        object_id=str(photo.id) if photo.id else "(pending)",
        action_type="UPLOAD_DEFECT_PHOTO",
        new_value={
            "defect_act_no": defect.act_no,
            "size": len(raw),
            "sha256": sha,
            "mime": file.content_type,
        },
    )
    db.commit()
    db.refresh(photo)
    return photo


def list_photos(db: Session, user: CurrentUser, defect_id: UUID) -> list[ReceiptDefectPhoto]:
    require_permission(user, "VIEW_WAREHOUSE")
    defect = db.get(ReceiptDefect, defect_id)
    if not defect:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Defect act not found")
    return (
        db.query(ReceiptDefectPhoto)
        .filter(ReceiptDefectPhoto.defect_id == defect.id)
        .order_by(ReceiptDefectPhoto.uploaded_at)
        .all()
    )


def load_photo_file(
    db: Session,
    user: CurrentUser,
    photo_id: UUID,
) -> tuple[ReceiptDefectPhoto, bytes]:
    require_permission(user, "VIEW_WAREHOUSE")
    photo = db.get(ReceiptDefectPhoto, photo_id)
    if not photo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
    path = Path(photo.file_path)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Photo file is missing from storage")
    blob = path.read_bytes()
    actual = hashlib.sha256(blob).hexdigest()
    if actual != photo.sha256_hash:
        write_audit(
            db,
            user,
            object_type="receipt_defect_photo",
            object_id=str(photo.id),
            action_type="DEFECT_PHOTO_HASH_MISMATCH",
            new_value={"expected": photo.sha256_hash, "actual": actual},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Photo integrity check failed",
        )
    return photo, blob


# ---------------------------------------------------------------------------

def has_blocking_defects(db: Session, receipt_id: UUID) -> bool:
    """Critical defects that aren't resolved or returned block post_receipt."""
    count = (
        db.query(ReceiptDefect.id)
        .filter(
            ReceiptDefect.receipt_id == receipt_id,
            ReceiptDefect.severity == "critical",
            ReceiptDefect.status.in_(["pending", "escalated"]),
        )
        .count()
    )
    return count > 0
