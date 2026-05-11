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
    supplier_lot: str | None = None
    production_date: date | None = None
    production_year: int | None = Field(default=None, ge=2000, le=2100)
    expiry_date: date
    quantity: float = Field(gt=0)
    unit: str = Field(min_length=1)
    location_id: UUID

    @field_validator("material_id", mode="before")
    @classmethod
    def blank_material_id_to_none(cls, value):
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
    quantity: float
    unit: str
    quality_status: str
    production_date: date | None
    production_year: int
    expiry_date: date
    incoming_control_notified_at: datetime | None
    sampling_date: datetime | None
    qc_result_received_at: datetime | None
    qa_decision_at: datetime | None


class LotsResponse(BaseModel):
    lots: list[LotItem]


class LotOperationResponse(LotItem):
    pass


class TransferLotRequest(BaseModel):
    to_location_id: UUID
    reason: str = Field(min_length=1)


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
    material_code: str
    quantity_delta: float
    quantity_after: float
    unit: str
    reason: str | None
    workstation_id: str
    created_at: datetime


class MovementsResponse(BaseModel):
    movements: list[MovementItem]
