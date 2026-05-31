"""Routes for межсерийная кампания взвешивания (task #14)."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.schemas.weighing_campaign import (
    WeighingCampaignAddSeries,
    WeighingCampaignCreate,
    WeighingCampaignItem,
    WeighingCampaignSaveNet,
    WeighingCampaignSetLot,
    WeighingCampaignSignCell,
    WeighingCampaignsResponse,
)
from app.services.weighing_campaign import (
    add_series,
    create_campaign,
    get_campaign,
    list_campaigns,
    remove_series,
    save_net,
    set_lot,
    set_status,
    sign_cell,
)

router = APIRouter(prefix="/api/weighing-campaigns", tags=["weighing-campaign"])


@router.get("", response_model=WeighingCampaignsResponse)
def list_route(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> WeighingCampaignsResponse:
    return WeighingCampaignsResponse(campaigns=list_campaigns(db, user))


@router.post("", response_model=WeighingCampaignItem)
def create_route(payload: WeighingCampaignCreate, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> WeighingCampaignItem:
    return WeighingCampaignItem.model_validate(create_campaign(db, user, payload))


@router.get("/{campaign_id}", response_model=WeighingCampaignItem)
def get_route(campaign_id: UUID, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> WeighingCampaignItem:
    return WeighingCampaignItem.model_validate(get_campaign(db, user, campaign_id))


@router.post("/{campaign_id}/series", response_model=WeighingCampaignItem)
def add_series_route(campaign_id: UUID, payload: WeighingCampaignAddSeries, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> WeighingCampaignItem:
    return WeighingCampaignItem.model_validate(add_series(db, user, campaign_id, payload))


@router.delete("/{campaign_id}/series/{batch_id}", response_model=WeighingCampaignItem)
def remove_series_route(campaign_id: UUID, batch_id: UUID, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> WeighingCampaignItem:
    return WeighingCampaignItem.model_validate(remove_series(db, user, campaign_id, batch_id))


@router.put("/{campaign_id}/lot", response_model=WeighingCampaignItem)
def set_lot_route(campaign_id: UUID, payload: WeighingCampaignSetLot, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> WeighingCampaignItem:
    return WeighingCampaignItem.model_validate(set_lot(db, user, campaign_id, payload.ingredient_key, payload.lot_no))


@router.put("/{campaign_id}/net", response_model=WeighingCampaignItem)
def save_net_route(campaign_id: UUID, payload: WeighingCampaignSaveNet, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> WeighingCampaignItem:
    return WeighingCampaignItem.model_validate(save_net(db, user, campaign_id, payload))


@router.post("/{campaign_id}/sign", response_model=WeighingCampaignItem)
def sign_route(campaign_id: UUID, payload: WeighingCampaignSignCell, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> WeighingCampaignItem:
    return WeighingCampaignItem.model_validate(sign_cell(db, user, campaign_id, payload))


@router.post("/{campaign_id}/status/{new_status}", response_model=WeighingCampaignItem)
def status_route(campaign_id: UUID, new_status: str, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> WeighingCampaignItem:
    return WeighingCampaignItem.model_validate(set_status(db, user, campaign_id, new_status))
