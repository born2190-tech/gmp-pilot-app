from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import func, literal
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.inventory import Lot
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.models.quality import QCNotification, QCNotificationLine, QCReportParameter
from app.schemas.inventory import SignatureRequest
from app.schemas.quality import (
    MaterialSpecificationInput,
    MaterialSpecificationItem,
    MaterialSpecificationListItem,
    MaterialSpecificationsResponse,
    OOSCloseRequest,
    OOSItem,
    OOSListResponse,
    OOSUpdateRequest,
    QADecisionRequest,
    QCNotificationItem,
    QCNotificationLineItem,
    QCNotificationsResponse,
    QCReportCreate,
    QCReportItem,
    QCReportListItem,
    QCReportParameterItem,
    QCReportsListResponse,
    QCResultRequest,
    QualityLotItem,
    QualityLotsResponse,
    SampleLotRequest,
    SamplingActCreate,
    SamplingActItem,
    SamplingActPost,
    SamplingActsResponse,
)
from app.services.permissions import require_permission
from app.services.quality import create_qc_report, qa_decision, sample_lot, submit_qc_report, submit_qc_result
from app.services import sampling_acts as sampling_service
from app.services import specifications as spec_service
from app.services.sampling_act_pdf import render_sampling_act_pdf

router = APIRouter(prefix="/api/quality", tags=["quality"])


def _sampling_item(db: Session, act) -> SamplingActItem:
    return SamplingActItem.model_validate(sampling_service.build_item(db, act))


def quality_lot_item(db: Session, lot_id: UUID) -> QualityLotItem:
    row = (
        db.query(
            Lot.id,
            func.coalesce(Lot.supplier_lot, literal("")).label("internal_lot"),
            func.coalesce(Lot.supplier_lot, literal("")).label("supplier_lot"),
            Material.code.label("material_code"),
            func.coalesce(func.nullif(Material.name, ""), Material.code).label("material_name"),
            func.coalesce(Supplier.name, "-").label("supplier_name"),
            Manufacturer.name.label("manufacturer_name"),
            Warehouse.warehouse_type,
            Location.code.label("location_code"),
            Lot.quantity,
            Lot.unit,
            Lot.quality_status,
            Lot.production_date,
            Lot.production_year,
            Lot.expiry_date,
            Lot.incoming_control_notified_at,
            Lot.sampling_date,
            Lot.qc_result_received_at,
            Lot.qa_decision_at,
            Material.sample_pc_qty,
            Material.sample_micro_qty,
            Material.sample_archive_qty,
            Material.sample_stability_qty,
            Material.sample_unit,
        )
        .join(Material, Material.id == Lot.material_id)
        .outerjoin(Supplier, Supplier.id == Lot.supplier_id)
        .join(Manufacturer, Manufacturer.id == Lot.manufacturer_id)
        .join(Warehouse, Warehouse.id == Lot.warehouse_id)
        .join(Location, Location.id == Lot.location_id)
        .filter(Lot.id == lot_id)
        .one()
    )
    return QualityLotItem.model_validate(row)


def qc_report_item(db: Session, report_id: UUID) -> QCReportItem:
    from app.models.quality import QCReport

    report = db.get(QCReport, report_id)
    parameters = db.query(QCReportParameter).filter(QCReportParameter.report_id == report_id).order_by(QCReportParameter.created_at).all()
    item = QCReportItem.model_validate(report)
    item.parameters = [QCReportParameterItem.model_validate(parameter) for parameter in parameters]
    return item


def qc_notification_item(db: Session, notification: QCNotification) -> QCNotificationItem:
    warehouse = db.get(Warehouse, notification.warehouse_id)
    lines = db.query(QCNotificationLine).filter(QCNotificationLine.notification_id == notification.id).order_by(QCNotificationLine.created_at).all()
    return QCNotificationItem(
        id=notification.id,
        notification_no=notification.notification_no,
        status=notification.status,
        warehouse_type=warehouse.warehouse_type,
        notified_at=notification.notified_at,
        lines=[QCNotificationLineItem.model_validate(line) for line in lines],
    )


@router.get("/qc-notifications", response_model=QCNotificationsResponse)
def list_qc_notifications(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCNotificationsResponse:
    if "VIEW_WAREHOUSE" not in current_user.permissions and "VIEW_QC" not in current_user.permissions:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission VIEW_WAREHOUSE or VIEW_QC is required")

    query = db.query(QCNotification).join(Warehouse, Warehouse.id == QCNotification.warehouse_id)
    if current_user.warehouse_scope:
        query = query.filter(Warehouse.warehouse_type == current_user.warehouse_scope)
    notifications = query.order_by(QCNotification.notified_at.desc()).all()
    return QCNotificationsResponse(notifications=[qc_notification_item(db, item) for item in notifications])


@router.get("/qc/lots", response_model=QualityLotsResponse)
def list_qc_lots(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QualityLotsResponse:
    require_permission(current_user, "VIEW_QC")
    rows = (
        db.query(
            Lot.id,
            func.coalesce(Lot.supplier_lot, literal("")).label("internal_lot"),
            func.coalesce(Lot.supplier_lot, literal("")).label("supplier_lot"),
            Material.code.label("material_code"),
            func.coalesce(func.nullif(Material.name, ""), Material.code).label("material_name"),
            func.coalesce(Supplier.name, "-").label("supplier_name"),
            Manufacturer.name.label("manufacturer_name"),
            Warehouse.warehouse_type,
            Location.code.label("location_code"),
            Lot.quantity,
            Lot.unit,
            Lot.quality_status,
            Lot.production_date,
            Lot.production_year,
            Lot.expiry_date,
            Lot.incoming_control_notified_at,
            Lot.sampling_date,
            Lot.qc_result_received_at,
            Lot.qa_decision_at,
            Material.sample_pc_qty,
            Material.sample_micro_qty,
            Material.sample_archive_qty,
            Material.sample_stability_qty,
            Material.sample_unit,
        )
        .join(Material, Material.id == Lot.material_id)
        .outerjoin(Supplier, Supplier.id == Lot.supplier_id)
        .join(Manufacturer, Manufacturer.id == Lot.manufacturer_id)
        .join(Warehouse, Warehouse.id == Lot.warehouse_id)
        .join(Location, Location.id == Lot.location_id)
        .filter(Lot.quality_status.in_(["quarantine", "sampled", "under_test"]))
        .order_by(Lot.incoming_control_notified_at.asc(), Lot.created_at.desc())
        .all()
    )
    return QualityLotsResponse(lots=rows)


@router.get("/qa/lots", response_model=QualityLotsResponse)
def list_qa_lots(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QualityLotsResponse:
    require_permission(current_user, "VIEW_QA")
    rows = (
        db.query(
            Lot.id,
            func.coalesce(Lot.supplier_lot, literal("")).label("internal_lot"),
            func.coalesce(Lot.supplier_lot, literal("")).label("supplier_lot"),
            Material.code.label("material_code"),
            func.coalesce(func.nullif(Material.name, ""), Material.code).label("material_name"),
            func.coalesce(Supplier.name, "-").label("supplier_name"),
            Manufacturer.name.label("manufacturer_name"),
            Warehouse.warehouse_type,
            Location.code.label("location_code"),
            Lot.quantity,
            Lot.unit,
            Lot.quality_status,
            Lot.production_date,
            Lot.production_year,
            Lot.expiry_date,
            Lot.incoming_control_notified_at,
            Lot.sampling_date,
            Lot.qc_result_received_at,
            Lot.qa_decision_at,
        )
        .join(Material, Material.id == Lot.material_id)
        .outerjoin(Supplier, Supplier.id == Lot.supplier_id)
        .join(Manufacturer, Manufacturer.id == Lot.manufacturer_id)
        .join(Warehouse, Warehouse.id == Lot.warehouse_id)
        .join(Location, Location.id == Lot.location_id)
        .filter(Lot.quality_status == "under_test", Lot.qc_result_received_at.is_not(None))
        .order_by(Lot.qc_result_received_at.asc(), Lot.created_at.desc())
        .all()
    )
    return QualityLotsResponse(lots=rows)


@router.post("/lots/{lot_id}/sample", response_model=QualityLotItem)
def sample_lot_route(
    lot_id: UUID,
    payload: SampleLotRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QualityLotItem:
    lot = sample_lot(db, current_user, lot_id, payload)
    return quality_lot_item(db, lot.id)


@router.post("/lots/{lot_id}/qc-result", response_model=QualityLotItem)
def submit_qc_result_route(
    lot_id: UUID,
    payload: QCResultRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QualityLotItem:
    lot = submit_qc_result(db, current_user, lot_id, payload)
    return quality_lot_item(db, lot.id)


@router.post("/lots/{lot_id}/qa-decision", response_model=QualityLotItem)
def qa_decision_route(
    lot_id: UUID,
    payload: QADecisionRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QualityLotItem:
    lot = qa_decision(db, current_user, lot_id, payload)
    return quality_lot_item(db, lot.id)


@router.post("/qc-reports", response_model=QCReportItem, status_code=201)
def create_qc_report_route(
    payload: QCReportCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCReportItem:
    report = create_qc_report(db, current_user, payload)
    return qc_report_item(db, report.id)


@router.post("/qc-reports/{report_id}/submit", response_model=QCReportItem)
def submit_qc_report_route(
    report_id: UUID,
    payload: SignatureRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCReportItem:
    report = submit_qc_report(db, current_user, report_id, payload)
    return qc_report_item(db, report.id)


def _build_qc_report_data(db: Session, report) -> dict:
    """Собирает данные для PDF аналитического листа из протокола + партии."""
    lot = db.get(Lot, report.lot_id)
    material = db.get(Material, lot.material_id) if lot else None
    manufacturer = db.get(Manufacturer, lot.manufacturer_id) if lot else None
    warehouse = db.get(Warehouse, lot.warehouse_id) if lot else None
    sop_form = "548" if (warehouse and warehouse.warehouse_type == "FG_WAREHOUSE") else "533"
    params = (
        db.query(QCReportParameter)
        .filter(QCReportParameter.report_id == report.id)
        .order_by(QCReportParameter.created_at)
        .all()
    )
    def _serialize(p) -> dict:
        return {
            "parameter_name": p.parameter_name,
            "specification": p.specification,
            "result_value": p.result_value,
            "unit": p.unit,
            "method_reference": p.method_reference,
            "complies": p.complies,
        }

    pc_params = [_serialize(p) for p in params if (getattr(p, "category", None) or "physicochemical") != "microbiological"]
    micro_params = [_serialize(p) for p in params if getattr(p, "category", None) == "microbiological"]
    return {
        "report_no": report.report_no,
        "sop_form": sop_form,
        "method_reference": report.method_reference,
        "analysis_started_at": report.analysis_started_at,
        "analysis_finished_at": report.analysis_finished_at,
        "overall_result": report.overall_result,
        "equipment": report.equipment,
        "room_temp": report.room_temp,
        "humidity": report.humidity,
        "micro_required": report.micro_required,
        "micro_method_reference": report.micro_method_reference,
        "micro_started_at": report.micro_started_at,
        "micro_finished_at": report.micro_finished_at,
        "material_name": material.name if material else None,
        "internal_lot": (lot.supplier_lot or lot.internal_lot) if lot else None,
        "manufacturer_name": manufacturer.name if manufacturer else None,
        "production_date": lot.production_date if lot else None,
        "expiry_date": lot.expiry_date if lot else None,
        "sampling_date": lot.sampling_date if lot else None,
        # Обратная совместимость: общий список + раздельные ФХ/микро.
        "parameters": pc_params + micro_params,
        "pc_parameters": pc_params,
        "micro_parameters": micro_params,
    }


def _qc_report_pdf_response(db: Session, report, inline: bool) -> Response:
    from app.services.qc_report_pdf import render_qc_report_pdf

    pdf_bytes = render_qc_report_pdf(_build_qc_report_data(db, report))
    filename = f"analytical-sheet-{report.report_no}.pdf"
    disposition = "inline" if inline else "attachment"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"{disposition}; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/lots/{lot_id}/qc-report/pdf")
def lot_qc_report_pdf(
    lot_id: UUID,
    inline: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Аналитический лист ОКК (Ф-11) для партии — последний поданный протокол."""
    require_permission(current_user, "VIEW_WAREHOUSE")
    from app.models.quality import QCReport

    report = (
        db.query(QCReport)
        .filter(QCReport.lot_id == lot_id)
        .order_by(QCReport.submitted_at.desc().nullslast(), QCReport.created_at.desc())
        .first()
    )
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC report not found for this lot")
    return _qc_report_pdf_response(db, report, inline)


@router.get("/lots/{lot_id}/qc-report/scan")
def lot_qc_report_scan(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Скан подписанного аналитического листа (Ф-11) для партии."""
    require_permission(current_user, "VIEW_WAREHOUSE")
    from app.models.quality import QCReport
    from app.services.qc_report_scans import latest_scan, load_scan_file

    report = (
        db.query(QCReport)
        .filter(QCReport.lot_id == lot_id)
        .order_by(QCReport.submitted_at.desc().nullslast(), QCReport.created_at.desc())
        .first()
    )
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC report not found for this lot")
    scan = latest_scan(db, report.id)
    if not scan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Скан аналитического листа ещё не приложен (приложите его в разделе ОКК)",
        )
    raw, mime = load_scan_file(db, current_user, scan.id)
    return Response(content=raw, media_type=mime)


@router.get("/qc-reports", response_model=QCReportsListResponse)
def list_qc_reports_route(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCReportsListResponse:
    """Список аналитических листов (поданные протоколы ОКК) для дашборда."""
    require_permission(current_user, "VIEW_QC")
    from app.models.quality import QCReport

    reports = (
        db.query(QCReport)
        .filter(QCReport.status == "submitted")
        .order_by(QCReport.submitted_at.desc().nullslast(), QCReport.created_at.desc())
        .all()
    )
    from app.services.qc_report_scans import latest_scan

    items: list[QCReportListItem] = []
    for r in reports:
        lot = db.get(Lot, r.lot_id)
        material = db.get(Material, lot.material_id) if lot else None
        manufacturer = db.get(Manufacturer, lot.manufacturer_id) if lot else None
        scan = latest_scan(db, r.id)
        items.append(
            QCReportListItem(
                id=r.id,
                lot_id=r.lot_id,
                report_no=r.report_no,
                status=r.status,
                overall_result=r.overall_result,
                submitted_at=r.submitted_at,
                internal_lot=(lot.supplier_lot or lot.internal_lot) if lot else None,
                material_name=material.name if material else None,
                manufacturer_name=manufacturer.name if manufacturer else None,
                scan_id=scan.id if scan else None,
                scan_sha256=scan.sha256_hash if scan else None,
            )
        )
    return QCReportsListResponse(reports=items)


@router.post("/qc-reports/{report_id}/scan", response_model=QCReportListItem)
async def upload_qc_report_scan_route(
    report_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCReportListItem:
    """Загрузка скана подписанного аналитического листа (Ф-11)."""
    from app.models.quality import QCReport
    from app.services.qc_report_scans import latest_scan, upload_report_scan

    await upload_report_scan(db, current_user, report_id, file)
    r = db.get(QCReport, report_id)
    lot = db.get(Lot, r.lot_id) if r else None
    material = db.get(Material, lot.material_id) if lot else None
    manufacturer = db.get(Manufacturer, lot.manufacturer_id) if lot else None
    scan = latest_scan(db, report_id)
    return QCReportListItem(
        id=r.id,
        lot_id=r.lot_id,
        report_no=r.report_no,
        status=r.status,
        overall_result=r.overall_result,
        submitted_at=r.submitted_at,
        internal_lot=(lot.supplier_lot or lot.internal_lot) if lot else None,
        material_name=material.name if material else None,
        manufacturer_name=manufacturer.name if manufacturer else None,
        scan_id=scan.id if scan else None,
        scan_sha256=scan.sha256_hash if scan else None,
    )


@router.get("/qc-report-scans/{scan_id}/file")
def download_qc_report_scan_route(
    scan_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    from app.services.qc_report_scans import load_scan_file

    raw, mime = load_scan_file(db, current_user, scan_id)
    return Response(content=raw, media_type=mime)


@router.get("/qc-reports/{report_id}/pdf")
def qc_report_pdf_route(
    report_id: UUID,
    inline: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Аналитический лист ОКК (Ф-11) по конкретному протоколу."""
    require_permission(current_user, "VIEW_QC")
    from app.models.quality import QCReport

    report = db.get(QCReport, report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QC report not found")
    return _qc_report_pdf_response(db, report, inline)


# ---------------------------------------------------------------------------
# Sampling acts — СОП-533 / СОП-548 Ф-10
# ---------------------------------------------------------------------------


@router.get("/sampling-acts", response_model=SamplingActsResponse)
def list_sampling_acts_route(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SamplingActsResponse:
    acts = sampling_service.list_sampling_acts(db, current_user, status_filter)
    return SamplingActsResponse(sampling_acts=[_sampling_item(db, a) for a in acts])


@router.get("/lots/{lot_id}/sampling-act", response_model=SamplingActItem | None)
def get_sampling_act_for_lot_route(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SamplingActItem | None:
    require_permission(current_user, "VIEW_QC")
    act = sampling_service.get_act_for_lot(db, lot_id)
    return _sampling_item(db, act) if act else None


@router.post("/sampling-acts", response_model=SamplingActItem, status_code=201)
def create_sampling_act_route(
    payload: SamplingActCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SamplingActItem:
    act = sampling_service.create_sampling_act(db, current_user, payload)
    return _sampling_item(db, act)


@router.get("/sampling-acts/{act_id}", response_model=SamplingActItem)
def get_sampling_act_route(
    act_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SamplingActItem:
    act = sampling_service.get_sampling_act(db, current_user, act_id)
    return _sampling_item(db, act)


@router.put("/sampling-acts/{act_id}", response_model=SamplingActItem)
def update_sampling_act_route(
    act_id: UUID,
    payload: SamplingActCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SamplingActItem:
    act = sampling_service.update_sampling_act(db, current_user, act_id, payload)
    return _sampling_item(db, act)


@router.post("/sampling-acts/{act_id}/scans", response_model=SamplingActItem)
async def upload_sampling_scan_route(
    act_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SamplingActItem:
    await sampling_service.upload_scan(db, current_user, act_id, file)
    act = sampling_service.get_sampling_act(db, current_user, act_id)
    return _sampling_item(db, act)


@router.get("/sampling-scans/{scan_id}/file")
def download_sampling_scan_route(
    scan_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    raw, mime = sampling_service.load_scan_file(db, current_user, scan_id)
    return Response(content=raw, media_type=mime)


@router.post("/sampling-acts/{act_id}/cancel", response_model=SamplingActItem)
def cancel_sampling_act_route(
    act_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SamplingActItem:
    act = sampling_service.cancel_sampling_act(db, current_user, act_id)
    return _sampling_item(db, act)


@router.post("/sampling-acts/{act_id}/post", response_model=SamplingActItem)
def post_sampling_act_route(
    act_id: UUID,
    payload: SamplingActPost,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> SamplingActItem:
    act = sampling_service.post_sampling_act(db, current_user, act_id, payload)
    return _sampling_item(db, act)


@router.get("/sampling-acts/{act_id}/pdf")
def sampling_act_pdf_route(
    act_id: UUID,
    inline: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    act = sampling_service.get_sampling_act(db, current_user, act_id)
    data = sampling_service.build_item(db, act)
    pdf_bytes = render_sampling_act_pdf(data)
    filename = f"sampling-act-{act.act_no}.pdf"
    disposition = "inline" if inline else "attachment"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"{disposition}; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
            )
        },
    )


# ---------------------------------------------------------------------------
# Material specifications (НД) registry
# ---------------------------------------------------------------------------


def _spec_list_item(spec) -> MaterialSpecificationListItem:
    return MaterialSpecificationListItem(
        id=spec.id,
        nd_code=spec.nd_code,
        revision=spec.revision,
        material_name=spec.material_name,
        material_id=spec.material_id,
        sop_form=spec.sop_form,
        micro_required=spec.micro_required,
        is_active=spec.is_active,
        effective_date=spec.effective_date,
        parameters_count=len(spec.parameters),
    )


@router.get("/specifications", response_model=MaterialSpecificationsResponse)
def list_specifications_route(
    include_inactive: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MaterialSpecificationsResponse:
    require_permission(current_user, "VIEW_QC")
    specs = spec_service.list_specifications(db, include_inactive=include_inactive)
    return MaterialSpecificationsResponse(specifications=[_spec_list_item(s) for s in specs])


@router.get("/specifications/{spec_id}", response_model=MaterialSpecificationItem)
def get_specification_route(
    spec_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MaterialSpecificationItem:
    require_permission(current_user, "VIEW_QC")
    spec = spec_service.get_specification(db, spec_id)
    return MaterialSpecificationItem.model_validate(spec)


@router.post("/specifications", response_model=MaterialSpecificationItem, status_code=201)
def create_specification_route(
    payload: MaterialSpecificationInput,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MaterialSpecificationItem:
    spec = spec_service.create_specification(db, current_user, payload)
    return MaterialSpecificationItem.model_validate(spec)


@router.put("/specifications/{spec_id}", response_model=MaterialSpecificationItem)
def update_specification_route(
    spec_id: UUID,
    payload: MaterialSpecificationInput,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MaterialSpecificationItem:
    spec = spec_service.update_specification(db, current_user, spec_id, payload)
    return MaterialSpecificationItem.model_validate(spec)


@router.delete("/specifications/{spec_id}", status_code=204)
def delete_specification_route(
    spec_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    spec_service.delete_specification(db, current_user, spec_id)
    return Response(status_code=204)


@router.get("/lots/{lot_id}/specification", response_model=MaterialSpecificationItem | None)
def resolve_lot_specification_route(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MaterialSpecificationItem | None:
    """Подбирает спецификацию (НД) для материала партии — для «Загрузить шаблон»."""
    require_permission(current_user, "VIEW_QC")
    lot = db.get(Lot, lot_id)
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lot not found")
    spec = spec_service.resolve_for_lot(db, lot)
    return MaterialSpecificationItem.model_validate(spec) if spec else None


# ---------------------------------------------------------------------------
# OOS / РНС — расследование несоответствия (СОП-549)
# ---------------------------------------------------------------------------


def _oos_item(db: Session, row) -> OOSItem:
    from app.models.quality import QCReport

    lot = db.get(Lot, row.lot_id)
    material = db.get(Material, lot.material_id) if lot else None
    report = db.get(QCReport, row.report_id)
    item = OOSItem.model_validate(row)
    item.internal_lot = (lot.supplier_lot or lot.internal_lot) if lot else None
    item.material_name = material.name if material else None
    item.report_no = report.report_no if report else None
    return item


@router.get("/oos", response_model=OOSListResponse)
def list_oos_route(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> OOSListResponse:
    require_permission(current_user, "VIEW_QC")
    from app.services import oos as oos_service

    rows = oos_service.list_oos(db, status_filter)
    return OOSListResponse(investigations=[_oos_item(db, r) for r in rows])


@router.put("/oos/{oos_id}", response_model=OOSItem)
def update_oos_route(
    oos_id: UUID,
    payload: OOSUpdateRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> OOSItem:
    from app.services import oos as oos_service

    row = oos_service.update_oos(db, current_user, oos_id, payload)
    return _oos_item(db, row)


@router.post("/oos/{oos_id}/close", response_model=OOSItem)
def close_oos_route(
    oos_id: UUID,
    payload: OOSCloseRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> OOSItem:
    from app.services import oos as oos_service

    row = oos_service.close_oos(db, current_user, oos_id, payload)
    return _oos_item(db, row)
