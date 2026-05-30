from __future__ import annotations

import calendar
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import ProductionBatch
from app.schemas.production import (
    ProductionBatchBmrIssueRequest,
    ProductionBatchChecklistUpdate,
    ProductionBatchCreate,
    ProductionBatchNumberCheckRequest,
    ProductionBatchPreviewRequest,
    ProductionBatchStartRequest,
)
from app.services.audit import write_audit
from app.services.signature import validate_signature


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _require_any_permission(user: CurrentUser, permission_codes: tuple[str, ...]) -> None:
    if not any(code in user.permissions for code in permission_codes):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"One of permissions {', '.join(permission_codes)} is required",
        )


def _add_months_to_month_end(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = calendar.monthrange(year, month)[1]
    return date(year, month, day)


def _next_serial(db: Session, product_code: str, production_date: date) -> int:
    existing = (
        db.query(func.max(ProductionBatch.serial_no))
        .filter(
            ProductionBatch.product_code == product_code,
            func.extract("year", ProductionBatch.production_date) == production_date.year,
        )
        .scalar()
    )
    return int(existing or 0) + 1


def _format_batch_no(product_code: str, production_date: date, serial_no: int) -> str:
    return f"{product_code}N{production_date:%y%m}{serial_no:03d}"


def _all_start_checks(batch: ProductionBatch) -> bool:
    return all(
        (
            batch.room_ready,
            batch.equipment_ready,
            batch.scales_checked,
            batch.materials_ready,
            batch.qa_line_clearance,
        )
    )


def _update_status_from_gates(batch: ProductionBatch) -> None:
    if batch.status == "in_production":
        return
    if batch.bmr_issued_at and _all_start_checks(batch):
        batch.status = "ready_to_start"
    elif batch.bmr_issued_at:
        batch.status = "bmr_issued"
    elif batch.number_checked_at:
        batch.status = "number_checked"
    else:
        batch.status = "assigned"


def preview_batch_number(db: Session, user: CurrentUser, payload: ProductionBatchPreviewRequest) -> dict:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "EXECUTE_BMR"))
    serial = _next_serial(db, payload.product_code, payload.production_date)
    return {
        "batch_no": _format_batch_no(payload.product_code, payload.production_date, serial),
        "serial_no": serial,
        "expiry_date": _add_months_to_month_end(payload.production_date, payload.shelf_life_months),
    }


def create_batch(db: Session, user: CurrentUser, payload: ProductionBatchCreate) -> ProductionBatch:
    _require_any_permission(user, ("MANAGE_PRODUCTION",))
    preview = preview_batch_number(db, user, payload)
    batch = ProductionBatch(
        batch_no=preview["batch_no"],
        status="assigned",
        product_code=payload.product_code,
        serial_no=preview["serial_no"],
        product_name=payload.product_name.strip(),
        dosage_form=(payload.dosage_form or "").strip() or None,
        batch_size=payload.batch_size,
        batch_size_unit=payload.batch_size_unit.strip(),
        production_date=payload.production_date,
        expiry_date=preview["expiry_date"],
        shelf_life_months=payload.shelf_life_months,
        created_by=user.id,
        notes=payload.notes,
    )
    db.add(batch)
    db.flush()
    write_audit(
        db,
        user,
        object_type="production_batch",
        object_id=str(batch.id),
        action_type="ASSIGN_BATCH_NO",
        new_value={
            "batch_no": batch.batch_no,
            "sop": "SOP-409",
            "production_date": str(batch.production_date),
            "expiry_date": str(batch.expiry_date),
        },
    )
    db.commit()
    db.refresh(batch)
    return batch


def list_batches(db: Session, user: CurrentUser, status_filter: str | None = None) -> list[ProductionBatch]:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "EXECUTE_BMR", "VIEW_QA", "QA_DECISION"))
    query = db.query(ProductionBatch).order_by(ProductionBatch.created_at.desc())
    if status_filter:
        query = query.filter(ProductionBatch.status == status_filter)
    return query.all()


def get_batch(db: Session, user: CurrentUser, batch_id) -> ProductionBatch:
    _require_any_permission(user, ("VIEW_PRODUCTION", "MANAGE_PRODUCTION", "EXECUTE_BMR", "VIEW_QA", "QA_DECISION"))
    batch = db.get(ProductionBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Production batch not found")
    return batch


def issue_bmr(db: Session, user: CurrentUser, batch_id, payload: ProductionBatchBmrIssueRequest) -> ProductionBatch:
    _require_any_permission(user, ("QA_DECISION",))
    batch = get_batch(db, user, batch_id)
    if batch.bmr_issued_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="BMR already issued")
    if not batch.number_checked_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Batch number must be checked before BMR issue")
    validate_signature(db, user, payload, "ISSUE_BMR", "production_batch", str(batch.id))
    batch.bmr_no = (payload.bmr_no or f"BMR-{batch.batch_no}").strip()
    batch.bmr_issued_by = user.id
    batch.bmr_issued_at = now_utc()
    _update_status_from_gates(batch)
    write_audit(
        db,
        user,
        object_type="production_batch",
        object_id=str(batch.id),
        action_type="ISSUE_BMR",
        new_value={"bmr_no": batch.bmr_no, "status": batch.status, "sop": "SOP-436"},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(batch)
    return batch


def check_batch_number(db: Session, user: CurrentUser, batch_id, payload: ProductionBatchNumberCheckRequest) -> ProductionBatch:
    _require_any_permission(user, ("ENTER_QC_RESULT", "QA_DECISION"))
    batch = get_batch(db, user, batch_id)
    if batch.number_checked_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Batch number already checked")
    validate_signature(db, user, payload, "CHECK_PRODUCTION_BATCH_NUMBER", "production_batch", str(batch.id))
    batch.number_checked_by = user.id
    batch.number_checked_at = now_utc()
    _update_status_from_gates(batch)
    write_audit(
        db,
        user,
        object_type="production_batch",
        object_id=str(batch.id),
        action_type="CHECK_PRODUCTION_BATCH_NUMBER",
        new_value={"batch_no": batch.batch_no, "status": batch.status, "sop": "SOP-409"},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(batch)
    return batch


def update_checklist(db: Session, user: CurrentUser, batch_id, payload: ProductionBatchChecklistUpdate) -> ProductionBatch:
    _require_any_permission(user, ("MANAGE_PRODUCTION", "EXECUTE_BMR"))
    batch = get_batch(db, user, batch_id)
    if batch.status == "in_production":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Batch already started")
    for field in ("room_ready", "equipment_ready", "scales_checked", "materials_ready", "qa_line_clearance"):
        setattr(batch, field, getattr(payload, field))
    batch.checklist_updated_by = user.id
    batch.checklist_updated_at = now_utc()
    _update_status_from_gates(batch)
    write_audit(
        db,
        user,
        object_type="production_batch",
        object_id=str(batch.id),
        action_type="UPDATE_START_CHECKLIST",
        new_value={
            "room_ready": batch.room_ready,
            "equipment_ready": batch.equipment_ready,
            "scales_checked": batch.scales_checked,
            "materials_ready": batch.materials_ready,
            "qa_line_clearance": batch.qa_line_clearance,
            "status": batch.status,
        },
    )
    db.commit()
    db.refresh(batch)
    return batch


def start_batch(db: Session, user: CurrentUser, batch_id, payload: ProductionBatchStartRequest) -> ProductionBatch:
    _require_any_permission(user, ("MANAGE_PRODUCTION", "EXECUTE_BMR"))
    batch = get_batch(db, user, batch_id)
    if not batch.bmr_issued_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="BMR must be issued by QA before batch start")
    if not _all_start_checks(batch):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Start checklist is not complete")
    validate_signature(db, user, payload, "START_PRODUCTION_BATCH", "production_batch", str(batch.id))
    batch.status = "in_production"
    batch.started_by = user.id
    batch.started_at = now_utc()
    write_audit(
        db,
        user,
        object_type="production_batch",
        object_id=str(batch.id),
        action_type="START_PRODUCTION_BATCH",
        new_value={"batch_no": batch.batch_no, "status": batch.status},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(batch)
    return batch
