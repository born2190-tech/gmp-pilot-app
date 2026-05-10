from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import hash_token
from app.models.identity import AuthSession, User


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    username: str
    full_name: str
    role: str
    department: str | None
    permissions: list[str]
    warehouse_scope: str | None
    workstation_id: str


def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authorization Bearer token is required")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token")

    session = (
        db.query(AuthSession)
        .join(User, User.id == AuthSession.user_id)
        .filter(AuthSession.token_hash == hash_token(token), AuthSession.revoked.is_(False))
        .first()
    )
    if not session or session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")

    user = session.user
    permissions = sorted(permission.code for permission in user.role.permissions)
    return CurrentUser(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role.code,
        department=user.department.code if user.department else None,
        permissions=permissions,
        warehouse_scope=user.warehouse_scope,
        workstation_id=session.workstation_id,
    )
