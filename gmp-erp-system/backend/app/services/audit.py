from typing import Any

from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.audit import AuditEvent


def write_audit(
    db: Session,
    user: CurrentUser,
    object_type: str,
    object_id: str,
    action_type: str,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    reason: str | None = None,
    source: str = "API",
) -> None:
    db.add(
        AuditEvent(
            user_id=user.id,
            role_code=user.role,
            workstation_id=user.workstation_id,
            object_type=object_type,
            object_id=object_id,
            action_type=action_type,
            old_value_json=old_value,
            new_value_json=new_value,
            reason=reason,
            source=source,
        )
    )
