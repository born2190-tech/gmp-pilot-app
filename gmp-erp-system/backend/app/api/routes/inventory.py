from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.inventory import FGShipmentDocument, FGShipmentLine, InventoryCountDocument, InventoryCountLine, InventoryMovement, Lot
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.schemas.inventory import (
    AdjustLotRequest,
    FGShipmentCreate,
    FGShipmentItem,
    FGShipmentLineItem,
    FGShipmentsResponse,
    InventoryCountCreate,
    InventoryCountItem,
    InventoryCountLineItem,
    InventoryCountsResponse,
    IssueProductionRequest,
    LotOperationResponse,
    LotsResponse,
    MovementsResponse,
    PostReceiptResponse,
    ReceiptCreate,
    ReceiptResponse,
    SignatureRequest,
    TransferLotRequest,
)
from app.services.inventory import adjust_lot, create_fg_shipment, create_inventory_count, create_receipt_draft, issue_to_production, post_receipt, transfer_lot
from app.services.permissions import require_permission

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


def lot_item_query(db: Session, lot_id: UUID) -> LotOperationResponse:
    row = (
        db.query(
            Lot.id,
            Lot.internal_lot,
            func.coalesce(Lot.supplier_lot, "-").label("supplier_lot"),
            Material.code.label("material_code"),
            Material.name.label("material_name"),
            func.coalesce(Supplier.name, "-").label("supplier_name"),
            Manufacturer.name.label("manufacturer_name"),
            Lot.warehouse_id,
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
    return LotOperationResponse.model_validate(row)


def shipment_item(db: Session, shipment: FGShipmentDocument) -> FGShipmentItem:
    rows = (
        db.query(
            FGShipmentLine.lot_id,
            Lot.internal_lot,
            Material.code.label("material_code"),
            Material.name.label("material_name"),
            Lot.production_date,
            Lot.expiry_date,
            FGShipmentLine.quantity,
            FGShipmentLine.unit,
            FGShipmentLine.quantity_after,
        )
        .join(Lot, Lot.id == FGShipmentLine.lot_id)
        .join(Material, Material.id == Lot.material_id)
        .filter(FGShipmentLine.shipment_id == shipment.id)
        .order_by(FGShipmentLine.created_at)
        .all()
    )
    return FGShipmentItem(
        id=shipment.id,
        document_no=shipment.document_no,
        status=shipment.status,
        customer_name=shipment.customer_name,
        customer_tax_id=shipment.customer_tax_id,
        destination_address=shipment.destination_address,
        shipment_date=shipment.shipment_date,
        vehicle_no=shipment.vehicle_no,
        waybill_no=shipment.waybill_no,
        posted_at=shipment.posted_at,
        lines=[FGShipmentLineItem.model_validate(row) for row in rows],
    )


def count_item(db: Session, count: InventoryCountDocument) -> InventoryCountItem:
    warehouse = db.get(Warehouse, count.warehouse_id)
    rows = (
        db.query(
            InventoryCountLine.lot_id,
            Lot.internal_lot,
            Material.code.label("material_code"),
            InventoryCountLine.system_quantity,
            InventoryCountLine.actual_quantity,
            InventoryCountLine.variance,
            InventoryCountLine.unit,
        )
        .join(Lot, Lot.id == InventoryCountLine.lot_id)
        .join(Material, Material.id == Lot.material_id)
        .filter(InventoryCountLine.count_id == count.id)
        .order_by(InventoryCountLine.created_at)
        .all()
    )
    return InventoryCountItem(
        id=count.id,
        document_no=count.document_no,
        status=count.status,
        warehouse_type=warehouse.warehouse_type if warehouse else "",
        count_date=count.count_date,
        posted_at=count.posted_at,
        lines=[InventoryCountLineItem.model_validate(row) for row in rows],
    )


@router.post("/receipts", response_model=ReceiptResponse)
def create_receipt(
    payload: ReceiptCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReceiptResponse:
    receipt = create_receipt_draft(db, current_user, payload)
    return ReceiptResponse(id=receipt.id, document_no=receipt.document_no, status=receipt.status)


@router.post("/receipts/{receipt_id}/post", response_model=PostReceiptResponse)
def post_receipt_route(
    receipt_id: UUID,
    payload: SignatureRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> PostReceiptResponse:
    receipt, lots_created = post_receipt(db, current_user, receipt_id, payload)
    return PostReceiptResponse(id=receipt.id, document_no=receipt.document_no, status=receipt.status, lots_created=lots_created)


@router.post("/lots/{lot_id}/transfer", response_model=LotOperationResponse)
def transfer_lot_route(
    lot_id: UUID,
    payload: TransferLotRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> LotOperationResponse:
    lot = transfer_lot(db, current_user, lot_id, payload)
    return lot_item_query(db, lot.id)


@router.post("/lots/{lot_id}/adjust", response_model=LotOperationResponse)
def adjust_lot_route(
    lot_id: UUID,
    payload: AdjustLotRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> LotOperationResponse:
    lot = adjust_lot(db, current_user, lot_id, payload)
    return lot_item_query(db, lot.id)


@router.post("/lots/{lot_id}/issue-production", response_model=LotOperationResponse)
def issue_to_production_route(
    lot_id: UUID,
    payload: IssueProductionRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> LotOperationResponse:
    lot = issue_to_production(db, current_user, lot_id, payload)
    return lot_item_query(db, lot.id)


@router.post("/fg-shipments", response_model=FGShipmentItem)
def create_fg_shipment_route(
    payload: FGShipmentCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> FGShipmentItem:
    shipment = create_fg_shipment(db, current_user, payload)
    return shipment_item(db, shipment)


@router.get("/fg-shipments", response_model=FGShipmentsResponse)
def list_fg_shipments(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> FGShipmentsResponse:
    require_permission(current_user, "VIEW_WAREHOUSE")
    query = db.query(FGShipmentDocument).order_by(FGShipmentDocument.posted_at.desc())
    if current_user.warehouse_scope and current_user.warehouse_scope != "FG_WAREHOUSE":
        return FGShipmentsResponse(shipments=[])
    return FGShipmentsResponse(shipments=[shipment_item(db, shipment) for shipment in query.all()])


@router.post("/counts", response_model=InventoryCountItem)
def create_inventory_count_route(
    payload: InventoryCountCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryCountItem:
    count = create_inventory_count(db, current_user, payload)
    return count_item(db, count)


@router.get("/counts", response_model=InventoryCountsResponse)
def list_inventory_counts(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryCountsResponse:
    require_permission(current_user, "VIEW_WAREHOUSE")
    query = db.query(InventoryCountDocument).join(Warehouse, Warehouse.id == InventoryCountDocument.warehouse_id).order_by(InventoryCountDocument.posted_at.desc())
    if current_user.warehouse_scope:
        query = query.filter(Warehouse.warehouse_type == current_user.warehouse_scope)
    return InventoryCountsResponse(counts=[count_item(db, count) for count in query.all()])


@router.get("/lots", response_model=LotsResponse)
def list_lots(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> LotsResponse:
    require_permission(current_user, "VIEW_WAREHOUSE")
    query = (
        db.query(
            Lot.id,
            Lot.internal_lot,
            func.coalesce(Lot.supplier_lot, "-").label("supplier_lot"),
            Material.code.label("material_code"),
            Material.name.label("material_name"),
            func.coalesce(Supplier.name, "-").label("supplier_name"),
            Manufacturer.name.label("manufacturer_name"),
            Lot.warehouse_id,
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
        .order_by(Lot.created_at.desc())
    )
    if current_user.warehouse_scope:
        query = query.filter(Warehouse.warehouse_type == current_user.warehouse_scope)
    return LotsResponse(lots=query.all())


@router.get("/movements", response_model=MovementsResponse)
def list_movements(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> MovementsResponse:
    require_permission(current_user, "VIEW_WAREHOUSE")
    query = (
        db.query(
            InventoryMovement.id,
            InventoryMovement.movement_type,
            InventoryMovement.document_type,
            InventoryMovement.document_id,
            Lot.internal_lot,
            Material.code.label("material_code"),
            InventoryMovement.quantity_delta,
            InventoryMovement.quantity_after,
            InventoryMovement.unit,
            InventoryMovement.reason,
            InventoryMovement.workstation_id,
            InventoryMovement.created_at,
        )
        .join(Lot, Lot.id == InventoryMovement.lot_id)
        .join(Material, Material.id == Lot.material_id)
        .join(Warehouse, Warehouse.id == Lot.warehouse_id)
        .order_by(InventoryMovement.created_at.desc())
    )
    if current_user.warehouse_scope:
        query = query.filter(Warehouse.warehouse_type == current_user.warehouse_scope)
    return MovementsResponse(movements=query.all())
