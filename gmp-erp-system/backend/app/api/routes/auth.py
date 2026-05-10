from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_token, hash_token, verify_password
from app.models.identity import AuthSession, User
from app.schemas.identity import CurrentUserResponse, LoginRequest, LoginResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

    token, token_hash = create_token()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=token_hash,
            workstation_id=payload.workstation_id,
            expires_at=expires_at,
            revoked=False,
        )
    )
    db.commit()

    return LoginResponse(
        access_token=token,
        expires_at=expires_at.isoformat(),
        username=user.username,
        role=user.role.code,
        department=user.department.code if user.department else None,
        warehouse_scope=user.warehouse_scope,
        workstation_id=payload.workstation_id,
    )


@router.post("/logout")
def logout(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    token = authorization.removeprefix("Bearer ").strip() if authorization else ""
    db.query(AuthSession).filter(AuthSession.token_hash == hash_token(token)).update(
        {AuthSession.revoked: True}, synchronize_session=False
    )
    db.commit()
    return {"message": f"Session revoked for {current_user.username}"}


@router.get("/me", response_model=CurrentUserResponse)
def me(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse(
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role,
        department=current_user.department,
        permissions=current_user.permissions,
        warehouse_scope=current_user.warehouse_scope,
        workstation_id=current_user.workstation_id,
    )
