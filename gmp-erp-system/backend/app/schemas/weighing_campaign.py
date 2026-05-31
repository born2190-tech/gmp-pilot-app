from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.inventory import SignatureRequest


class WeighingCampaignCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    campaign_date: date
    room: str | None = Field(default=None, max_length=64)
    batch_ids: list[UUID] = Field(default_factory=list)


class WeighingCampaignAddSeries(BaseModel):
    batch_ids: list[UUID] = Field(default_factory=list)


class WeighingCampaignSetLot(BaseModel):
    ingredient_key: str
    lot_no: str | None = Field(default=None, max_length=128)


class WeighingCampaignSaveNet(BaseModel):
    ingredient_key: str
    batch_id: UUID
    net: float | None = None


class WeighingCampaignSignCell(SignatureRequest):
    ingredient_key: str
    batch_id: UUID
    role: str = Field(pattern="^(warehouse|dp|qa)$")


class WeighingCampaignItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    title: str
    campaign_date: date
    room: str | None = None
    status: str
    notes: str | None = None
    batches: list[Any] = Field(default_factory=list)
    ledger: list[Any] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class WeighingCampaignListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    title: str
    campaign_date: date
    room: str | None = None
    status: str
    series_count: int = 0
    updated_at: datetime | None = None


class WeighingCampaignsResponse(BaseModel):
    campaigns: list[WeighingCampaignListItem] = Field(default_factory=list)
