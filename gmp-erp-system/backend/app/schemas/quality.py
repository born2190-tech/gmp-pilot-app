from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.inventory import SignatureRequest


class SampleLotRequest(BaseModel):
    reason: str = Field(min_length=1)


class QCResultRequest(SignatureRequest):
    result_summary: str = Field(min_length=1, max_length=1000)


class QADecisionRequest(SignatureRequest):
    decision: str = Field(pattern="^(released|rejected)$")


class QualityLotItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    internal_lot: str
    supplier_lot: str
    material_code: str
    material_name: str
    supplier_name: str
    manufacturer_name: str
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


class QualityLotsResponse(BaseModel):
    lots: list[QualityLotItem]
