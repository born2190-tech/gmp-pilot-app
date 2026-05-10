from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.inventory import Lot
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.schemas.quality import QADecisionRequest, QCResultRequest, QualityLotItem, QualityLotsResponse, SampleLotRequest
from app.services.permissions import require_permission
from app.services.quality import qa_decision, sample_lot, submit_qc_result

router = APIRouter(prefix="/api/quality", tags=["quality"])


def quality_lot_item(db: Session, lot_id: UUID) -> QualityLotItem:
    row = (
        db.query(
            Lot.id,
            Lot.internal_lot,
            Lot.supplier_lot,
            Material.code.label("material_code"),
            Material.name.label("material_name"),
            Supplier.name.label("supplier_name"),
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
        .join(Supplier, Supplier.id == Lot.supplier_id)
        .join(Manufacturer, Manufacturer.id == Lot.manufacturer_id)
        .join(Warehouse, Warehouse.id == Lot.warehouse_id)
        .join(Location, Location.id == Lot.location_id)
        .filter(Lot.id == lot_id)
        .one()
    )
    return QualityLotItem.model_validate(row)


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
            Lot.supplier_lot,
            Material.code.label("material_code"),
            Material.name.label("material_name"),
            Supplier.name.label("supplier_name"),
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
        .join(Supplier, Supplier.id == Lot.supplier_id)
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
            Lot.supplier_lot,
            Material.code.label("material_code"),
            Material.name.label("material_name"),
            Supplier.name.label("supplier_name"),
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
        .join(Supplier, Supplier.id == Lot.supplier_id)
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
