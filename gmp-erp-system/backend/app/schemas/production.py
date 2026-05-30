from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.inventory import SignatureRequest


# --- Products (ЛС) reference -------------------------------------------------
class ProductCreate(BaseModel):
    code: str = Field(min_length=2, max_length=8, pattern=r"^\d{2,8}$")
    market_code: str = Field(default="UZ", min_length=2, max_length=16, pattern=r"^[A-Z_]{2,16}$")
    market_name: str = Field(default="Узбекистан", min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    dosage_form: str | None = Field(default=None, max_length=128)
    default_shelf_life_months: int = Field(default=24, ge=1, le=120)
    batch_format: str | None = Field(default=None, max_length=64)
    is_active: bool = True
    notes: str | None = None


class ProductUpdate(BaseModel):
    market_code: str = Field(default="UZ", min_length=2, max_length=16, pattern=r"^[A-Z_]{2,16}$")
    market_name: str = Field(default="Узбекистан", min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    dosage_form: str | None = Field(default=None, max_length=128)
    default_shelf_life_months: int = Field(default=24, ge=1, le=120)
    batch_format: str | None = Field(default=None, max_length=64)
    is_active: bool = True
    notes: str | None = None


class ProductItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    market_code: str
    market_name: str
    name: str
    dosage_form: str | None
    default_shelf_life_months: int
    batch_format: str | None
    is_active: bool
    notes: str | None


class ProductsResponse(BaseModel):
    products: list[ProductItem]


# --- Production batches -------------------------------------------------------
class ProductionBatchPreviewRequest(BaseModel):
    product_id: UUID
    production_date: date
    shelf_life_months: int = Field(ge=1, le=120)


class ProductionBatchCreate(BaseModel):
    product_id: UUID
    production_date: date
    shelf_life_months: int = Field(ge=1, le=120)
    # Снимок реквизитов (по умолчанию из справочника, можно править вручную).
    product_name: str | None = Field(default=None, max_length=255)
    dosage_form: str | None = Field(default=None, max_length=128)
    batch_size: float = Field(gt=0)
    batch_size_unit: str = Field(min_length=1, max_length=32)
    notes: str | None = None
    # Контролируемое ручное переопределение номера (СОП-409): требует причину.
    batch_no_override: str | None = Field(default=None, max_length=32)
    override_reason: str | None = Field(default=None, max_length=500)
    # Сохранить как черновик (status=draft) вместо официального присвоения.
    as_draft: bool = False


class ProductionBatchCancelRequest(SignatureRequest):
    pass


class ProductionBatchChecklistUpdate(BaseModel):
    room_ready: bool
    equipment_ready: bool
    scales_checked: bool
    materials_ready: bool
    qa_line_clearance: bool


class ProductionBatchBmrIssueRequest(SignatureRequest):
    bmr_no: str | None = Field(default=None, max_length=64)


class ProductionBatchNumberCheckRequest(SignatureRequest):
    pass


class ProductionBatchStartRequest(SignatureRequest):
    pass


class ProductionBatchCompleteRequest(SignatureRequest):
    pass


class ProductionBatchPreview(BaseModel):
    batch_no: str
    serial_no: int
    expiry_date: date


class ProductionBatchItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    batch_no: str
    status: str
    product_id: UUID | None
    product_code: str
    serial_no: int
    product_name: str
    dosage_form: str | None
    batch_size: float
    batch_size_unit: str
    production_date: date
    expiry_date: date
    shelf_life_months: int
    bmr_no: str | None
    bmr_requested_at: datetime | None
    number_checked_at: datetime | None
    bmr_issued_at: datetime | None
    room_ready: bool
    equipment_ready: bool
    scales_checked: bool
    materials_ready: bool
    qa_line_clearance: bool
    checklist_updated_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    cancel_reason: str | None
    notes: str | None
    created_at: datetime


class ProductionBatchesResponse(BaseModel):
    batches: list[ProductionBatchItem]


class BmrQueueItem(BaseModel):
    id: UUID
    batch_no: str
    product_code: str
    product_name: str
    dosage_form: str | None
    batch_size: float
    batch_size_unit: str
    production_date: date
    expiry_date: date
    bmr_requested_at: datetime
    requested_by_name: str | None


class BmrQueueResponse(BaseModel):
    items: list[BmrQueueItem]


class ProductionBatchAuditItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    action_type: str
    user_name: str | None
    role_code: str | None
    reason: str | None
    created_at: datetime


class ProductionBatchAuditResponse(BaseModel):
    events: list[ProductionBatchAuditItem]
