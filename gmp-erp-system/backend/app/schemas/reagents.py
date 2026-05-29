from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.inventory import SignatureRequest


class ReagentCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    type: str = Field(min_length=1, max_length=64)
    grade: str | None = Field(default=None, max_length=255)
    manufacturer: str | None = Field(default=None, max_length=255)
    supplier: str | None = Field(default=None, max_length=255)
    batch_number: str | None = Field(default=None, max_length=128)
    internal_batch_number: str = Field(min_length=1, max_length=128)
    received_date: date
    opened_date: date | None = None
    expiry_date_unopened: date
    expiry_date_after_opening_days: int = Field(default=365, ge=1, le=3650)
    status: str = Field(default="draft", max_length=32)
    quantity: float = Field(ge=0)
    unit: str = Field(min_length=1, max_length=32)
    storage_location: str | None = Field(default=None, max_length=255)
    storage_conditions: str | None = Field(default=None, max_length=255)
    responsible: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)


class ReagentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    type: str | None = Field(default=None, max_length=64)
    grade: str | None = Field(default=None, max_length=255)
    manufacturer: str | None = Field(default=None, max_length=255)
    supplier: str | None = Field(default=None, max_length=255)
    batch_number: str | None = Field(default=None, max_length=128)
    received_date: date | None = None
    opened_date: date | None = None
    expiry_date_unopened: date | None = None
    expiry_date_after_opening_days: int | None = Field(default=None, ge=1, le=3650)
    status: str | None = Field(default=None, max_length=32)
    quantity: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=32)
    storage_location: str | None = Field(default=None, max_length=255)
    storage_conditions: str | None = Field(default=None, max_length=255)
    responsible: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)
    reason: str | None = Field(default=None, max_length=1000)


class ReagentUseRequest(SignatureRequest):
    quantity: float = Field(gt=0)
    analytical_sheet: str = Field(min_length=1, max_length=128)
    material_batch: str = Field(min_length=1, max_length=128)


class ReagentStatusRequest(SignatureRequest):
    status: str = Field(min_length=1, max_length=32)


class ReagentMovementItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    reagent_id: UUID
    operation_type: str
    quantity_before: float
    quantity_operation: float
    quantity_after: float
    analytical_sheet: str | None
    material_batch: str | None
    reason: str | None
    signature_required: bool
    performed_by: UUID | None
    performed_at: datetime


class ReagentCertificateItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    reagent_id: UUID
    certificate_no: str | None
    note: str | None
    mime_type: str
    file_size: int
    sha256_hash: str
    uploaded_by: UUID | None
    uploaded_at: datetime


class ReagentItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    type: str
    grade: str | None
    manufacturer: str | None
    supplier: str | None
    batch_number: str | None
    internal_batch_number: str
    received_date: date
    opened_date: date | None
    expiry_date_unopened: date
    expiry_date_after_opening_days: int
    status: str
    quantity: float
    unit: str
    storage_location: str | None
    storage_conditions: str | None
    responsible: str | None
    notes: str | None
    effective_expiry_date: date
    days_to_expiry: int
    has_certificate: bool


class ReagentsResponse(BaseModel):
    reagents: list[ReagentItem]


class ReagentDetail(ReagentItem):
    movements: list[ReagentMovementItem] = Field(default_factory=list)
    certificates: list[ReagentCertificateItem] = Field(default_factory=list)
