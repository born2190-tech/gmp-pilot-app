from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import Lot, ReceiptDocument, ReceiptLine
from app.models.master_data import Manufacturer, Material, Warehouse
from app.models.quality import QCNotification, QCNotificationLine, QCReport, QCReportParameter
from app.schemas.inventory import SignatureRequest
from app.schemas.quality import QADecisionRequest, QCNotificationCreate, QCReportCreate, QCResultRequest, SampleLotRequest
from app.services.audit import write_audit
from app.services.permissions import require_permission, require_warehouse_type_scope
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


def generate_qc_notification_no(receipt: ReceiptDocument) -> str:
    return f"IQC-{receipt.received_date.strftime('%Y%m%d')}-{receipt.document_no}"[:64]


def create_qc_notification(db: Session, user: CurrentUser, payload: QCNotificationCreate) -> QCNotification:
    """Manually create a QC notification (Извещение) for a posted receipt.

    Form Ф-14 к СОП-209 — printed by the substance warehouse and handed
    to the QC manager so they can sample lots that just entered quarantine.
    """
    require_permission(user, "POST_RECEIPT")
    receipt = db.get(ReceiptDocument, payload.receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt not found")
    if receipt.status != "posted":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only posted receipts can be notified to QC")
    warehouse = db.get(Warehouse, receipt.warehouse_id)
    require_warehouse_type_scope(user, warehouse.warehouse_type)
    if warehouse.warehouse_type != "SUBSTANCE_WAREHOUSE":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="QC notification (Ф-14 СОП-209) is only issued for the substance warehouse",
        )

    notification_no = (payload.notification_no or "").strip() or generate_qc_notification_no(receipt)
    if db.query(QCNotification).filter(QCNotification.notification_no == notification_no).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Notification number already exists")

    lines = db.query(ReceiptLine).filter(ReceiptLine.receipt_id == receipt.id).order_by(ReceiptLine.created_at).all()
    if not lines:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Receipt has no lines")

    notification = QCNotification(
        notification_no=notification_no,
        status="created",
        warehouse_id=receipt.warehouse_id,
        receipt_id=receipt.id,
        created_by=user.id,
        notified_at=now_utc(),
    )
    db.add(notification)
    db.flush()

    for line in lines:
        material = db.get(Material, line.material_id)
        manufacturer = db.get(Manufacturer, line.manufacturer_id)
        lot = (
            db.query(Lot)
            .filter(Lot.material_id == line.material_id, Lot.warehouse_id == receipt.warehouse_id)
            .filter((Lot.supplier_lot == line.supplier_lot) | (Lot.internal_lot == (line.supplier_lot or "")))
            .order_by(Lot.created_at.desc())
            .first()
        )
        if not lot:
            # Fallback: any lot from this receipt's material with matching expiry.
            lot = (
                db.query(Lot)
                .filter(Lot.material_id == line.material_id, Lot.expiry_date == line.expiry_date)
                .order_by(Lot.created_at.desc())
                .first()
            )
        if not lot:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Lot for material {material.code} not found — post the receipt first",
            )
        db.add(
            QCNotificationLine(
                notification_id=notification.id,
                lot_id=lot.id,
                material_name=material.name,
                batch_number=line.supplier_lot or lot.internal_lot,
                expiry_date=line.expiry_date.isoformat(),
                quantity=line.quantity,
                unit=line.unit,
                manufacturer_name=manufacturer.name,
                invoice_info=f"{receipt.document_no} от {receipt.received_date.isoformat()}",
            )
        )

    write_audit(
        db,
        user,
        object_type="qc_notification",
        object_id=str(notification.id),
        action_type="CREATE_QC_NOTIFICATION",
        new_value={
            "notification_no": notification.notification_no,
            "receipt_document_no": receipt.document_no,
            "warehouse_type": warehouse.warehouse_type,
            "lines": len(lines),
        },
        reason=payload.reason,
    )
    db.commit()
    db.refresh(notification)
    return notification


def get_qc_notification(db: Session, user: CurrentUser, notification_id: UUID) -> QCNotification:
    if "VIEW_WAREHOUSE" not in user.permissions and "VIEW_QC" not in user.permissions:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission VIEW_WAREHOUSE or VIEW_QC is required")
    notification = db.get(QCNotification, notification_id)
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC notification not found")
    warehouse = db.get(Warehouse, notification.warehouse_id)
    if user.warehouse_scope and warehouse.warehouse_type != user.warehouse_scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Notification is out of scope")
    return notification
