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


class QCNotificationLineItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lot_id: UUID
    material_name: str
    batch_number: str
    expiry_date: str
    quantity: float
    unit: str
    manufacturer_name: str
    invoice_info: str


class QCNotificationItem(BaseModel):
    id: UUID
    notification_no: str
    status: str
    warehouse_type: str
    notified_at: datetime
    lines: list[QCNotificationLineItem]


class QCNotificationsResponse(BaseModel):
    notifications: list[QCNotificationItem]


class QCNotificationCreate(BaseModel):
    receipt_id: UUID
    notification_no: str | None = Field(default=None, max_length=64)
    reason: str | None = Field(default=None, max_length=500)


class QCNotificationScanItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    notification_id: UUID
    version: int
    file_size: int
    mime_type: str
    sha256_hash: str
    status: str
    uploaded_at: datetime
    uploaded_by: UUID
    verified_at: datetime | None
    verified_by: UUID | None
    signature_warehouse_ok: bool | None
    signature_qc_ok: bool | None
    signature_manager_ok: bool | None
    remarks: str | None


class QCNotificationScansResponse(BaseModel):
    notification_id: UUID
    notification_no: str
    notification_status: str
    scans: list[QCNotificationScanItem]


class QCScanVerifyRequest(BaseModel):
    signature_warehouse_ok: bool
    signature_qc_ok: bool
    signature_manager_ok: bool
    remarks: str | None = Field(default=None, max_length=1000)
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    meaning: str = Field(min_length=1)
    reason: str | None = Field(default=None, max_length=500)


class QCScanRejectRequest(BaseModel):
    remarks: str = Field(min_length=1, max_length=1000)
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    meaning: str = Field(min_length=1)
    reason: str | None = Field(default=None, max_length=500)


class QCPendingScanItem(BaseModel):
    """Row shown on the ДОК verification queue."""
    model_config = ConfigDict(from_attributes=True)

    scan_id: UUID
    notification_id: UUID
    notification_no: str
    warehouse_type: str
    notified_at: datetime
    uploaded_at: datetime
    uploaded_by: UUID
    uploaded_by_name: str | None
    version: int
    lines_count: int


class QCPendingScansResponse(BaseModel):
    scans: list[QCPendingScanItem]


class QCReportParameterCreate(BaseModel):
    parameter_name: str = Field(min_length=1, max_length=255)
    specification: str = Field(min_length=1)
    result_value: str = Field(min_length=1)
    unit: str | None = Field(default=None, max_length=32)
    method_reference: str | None = Field(default=None, max_length=255)
    complies: bool


class QCReportCreate(BaseModel):
    lot_id: UUID
    report_no: str = Field(min_length=1, max_length=64)
    analysis_started_at: datetime | None = None
    analysis_finished_at: datetime | None = None
    method_reference: str | None = Field(default=None, max_length=255)
    parameters: list[QCReportParameterCreate] = Field(min_length=1)


class QCReportParameterItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    parameter_name: str
    specification: str
    result_value: str
    unit: str | None
    method_reference: str | None
    complies: bool


class QCReportItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    lot_id: UUID
    report_no: str
    status: str
    method_reference: str | None
    analysis_started_at: datetime | None
    analysis_finished_at: datetime | None
    overall_result: str | None
    submitted_at: datetime | None
    parameters: list[QCReportParameterItem] = Field(default_factory=list)
