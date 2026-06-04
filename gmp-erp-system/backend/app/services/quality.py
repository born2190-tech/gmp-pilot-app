from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import Lot, ReceiptDocument, ReceiptLine
from app.models.master_data import Manufacturer, Material, Warehouse
from app.models.quality import QCNotification, QCNotificationLine, QCReport, QCReportParameter
from app.schemas.inventory import SignatureRequest
from app.schemas.quality import QADecisionRequest, QCNotificationCreate, QCReportCreate, QCResultRequest, SampleLotRequest
from app.services.audit import write_audit
from app.services.equipment import resolve_equipment_for_report
from app.services.permissions import require_permission, require_warehouse_type_scope
from app.services.signature import validate_signature


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def get_lot(db: Session, lot_id: UUID) -> Lot:
    lot = db.get(Lot, lot_id)
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lot not found")
    return lot


def _require_verified_notification(db: Session, lot: Lot) -> None:
    """Block QC start until the Ф-14 notification for this lot is verified.

    Only enforced for the substance warehouse — packaging and FG flows use
    different incoming-control procedures and don't have a Ф-14.
    """
    warehouse = db.get(Warehouse, lot.warehouse_id)
    if not warehouse or warehouse.warehouse_type != "SUBSTANCE_WAREHOUSE":
        return
    has_verified = (
        db.query(QCNotificationLine.id)
        .join(QCNotification, QCNotification.id == QCNotificationLine.notification_id)
        .filter(QCNotificationLine.lot_id == lot.id, QCNotification.status == "verified")
        .first()
    )
    if not has_verified:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "QC analysis can be started only after the wet-ink-signed Ф-14 "
                "notification has been uploaded by ДКК and verified by ДОК."
            ),
        )


def _require_verified_sampling_act(db: Session, lot: Lot) -> None:
    """Лабораторный анализ нельзя начать, пока акт отбора (СОП-533/548 Ф-10)
    не подписан (status='verified'). Закрывает дыру: результат анализа не
    может быть введён раньше физического отбора пробы.
    """
    from app.models.quality import SamplingAct

    has_verified = (
        db.query(SamplingAct.id)
        .filter(SamplingAct.lot_id == lot.id, SamplingAct.status == "verified")
        .first()
    )
    if not has_verified:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Невозможно начать анализ: акт отбора средней пробы "
                "(СОП-533/548 Ф-10) не оформлен или не подписан. Сначала "
                "оформите акт, загрузите подписанный скан и подтвердите его."
            ),
        )


def sample_lot(db: Session, user: CurrentUser, lot_id: UUID, payload: SampleLotRequest) -> Lot:
    require_permission(user, "ENTER_QC_RESULT")
    lot = get_lot(db, lot_id)
    if lot.quality_status != "quarantine":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only quarantine lots can be sampled")

    # GMP gate (hybrid stage, СОП-209): a lot from the substance warehouse
    # can only be sampled after a Ф-14 notification has been printed, signed
    # in wet ink and the scan verified by ДОК. Without a verified scan the
    # chain of custody is broken and QC analysis must not start.
    _require_verified_notification(db, lot)

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
    _require_verified_sampling_act(db, lot)

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
    _require_verified_sampling_act(db, lot)
    if db.query(QCReport).filter(QCReport.report_no == payload.report_no).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QC report number already exists")

    # Реестр КИП: валидируем выбранные приборы (шапка отчёта + per-row).
    # Просроченная/отсутствующая калибровка блокирует сохранение (GMP Annex 15).
    header_equipments = resolve_equipment_for_report(db, payload.equipment_ids)
    per_row_ids = [p.equipment_id for p in payload.parameters if p.equipment_id is not None]
    resolve_equipment_for_report(db, per_row_ids)

    report = QCReport(
        lot_id=lot.id,
        report_no=payload.report_no,
        status="draft",
        method_reference=payload.method_reference,
        analysis_started_at=payload.analysis_started_at,
        analysis_finished_at=payload.analysis_finished_at,
        equipment=payload.equipment,
        room_temp=payload.room_temp,
        humidity=payload.humidity,
        micro_required=payload.micro_required,
        micro_method_reference=payload.micro_method_reference,
        micro_started_at=payload.micro_started_at,
        micro_finished_at=payload.micro_finished_at,
    )
    if header_equipments:
        report.equipments = header_equipments
    db.add(report)
    db.flush()
    for parameter in payload.parameters:
        db.add(
            QCReportParameter(
                report_id=report.id,
                category=parameter.category,
                parameter_name=parameter.parameter_name,
                specification=parameter.specification,
                result_value=parameter.result_value,
                unit=parameter.unit,
                method_reference=parameter.method_reference,
                complies=parameter.complies,
                equipment_id=parameter.equipment_id,
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

    # OOS / РНС (СОП-549): при вердикте «НЕ соответствует» автоматически
    # открываем расследование несоответствия (если ещё не открыто по протоколу).
    if overall_result == "does_not_comply":
        from app.models.quality import OOSInvestigation

        exists = db.query(OOSInvestigation).filter(OOSInvestigation.report_id == report.id).first()
        if not exists:
            failed = [p for p in parameters if not p.complies]
            summary = "; ".join(
                f"{p.parameter_name}: {p.result_value}{(' ' + p.unit) if p.unit else ''} (норма: {p.specification})"
                for p in failed
            )
            seq = db.query(OOSInvestigation).count() + 1
            number = f"РНС-{report.submitted_at.strftime('%Y%m%d')}-{seq:03d}"
            db.add(
                OOSInvestigation(
                    number=number,
                    report_id=report.id,
                    lot_id=lot.id,
                    status="open",
                    failed_summary=summary[:4000],
                    opened_by=user.id,
                    opened_at=report.submitted_at,
                )
            )
            write_audit(
                db, user, object_type="oos_investigation", object_id=str(report.id),
                action_type="OPEN_OOS", new_value={"number": number, "lot_id": str(lot.id)},
            )
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

    # OOS / РНС: пока есть открытое расследование несоответствия — допуск
    # серии запрещён (СОП-549). Расследование должно быть закрыто.
    if payload.decision == "released":
        from app.services.oos import has_open_oos

        if has_open_oos(db, lot.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Допуск невозможен: по серии открыто расследование OOS/РНС (СОП-549). Закройте расследование.",
            )

        # Допуск серии заблокирован, пока ДОК не верифицировал подписанный
        # аналитический лист (Ф-11): если скан загружен, но его последняя
        # версия не подтверждена ДОК (мокрые подписи, 4-eyes) — допуск нельзя.
        from app.models.quality import QCReport
        from app.services.qc_report_scans import latest_scan

        report = (
            db.query(QCReport)
            .filter(QCReport.lot_id == lot.id)
            .order_by(QCReport.submitted_at.desc().nullslast(), QCReport.created_at.desc())
            .first()
        )
        if report is not None:
            last_scan = latest_scan(db, report.id)
            if last_scan is not None and last_scan.status != "verified":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Допуск невозможен: подписанный аналитический лист (Ф-11) ещё не верифицирован ДОК.",
                )

    validate_signature(db, user, payload, "QA_DECISION", "lot", str(lot.id))
    old_status = lot.quality_status
    lot.quality_status = payload.decision
    lot.qa_decision_at = now_utc()
    # ДОПУСК физически НЕ перемещает партию и НЕ переносит счёт: это решение ОКК,
    # а перемещение в зону допущенных делает склад сам в «Операциях склада»
    # (там же переносится стоимость на счёт допущенных). Отклонение переносим на
    # счёт брака сразу (склад брак отдельно в RELEASED не двигает).
    if payload.decision != "released":
        from app.services.accounts import move_lot_account, zone_for_status

        move_lot_account(
            db,
            lot,
            zone_for_status(lot.quality_status),
            user_id=user.id,
            workstation_id=user.workstation_id,
            document_type="lot",
            document_id=lot.id,
            reason=payload.reason,
        )
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


def _populate_notification_lines(db: Session, notification: QCNotification, receipt: ReceiptDocument, lines, *, strict: bool) -> int:
    """Заполняет строки извещения по строкам прихода (по созданным партиям).
    strict=True → бросает, если партия не найдена; иначе пропускает строку."""
    added = 0
    for line in lines:
        material = db.get(Material, line.material_id)
        manufacturer = db.get(Manufacturer, line.manufacturer_id)
        lot = db.query(Lot).filter(Lot.receipt_line_id == line.id).first()
        if not lot:
            lot = (
                db.query(Lot)
                .filter(Lot.material_id == line.material_id, Lot.warehouse_id == receipt.warehouse_id)
                .filter((Lot.supplier_lot == line.supplier_lot) | (Lot.internal_lot == (line.supplier_lot or "")))
                .order_by(Lot.created_at.desc())
                .first()
            )
        if not lot:
            lot = (
                db.query(Lot)
                .filter(Lot.material_id == line.material_id, Lot.expiry_date == line.expiry_date)
                .order_by(Lot.created_at.desc())
                .first()
            )
        if not lot:
            if strict:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Lot for material {material.code if material else line.material_id} not found — post the receipt first",
                )
            continue
        db.add(
            QCNotificationLine(
                notification_id=notification.id,
                lot_id=lot.id,
                material_name=material.name if material else "",
                batch_number=line.supplier_lot or lot.internal_lot,
                expiry_date=line.expiry_date.isoformat(),
                quantity=line.quantity,
                unit=line.unit,
                manufacturer_name=manufacturer.name if manufacturer else "",
                invoice_info=f"{receipt.document_no} от {receipt.received_date.isoformat()}",
            )
        )
        added += 1
    return added


QC_NOTIFICATION_WAREHOUSES = {"SUBSTANCE_WAREHOUSE", "PACKAGING_WAREHOUSE"}


def list_eligible_receipts_for_notification(db: Session, user: CurrentUser) -> list[dict]:
    """Проведённые приходы сырья/упаковки, по которым ещё НЕ создано извещение
    (Ф-14). Источник для ручного создания извещения складом во вкладке «Извещения»."""
    require_permission(user, "POST_RECEIPT")
    notified = db.query(QCNotification.receipt_id)
    query = (
        db.query(ReceiptDocument)
        .join(Warehouse, Warehouse.id == ReceiptDocument.warehouse_id)
        .filter(
            ReceiptDocument.status == "posted",
            Warehouse.warehouse_type.in_(QC_NOTIFICATION_WAREHOUSES),
            ~ReceiptDocument.id.in_(notified),
        )
        .order_by(ReceiptDocument.posted_at.desc().nullslast())
        .limit(100)
    )
    if user.warehouse_scope:
        query = query.filter(Warehouse.warehouse_type == user.warehouse_scope)
    rows = query.all()
    out: list[dict] = []
    for r in rows:
        n = db.query(func.count(ReceiptLine.id)).filter(ReceiptLine.receipt_id == r.id).scalar() or 0
        out.append({
            "receipt_id": r.id,
            "document_no": r.document_no,
            "received_date": r.received_date,
            "lines": int(n),
        })
    return out


def create_qc_notification(db: Session, user: CurrentUser, payload: QCNotificationCreate) -> QCNotification:
    """Manually create a QC notification (Извещение) for a posted receipt.

    Form Ф-14 к СОП-209 — printed by the warehouse and handed
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
    if warehouse.warehouse_type not in QC_NOTIFICATION_WAREHOUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="QC notification (Ф-14 СОП-209) is only issued for substance or packaging warehouses",
        )

    # Извещение теперь создаётся автоматически при проведении прихода — если оно
    # уже есть для этого прихода, возвращаем его (идемпотентно), а не ошибку.
    existing = db.query(QCNotification).filter(QCNotification.receipt_id == receipt.id).first()
    if existing:
        return existing

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

    _populate_notification_lines(db, notification, receipt, lines, strict=True)

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
