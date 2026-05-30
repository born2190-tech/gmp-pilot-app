from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# Допустимые типы секций конструктора BMR (СОП-11).
SECTION_TYPES = (
    "product_header",
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
