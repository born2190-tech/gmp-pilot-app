"""HTTP-роуты реестра контрольно-измерительных приборов (КИП).

- `GET    /api/equipment`            — список (доступно всем VIEW_QC); фильтры `?active=true&category=...`.
- `GET    /api/equipment/{id}`       — карточка прибора + история калибровок.
- `POST   /api/equipment`            — создать (EQUIPMENT_MANAGE).
- `PATCH  /api/equipment/{id}`       — изменить (EQUIPMENT_MANAGE).
- `POST   /api/equipment/{id}/calibrations` — добавить калибровку (EQUIPMENT_MANAGE).
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.schemas.equipment import (
    EquipmentCalibrationCreate,
    EquipmentCreate,
    EquipmentDetail,
    EquipmentListResponse,
    EquipmentUpdate,
)
from app.services import equipment as equipment_service
from app.services.permissions import require_permission

router = APIRouter(prefix="/api/equipment", tags=["equipment"])


@router.get("", response_model=EquipmentListResponse)
def list_equipment_route(
    active: bool | None = Query(default=None),
    category: str | None = Query(default=None, max_length=64),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> EquipmentListResponse:
    if "VIEW_QC" not in current_user.permissions and "EQUIPMENT_MANAGE" not in current_user.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission VIEW_QC or EQUIPMENT_MANAGE is required",
        )
    items = equipment_service.list_equipment(
        db,
        only_active=bool(active) if active is not None else False,
        category=category,
    )
    return EquipmentListResponse(equipment=items)


@router.get("/{equipment_id}", response_model=EquipmentDetail)
def get_equipment_route(
    equipment_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> EquipmentDetail:
    if "VIEW_QC" not in current_user.permissions and "EQUIPMENT_MANAGE" not in current_user.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission VIEW_QC or EQUIPMENT_MANAGE is required",
        )
    return equipment_service.get_equipment_detail(db, equipment_id)


@router.post("", response_model=EquipmentDetail, status_code=status.HTTP_201_CREATED)
def create_equipment_route(
    payload: EquipmentCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> EquipmentDetail:
    require_permission(current_user, "EQUIPMENT_MANAGE")
    return equipment_service.create_equipment(db, current_user, payload)


@router.patch("/{equipment_id}", response_model=EquipmentDetail)
def update_equipment_route(
    equipment_id: UUID,
    payload: EquipmentUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> EquipmentDetail:
    require_permission(current_user, "EQUIPMENT_MANAGE")
    return equipment_service.update_equipment(db, current_user, equipment_id, payload)


@router.post(
    "/{equipment_id}/calibrations",
    response_model=EquipmentDetail,
    status_code=status.HTTP_201_CREATED,
)
def add_calibration_route(
    equipment_id: UUID,
    payload: EquipmentCalibrationCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> EquipmentDetail:
    require_permission(current_user, "EQUIPMENT_MANAGE")
    return equipment_service.add_calibration(db, current_user, equipment_id, payload)
