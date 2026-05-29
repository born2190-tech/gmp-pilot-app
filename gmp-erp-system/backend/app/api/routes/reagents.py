from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.schemas.reagents import (
    ReagentCertificateItem,
    ReagentCreate,
    ReagentDetail,
    ReagentStatusRequest,
    ReagentUpdate,
    ReagentUseRequest,
    ReagentsResponse,
)
from app.services import reagents as service

router = APIRouter(prefix="/api/qc/reagents", tags=["qc-reagents"])


@router.get("", response_model=ReagentsResponse)
def list_reagents_route(
    search: str | None = Query(default=None),
    type: str | None = Query(default=None),  # noqa: A002 - API query name
    status: str | None = Query(default=None),
    opened_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReagentsResponse:
    return ReagentsResponse(
        reagents=service.list_reagents(
            db,
            current_user,
            search=search,
            type_=type,
            status_=status,
            opened_only=opened_only,
        )
    )


@router.get("/{reagent_id}", response_model=ReagentDetail)
def get_reagent_route(
    reagent_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReagentDetail:
    return service.get_reagent(db, current_user, reagent_id)


@router.post("", response_model=ReagentDetail, status_code=status.HTTP_201_CREATED)
def create_reagent_route(
    payload: ReagentCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReagentDetail:
    return service.create_reagent(db, current_user, payload)


@router.patch("/{reagent_id}", response_model=ReagentDetail)
def update_reagent_route(
    reagent_id: UUID,
    payload: ReagentUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReagentDetail:
    return service.update_reagent(db, current_user, reagent_id, payload)


@router.post("/{reagent_id}/use", response_model=ReagentDetail)
def use_reagent_route(
    reagent_id: UUID,
    payload: ReagentUseRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReagentDetail:
    return service.use_reagent(db, current_user, reagent_id, payload)


@router.post("/{reagent_id}/status", response_model=ReagentDetail)
def change_status_route(
    reagent_id: UUID,
    payload: ReagentStatusRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReagentDetail:
    return service.change_status(db, current_user, reagent_id, payload)


@router.get("/{reagent_id}/audit")
def reagent_audit_route(
    reagent_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, list[dict[str, object]]]:
    rows = service.list_audit(db, current_user, reagent_id)
    return {
        "events": [
            {
                "id": str(row.id),
                "created_at": row.created_at,
                "user_id": str(row.user_id),
                "role_code": row.role_code,
                "workstation_id": row.workstation_id,
                "action_type": row.action_type,
                "old_value": row.old_value_json,
                "new_value": row.new_value_json,
                "reason": row.reason,
                "source": row.source,
            }
            for row in rows
        ]
    }


@router.post("/{reagent_id}/certificates", response_model=ReagentCertificateItem, status_code=status.HTTP_201_CREATED)
async def upload_certificate_route(
    reagent_id: UUID,
    file: UploadFile = File(...),
    certificate_no: str | None = Query(default=None),
    note: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReagentCertificateItem:
    cert = await service.upload_certificate(db, current_user, reagent_id, file, certificate_no=certificate_no, note=note)
    return ReagentCertificateItem.model_validate(cert)


@router.get("/certificates/{certificate_id}/file")
def download_certificate_route(
    certificate_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    raw, mime = service.load_certificate_file(db, current_user, certificate_id)
    filename = quote(f"reagent-certificate-{certificate_id}")
    return Response(
        content=raw,
        media_type=mime,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{filename}"},
    )
