from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.inventory import Lot
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.models.quality import QCReportParameter
from app.schemas.inventory import SignatureRequest
from app.schemas.quality import (
    QADecisionRequest,
    QCReportCreate,
    QCReportItem,
    QCReportParameterItem,
    QCResultRequest,
    QualityLotItem,
    QualityLotsResponse,
    SampleLotRequest,
)
from app.services.permissions import require_permission
from app.services.quality import create_qc_report, qa_decision, sample_lot, submit_qc_report, submit_qc_result

router = APIRouter(prefix="/api/quality", tags=["quality"])


def quality_lot_item(db: Session, lot_id: UUID) -> QualityLotItem:
    row = (
        db.query(
            Lot.id,
            Lot.internal_lot,
            func.coalesce(Lot.supplier_lot, "-").label("supplier_lot"),
            Material.code.label("material_code"),
            Material.name.label("material_name"),
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


@router.get("/qc/lots", response_model=QualityLotsResponse)
def list_qc_lots(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QualityLotsResponse:
    require_permission(current_user, "VIEW_QC")
    rows = (
        db.query(
            Lot.id,
            Lot.internal_lot,
            func.coalesce(Lot.supplier_lot, "-").label("supplier_lot"),
            Material.code.label("material_code"),
            Material.name.label("material_name"),
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
            Lot.internal_lot,
            func.coalesce(Lot.supplier_lot, "-").label("supplier_lot"),
            Material.code.label("material_code"),
            Material.name.label("material_name"),
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
