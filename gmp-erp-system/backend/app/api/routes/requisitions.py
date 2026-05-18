"""Production Requisition API routes."""
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.master_data import Material
from app.schemas.inventory import (
    AllocationUpdateRequest,
    IssueRequisitionRequest,
    RequisitionCreate,
    RequisitionItem,
    RequisitionsResponse,
)
from app.services.internal_transfer_pdf import render_internal_transfer_pdf
from app.services.requisitions import (
    auto_allocate,
    build_requisition_item,
    create_requisition,
    get_requisition,
    issue_requisition,
    list_requisitions,
    update_allocation,
)

router = APIRouter(prefix="/api/requisitions", tags=["requisitions"])


@router.post("", response_model=RequisitionItem)
def create(
    payload: RequisitionCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RequisitionItem:
    req = create_requisition(db, user, payload)
    return RequisitionItem.model_validate(build_requisition_item(db, req))


@router.get("", response_model=RequisitionsResponse)
def list_all(
    status: str | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RequisitionsResponse:
    reqs = list_requisitions(db, user, status_filter=status)
    items = [RequisitionItem.model_validate(build_requisition_item(db, r)) for r in reqs]
    return RequisitionsResponse(requisitions=items)


@router.get("/{requisition_id}", response_model=RequisitionItem)
def get_one(
    requisition_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RequisitionItem:
    req = get_requisition(db, user, requisition_id)
    return RequisitionItem.model_validate(build_requisition_item(db, req))


@router.post("/{requisition_id}/allocate", response_model=RequisitionItem)
def allocate(
    requisition_id: UUID,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RequisitionItem:
    """Run FEFO auto-allocation for this warehouse's lines."""
    req = auto_allocate(db, user, requisition_id)
    return RequisitionItem.model_validate(build_requisition_item(db, req))


@router.patch("/{requisition_id}/allocation", response_model=RequisitionItem)
def patch_allocation(
    requisition_id: UUID,
    payload: AllocationUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RequisitionItem:
    """Manually update allocation lines (add / update quantity / remove)."""
    req = update_allocation(db, user, requisition_id, payload)
    return RequisitionItem.model_validate(build_requisition_item(db, req))


@router.post("/{requisition_id}/issue", response_model=RequisitionItem)
def issue(
    requisition_id: UUID,
    payload: IssueRequisitionRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RequisitionItem:
    """Sign and issue all allocation lines for this warehouse. Creates InventoryMovements."""
    req = issue_requisition(db, user, requisition_id, payload)
    return RequisitionItem.model_validate(build_requisition_item(db, req))


@router.get("/{requisition_id}/pdf")
def download_pdf(
    requisition_id: UUID,
    inline: bool = Query(False, description="If true, serve with inline disposition for browser preview"),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Render «Заявка на внутреннее перемещение» (П-4 Ф-3) for printing or preview."""
    req = get_requisition(db, user, requisition_id)
    material_ids = {line.material_id for line in req.lines}
    materials = db.query(Material).filter(Material.id.in_(material_ids)).all() if material_ids else []
    materials_by_id = {m.id: m for m in materials}
    pdf_bytes = render_internal_transfer_pdf(req, materials_by_id)

    filename = f"requisition-{req.requisition_no}.pdf"
    # RFC 5987 for non-ASCII filenames (Cyrillic safe).
    disposition_type = "inline" if inline else "attachment"
    disposition = (
        f"{disposition_type}; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": disposition},
    )
