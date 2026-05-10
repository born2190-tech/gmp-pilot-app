from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.core.security import verify_password
from app.models.audit import SignatureEvent
from app.models.identity import User
from app.schemas.inventory import SignatureRequest


def validate_signature(
    db: Session,
    actor: CurrentUser,
    signature: SignatureRequest,
    action_type: str,
    object_type: str,
    object_id: str,
) -> None:
    signer = db.query(User).filter(User.username == signature.username).first()
    result = "failed"
    role_code = signer.role.code if signer else None
    user_id = signer.id if signer else None
    try:
        if not signer or not signer.is_active or not verify_password(signature.password, signer.password_hash):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid signature credentials")
        if signer.username != actor.username:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Signature user must match acting user")
        result = "success"
    finally:
        db.add(
            SignatureEvent(
                user_id=user_id,
                username=signature.username,
                role_code=role_code,
                workstation_id=actor.workstation_id,
                object_type=object_type,
                object_id=object_id,
                action_type=action_type,
                meaning=signature.meaning,
                reason=signature.reason,
                result=result,
            )
        )
        db.flush()

