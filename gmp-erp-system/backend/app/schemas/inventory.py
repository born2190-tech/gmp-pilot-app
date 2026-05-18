from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ReferenceCreateInline(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)


class MaterialCreateInline(ReferenceCreateInline):
    item_type: str = Field(min_length=1, max_length=64)
    default_unit: str = Field(min_length=1, max_length=32)


class ReceiptLineCreate(BaseModel):
    material_id: UUID | None = None
    material: MaterialCreateInline | None = None
    supplier_id: UUID | None = None
    supplier: ReferenceCreateInline | None = None
    manufacturer_id: UUID | None = None
    manufacturer: ReferenceCreateInline | None = None
    supplier_lot: str | None = None
    production_date: date | None = None
    production_year: int | None = Field(default=None, ge=2000, le=2100)
    expiry_date: date
    quantity: float = Field(gt=0)
    unit: str = Field(min_length=1)
    location_id: UUID

    @field_validator("material_id", "supplier_id", "manufacturer_id", mode="before")
    @classmethod
    def blank_id_to_none(cls, value):
        return None if value == "" else value


class ReceiptCreate(BaseModel):
    document_no: str = Field(min_length=1)
    supplier_id: UUID | None = None
    supplier: ReferenceCreateInline | None = None
    manufacturer_id: UUID | None = None
    manufacturer: ReferenceCreateInline | None = None
    warehouse_id: UUID
    received_date: date
    lines: list[ReceiptLineCreate] = Field(min_length=1)

    @field_validator("supplier_id", "manufacturer_id", mode="before")
    @classmethod
    def blank_reference_id_to_none(cls, value):
        return None if value == "" else value


class ReceiptResponse(BaseModel):
    id: UUID
    document_no: str
    status: str


class SignatureRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    meaning: str = Field(min_length=1)
    reason: str | None = None


class PostReceiptResponse(BaseModel):
    id: UUID
    document_no: str
    status: str
    lots_created: int


class LotItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    internal_lot: str
    supplier_lot: str
    material_code: str
    material_name: str
    supplier_name: str
    manufacturer_name: str
    warehouse_id: UUID
    warehouse_type: str
    location_code: str
    rack_no: str | None = None
    sector_no: str | None = None
    tier_no: str | None = None
    place_no: str | None = None
    pallet_no: str | None = None
    quantity: float
    initial_quantity: float = 0.0
    unit: str
    quality_status: str
    production_date: date | None
    production_year: int
    expiry_date: date
    incoming_control_notified_at: datetime | None
    sampling_date: datetime | None
    qc_result_received_at: datetime | None
    qc_report_no: str | None = None
    qa_decision_at: datetime | None


class LotsResponse(BaseModel):
    lots: list[LotItem]


class LotOperationResponse(LotItem):
    pass


class TransferLotRequest(SignatureRequest):
    to_location_id: UUID
    # `reason` уже унаследовано из SignatureRequest как str | None; здесь
    # делаем его обязательным (как и раньше) переопределением поля.
    reason: str = Field(min_length=1)
    # Physical destination coordinates (form Ф-3 СОП-415). Empty/null means
    # "not specified" — the corresponding fields on the lot stay unchanged.
    rack_no: str | None = Field(default=None, max_length=32)
    sector_no: str | None = Field(default=None, max_length=32)
    tier_no: str | None = Field(default=None, max_length=32)
    place_no: str | None = Field(default=None, max_length=32)
    pallet_no: str | None = Field(default=None, max_length=32)


class AdjustLotRequest(SignatureRequest):
    new_quantity: float = Field(ge=0)


class IssueProductionRequest(SignatureRequest):
    quantity: float = Field(gt=0)
    production_order_no: str = Field(min_length=1, max_length=128)


class FGShipmentLineCreate(BaseModel):
    lot_id: UUID
    quantity: float = Field(gt=0)


class FGShipmentCreate(SignatureRequest):
    document_no: str = Field(min_length=1, max_length=64)
    customer_name: str = Field(min_length=1, max_length=255)
    customer_tax_id: str | None = Field(default=None, max_length=64)
    destination_address: str = Field(min_length=1, max_length=500)
    shipment_date: date
    vehicle_no: str | None = Field(default=None, max_length=64)
    waybill_no: str | None = Field(default=None, max_length=128)
    lines: list[FGShipmentLineCreate] = Field(min_length=1)


class FGShipmentLineItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lot_id: UUID
    internal_lot: str
    material_code: str
    material_name: str
    production_date: date | None
    expiry_date: date
    quantity: float
    unit: str
    quantity_after: float


class FGShipmentItem(BaseModel):
    id: UUID
    document_no: str
    status: str
    customer_name: str
    customer_tax_id: str | None
    destination_address: str
    shipment_date: date
    vehicle_no: str | None
    waybill_no: str | None
    posted_at: datetime
    lines: list[FGShipmentLineItem]


class FGShipmentsResponse(BaseModel):
    shipments: list[FGShipmentItem]


class InventoryCountLineCreate(BaseModel):
    lot_id: UUID
    actual_quantity: float = Field(ge=0)


# ---------------------------------------------------------------------------
# Inventory count wave (GMP 4-eyes workflow)
# ---------------------------------------------------------------------------

class ReceiptDefectCreate(BaseModel):
    receipt_line_id: UUID | None = None
    severity: str = Field(pattern="^(critical|significant|minor)$")
    description: str = Field(min_length=1, max_length=2000)


class ReceiptDefectStatusUpdate(BaseModel):
    status: str = Field(pattern="^(escalated|resolved|returned)$")
    comment: str | None = Field(default=None, max_length=2000)


class ReceiptDefectPhotoItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    mime_type: str
    file_size: int
    sha256_hash: str
    uploaded_by: UUID
    uploaded_at: datetime


class ReceiptDefectItem(BaseModel):
    id: UUID
    act_no: str
    receipt_id: UUID
    receipt_line_id: UUID | None
    severity: str
    description: str
    status: str
    recorded_by: UUID
    recorded_by_name: str | None
    recorded_at: datetime
    resolved_by: UUID | None
    resolved_by_name: str | None
    resolved_at: datetime | None
    resolution_comment: str | None
    material_code: str | None = None
    material_name: str | None = None
    photos: list[ReceiptDefectPhotoItem] = Field(default_factory=list)


class ReceiptDefectsResponse(BaseModel):
    defects: list[ReceiptDefectItem]


class WaveScope(BaseModel):
    """Defines which lots become part of the wave."""

    warehouse_id: UUID
    # Optional narrowing: only lots in this zone (location code) participate.
    location_code: str | None = Field(default=None, max_length=64)
    # Optional narrowing by physical rack number (Ф-3 СОП-415).
    rack_no: str | None = Field(default=None, max_length=32)
    # Manual override: explicit lot ids. If non-empty, ignore the filters above.
    lot_ids: list[UUID] = Field(default_factory=list)


class InventoryWaveStartRequest(BaseModel):
    wave_no: str | None = Field(default=None, max_length=64)
    scope: WaveScope
    tolerance_pct: float = Field(default=0.5, ge=0, le=100)
    counters: list[str] = Field(default_factory=list)
    verifier_username: str | None = Field(default=None, max_length=128)
    reason: str | None = Field(default=None, max_length=500)


class InventoryWaveLineUpdate(BaseModel):
    actual_quantity: float = Field(ge=0)
    notes: str | None = Field(default=None, max_length=1000)


class InventoryWaveVerifyRequest(BaseModel):
    decision: str = Field(pattern="^(confirm|escalate)$")
    comment: str | None = Field(default=None, max_length=1000)


class InventoryWavePostRequest(SignatureRequest):
    pass


class InventoryWaveCancelRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class InventoryWaveSubmitRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class InventoryWaveLineItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    lot_id: UUID
    internal_lot: str
    supplier_lot: str | None
    material_code: str
    material_name: str
    location_code: str
    rack_no: str | None
    sector_no: str | None
    tier_no: str | None
    place_no: str | None
    pallet_no: str | None
    unit: str
    status: str
    system_quantity: float
    actual_quantity: float | None
    variance: float | None
    variance_pct: float | None
    notes: str | None
    counted_by: UUID | None
    counted_by_name: str | None
    counted_at: datetime | None
    verified_by: UUID | None
    verified_by_name: str | None
    verified_at: datetime | None
    verifier_comment: str | None


class InventoryWaveItem(BaseModel):
    id: UUID
    wave_no: str
    status: str
    warehouse_type: str
    warehouse_name: str
    scope_description: str
    tolerance_pct: float
    created_by: UUID
    created_by_name: str | None
    started_at: datetime
    counters: list[str]
    verifier_id: UUID | None
    verifier_name: str | None
    submitted_at: datetime | None
    posted_by: UUID | None
    posted_by_name: str | None
    posted_at: datetime | None
    total_lines: int
    counted_lines: int
    variance_lines: int
    lines: list[InventoryWaveLineItem] = Field(default_factory=list)


class InventoryWavesResponse(BaseModel):
    waves: list[InventoryWaveItem]


class InventoryCountCreate(SignatureRequest):
    document_no: str = Field(min_length=1, max_length=64)
    count_date: date
    lines: list[InventoryCountLineCreate] = Field(min_length=1)


class InventoryCountLineItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lot_id: UUID
    internal_lot: str
    material_code: str
    system_quantity: float
    actual_quantity: float
    variance: float
    unit: str


class InventoryCountItem(BaseModel):
    id: UUID
    document_no: str
    status: str
    warehouse_type: str
    count_date: date
    posted_at: datetime
    lines: list[InventoryCountLineItem]


class InventoryCountsResponse(BaseModel):
    counts: list[InventoryCountItem]


class MovementItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    movement_type: str
    document_type: str
    document_id: UUID
    internal_lot: str
    supplier_lot: str
    material_code: str
    material_name: str
    quantity_delta: float
    quantity_after: float
    unit: str
    reason: str | None
    workstation_id: str
    created_at: datetime


class MovementsResponse(BaseModel):
    movements: list[MovementItem]


# ---------------------------------------------------------------------------
# Production Requisition schemas
# ---------------------------------------------------------------------------

class RequisitionLineCreate(BaseModel):
    material_id: UUID
    requested_quantity: float = Field(gt=0)
    unit: str = Field(min_length=1, max_length=32)


class RequisitionCreate(BaseModel):
    product_name: str = Field(min_length=1, max_length=255)
    product_series: str | None = None
    production_date: date | None = None
    production_order_no: str | None = None
    notes: str | None = None
    lines: list[RequisitionLineCreate] = Field(min_length=1)


class AllocationLineUpdate(BaseModel):
    """Frontend sends updated allocation lines for one warehouse."""
    id: UUID
    allocated_quantity: float = Field(ge=0)


class AllocationLineAdd(BaseModel):
    """Add a manual allocation line."""
    requisition_line_id: UUID
    lot_id: UUID
    allocated_quantity: float = Field(gt=0)


class AllocationUpdateRequest(BaseModel):
    updates: list[AllocationLineUpdate] = Field(default_factory=list)
    additions: list[AllocationLineAdd] = Field(default_factory=list)
    removals: list[UUID] = Field(default_factory=list)  # allocation line ids to remove


class IssueRequisitionRequest(SignatureRequest):
    """Sign and issue all draft allocation lines for this warehouse."""
    pass


# ---- Response models ----

class AllocationLineItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    requisition_line_id: UUID
    lot_id: UUID
    lot_internal_lot: str
    lot_supplier_lot: str
    lot_expiry_date: date
    lot_location_code: str
    # Physical address inside the warehouse (form Ф-3 СОП-415); any may be null.
    lot_rack_no: str | None = None
    lot_sector_no: str | None = None
    lot_tier_no: str | None = None
    lot_place_no: str | None = None
    lot_pallet_no: str | None = None
    lot_available: float
    warehouse_type: str
    allocated_quantity: float
    status: str


class RequisitionLineItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    material_id: UUID
    material_code: str
    material_name: str
    requested_quantity: float
    issued_quantity: float
    unit: str
    warehouse_type: str
    status: str
    allocation_lines: list[AllocationLineItem]


class RequisitionItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    requisition_no: str
    status: str
    product_name: str
    product_series: str | None
    production_date: date | None
    production_order_no: str | None
    notes: str | None
    submitted_at: datetime | None
    created_at: datetime
    lines: list[RequisitionLineItem]


class RequisitionsResponse(BaseModel):
    requisitions: list[RequisitionItem]
