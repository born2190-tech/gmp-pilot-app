"""Production batch start workflow routes."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.schemas.production import (
    ProductCreate,
    ProductItem,
    ProductUpdate,
    ProductsResponse,
    ProductionBatchAuditItem,
    ProductionBatchAuditResponse,
    ProductionBatchBmrIssueRequest,
    ProductionBatchCancelRequest,
    ProductionBatchChecklistUpdate,
    ProductionBatchCompleteRequest,
    ProductionBatchCreate,
    ProductionBatchItem,
    ProductionBatchNumberCheckRequest,
    ProductionBatchPreview,
    ProductionBatchPreviewRequest,
    ProductionBatchesResponse,
    ProductionBatchStartRequest,
)
from app.services.production_batches import (
    assign_batch,
    cancel_batch,
    create_batch,
    check_batch_number,
    complete_batch,
    get_batch,
    issue_bmr,
    list_batch_audit,
    list_batches,
    preview_batch_number,
    start_batch,
    update_checklist,
)
from app.services.products import (
    create_product,
    list_products,
    update_product,
)

router = APIRouter(prefix="/api/production/batches", tags=["production"])
products_router = APIRouter(prefix="/api/production/products", tags=["production"])


@products_router.get("", response_model=ProductsResponse)
def list_products_route(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductsResponse:
    return ProductsResponse(products=[ProductItem.model_validate(p) for p in list_products(db, user)])


@products_router.post("", response_model=ProductItem)
def create_product_route(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductItem:
    return ProductItem.model_validate(create_product(db, user, payload))


@products_router.put("/{product_id}", response_model=ProductItem)
def update_product_route(
    product_id: UUID,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductItem:
    return ProductItem.model_validate(update_product(db, user, product_id, payload))


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


@router.get("/{batch_id}/audit", response_model=ProductionBatchAuditResponse)
def batch_audit_route(
    batch_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchAuditResponse:
    return ProductionBatchAuditResponse(
        events=[ProductionBatchAuditItem.model_validate(e) for e in list_batch_audit(db, user, batch_id)]
    )


@router.post("/{batch_id}/assign", response_model=ProductionBatchItem)
def assign_route(
    batch_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchItem:
    return ProductionBatchItem.model_validate(assign_batch(db, user, batch_id))


@router.post("/{batch_id}/cancel", response_model=ProductionBatchItem)
def cancel_route(
    batch_id: UUID,
    payload: ProductionBatchCancelRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchItem:
    return ProductionBatchItem.model_validate(cancel_batch(db, user, batch_id, payload))


@router.post("/{batch_id}/check-number", response_model=ProductionBatchItem)
def check_number_route(
    batch_id: UUID,
    payload: ProductionBatchNumberCheckRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchItem:
    return ProductionBatchItem.model_validate(check_batch_number(db, user, batch_id, payload))


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


@router.post("/{batch_id}/complete", response_model=ProductionBatchItem)
def complete_route(
    batch_id: UUID,
    payload: ProductionBatchCompleteRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProductionBatchItem:
    return ProductionBatchItem.model_validate(complete_batch(db, user, batch_id, payload))
