from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import Lot
from app.models.quality import QCReport, QCReportParameter
from app.schemas.inventory import SignatureRequest
from app.schemas.quality import QADecisionRequest, QCReportCreate, QCResultRequest, SampleLotRequest
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


def create_qc_report(db: Session, user: CurrentUser, payload: QCReportCreate) -> QCReport:
    require_permission(user, "ENTER_QC_RESULT")
    lot = get_lot(db, payload.lot_id)
    if lot.quality_status not in {"sampled", "under_test"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QC report requires sampled lot")
    if db.query(QCReport).filter(QCReport.report_no == payload.report_no).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QC report number already exists")

    report = QCReport(
        lot_id=lot.id,
        report_no=payload.report_no,
        status="draft",
        method_reference=payload.method_reference,
        analysis_started_at=payload.analysis_started_at,
        analysis_finished_at=payload.analysis_finished_at,
    )
    db.add(report)
    db.flush()
    for parameter in payload.parameters:
        db.add(
            QCReportParameter(
                report_id=report.id,
                parameter_name=parameter.parameter_name,
                specification=parameter.specification,
                result_value=parameter.result_value,
                unit=parameter.unit,
                method_reference=parameter.method_reference,
                complies=parameter.complies,
            )
        )
    write_audit(
        db,
        user,
        object_type="qc_report",
        object_id=str(report.id),
        action_type="CREATE_QC_REPORT",
        new_value={"report_no": report.report_no, "lot_id": str(lot.id), "parameters": len(payload.parameters)},
    )
    db.commit()
    db.refresh(report)
    return report


def submit_qc_report(db: Session, user: CurrentUser, report_id: UUID, signature: SignatureRequest) -> QCReport:
    require_permission(user, "ENTER_QC_RESULT")
    report = db.get(QCReport, report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC report not found")
    if report.status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft QC report can be submitted")
    lot = get_lot(db, report.lot_id)
    if lot.quality_status not in {"sampled", "under_test"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QC report requires sampled lot")

    parameters = db.query(QCReportParameter).filter(QCReportParameter.report_id == report.id).all()
    if not parameters:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QC report must contain parameters")

    validate_signature(db, user, signature, "SUBMIT_QC_REPORT", "qc_report", str(report.id))
    overall_result = "complies" if all(parameter.complies for parameter in parameters) else "does_not_comply"
    report.status = "submitted"
    report.overall_result = overall_result
    report.submitted_by = user.id
    report.submitted_at = now_utc()
    old_status = lot.quality_status
    lot.quality_status = "under_test"
    lot.qc_result_received_at = report.submitted_at
    write_audit(
        db,
        user,
        object_type="qc_report",
        object_id=str(report.id),
        action_type="SUBMIT_QC_REPORT",
        old_value={"status": "draft", "lot_quality_status": old_status},
        new_value={"status": report.status, "overall_result": overall_result, "lot_quality_status": lot.quality_status},
        reason=signature.reason,
    )
    db.commit()
    db.refresh(report)
    return report


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
