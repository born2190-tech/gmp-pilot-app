from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.core.security import verify_password
from app.models.audit import SignatureEvent
from app.models.identity import User
from app.schemas.inventory import SignatureRequest


def validate_independent_signature(
    db: Session,
    actor: CurrentUser,
    signature: SignatureRequest,
    action_type: str,
    object_type: str,
    object_id: str,
    required_permissions: tuple[str, ...],
) -> User:
    """Независимая e-подпись: подписывает НЕ обязательно тот, кто залогинен на
    планшете (общий планшет комнаты, на нём работают и оператор, и контролёр).

    Подписант сам вводит свой логин+пароль/PIN; проверяем именно его учётку и его
    роль (анти-подмена: оператор не подпишет ячейку ДОК и наоборот). Возвращает
    пользователя-подписанта. Событие подписи логируется в любом случае."""
    signer = db.query(User).filter(User.username == signature.username).first()
    result = "failed"
    role_code = signer.role.code if signer else None
    user_id = signer.id if signer else None
    try:
        # Построчная подпись принимает ЛИЧНЫЙ PIN ИЛИ пароль (на планшете в перчатках
        # PIN удобнее; пароль остаётся резервом). PIN — короткий личный код подписанта.
        secret = signature.password
        pin_ok = bool(signer and signer.signing_pin_hash and verify_password(secret, signer.signing_pin_hash))
        pwd_ok = bool(signer and verify_password(secret, signer.password_hash))
        if not signer or not signer.is_active or not (pin_ok or pwd_ok):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Неверные учётные данные подписи (PIN/пароль)")
        signer_perms = {p.code for p in signer.role.permissions}
        if not any(code in signer_perms for code in required_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="У подписанта нет права на эту подпись (роль не соответствует ячейке)",
            )
        result = "success"
        return signer
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

