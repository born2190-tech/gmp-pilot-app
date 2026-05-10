from fastapi import HTTPException, status

from app.api.deps import CurrentUser


def require_permission(user: CurrentUser, permission_code: str) -> None:
    if permission_code not in user.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission {permission_code} is required",
        )


def require_warehouse_type_scope(user: CurrentUser, warehouse_type: str) -> None:
    if user.warehouse_scope and user.warehouse_scope != warehouse_type:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Warehouse scope {user.warehouse_scope} cannot access {warehouse_type}",
        )
