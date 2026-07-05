from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.inventory import SignatureRequest


# Допустимые типы секций конструктора BMR (СОП-11).
SECTION_TYPES = (
    "product_header",
    "process_header",
    "reference_table",
    "production_formula",
    "distribution_list",
    "stage",
    "environment",
    "equipment",
    "checklist",
    "process_steps",
    "in_process_control",
    "yield",
    "materials_used",
    "attachments",
    "free_text",
)


class BmrSectionInput(BaseModel):
    section_type: str = Field(pattern="^(" + "|".join(SECTION_TYPES) + ")$")
    title: str = Field(min_length=1, max_length=255)
    config: dict = Field(default_factory=dict)


class BmrSectionItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ordinal: int
    section_type: str
    title: str
    config: dict


class BmrTemplateCreate(BaseModel):
    product_id: UUID
    title: str = Field(min_length=1, max_length=255)
    notes: str | None = None
    sections: list[BmrSectionInput] = Field(default_factory=list)


class BmrTemplateUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    notes: str | None = None
    sections: list[BmrSectionInput] = Field(default_factory=list)


class BmrTemplateApproveRequest(BaseModel):
    effective_date: date | None = None


class BmrTemplateListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    product_code: str | None = None
    product_name: str | None = None
    market_code: str | None = None
    title: str
    version: int
    status: str
    effective_date: date | None
    sections_count: int = 0
    updated_at: datetime


class BmrTemplateItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    product_code: str | None = None
    product_name: str | None = None
    market_code: str | None = None
    title: str
    version: int
    status: str
    effective_date: date | None
    notes: str | None
    created_by: UUID
    approved_by: UUID | None
    approved_at: datetime | None
    sections: list[BmrSectionItem]


class BmrTemplatesResponse(BaseModel):
    templates: list[BmrTemplateListItem]


# --- BMR instance (per batch) ------------------------------------------------
class BmrInstanceSectionItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ordinal: int
    section_type: str
    title: str
    config: dict


class BmrEntryItem(BaseModel):
    section_id: UUID
    field_index: int
    value: Any = None
    filled_by_name: str | None = None
    filled_at: datetime | None = None


class BmrStageItem(BaseModel):
    stage: str
    title: str
    room: str | None = None


class BmrOperatorItem(BaseModel):
    id: str
    username: str
    full_name: str
    employee_no: str | None = None
    position_title: str | None = None
    department: str | None = None
    signature_initials: str | None = None
    role: str | None = None
    is_operator: bool = True


class BmrOperatorsResponse(BaseModel):
    operators: list[BmrOperatorItem] = Field(default_factory=list)


class BmrAssignmentsRequest(BaseModel):
    assignments: dict[str, list[str]] = Field(default_factory=dict)


class BmrParticipantItem(BaseModel):
    full_name: str | None = None
    username: str | None = None
    role: str | None = None
    duties: list[str] = Field(default_factory=list)
    stages: list[str] = Field(default_factory=list)
    assigned: bool = False
    signed: bool = False


class BmrSignatureLogItem(BaseModel):
    full_name: str | None = None
    username: str | None = None
    role: str | None = None
    department: str | None = None
    duty: str
    meaning: str
    stage: str | None = None
    stage_title: str | None = None
    section_title: str | None = None
    field_label: str | None = None
    signed_at: datetime | None = None
    workstation_id: str | None = None


class BmrRouteStageItem(BaseModel):
    stage: str
    title: str
    room: str | None = None
    ordinal: int = 0
    status: str = "issued"
    done: int = 0
    total: int = 0
    dp_done: int = 0
    dp_total: int = 0
    dok_done: int = 0
    dok_total: int = 0
    who: str = ""


class BmrInstanceItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    production_batch_id: UUID
    batch_no: str | None = None
    template_id: UUID | None
    template_version: int
    title: str
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    reviewed_at: datetime | None
    sections: list[BmrInstanceSectionItem]
    entries: list[BmrEntryItem] = Field(default_factory=list)
    assignments: dict[str, list[str]] = Field(default_factory=dict)
    stages: list[BmrStageItem] = Field(default_factory=list)
    participants: list[BmrParticipantItem] = Field(default_factory=list)
    signature_log: list[BmrSignatureLogItem] = Field(default_factory=list)
    route: list[BmrRouteStageItem] = Field(default_factory=list)


class BmrEntrySave(BaseModel):
    section_id: UUID
    field_index: int
    value: Any = None


class BmrEntriesSaveRequest(BaseModel):
    entries: list[BmrEntrySave]


class BmrSignRequest(SignatureRequest):
    section_id: UUID
    field_index: int


class BmrInstanceActionRequest(SignatureRequest):
    pass
