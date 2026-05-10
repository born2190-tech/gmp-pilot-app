from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import Lot
from app.schemas.quality import QADecisionRequest, QCResultRequest, SampleLotRequest
from app.services.audit import write_audit
from app.services.permissions import require_permission
from app.services.signature import validate_signature


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def get_lot(db: Session, lot_id: UUID) -> Lot:
    lot = db.get(Lot, lot_id)
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lot not found")
    return lot


def sample_lot(db: Session, user: CurrentUser, lot_id: UUID, payload: SampleLotRequest) -> Lot:
    require_permission(user, "ENTER_QC_RESULT")
    lot = get_lot(db, lot_id)
    if lot.quality_status != "quarantine":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only quarantine lots can be sampled")

    old_status = lot.quality_status
    lot.quality_status = "sampled"
    lot.sampling_date = now_utc()
    write_audit(
        db,
        user,
        object_type="lot",
        object_id=str(lot.id),
        action_type="SAMPLE_LOT",
        old_value={"quality_status": old_status, "sampling_date": None},
        new_value={"quality_status": lot.quality_status, "sampling_date": lot.sampling_date.isoformat()},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(lot)
    return lot


def submit_qc_result(db: Session, user: CurrentUser, lot_id: UUID, payload: QCResultRequest) -> Lot:
    require_permission(user, "ENTER_QC_RESULT")
    lot = get_lot(db, lot_id)
    if lot.quality_status not in {"sampled", "under_test"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QC result requires a sampled lot")

    validate_signature(db, user, payload, "SUBMIT_QC_RESULT", "lot", str(lot.id))
    old_status = lot.quality_status
    lot.quality_status = "under_test"
    lot.qc_result_received_at = now_utc()
    write_audit(
        db,
        user,
        object_type="lot",
        object_id=str(lot.id),
        action_type="SUBMIT_QC_RESULT",
        old_value={"quality_status": old_status, "qc_result_received_at": None},
        new_value={
            "quality_status": lot.quality_status,
            "qc_result_received_at": lot.qc_result_received_at.isoformat(),
            "result_summary": payload.result_summary,
        },
        reason=payload.reason,
    )
    db.commit()
    db.refresh(lot)
    return lot


def qa_decision(db: Session, user: CurrentUser, lot_id: UUID, payload: QADecisionRequest) -> Lot:
    require_permission(user, "QA_DECISION")
    lot = get_lot(db, lot_id)
    if lot.quality_status != "under_test" or not lot.qc_result_received_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QA decision requires received QC result")

    validate_signature(db, user, payload, "QA_DECISION", "lot", str(lot.id))
    old_status = lot.quality_status
    lot.quality_status = payload.decision
    lot.qa_decision_at = now_utc()
    write_audit(
        db,
        user,
        object_type="lot",
        object_id=str(lot.id),
        action_type="QA_DECISION",
        old_value={"quality_status": old_status, "qa_decision_at": None},
        new_value={"quality_status": lot.quality_status, "qa_decision_at": lot.qa_decision_at.isoformat()},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(lot)
    return lot
