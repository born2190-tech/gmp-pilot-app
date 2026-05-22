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
    QADecisionRequest,
    QCNotificationItem,
    QCNotificationLineItem,
    QCNotificationsResponse,
    QCReportCreate,
    QCReportItem,
    QCReportParameterItem,
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
