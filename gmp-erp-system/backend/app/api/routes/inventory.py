from datetime import date
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy import String, cast, func, literal, or_
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.inventory import (
    FGShipmentDocument,
    FGShipmentLine,
    InventoryCountDocument,
    InventoryCountLine,
    InventoryCountWave,
    InventoryCountWaveLine,
    InventoryMovement,
    Lot,
    ReceiptDefect,
    ReceiptDefectPhoto,
    ReceiptDocument,
    ReceiptLine,
)
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.models.identity import User
from app.models.quality import QCNotification, QCNotificationLine, QCNotificationScan, QCReport
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
    InventoryWaveCancelRequest,
    InventoryWaveItem,
    InventoryWaveLineItem,
    InventoryWaveLineUpdate,
    InventoryWavePostRequest,
    InventoryWaveStartRequest,
    InventoryWaveSubmitRequest,
    InventoryWaveVerifyRequest,
    InventoryWavesResponse,
    IssueProductionRequest,
    ReceiptDefectCreate,
    ReceiptDefectItem,
    ReceiptDefectPhotoItem,
    ReceiptDefectStatusUpdate,
    ReceiptDefectsResponse,
    LotOperationResponse,
    LotsResponse,
    MovementsResponse,
    PostReceiptResponse,
    ReceiptCreate,
    ReceiptResponse,
    SignatureRequest,
    TransferLotRequest,
)
from app.schemas.quality import (
    QCNotificationCreate,
    QCNotificationItem,
    QCNotificationLineItem,
    QCNotificationScanItem,
    QCNotificationScansResponse,
    QCPendingScanItem,
    QCPendingScansResponse,
    QCScanRejectRequest,
    QCScanVerifyRequest,
)
from app.services.inventory import adjust_lot, create_fg_shipment, create_inventory_count, create_receipt_draft, issue_to_production, post_receipt, transfer_lot
from app.services.inventory_count_pdf import render_inventory_count_pdf
from app.services.lot_ledger_card_pdf import render_lot_ledger_card_pdf
from app.services.receipt_defect_pdf import render_receipt_defect_pdf
from app.services.receipt_defects import (
    create_defect as create_defect_service,
    get_defect as get_defect_service,
    list_defects as list_defects_service,
    list_photos as list_photos_service,
    load_photo_file as load_photo_service,
    set_status as set_defect_status_service,
    upload_photo as upload_photo_service,
)
from app.services.inventory_count_waves import (
    cancel_wave as cancel_wave_service,
    get_wave as get_wave_service,
    list_waves as list_waves_service,
    post_wave as post_wave_service,
    save_line as save_line_service,
    start_wave as start_wave_service,
    submit_for_verification as submit_wave_service,
    verify_line as verify_line_service,
)
from app.services.permissions import require_permission
from app.services.qc_notification_pdf import render_qc_notification_pdf
from app.services.qc_notification_scans import (
    compute_state_hash,
    list_scans,
    load_scan_file,
    make_qr_payload,
    record_print_event,
    reject_scan,
    upload_scan,
    verify_scan,
)
from app.services.quality import create_qc_notification, get_qc_notification

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


def lot_item_query(db: Session, lot_id: UUID) -> LotOperationResponse:
    latest_qc_report_no = (
        db.query(QCReport.report_no)
        .filter(QCReport.lot_id == Lot.id, QCReport.status == "submitted")
        .order_by(QCReport.submitted_at.desc(), QCReport.created_at.desc())
        .limit(1)
        .correlate(Lot)
        .scalar_subquery()
    )
    row = (
        db.query(
            Lot.id,
            Lot.internal_lot.label("internal_lot"),
            func.coalesce(Lot.supplier_lot, literal("-")).label("supplier_lot"),
            Material.code.label("material_code"),
            func.coalesce(func.nullif(Material.name, ""), Material.code).label("material_name"),
            func.coalesce(Supplier.name, "-").label("supplier_name"),
            Manufacturer.name.label("manufacturer_name"),
            Lot.warehouse_id,
            Warehouse.warehouse_type,
            Location.code.label("location_code"),
            Lot.rack_no,
            Lot.sector_no,
            Lot.tier_no,
            Lot.place_no,
            Lot.pallet_no,
            Lot.quantity,
            Lot.initial_quantity,
            Lot.unit,
            Lot.quality_status,
            Lot.production_date,
            Lot.production_year,
            Lot.expiry_date,
            Lot.incoming_control_notified_at,
            Lot.sampling_date,
            Lot.qc_result_received_at,
            latest_qc_report_no.label("qc_report_no"),
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
            Lot.internal_lot.label("internal_lot"),
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
            Lot.internal_lot.label("internal_lot"),
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
    date_type: str = Query(default="arrival", pattern="^(arrival|expiry)$"),
    date_from: date | None = None,
    date_to: date | None = None,
    material: str | None = None,
    quality_status: str | None = None,
    location: str | None = None,
    manufacturer: str | None = None,
    internal_lot: str | None = None,
    supplier_lot: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> LotsResponse:
    require_permission(current_user, "VIEW_WAREHOUSE")
    latest_qc_report_no = (
        db.query(QCReport.report_no)
        .filter(QCReport.lot_id == Lot.id, QCReport.status == "submitted")
        .order_by(QCReport.submitted_at.desc(), QCReport.created_at.desc())
        .limit(1)
        .correlate(Lot)
        .scalar_subquery()
    )
    query = (
        db.query(
            Lot.id,
            Lot.internal_lot.label("internal_lot"),
            func.coalesce(Lot.supplier_lot, literal("-")).label("supplier_lot"),
            Material.code.label("material_code"),
            func.coalesce(func.nullif(Material.name, ""), Material.code).label("material_name"),
            func.coalesce(Supplier.name, "-").label("supplier_name"),
            Manufacturer.name.label("manufacturer_name"),
            Lot.warehouse_id,
            Warehouse.warehouse_type,
            Location.code.label("location_code"),
            Lot.rack_no,
            Lot.sector_no,
            Lot.tier_no,
            Lot.place_no,
            Lot.pallet_no,
            Lot.quantity,
            Lot.initial_quantity,
            Lot.unit,
            Lot.quality_status,
            Lot.production_date,
            Lot.production_year,
            Lot.expiry_date,
            Lot.incoming_control_notified_at,
            Lot.sampling_date,
            Lot.qc_result_received_at,
            latest_qc_report_no.label("qc_report_no"),
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

    if material:
        like = f"%{material.strip().lower()}%"
        query = query.filter(or_(func.lower(Material.code).like(like), func.lower(Material.name).like(like)))
    if quality_status:
        query = query.filter(Lot.quality_status == quality_status)
    if location:
        query = query.filter(func.lower(Location.code).like(f"%{location.strip().lower()}%"))
    if manufacturer:
        query = query.filter(func.lower(Manufacturer.name).like(f"%{manufacturer.strip().lower()}%"))
    if internal_lot:
        query = query.filter(func.lower(func.coalesce(Lot.supplier_lot, Lot.internal_lot)).like(f"%{internal_lot.strip().lower()}%"))
    if supplier_lot:
        query = query.filter(func.lower(func.coalesce(Lot.supplier_lot, Lot.internal_lot)).like(f"%{supplier_lot.strip().lower()}%"))

    date_field = Lot.expiry_date if date_type == "expiry" else func.date(Lot.incoming_control_notified_at)
    if date_from:
        query = query.filter(date_field >= date_from)
    if date_to:
        query = query.filter(date_field <= date_to)

    if search:
        like = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(func.coalesce(Lot.supplier_lot, Lot.internal_lot)).like(like),
                func.lower(Material.code).like(like),
                func.lower(Material.name).like(like),
                func.lower(Manufacturer.name).like(like),
                func.lower(Location.code).like(like),
            )
        )

    return LotsResponse(lots=query.all())


@router.get("/movements", response_model=MovementsResponse)
def list_movements(
    date_from: date | None = None,
    date_to: date | None = None,
    material: str | None = None,
    internal_lot: str | None = None,
    supplier_lot: str | None = None,
    document: str | None = None,
    movement_type: str | None = None,
    search: str | None = None,
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
            Lot.internal_lot.label("internal_lot"),
            func.coalesce(Lot.supplier_lot, literal("-")).label("supplier_lot"),
            Material.code.label("material_code"),
            func.coalesce(func.nullif(Material.name, ""), Material.code).label("material_name"),
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

    if date_from:
        query = query.filter(func.date(InventoryMovement.created_at) >= date_from)
    if date_to:
        query = query.filter(func.date(InventoryMovement.created_at) <= date_to)
    if material:
        like = f"%{material.strip().lower()}%"
        query = query.filter(or_(func.lower(Material.code).like(like), func.lower(Material.name).like(like)))
    if internal_lot:
        query = query.filter(func.lower(func.coalesce(Lot.supplier_lot, Lot.internal_lot)).like(f"%{internal_lot.strip().lower()}%"))
    if supplier_lot:
        query = query.filter(func.lower(func.coalesce(Lot.supplier_lot, Lot.internal_lot)).like(f"%{supplier_lot.strip().lower()}%"))
    if document:
        like = f"%{document.strip().lower()}%"
        query = query.filter(or_(func.lower(InventoryMovement.document_type).like(like), func.lower(cast(InventoryMovement.document_id, String)).like(like)))
    if movement_type:
        query = query.filter(InventoryMovement.movement_type == movement_type)
    if search:
        like = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(func.coalesce(Lot.supplier_lot, Lot.internal_lot)).like(like),
                func.lower(Material.code).like(like),
                func.lower(Material.name).like(like),
                func.lower(InventoryMovement.document_type).like(like),
                func.lower(func.coalesce(InventoryMovement.reason, "")).like(like),
                func.lower(InventoryMovement.movement_type).like(like),
            )
        )

    return MovementsResponse(movements=query.all())


# ---------------------------------------------------------------------------
# Registry KPIs and Excel exports
# ---------------------------------------------------------------------------


@router.get("/lots/kpis")
def lots_kpis(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Aggregate counters for the warehouse registry: active / quarantine / low stock."""
    require_permission(current_user, "VIEW_WAREHOUSE")
    base = (
        db.query(Lot)
        .join(Warehouse, Warehouse.id == Lot.warehouse_id)
    )
    if current_user.warehouse_scope:
        base = base.filter(Warehouse.warehouse_type == current_user.warehouse_scope)

    active = base.filter(Lot.quality_status == "released", Lot.quantity > 0).count()
    quarantine = base.filter(Lot.quality_status == "quarantine").count()
    rejected = base.filter(Lot.quality_status == "rejected").count()
    # «Мало остатков» — released лоты, у которых остаток < 10% от исходного.
    low_stock = base.filter(
        Lot.quality_status == "released",
        Lot.quantity > 0,
        Lot.initial_quantity > 0,
        Lot.quantity < Lot.initial_quantity * 0.10,
    ).count()
    total = base.count()
    return {
        "active": active,
        "quarantine": quarantine,
        "rejected": rejected,
        "low_stock": low_stock,
        "total": total,
        "low_stock_threshold_pct": 10,
    }


@router.get("/lots/export.xlsx")
def export_lots(
    columns: str = Query("", description="Comma-separated column ids; empty = all"),
    material: str | None = None,
    quality_status: str | None = None,
    location: str | None = None,
    manufacturer: str | None = None,
    internal_lot: str | None = None,
    supplier_lot: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    date_type: str = Query("arrival", pattern="^(arrival|expiry)$"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    require_permission(current_user, "VIEW_WAREHOUSE")
    from app.services.registry_export import export_lots_xlsx

    cols = [c.strip() for c in columns.split(",") if c.strip()]
    blob = export_lots_xlsx(
        db,
        current_user,
        columns=cols,
        material=material,
        quality_status=quality_status,
        location=location,
        manufacturer=manufacturer,
        internal_lot=internal_lot,
        supplier_lot=supplier_lot,
        date_from=date_from,
        date_to=date_to,
        date_type=date_type,
    )
    filename = f"lots-{date.today().isoformat()}.xlsx"
    return Response(
        content=blob,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
            )
        },
    )


@router.get("/movements/export.xlsx")
def export_movements(
    columns: str = Query("", description="Comma-separated column ids; empty = all"),
    material: str | None = None,
    internal_lot: str | None = None,
    supplier_lot: str | None = None,
    document: str | None = None,
    movement_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    require_permission(current_user, "VIEW_WAREHOUSE")
    from app.services.registry_export import export_movements_xlsx

    cols = [c.strip() for c in columns.split(",") if c.strip()]
    blob = export_movements_xlsx(
        db,
        current_user,
        columns=cols,
        material=material,
        internal_lot=internal_lot,
        supplier_lot=supplier_lot,
        document=document,
        movement_type=movement_type,
        date_from=date_from,
        date_to=date_to,
    )
    filename = f"movements-{date.today().isoformat()}.xlsx"
    return Response(
        content=blob,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
            )
        },
    )


# ---------------------------------------------------------------------------
# QC notification — Извещение (Ф-14 к СОП-209)
# ---------------------------------------------------------------------------


def _qc_notification_item(db: Session, notification: QCNotification) -> QCNotificationItem:
    warehouse = db.get(Warehouse, notification.warehouse_id)
    lines = (
        db.query(QCNotificationLine)
        .filter(QCNotificationLine.notification_id == notification.id)
        .order_by(QCNotificationLine.created_at)
        .all()
    )
    return QCNotificationItem(
        id=notification.id,
        notification_no=notification.notification_no,
        status=notification.status,
        warehouse_type=warehouse.warehouse_type,
        notified_at=notification.notified_at,
        lines=[QCNotificationLineItem.model_validate(line) for line in lines],
    )


@router.post("/qc-notifications", response_model=QCNotificationItem, status_code=201)
def create_qc_notification_route(
    payload: QCNotificationCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCNotificationItem:
    notification = create_qc_notification(db, current_user, payload)
    return _qc_notification_item(db, notification)


@router.get("/qc-notifications/{notification_id}/pdf")
def qc_notification_pdf_route(
    notification_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    notification = get_qc_notification(db, current_user, notification_id)
    warehouse = db.get(Warehouse, notification.warehouse_id)
    lines = (
        db.query(QCNotificationLine)
        .filter(QCNotificationLine.notification_id == notification.id)
        .order_by(QCNotificationLine.created_at)
        .all()
    )
    state_hash = notification.state_hash or compute_state_hash(notification, lines)
    qr_payload = make_qr_payload(notification.id, state_hash)
    pdf_bytes = render_qc_notification_pdf(notification, warehouse, lines, qr_payload=qr_payload)
    # Record first-print event — moves status created → printed, stamps user/time.
    record_print_event(db, current_user, notification, state_hash)
    # Notification numbers may contain non-ASCII (e.g. "№"); HTTP headers are
    # latin-1 only, so use RFC 5987 filename* with a sanitised ASCII fallback.
    raw_name = f"izveshchenie-{notification.notification_no}.pdf"
    ascii_fallback = raw_name.encode("ascii", "replace").decode("ascii").replace("?", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{quote(raw_name)}"
            )
        },
    )


# ---------------------------------------------------------------------------
# QC notification scans (Ф-14 true-copy chain of custody)
# ---------------------------------------------------------------------------


def _scan_item(scan: QCNotificationScan) -> QCNotificationScanItem:
    return QCNotificationScanItem.model_validate(scan)


@router.post(
    "/qc-notifications/{notification_id}/scans",
    response_model=QCNotificationScanItem,
    status_code=201,
)
async def upload_qc_scan_route(
    notification_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCNotificationScanItem:
    scan = await upload_scan(db, current_user, notification_id, file)
    return _scan_item(scan)


@router.get(
    "/qc-notifications/{notification_id}/scans",
    response_model=QCNotificationScansResponse,
)
def list_qc_scans_route(
    notification_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCNotificationScansResponse:
    scans = list_scans(db, current_user, notification_id)
    notification = db.get(QCNotification, notification_id)
    return QCNotificationScansResponse(
        notification_id=notification.id,
        notification_no=notification.notification_no,
        notification_status=notification.status,
        scans=[_scan_item(scan) for scan in scans],
    )


@router.get("/qc-notifications/scans/{scan_id}/file")
def download_qc_scan_route(
    scan_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    scan, blob = load_scan_file(db, current_user, scan_id)
    raw_name = f"qc-scan-{scan.notification_id}-v{scan.version}.pdf"
    return Response(
        content=blob,
        media_type=scan.mime_type or "application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="{raw_name}"; '
                f"filename*=UTF-8''{quote(raw_name)}"
            )
        },
    )


@router.post(
    "/qc-notifications/scans/{scan_id}/verify",
    response_model=QCNotificationScanItem,
)
def verify_qc_scan_route(
    scan_id: UUID,
    payload: QCScanVerifyRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCNotificationScanItem:
    scan = verify_scan(
        db,
        current_user,
        scan_id,
        signature_warehouse_ok=payload.signature_warehouse_ok,
        signature_qc_ok=payload.signature_qc_ok,
        signature_manager_ok=payload.signature_manager_ok,
        remarks=payload.remarks,
        username=payload.username,
        password=payload.password,
        meaning=payload.meaning,
        reason=payload.reason,
    )
    return _scan_item(scan)


@router.post(
    "/qc-notifications/scans/{scan_id}/reject",
    response_model=QCNotificationScanItem,
)
def reject_qc_scan_route(
    scan_id: UUID,
    payload: QCScanRejectRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCNotificationScanItem:
    scan = reject_scan(
        db,
        current_user,
        scan_id,
        remarks=payload.remarks,
        username=payload.username,
        password=payload.password,
        meaning=payload.meaning,
        reason=payload.reason,
    )
    return _scan_item(scan)


@router.get(
    "/qc-notifications/scans/pending",
    response_model=QCPendingScansResponse,
)
def list_pending_qc_scans_route(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> QCPendingScansResponse:
    """Queue for ДОК — all scans waiting for wet-ink signature verification."""
    require_permission(current_user, "VERIFY_QC_SCAN")
    rows = (
        db.query(
            QCNotificationScan.id.label("scan_id"),
            QCNotificationScan.notification_id,
            QCNotification.notification_no,
            Warehouse.warehouse_type,
            QCNotification.notified_at,
            QCNotificationScan.uploaded_at,
            QCNotificationScan.uploaded_by,
            User.full_name.label("uploaded_by_name"),
            QCNotificationScan.version,
            func.count(QCNotificationLine.id).label("lines_count"),
        )
        .join(QCNotification, QCNotification.id == QCNotificationScan.notification_id)
        .join(Warehouse, Warehouse.id == QCNotification.warehouse_id)
        .outerjoin(QCNotificationLine, QCNotificationLine.notification_id == QCNotification.id)
        .outerjoin(User, User.id == QCNotificationScan.uploaded_by)
        .filter(QCNotificationScan.status == "pending_verification")
        .group_by(
            QCNotificationScan.id,
            QCNotificationScan.notification_id,
            QCNotification.notification_no,
            Warehouse.warehouse_type,
            QCNotification.notified_at,
            QCNotificationScan.uploaded_at,
            QCNotificationScan.uploaded_by,
            User.full_name,
            QCNotificationScan.version,
        )
        .order_by(QCNotificationScan.uploaded_at.asc())
        .all()
    )
    return QCPendingScansResponse(scans=[QCPendingScanItem.model_validate(row) for row in rows])


# ---------------------------------------------------------------------------
# Inventory count waves (GMP 4-eyes workflow)
# ---------------------------------------------------------------------------


def _user_name(db: Session, uid: UUID | None) -> str | None:
    if uid is None:
        return None
    u = db.get(User, uid)
    return u.full_name if u else None


def _wave_line_item(db: Session, line: InventoryCountWaveLine) -> InventoryWaveLineItem:
    lot = db.get(Lot, line.lot_id)
    material = db.get(Material, lot.material_id) if lot else None
    location = db.get(Location, lot.location_id) if lot else None
    return InventoryWaveLineItem(
        id=line.id,
        lot_id=line.lot_id,
        internal_lot=lot.internal_lot if lot else "",
        supplier_lot=lot.supplier_lot if lot else None,
        material_code=material.code if material else "",
        material_name=material.name if material else "",
        location_code=location.code if location else "",
        rack_no=lot.rack_no if lot else None,
        sector_no=lot.sector_no if lot else None,
        tier_no=lot.tier_no if lot else None,
        place_no=lot.place_no if lot else None,
        pallet_no=lot.pallet_no if lot else None,
        unit=line.unit,
        status=line.status,
        system_quantity=line.system_quantity,
        actual_quantity=line.actual_quantity,
        variance=line.variance,
        variance_pct=line.variance_pct,
        notes=line.notes,
        counted_by=line.counted_by,
        counted_by_name=_user_name(db, line.counted_by),
        counted_at=line.counted_at,
        verified_by=line.verified_by,
        verified_by_name=_user_name(db, line.verified_by),
        verified_at=line.verified_at,
        verifier_comment=line.verifier_comment,
    )


def _wave_item(db: Session, wave: InventoryCountWave, include_lines: bool = True) -> InventoryWaveItem:
    warehouse = db.get(Warehouse, wave.warehouse_id)
    lines = (
        db.query(InventoryCountWaveLine)
        .filter(InventoryCountWaveLine.wave_id == wave.id)
        .order_by(InventoryCountWaveLine.created_at)
        .all()
    )
    total = len(lines)
    counted = sum(1 for line in lines if line.status != "pending")
    variance = sum(1 for line in lines if line.status == "needs_verification")
    return InventoryWaveItem(
        id=wave.id,
        wave_no=wave.wave_no,
        status=wave.status,
        warehouse_type=warehouse.warehouse_type if warehouse else "",
        warehouse_name=warehouse.name if warehouse else "",
        scope_description=wave.scope_description,
        tolerance_pct=wave.tolerance_pct,
        created_by=wave.created_by,
        created_by_name=_user_name(db, wave.created_by),
        started_at=wave.started_at,
        counters=[c for c in (wave.counters or "").split(",") if c],
        verifier_id=wave.verifier_id,
        verifier_name=_user_name(db, wave.verifier_id),
        submitted_at=wave.submitted_at,
        posted_by=wave.posted_by,
        posted_by_name=_user_name(db, wave.posted_by),
        posted_at=wave.posted_at,
        total_lines=total,
        counted_lines=counted,
        variance_lines=variance,
        lines=[_wave_line_item(db, line) for line in lines] if include_lines else [],
    )


@router.get("/inventory-waves", response_model=InventoryWavesResponse)
def list_inventory_waves_route(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryWavesResponse:
    waves = list_waves_service(db, current_user, status_filter)
    return InventoryWavesResponse(waves=[_wave_item(db, wave, include_lines=False) for wave in waves])


@router.get("/inventory-waves/{wave_id}", response_model=InventoryWaveItem)
def get_inventory_wave_route(
    wave_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryWaveItem:
    wave = get_wave_service(db, current_user, wave_id)
    return _wave_item(db, wave)


@router.post("/inventory-waves", response_model=InventoryWaveItem, status_code=201)
def start_inventory_wave_route(
    payload: InventoryWaveStartRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryWaveItem:
    wave = start_wave_service(db, current_user, payload)
    return _wave_item(db, wave)


@router.post("/inventory-waves/{wave_id}/lines/{line_id}", response_model=InventoryWaveItem)
def save_inventory_wave_line_route(
    wave_id: UUID,
    line_id: UUID,
    payload: InventoryWaveLineUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryWaveItem:
    save_line_service(db, current_user, wave_id, line_id, payload)
    wave = get_wave_service(db, current_user, wave_id)
    return _wave_item(db, wave)


@router.post("/inventory-waves/{wave_id}/submit", response_model=InventoryWaveItem)
def submit_inventory_wave_route(
    wave_id: UUID,
    payload: InventoryWaveSubmitRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryWaveItem:
    wave = submit_wave_service(db, current_user, wave_id, payload)
    return _wave_item(db, wave)


@router.post("/inventory-waves/{wave_id}/lines/{line_id}/verify", response_model=InventoryWaveItem)
def verify_inventory_wave_line_route(
    wave_id: UUID,
    line_id: UUID,
    payload: InventoryWaveVerifyRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryWaveItem:
    verify_line_service(db, current_user, wave_id, line_id, payload)
    wave = get_wave_service(db, current_user, wave_id)
    return _wave_item(db, wave)


@router.post("/inventory-waves/{wave_id}/post", response_model=InventoryWaveItem)
def post_inventory_wave_route(
    wave_id: UUID,
    payload: InventoryWavePostRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryWaveItem:
    wave = post_wave_service(db, current_user, wave_id, payload)
    return _wave_item(db, wave)


@router.post("/inventory-waves/{wave_id}/cancel", response_model=InventoryWaveItem)
def cancel_inventory_wave_route(
    wave_id: UUID,
    payload: InventoryWaveCancelRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryWaveItem:
    wave = cancel_wave_service(db, current_user, wave_id, payload)
    return _wave_item(db, wave)


@router.get("/inventory-waves/{wave_id}/pdf")
def inventory_wave_pdf_route(
    wave_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    wave = get_wave_service(db, current_user, wave_id)
    warehouse = db.get(Warehouse, wave.warehouse_id)
    lines = (
        db.query(InventoryCountWaveLine)
        .filter(InventoryCountWaveLine.wave_id == wave.id)
        .order_by(InventoryCountWaveLine.created_at)
        .all()
    )
    # Eager-load lot + material for the PDF so it can print code/name.
    for line in lines:
        _ = line.lot.material.name if line.lot and line.lot.material else None

    counter_users: list[User] = []
    if wave.counters:
        usernames = [u.strip() for u in wave.counters.split(",") if u.strip()]
        if usernames:
            counter_users = db.query(User).filter(User.username.in_(usernames)).all()
    verifier_user = db.get(User, wave.verifier_id) if wave.verifier_id else None
    posted_by_user = db.get(User, wave.posted_by) if wave.posted_by else None

    name_ids = {line.counted_by for line in lines if line.counted_by} | {
        line.verified_by for line in lines if line.verified_by
    }
    user_names: dict[str, str] = {}
    if name_ids:
        users = db.query(User).filter(User.id.in_(name_ids)).all()
        for u in users:
            user_names[str(u.id)] = u.full_name or u.username

    pdf_bytes = render_inventory_count_pdf(
        wave,
        warehouse,
        lines,
        counter_users,
        verifier_user,
        posted_by_user,
        user_names=user_names,
    )
    raw_name = f"inventory-{wave.wave_no}.pdf"
    ascii_fallback = raw_name.encode("ascii", "replace").decode("ascii").replace("?", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{quote(raw_name)}"
            )
        },
    )


@router.get("/lots/{lot_id}/ledger-card/pdf")
def lot_ledger_card_pdf_route(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    require_permission(current_user, "VIEW_WAREHOUSE")
    lot = db.get(Lot, lot_id)
    if not lot:
        from fastapi import HTTPException, status as http_status

        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Lot not found")
    warehouse = db.get(Warehouse, lot.warehouse_id)
    if current_user.warehouse_scope and warehouse and warehouse.warehouse_type != current_user.warehouse_scope:
        from fastapi import HTTPException, status as http_status

        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Lot is out of warehouse scope")
    material = db.get(Material, lot.material_id)

    # Pre-fill the "Дата получения" and "Количество полученного" boxes from
    # the first RECEIPT movement for this lot, if available — that's the
    # paper card's "initial state" snapshot.
    initial_qty: float | None = None
    initial_date = None
    receipt_move = (
        db.query(InventoryMovement)
        .filter(InventoryMovement.lot_id == lot.id, InventoryMovement.movement_type == "RECEIPT")
        .order_by(InventoryMovement.created_at.asc())
        .first()
    )
    if receipt_move:
        initial_qty = receipt_move.quantity_after
        initial_date = receipt_move.created_at

    pdf_bytes = render_lot_ledger_card_pdf(
        lot=lot,
        material=material,
        warehouse=warehouse,
        initial_quantity=initial_qty,
        initial_date=initial_date,
    )
    raw_name = f"ledger-card-{lot.internal_lot}.pdf"
    ascii_fallback = raw_name.encode("ascii", "replace").decode("ascii").replace("?", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{quote(raw_name)}"
            )
        },
    )


# ---------------------------------------------------------------------------
# Receipt defects (СОП-209 Ф-12)
# ---------------------------------------------------------------------------


def _defect_item(db: Session, defect: ReceiptDefect) -> ReceiptDefectItem:
    line = db.get(ReceiptLine, defect.receipt_line_id) if defect.receipt_line_id else None
    material = db.get(Material, line.material_id) if line else None
    recorded_by = db.get(User, defect.recorded_by) if defect.recorded_by else None
    resolved_by = db.get(User, defect.resolved_by) if defect.resolved_by else None
    photos = (
        db.query(ReceiptDefectPhoto)
        .filter(ReceiptDefectPhoto.defect_id == defect.id)
        .order_by(ReceiptDefectPhoto.uploaded_at)
        .all()
    )
    return ReceiptDefectItem(
        id=defect.id,
        act_no=defect.act_no,
        receipt_id=defect.receipt_id,
        receipt_line_id=defect.receipt_line_id,
        severity=defect.severity,
        description=defect.description,
        status=defect.status,
        recorded_by=defect.recorded_by,
        recorded_by_name=(recorded_by.full_name or recorded_by.username) if recorded_by else None,
        recorded_at=defect.recorded_at,
        resolved_by=defect.resolved_by,
        resolved_by_name=(resolved_by.full_name or resolved_by.username) if resolved_by else None,
        resolved_at=defect.resolved_at,
        resolution_comment=defect.resolution_comment,
        material_code=material.code if material else None,
        material_name=material.name if material else None,
        photos=[ReceiptDefectPhotoItem.model_validate(p) for p in photos],
    )


@router.get(
    "/receipts/{receipt_id}/defects",
    response_model=ReceiptDefectsResponse,
)
def list_receipt_defects_route(
    receipt_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReceiptDefectsResponse:
    defects = list_defects_service(db, current_user, receipt_id)
    return ReceiptDefectsResponse(defects=[_defect_item(db, d) for d in defects])


@router.post(
    "/receipts/{receipt_id}/defects",
    response_model=ReceiptDefectItem,
    status_code=201,
)
def create_receipt_defect_route(
    receipt_id: UUID,
    payload: ReceiptDefectCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReceiptDefectItem:
    defect = create_defect_service(db, current_user, receipt_id, payload)
    return _defect_item(db, defect)


@router.post(
    "/receipt-defects/{defect_id}/status",
    response_model=ReceiptDefectItem,
)
def set_defect_status_route(
    defect_id: UUID,
    payload: ReceiptDefectStatusUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReceiptDefectItem:
    defect = set_defect_status_service(db, current_user, defect_id, payload)
    return _defect_item(db, defect)


@router.post(
    "/receipt-defects/{defect_id}/photos",
    response_model=ReceiptDefectPhotoItem,
    status_code=201,
)
async def upload_defect_photo_route(
    defect_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReceiptDefectPhotoItem:
    photo = await upload_photo_service(db, current_user, defect_id, file)
    return ReceiptDefectPhotoItem.model_validate(photo)


@router.get(
    "/receipt-defect-photos/{photo_id}/file",
)
def download_defect_photo_route(
    photo_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    photo, blob = load_photo_service(db, current_user, photo_id)
    return Response(
        content=blob,
        media_type=photo.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="defect-{photo.id}.bin"'},
    )


@router.get("/receipt-defects/{defect_id}/pdf")
def receipt_defect_pdf_route(
    defect_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    defect = get_defect_service(db, current_user, defect_id)
    receipt = db.get(ReceiptDocument, defect.receipt_id)
    line = db.get(ReceiptLine, defect.receipt_line_id) if defect.receipt_line_id else None
    material = db.get(Material, line.material_id) if line else None
    recorded_by = db.get(User, defect.recorded_by) if defect.recorded_by else None
    resolved_by = db.get(User, defect.resolved_by) if defect.resolved_by else None

    photos = list_photos_service(db, current_user, defect_id)
    photos_with_bytes: list[tuple[ReceiptDefectPhoto, bytes]] = []
    for p in photos:
        try:
            _, raw = load_photo_service(db, current_user, p.id)
            photos_with_bytes.append((p, raw))
        except Exception:
            continue

    pdf = render_receipt_defect_pdf(
        defect=defect,
        receipt=receipt,
        line=line,
        material=material,
        recorded_by=recorded_by,
        resolved_by=resolved_by,
        photos_with_bytes=photos_with_bytes,
    )
    raw_name = f"defect-act-{defect.act_no}.pdf"
    ascii_fallback = raw_name.encode("ascii", "replace").decode("ascii").replace("?", "_")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{quote(raw_name)}"
            )
        },
    )
