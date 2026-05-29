from __future__ import annotations

import hashlib
import mimetypes
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.core.config import settings
from app.models.audit import AuditEvent
from app.models.reagents import Reagent, ReagentCertificate, ReagentMovement
from app.schemas.reagents import (
    ReagentCertificateItem,
    ReagentCreate,
    ReagentDetail,
    ReagentItem,
    ReagentMovementItem,
    ReagentStatusRequest,
    ReagentUpdate,
    ReagentUseRequest,
)
from app.services.audit import write_audit
from app.services.permissions import require_permission
from app.services.signature import validate_signature


CERT_MAX_BYTES = 15 * 1024 * 1024
CERT_MIMES = {"image/jpeg", "image/jpg", "image/png", "application/pdf"}
BLOCKED_STATUSES = {"expired", "blocked", "disposed", "depleted"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def effective_expiry(reagent: Reagent) -> date:
    if reagent.opened_date:
        return reagent.opened_date + timedelta(days=reagent.expiry_date_after_opening_days)
    return reagent.expiry_date_unopened


def days_to_expiry(reagent: Reagent) -> int:
    return (effective_expiry(reagent) - date.today()).days


def _item(db: Session, reagent: Reagent) -> ReagentItem:
    return ReagentItem(
        id=reagent.id,
        code=reagent.code,
        name=reagent.name,
        type=reagent.type,
        grade=reagent.grade,
        manufacturer=reagent.manufacturer,
        supplier=reagent.supplier,
        batch_number=reagent.batch_number,
        internal_batch_number=reagent.internal_batch_number,
        received_date=reagent.received_date,
        opened_date=reagent.opened_date,
        expiry_date_unopened=reagent.expiry_date_unopened,
        expiry_date_after_opening_days=reagent.expiry_date_after_opening_days,
        status=reagent.status,
        quantity=float(reagent.quantity),
        unit=reagent.unit,
        storage_location=reagent.storage_location,
        storage_conditions=reagent.storage_conditions,
        responsible=reagent.responsible,
        notes=reagent.notes,
        effective_expiry_date=effective_expiry(reagent),
        days_to_expiry=days_to_expiry(reagent),
        has_certificate=db.query(ReagentCertificate.id).filter(ReagentCertificate.reagent_id == reagent.id).first()
        is not None,
    )


def _detail(db: Session, reagent: Reagent) -> ReagentDetail:
    movements = (
        db.query(ReagentMovement)
        .filter(ReagentMovement.reagent_id == reagent.id)
        .order_by(ReagentMovement.performed_at.desc())
        .all()
    )
    certs = (
        db.query(ReagentCertificate)
        .filter(ReagentCertificate.reagent_id == reagent.id)
        .order_by(ReagentCertificate.uploaded_at.desc())
        .all()
    )
    return ReagentDetail(
        **_item(db, reagent).model_dump(),
        movements=[ReagentMovementItem.model_validate(m) for m in movements],
        certificates=[ReagentCertificateItem.model_validate(c) for c in certs],
    )


def list_reagents(
    db: Session,
    user: CurrentUser,
    *,
    search: str | None = None,
    type_: str | None = None,
    status_: str | None = None,
    opened_only: bool = False,
) -> list[ReagentItem]:
    require_permission(user, "VIEW_QC")
    query = db.query(Reagent)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(
            Reagent.code.ilike(like)
            | Reagent.name.ilike(like)
            | Reagent.batch_number.ilike(like)
            | Reagent.internal_batch_number.ilike(like)
        )
    if type_:
        query = query.filter(Reagent.type == type_)
    if status_:
        query = query.filter(Reagent.status == status_)
    if opened_only:
        query = query.filter(Reagent.opened_date.is_not(None))
    return [_item(db, row) for row in query.order_by(Reagent.code).all()]


def get_reagent(db: Session, user: CurrentUser, reagent_id: UUID) -> ReagentDetail:
    require_permission(user, "VIEW_QC")
    reagent = db.get(Reagent, reagent_id)
    if not reagent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reagent not found")
    return _detail(db, reagent)


def create_reagent(db: Session, user: CurrentUser, payload: ReagentCreate) -> ReagentDetail:
    require_permission(user, "VIEW_QC")
    code = payload.code.strip().upper()
    internal = payload.internal_batch_number.strip().upper()
    if db.query(Reagent).filter(Reagent.code == code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Reagent code already exists")
    if db.query(Reagent).filter(Reagent.internal_batch_number == internal).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Internal batch already exists")

    reagent = Reagent(
        code=code,
        name=payload.name.strip(),
        type=payload.type,
        grade=payload.grade,
        manufacturer=payload.manufacturer,
        supplier=payload.supplier,
        batch_number=payload.batch_number,
        internal_batch_number=internal,
        received_date=payload.received_date,
        opened_date=payload.opened_date,
        expiry_date_unopened=payload.expiry_date_unopened,
        expiry_date_after_opening_days=payload.expiry_date_after_opening_days,
        status=payload.status,
        quantity=payload.quantity,
        unit=payload.unit,
        storage_location=payload.storage_location,
        storage_conditions=payload.storage_conditions,
        responsible=payload.responsible,
        notes=payload.notes,
    )
    db.add(reagent)
    db.flush()
    _movement(
        db,
        user,
        reagent,
        "receipt",
        quantity_operation=float(payload.quantity),
        reason="Reagent registered",
        signature_required=False,
    )
    write_audit(db, user, "qc_reagent", str(reagent.id), "CREATE", new_value={"code": code, "name": reagent.name})
    db.commit()
    return _detail(db, reagent)


def update_reagent(db: Session, user: CurrentUser, reagent_id: UUID, payload: ReagentUpdate) -> ReagentDetail:
    require_permission(user, "VIEW_QC")
    reagent = db.get(Reagent, reagent_id)
    if not reagent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reagent not found")
    old = _item(db, reagent).model_dump(mode="json")
    changes: dict[str, object] = {}
    for field in (
        "name",
        "type",
        "grade",
        "manufacturer",
        "supplier",
        "batch_number",
        "received_date",
        "opened_date",
        "expiry_date_unopened",
        "expiry_date_after_opening_days",
        "status",
        "quantity",
        "unit",
        "storage_location",
        "storage_conditions",
        "responsible",
        "notes",
    ):
        value = getattr(payload, field)
        if value is not None and getattr(reagent, field) != value:
            setattr(reagent, field, value)
            changes[field] = value.isoformat() if hasattr(value, "isoformat") else value
    if changes:
        write_audit(db, user, "qc_reagent", str(reagent.id), "UPDATE", old_value=old, new_value=changes, reason=payload.reason)
        db.commit()
    return _detail(db, reagent)


def change_status(db: Session, user: CurrentUser, reagent_id: UUID, payload: ReagentStatusRequest) -> ReagentDetail:
    require_permission(user, "VIEW_QC")
    reagent = db.get(Reagent, reagent_id)
    if not reagent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reagent not found")
    validate_signature(db, user, payload, "REAGENT_STATUS", "qc_reagent", str(reagent.id))
    old = {"status": reagent.status}
    reagent.status = payload.status
    if payload.status == "opened" and reagent.opened_date is None:
        reagent.opened_date = date.today()
    _movement(db, user, reagent, payload.status if payload.status != "opened" else "opening", 0, payload.reason, True)
    write_audit(db, user, "qc_reagent", str(reagent.id), "STATUS", old_value=old, new_value={"status": payload.status}, reason=payload.reason)
    db.commit()
    return _detail(db, reagent)


def use_reagent(db: Session, user: CurrentUser, reagent_id: UUID, payload: ReagentUseRequest) -> ReagentDetail:
    require_permission(user, "ENTER_QC_RESULT")
    reagent = db.get(Reagent, reagent_id)
    if not reagent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reagent not found")
    if reagent.status in BLOCKED_STATUSES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Cannot use reagent with status {reagent.status}")
    if days_to_expiry(reagent) < 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Cannot use expired reagent")
    if float(reagent.quantity) < payload.quantity:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Insufficient reagent balance")
    validate_signature(db, user, payload, "REAGENT_USE", "qc_reagent", str(reagent.id))
    before = float(reagent.quantity)
    after = before - payload.quantity
    reagent.quantity = after
    reagent.status = "depleted" if after <= 0 else "in_use"
    _movement(
        db,
        user,
        reagent,
        "consumption",
        payload.quantity,
        payload.reason,
        True,
        analytical_sheet=payload.analytical_sheet,
        material_batch=payload.material_batch,
        quantity_before=before,
        quantity_after=after,
    )
    write_audit(
        db,
        user,
        "qc_reagent",
        str(reagent.id),
        "CONSUME",
        old_value={"quantity": before},
        new_value={"quantity": after, "analytical_sheet": payload.analytical_sheet, "material_batch": payload.material_batch},
        reason=payload.reason,
    )
    db.commit()
    return _detail(db, reagent)


def _movement(
    db: Session,
    user: CurrentUser,
    reagent: Reagent,
    operation_type: str,
    quantity_operation: float,
    reason: str | None,
    signature_required: bool,
    analytical_sheet: str | None = None,
    material_batch: str | None = None,
    quantity_before: float | None = None,
    quantity_after: float | None = None,
) -> ReagentMovement:
    before = float(reagent.quantity) if quantity_before is None else quantity_before
    after = float(reagent.quantity) if quantity_after is None else quantity_after
    row = ReagentMovement(
        reagent_id=reagent.id,
        operation_type=operation_type,
        quantity_before=before,
        quantity_operation=quantity_operation,
        quantity_after=after,
        analytical_sheet=analytical_sheet,
        material_batch=material_batch,
        reason=reason,
        signature_required=signature_required,
        performed_by=user.id,
        performed_at=now_utc(),
    )
    db.add(row)
    return row


def list_audit(db: Session, user: CurrentUser, reagent_id: UUID) -> list[AuditEvent]:
    require_permission(user, "VIEW_QC")
    return (
        db.query(AuditEvent)
        .filter(AuditEvent.object_type == "qc_reagent", AuditEvent.object_id == str(reagent_id))
        .order_by(AuditEvent.created_at.desc())
        .limit(100)
        .all()
    )


def _cert_root() -> Path:
    base = Path(settings.qc_scan_root).resolve().parent
    return base / "reagent-certificates"


def _safe_seg(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value)[:64]


async def upload_certificate(
    db: Session,
    user: CurrentUser,
    reagent_id: UUID,
    file: UploadFile,
    certificate_no: str | None = None,
    note: str | None = None,
) -> ReagentCertificate:
    require_permission(user, "VIEW_QC")
    reagent = db.get(Reagent, reagent_id)
    if not reagent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reagent not found")
    mime_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    if mime_type not in CERT_MIMES:
        guessed = mimetypes.guess_type(file.filename or "")[0]
        if guessed in CERT_MIMES:
            mime_type = guessed
    if mime_type not in CERT_MIMES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Only JPEG, PNG or PDF files are accepted")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(raw) > CERT_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Certificate exceeds 15 MiB limit")
    sha = hashlib.sha256(raw).hexdigest()
    when = now_utc()
    folder = _cert_root() / str(when.year) / f"{when.month:02d}" / _safe_seg(str(reagent.id))
    folder.mkdir(parents=True, exist_ok=True)
    ext = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "application/pdf": "pdf"}.get(mime_type, "bin")
    path = folder / f"{when.strftime('%Y%m%dT%H%M%S')}-{sha[:8]}.{ext}"
    path.write_bytes(raw)
    cert = ReagentCertificate(
        reagent_id=reagent.id,
        certificate_no=(certificate_no or "").strip() or None,
        note=(note or "").strip() or None,
        file_path=str(path),
        mime_type=mime_type,
        file_size=len(raw),
        sha256_hash=sha,
        uploaded_by=user.id,
        uploaded_at=when,
    )
    db.add(cert)
    write_audit(
        db,
        user,
        "qc_reagent",
        str(reagent.id),
        "UPLOAD_CERTIFICATE",
        new_value={"certificate_no": cert.certificate_no, "sha256": sha, "size": len(raw)},
        reason=note,
    )
    db.commit()
    db.refresh(cert)
    return cert


def load_certificate_file(db: Session, user: CurrentUser, certificate_id: UUID) -> tuple[bytes, str]:
    require_permission(user, "VIEW_QC")
    cert = db.get(ReagentCertificate, certificate_id)
    if not cert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certificate not found")
    path = Path(cert.file_path)
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Certificate file missing on disk")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != cert.sha256_hash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Certificate integrity check failed")
    return raw, cert.mime_type


def seed_reagents(db: Session) -> None:
    if db.query(Reagent.id).first():
        return
    rows = [
        Reagent(
            code="RE-2026-001",
            name="Метанол HPLC Grade",
            type="reagent",
            grade="HPLC Grade, ≥99.9%",
            manufacturer="Merck KGaA",
            supplier="Sigma-Aldrich",
            batch_number="SHBK9234V",
            internal_batch_number="QC-MET-001-2026",
            received_date=date(2026, 1, 15),
            opened_date=date(2026, 2, 1),
            expiry_date_unopened=date(2027, 1, 15),
            expiry_date_after_opening_days=365,
            status="in_use",
            quantity=850,
            unit="mL",
            storage_location="QC-STORE-A-SHELF-3",
            storage_conditions="RT, protected from light",
            responsible="Иванова А.С.",
        ),
        Reagent(
            code="RS-2026-015",
            name="Caffeine Reference Standard",
            type="reference_standard",
            grade="USP Reference Standard",
            manufacturer="USP",
            supplier="USP Direct",
            batch_number="J0L345",
            internal_batch_number="QC-CAF-RS-015-2026",
            received_date=date(2026, 3, 10),
            expiry_date_unopened=date(2027, 12, 31),
            expiry_date_after_opening_days=730,
            status="approved",
            quantity=500,
            unit="mg",
            storage_location="QC-REF-FRIDGE-2",
            storage_conditions="2-8°C, desiccator",
            responsible="Алимов Р.А.",
        ),
        Reagent(
            code="VS-2026-008",
            name="HCl 0.1N титрованный раствор",
            type="volumetric_solution",
            grade="Titrated, certified",
            manufacturer="ChemLab Ltd.",
            supplier="ChemLab Ltd.",
            batch_number="VT-HCL-0826",
            internal_batch_number="QC-HCL-VS-008-2026",
            received_date=date(2026, 4, 20),
            opened_date=date(2026, 5, 1),
            expiry_date_unopened=date(2026, 6, 20),
            expiry_date_after_opening_days=45,
            status="expiring",
            quantity=450,
            unit="mL",
            storage_location="QC-STORE-B-SHELF-1",
            storage_conditions="RT, tightly closed",
            responsible="Назарова Д.С.",
        ),
    ]
    db.add_all(rows)
