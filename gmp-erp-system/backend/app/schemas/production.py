from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.inventory import SignatureRequest


class ProductionBatchPreviewRequest(BaseModel):
    product_code: str = Field(min_length=2, max_length=2, pattern=r"^\d{2}$")
    production_date: date
    shelf_life_months: int = Field(ge=1, le=120)


class ProductionBatchCreate(ProductionBatchPreviewRequest):
    product_name: str = Field(min_length=1, max_length=255)
    dosage_form: str | None = Field(default=None, max_length=128)
    batch_size: float = Field(gt=0)
    batch_size_unit: str = Field(min_length=1, max_length=32)
    notes: str | None = None


class ProductionBatchChecklistUpdate(BaseModel):
    room_ready: bool
    equipment_ready: bool
    scales_checked: bool
    materials_ready: bool
    qa_line_clearance: bool


class ProductionBatchBmrIssueRequest(SignatureRequest):
    bmr_no: str | None = Field(default=None, max_length=64)


class ProductionBatchStartRequest(SignatureRequest):
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
    bmr_issued_at: datetime | None
    room_ready: bool
    equipment_ready: bool
    scales_checked: bool
    materials_ready: bool
    qa_line_clearance: bool
    checklist_updated_at: datetime | None
    started_at: datetime | None
    notes: str | None
    created_at: datetime


class ProductionBatchesResponse(BaseModel):
    batches: list[ProductionBatchItem]
