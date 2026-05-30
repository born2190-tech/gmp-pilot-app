"""Production batch start workflow routes."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.schemas.production import (
    ProductionBatchBmrIssueRequest,
    ProductionBatchChecklistUpdate,
    ProductionBatchCreate,
    ProductionBatchItem,
    ProductionBatchPreview,
    ProductionBatchPreviewRequest,
    ProductionBatchesResponse,
    ProductionBatchStartRequest,
)
from app.services.production_batches import (
    create_batch,
    get_batch,
    issue_bmr,
    list_batches,
    preview_batch_number,
    start_batch,
    update_checklist,
)

router = APIRouter(prefix="/api/production/batches", tags=["production"])


@router.post("/preview", response_model=ProductionBatchPreview)
def preview(
    payload: ProductionBatchPreviewRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchPreview:
    return ProductionBatchPreview.model_validate(preview_batch_number(db, user, payload))


@router.post("", response_model=ProductionBatchItem)
def create(
    payload: ProductionBatchCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchItem:
    batch = create_batch(db, user, payload)
    return ProductionBatchItem.model_validate(batch)


@router.get("", response_model=ProductionBatchesResponse)
def list_all(
    status: str | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchesResponse:
    return ProductionBatchesResponse(
        batches=[ProductionBatchItem.model_validate(batch) for batch in list_batches(db, user, status)]
    )


@router.get("/{batch_id}", response_model=ProductionBatchItem)
def get_one(
    batch_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchItem:
    return ProductionBatchItem.model_validate(get_batch(db, user, batch_id))


@router.post("/{batch_id}/issue-bmr", response_model=ProductionBatchItem)
def issue_bmr_route(
    batch_id: UUID,
    payload: ProductionBatchBmrIssueRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchItem:
    return ProductionBatchItem.model_validate(issue_bmr(db, user, batch_id, payload))


@router.patch("/{batch_id}/checklist", response_model=ProductionBatchItem)
def checklist_route(
    batch_id: UUID,
    payload: ProductionBatchChecklistUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchItem:
    return ProductionBatchItem.model_validate(update_checklist(db, user, batch_id, payload))


@router.post("/{batch_id}/start", response_model=ProductionBatchItem)
def start_route(
    batch_id: UUID,
    payload: ProductionBatchStartRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchItem:
    return ProductionBatchItem.model_validate(start_batch(db, user, batch_id, payload))
