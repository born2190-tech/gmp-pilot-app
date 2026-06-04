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
    # Вид материала и тип ВУМ — для выбора методов входного контроля в ОКК
    # (субстанция → Ф-11 СОП-533/548; упаковка → методы СОП-543 по типу).
    item_type: str | None = None
    packaging_type: str | None = None
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
    # Нормы отбора Ф-1 (из карточки материала) — для авто-подстановки в акт.
    sample_pc_qty: float | None = None
    sample_micro_qty: float | None = None
    sample_archive_qty: float | None = None
    sample_stability_qty: float | None = None
    sample_unit: str | None = None
    qc_notification_no: str | None = None
    qc_notification_status: str | None = None


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


# --- Unified ДОК verification queue (Ф-14 / Ф-10 / Ф-11) --------------------
class ScanVerifyRequest(BaseModel):
    """Generic verify payload for sampling-act / analytical-sheet scans."""
    signature_1_ok: bool
    signature_2_ok: bool
    signature_3_ok: bool
    remarks: str | None = Field(default=None, max_length=1000)
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    meaning: str = Field(min_length=1)
    reason: str | None = Field(default=None, max_length=500)


class ScanRejectRequest(BaseModel):
    remarks: str = Field(min_length=1, max_length=1000)
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    meaning: str = Field(min_length=1)
    reason: str | None = Field(default=None, max_length=500)


class VerificationQueueItem(BaseModel):
    """One pending scan in the unified ДОК verification queue."""
    doc_type: str  # qc_notification | sampling_act | qc_report
    scan_id: UUID
    doc_id: UUID
    doc_no: str
    sop_form: str | None = None
    title: str | None = None
    uploaded_at: datetime
    uploaded_by: UUID
    uploaded_by_name: str | None = None
    version: int
    # Ф-11 only: есть ли микробиология (управляет составом подписей при верификации).
    micro: bool | None = None


class VerificationQueueResponse(BaseModel):
    items: list[VerificationQueueItem]


class QCReportParameterCreate(BaseModel):
    category: str = Field(default="physicochemical", pattern="^(physicochemical|microbiological|packaging)$")
    parameter_name: str = Field(min_length=1, max_length=255)
    specification: str = Field(min_length=1)
    result_value: str = Field(min_length=1)
    unit: str | None = Field(default=None, max_length=32)
    method_reference: str | None = Field(default=None, max_length=255)
    complies: bool
    # Прибор, использованный для этого показателя (optional).
    equipment_id: UUID | None = None


class QCReportCreate(BaseModel):
    lot_id: UUID
    report_no: str = Field(min_length=1, max_length=64)
    analysis_started_at: datetime | None = None
    analysis_finished_at: datetime | None = None
    method_reference: str | None = Field(default=None, max_length=255)
    equipment: str | None = None
    # Multi-select приборов на весь аналитический лист (шапка Ф-11).
    equipment_ids: list[UUID] = Field(default_factory=list)
    room_temp: str | None = Field(default=None, max_length=32)
    humidity: str | None = Field(default=None, max_length=32)
    micro_required: bool = True
    micro_method_reference: str | None = Field(default=None, max_length=255)
    micro_started_at: datetime | None = None
    micro_finished_at: datetime | None = None
    parameters: list[QCReportParameterCreate] = Field(min_length=1)


class QCReportEquipmentItem(BaseModel):
    """Прибор, привязанный к аналитическому листу — со статусом калибровки."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    category: str | None
    calibration_status: str = "missing"
    calibration_valid_until: date | None = None


class QCReportParameterItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category: str
    parameter_name: str
    specification: str
    result_value: str
    unit: str | None
    method_reference: str | None
    complies: bool
    equipment_id: UUID | None = None
    equipment_code: str | None = None
    equipment_name: str | None = None


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
    equipment: str | None = None
    room_temp: str | None = None
    humidity: str | None = None
    micro_required: bool = True
    micro_method_reference: str | None = None
    micro_started_at: datetime | None = None
    micro_finished_at: datetime | None = None
    parameters: list[QCReportParameterItem] = Field(default_factory=list)
    equipments: list[QCReportEquipmentItem] = Field(default_factory=list)


class QCReportListItem(BaseModel):
    """Строка списка аналитических листов (для дашборда ОКК)."""

    id: UUID
    lot_id: UUID
    report_no: str
    status: str
    overall_result: str | None
    submitted_at: datetime | None
    internal_lot: str | None = None
    material_name: str | None = None
    manufacturer_name: str | None = None
    scan_id: UUID | None = None
    scan_sha256: str | None = None
    # ДОК-верификация подписанного скана: pending_verification | verified | rejected | None
    scan_status: str | None = None


class QCReportsListResponse(BaseModel):
    reports: list[QCReportListItem]


# ---------------------------------------------------------------------------
# Material specifications (НД) registry
# ---------------------------------------------------------------------------


class SpecificationParameterInput(BaseModel):
    category: str = Field(default="physicochemical", pattern="^(physicochemical|microbiological|packaging)$")
    parameter_name: str = Field(min_length=1, max_length=255)
    specification: str = Field(min_length=1)
    method_reference: str | None = Field(default=None, max_length=255)
    unit: str | None = Field(default=None, max_length=32)


class SpecificationParameterItem(SpecificationParameterInput):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ordinal: int


class MaterialSpecificationInput(BaseModel):
    nd_code: str = Field(min_length=1, max_length=128)
    revision: str | None = Field(default=None, max_length=32)
    material_name: str = Field(min_length=1, max_length=255)
    material_id: UUID | None = None
    match_keywords: str | None = Field(default=None, max_length=512)
    sop_form: str = Field(default="533", max_length=8)
    micro_required: bool = True
    micro_method_ref: str | None = Field(default=None, max_length=255)
    is_active: bool = True
    effective_date: date | None = None
    notes: str | None = None
    parameters: list[SpecificationParameterInput] = Field(default_factory=list)


class MaterialSpecificationItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nd_code: str
    revision: str | None
    material_name: str
    material_id: UUID | None
    match_keywords: str | None
    sop_form: str
    micro_required: bool
    micro_method_ref: str | None
    is_active: bool
    effective_date: date | None
    notes: str | None
    parameters: list[SpecificationParameterItem] = Field(default_factory=list)


class MaterialSpecificationListItem(BaseModel):
    """Краткая строка для списка справочника НД (без параметров)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nd_code: str
    revision: str | None
    material_name: str
    material_id: UUID | None
    sop_form: str
    micro_required: bool
    is_active: bool
    effective_date: date | None
    parameters_count: int = 0


class MaterialSpecificationsResponse(BaseModel):
    specifications: list[MaterialSpecificationListItem]


# ---------------------------------------------------------------------------
# OOS / РНС — out-of-specification investigations
# ---------------------------------------------------------------------------


class OOSItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    number: str
    report_id: UUID
    lot_id: UUID
    status: str
    failed_summary: str | None
    root_cause: str | None
    conclusion: str | None
    disposition: str | None
    opened_at: datetime
    closed_at: datetime | None
    internal_lot: str | None = None
    material_name: str | None = None
    report_no: str | None = None


class OOSListResponse(BaseModel):
    investigations: list[OOSItem]


class OOSUpdateRequest(BaseModel):
    root_cause: str | None = None
    conclusion: str | None = None
    disposition: str | None = None


class OOSCloseRequest(SignatureRequest):
    conclusion: str = Field(min_length=1)
    disposition: str = Field(pattern="^(confirmed_reject|lab_error_retest|use_as_is)$")
    root_cause: str | None = None


# ---------------------------------------------------------------------------
# Sampling acts — СОП-533 / СОП-548 Ф-10
# ---------------------------------------------------------------------------

SAMPLING_PURPOSES = ("PHYSICOCHEMICAL", "MICROBIOLOGICAL", "ARCHIVE", "STABILITY")


class SamplingLineInput(BaseModel):
    purpose: str = Field(pattern="^(PHYSICOCHEMICAL|MICROBIOLOGICAL|ARCHIVE|STABILITY)$")
    quantity: float = Field(ge=0)
    unit: str = Field(min_length=1, max_length=32)


class SamplingActCreate(BaseModel):
    lot_id: UUID
    head_qc_user_id: UUID | None = None
    warehouse_member_user_id: UUID | None = None
    qc_representative_user_id: UUID | None = None
    sampling_date: date | None = None
    sampling_location: str | None = Field(default=None, max_length=255)
    sample_condition: str | None = Field(default=None, max_length=255)
    temperature_c: float | None = None
    humidity_pct: float | None = None
    scale_model: str | None = Field(default=None, max_length=255)
    scale_calibration_no: str | None = Field(default=None, max_length=128)
    transport_with_ice: bool = False
    specification_ref: str | None = Field(default=None, max_length=255)
    registration_no: str | None = Field(default=None, max_length=128)
    containers_outer_total: int | None = None
    containers_outer_sampled: int | None = None
    containers_inner_total: int | None = None
    containers_inner_sampled: int | None = None
    notes: str | None = Field(default=None, max_length=2000)
    lines: list[SamplingLineInput] = Field(default_factory=list)


class SamplingActUpdate(SamplingActCreate):
    lot_id: UUID | None = None  # ignored on update; kept for shape compatibility


class SamplingActPost(SignatureRequest):
    pass


class SamplingLineItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    purpose: str
    quantity: float
    unit: str


class SamplingScanItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    version: int
    file_size: int
    mime_type: str
    sha256_hash: str
    uploaded_at: datetime
    uploaded_by: UUID


class SamplingActItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    act_no: str
    lot_id: UUID
    qc_notification_id: UUID | None
    sop_form: str
    status: str

    head_qc_user_id: UUID | None
    warehouse_member_user_id: UUID | None
    qc_representative_user_id: UUID | None
    head_qc_name: str | None = None
    warehouse_member_name: str | None = None
    qc_representative_name: str | None = None

    sampling_date: date | None
    sampling_location: str | None
    sample_condition: str | None
    temperature_c: float | None
    humidity_pct: float | None
    scale_model: str | None
    scale_calibration_no: str | None
    transport_with_ice: bool
    specification_ref: str | None
    registration_no: str | None
    containers_outer_total: int | None
    containers_outer_sampled: int | None
    containers_inner_total: int | None
    containers_inner_sampled: int | None
    notes: str | None

    posted_at: datetime | None
    created_at: datetime

    # Denormalised lot info for display.
    material_name: str | None = None
    material_code: str | None = None
    internal_lot: str | None = None
    supplier_lot: str | None = None
    manufacturer_name: str | None = None
    lot_quantity: float | None = None
    lot_unit: str | None = None
    total_sampled: float = 0.0

    lines: list[SamplingLineItem] = Field(default_factory=list)
    scans: list[SamplingScanItem] = Field(default_factory=list)


class SamplingActsResponse(BaseModel):
    sampling_acts: list[SamplingActItem]
