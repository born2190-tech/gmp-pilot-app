"""Electronic BMR template constructor routes (СОП-11) — Phase A."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.schemas.bmr import (
    BmrTemplateApproveRequest,
    BmrTemplateCreate,
    BmrTemplateItem,
    BmrTemplateListItem,
    BmrTemplateUpdate,
    BmrTemplatesResponse,
)
from app.services.bmr import (
    approve_template,
    create_template,
    duplicate_template,
    get_template,
    list_templates,
    update_template,
)

router = APIRouter(prefix="/api/bmr/templates", tags=["bmr"])


@router.get("", response_model=BmrTemplatesResponse)
def list_all(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> BmrTemplatesResponse:
    return BmrTemplatesResponse(templates=[BmrTemplateListItem.model_validate(t) for t in list_templates(db, user)])


@router.post("", response_model=BmrTemplateItem)
def create(payload: BmrTemplateCreate, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> BmrTemplateItem:
    t = create_template(db, user, payload)
    return BmrTemplateItem.model_validate(get_template(db, user, t.id))


@router.get("/{template_id}", response_model=BmrTemplateItem)
def get_one(template_id: UUID, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> BmrTemplateItem:
    return BmrTemplateItem.model_validate(get_template(db, user, template_id))


@router.put("/{template_id}", response_model=BmrTemplateItem)
def update(template_id: UUID, payload: BmrTemplateUpdate, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> BmrTemplateItem:
    update_template(db, user, template_id, payload)
    return BmrTemplateItem.model_validate(get_template(db, user, template_id))


@router.post("/{template_id}/duplicate", response_model=BmrTemplateItem)
def duplicate(template_id: UUID, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> BmrTemplateItem:
    t = duplicate_template(db, user, template_id)
    return BmrTemplateItem.model_validate(get_template(db, user, t.id))


@router.post("/{template_id}/approve", response_model=BmrTemplateItem)
def approve(template_id: UUID, payload: BmrTemplateApproveRequest, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)) -> BmrTemplateItem:
    approve_template(db, user, template_id, payload)
    return BmrTemplateItem.model_validate(get_template(db, user, template_id))
