"""OOS / РНС — расследование несоответствия результата (СОП-549).

Открывается автоматически при подписании протокола ОКК с вердиктом
«НЕ соответствует». Пока есть открытое расследование по партии — допуск
серии (ОКА) заблокирован. Закрытие фиксирует первопричину, заключение и
диспозицию (брак / лабораторная ошибка → ретест / использование с обоснованием).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.quality import OOSInvestigation
from app.schemas.inventory import SignatureRequest
from app.services.audit import write_audit
from app.services.permissions import require_permission
from app.services.signature import validate_signature

DISPOSITIONS = ("confirmed_reject", "lab_error_retest", "use_as_is")


def _now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)


def has_open_oos(db: Session, lot_id: UUID) -> bool:
    return (
        db.query(OOSInvestigation.id)
        .filter(OOSInvestigation.lot_id == lot_id, OOSInvestigation.status != "closed")
        .first()
        is not None
    )


def list_oos(db: Session, status_filter: str | None = None) -> list[OOSInvestigation]:
    q = db.query(OOSInvestigation)
    if status_filter == "open":
        q = q.filter(OOSInvestigation.status != "closed")
    elif status_filter == "closed":
        q = q.filter(OOSInvestigation.status == "closed")
    return q.order_by(OOSInvestigation.opened_at.desc()).all()


def get_oos(db: Session, oos_id: UUID) -> OOSInvestigation:
    row = db.get(OOSInvestigation, oos_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OOS investigation not found")
    return row


def update_oos(db: Session, user: CurrentUser, oos_id: UUID, payload) -> OOSInvestigation:
    require_permission(user, "ENTER_QC_RESULT")
    row = get_oos(db, oos_id)
    if row.status == "closed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Investigation already closed")
    if payload.root_cause is not None:
        row.root_cause = payload.root_cause
    if payload.conclusion is not None:
        row.conclusion = payload.conclusion
    if payload.disposition is not None:
        if payload.disposition not in DISPOSITIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid disposition")
        row.disposition = payload.disposition
    if row.status == "open":
        row.status = "investigating"
    write_audit(db, user, object_type="oos_investigation", object_id=str(row.id),
                action_type="UPDATE_OOS", new_value={"status": row.status, "disposition": row.disposition})
    db.commit()
    db.refresh(row)
    return row


def close_oos(db: Session, user: CurrentUser, oos_id: UUID, payload) -> OOSInvestigation:
    require_permission(user, "ENTER_QC_RESULT")
    row = get_oos(db, oos_id)
    if row.status == "closed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Investigation already closed")
    if not payload.disposition or payload.disposition not in DISPOSITIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Disposition is required to close")
    if not (payload.conclusion or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Conclusion is required to close")
    validate_signature(db, user, payload, "CLOSE_OOS", "oos_investigation", str(row.id))
    row.conclusion = payload.conclusion
    row.disposition = payload.disposition
    if payload.root_cause is not None:
        row.root_cause = payload.root_cause
    row.status = "closed"
    row.closed_by = user.id
    row.closed_at = _now()
    write_audit(db, user, object_type="oos_investigation", object_id=str(row.id),
                action_type="CLOSE_OOS", new_value={"disposition": row.disposition, "conclusion": row.conclusion[:200]},
                reason=getattr(payload, "reason", None))
    db.commit()
    db.refresh(row)
    return row
