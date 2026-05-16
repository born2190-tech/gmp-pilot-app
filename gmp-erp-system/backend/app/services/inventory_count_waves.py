"""GMP-style inventory count workflow.

State machine:

    planning ─start_wave→ counting ─submit_for_verification→ verification
                                                                  │
                                            ┌─────────────────────┤
                                            │                     │
                          all lines verified│                     │
                                            ▼                     │
                                          posted                  │
                                                                  │
                                           cancel ───────► cancelled

A wave is created in `counting` immediately (no separate "planning" wait):
the API call snapshots system_qty for the matching lots and lets counters
start typing. We keep the `planning` status reserved for the (future)
case where QA wants to review the scope before counters get access.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.identity import User
from app.models.inventory import (
    InventoryCountWave,
    InventoryCountWaveLine,
    InventoryMovement,
    Lot,
)
from app.models.master_data import Warehouse
from app.schemas.inventory import (
    InventoryWaveCancelRequest,
    InventoryWaveLineUpdate,
    InventoryWavePostRequest,
    InventoryWaveStartRequest,
    InventoryWaveSubmitRequest,
    InventoryWaveVerifyRequest,
    WaveScope,
)
from app.services.audit import write_audit
from app.services.permissions import require_permission
from app.services.signature import validate_signature


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_wave(db: Session, wave_id: UUID) -> InventoryCountWave:
    wave = db.get(InventoryCountWave, wave_id)
    if not wave:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory wave not found")
    return wave


def _generate_wave_no(db: Session) -> str:
    today = now_utc().strftime("%Y%m%d")
    last = (
        db.query(InventoryCountWave.wave_no)
        .filter(InventoryCountWave.wave_no.like(f"INV-{today}-%"))
        .order_by(InventoryCountWave.wave_no.desc())
        .limit(1)
        .scalar()
    )
    seq = 1
    if last:
        try:
            seq = int(last.rsplit("-", 1)[-1]) + 1
        except ValueError:
            seq = 1
    return f"INV-{today}-{seq:03d}"


def _resolve_scope_lots(db: Session, scope: WaveScope) -> list[Lot]:
    """Materialise the scope filter to a concrete list of lots."""
    if scope.lot_ids:
        return (
            db.query(Lot)
            .filter(Lot.id.in_(scope.lot_ids))
            .order_by(Lot.rack_no, Lot.tier_no, Lot.place_no, Lot.created_at)
            .all()
        )
    query = db.query(Lot).filter(Lot.warehouse_id == scope.warehouse_id, Lot.quantity > 0)
    if scope.rack_no:
        query = query.filter(Lot.rack_no == scope.rack_no)
    if scope.location_code:
        # Join with the lot's location to allow filtering by zone code.
        from app.models.master_data import Location

        query = query.join(Location, Location.id == Lot.location_id).filter(Location.code == scope.location_code)
    return query.order_by(Lot.rack_no, Lot.tier_no, Lot.place_no, Lot.created_at).all()


def _describe_scope(db: Session, warehouse: Warehouse, scope: WaveScope, lots: list[Lot]) -> str:
    if scope.lot_ids:
        return f"Произвольный список ({len(lots)} лотов)"
    if scope.rack_no:
        return f"Стеллаж {scope.rack_no}"
    if scope.location_code:
        return f"Зона {scope.location_code}"
    return f"Весь склад · {warehouse.name}"


def _within_tolerance(variance_pct: float | None, tolerance_pct: float) -> bool:
    if variance_pct is None:
        return False
    return abs(variance_pct) <= tolerance_pct


def _line_status(actual: float, system: float, tolerance_pct: float) -> tuple[str, float, float]:
    variance = actual - system
    pct = (variance / system * 100.0) if system > 0 else (100.0 if actual > 0 else 0.0)
    if _within_tolerance(pct, tolerance_pct):
        return "within_tolerance", variance, pct
    return "needs_verification", variance, pct


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

def start_wave(db: Session, user: CurrentUser, payload: InventoryWaveStartRequest) -> InventoryCountWave:
    require_permission(user, "COUNT_INVENTORY")

    warehouse = db.get(Warehouse, payload.scope.warehouse_id)
    if not warehouse:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Warehouse not found")

    lots = _resolve_scope_lots(db, payload.scope)
    if not lots:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No lots match the wave scope — nothing to count",
        )

    verifier = None
    if payload.verifier_username:
        verifier = db.query(User).filter(User.username == payload.verifier_username).first()
        if not verifier:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Verifier user not found")
        if verifier.id == user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Verifier must be different from the wave creator (4-eyes rule)",
            )

    wave_no = (payload.wave_no or "").strip() or _generate_wave_no(db)
    if db.query(InventoryCountWave).filter(InventoryCountWave.wave_no == wave_no).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Wave number already exists")

    counters_csv = ",".join(payload.counters) if payload.counters else None
    scope_text = _describe_scope(db, warehouse, payload.scope, lots)

    wave = InventoryCountWave(
        wave_no=wave_no,
        status="counting",
        warehouse_id=warehouse.id,
        scope_description=scope_text,
        tolerance_pct=payload.tolerance_pct,
        created_by=user.id,
        started_at=now_utc(),
        counters=counters_csv,
        verifier_id=verifier.id if verifier else None,
    )
    db.add(wave)
    db.flush()

    for lot in lots:
        db.add(
            InventoryCountWaveLine(
                wave_id=wave.id,
                lot_id=lot.id,
                status="pending",
                system_quantity=lot.quantity,
                unit=lot.unit,
            )
        )

    write_audit(
        db,
        user,
        object_type="inventory_count_wave",
        object_id=str(wave.id),
        action_type="START_INVENTORY_WAVE",
        new_value={
            "wave_no": wave_no,
            "warehouse": warehouse.code,
            "scope": scope_text,
            "tolerance_pct": payload.tolerance_pct,
            "lots": len(lots),
        },
        reason=payload.reason,
    )
    db.commit()
    db.refresh(wave)
    return wave


# ---------------------------------------------------------------------------
# Save line (counter action)
# ---------------------------------------------------------------------------

def save_line(
    db: Session,
    user: CurrentUser,
    wave_id: UUID,
    line_id: UUID,
    payload: InventoryWaveLineUpdate,
) -> InventoryCountWaveLine:
    require_permission(user, "COUNT_INVENTORY")
    wave = _get_wave(db, wave_id)
    if wave.status != "counting":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Lines can only be recorded while the wave is in `counting` state",
        )
    line = db.get(InventoryCountWaveLine, line_id)
    if not line or line.wave_id != wave_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wave line not found")

    new_status, variance, pct = _line_status(payload.actual_quantity, line.system_quantity, wave.tolerance_pct)
    # If the line had already been verified, recounting resets verification.
    line.status = new_status
    line.actual_quantity = payload.actual_quantity
    line.variance = variance
    line.variance_pct = pct
    line.notes = (payload.notes or "").strip() or None
    line.counted_by = user.id
    line.counted_at = now_utc()
    line.verified_by = None
    line.verified_at = None
    line.verifier_comment = None

    write_audit(
        db,
        user,
        object_type="inventory_count_wave_line",
        object_id=str(line.id),
        action_type="COUNT_INVENTORY_LINE",
        new_value={
            "actual": payload.actual_quantity,
            "system": line.system_quantity,
            "variance": variance,
            "variance_pct": round(pct, 3),
            "status": new_status,
        },
    )
    db.commit()
    db.refresh(line)
    return line


# ---------------------------------------------------------------------------
# Submit for verification (wave transition)
# ---------------------------------------------------------------------------

def submit_for_verification(
    db: Session,
    user: CurrentUser,
    wave_id: UUID,
    payload: InventoryWaveSubmitRequest,
) -> InventoryCountWave:
    require_permission(user, "COUNT_INVENTORY")
    wave = _get_wave(db, wave_id)
    if wave.status != "counting":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Wave is not in counting state")
    pending = (
        db.query(InventoryCountWaveLine)
        .filter(InventoryCountWaveLine.wave_id == wave.id, InventoryCountWaveLine.status == "pending")
        .count()
    )
    if pending > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot submit — {pending} lines have not been counted yet",
        )
    wave.status = "verification"
    wave.submitted_at = now_utc()
    write_audit(
        db,
        user,
        object_type="inventory_count_wave",
        object_id=str(wave.id),
        action_type="SUBMIT_INVENTORY_WAVE",
        new_value={"wave_no": wave.wave_no},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(wave)
    return wave


# ---------------------------------------------------------------------------
# Verify line (verifier action)
# ---------------------------------------------------------------------------

def verify_line(
    db: Session,
    user: CurrentUser,
    wave_id: UUID,
    line_id: UUID,
    payload: InventoryWaveVerifyRequest,
) -> InventoryCountWaveLine:
    require_permission(user, "VERIFY_INVENTORY_COUNT")
    wave = _get_wave(db, wave_id)
    if wave.status != "verification":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Wave is not under verification")
    line = db.get(InventoryCountWaveLine, line_id)
    if not line or line.wave_id != wave_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wave line not found")
    if line.status != "needs_verification":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Line does not need verification")
    if line.counted_by == user.id:
        # 4-eyes — the same user can't be counter and verifier of the same line.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verifier must differ from the counter for the same line",
        )

    if payload.decision == "confirm":
        line.status = "verified"
    else:  # escalate
        line.status = "rejected"
    line.verified_by = user.id
    line.verified_at = now_utc()
    line.verifier_comment = (payload.comment or "").strip() or None

    write_audit(
        db,
        user,
        object_type="inventory_count_wave_line",
        object_id=str(line.id),
        action_type=f"{'CONFIRM' if payload.decision == 'confirm' else 'ESCALATE'}_INVENTORY_LINE",
        new_value={
            "decision": payload.decision,
            "comment": line.verifier_comment,
            "actual": line.actual_quantity,
            "variance_pct": round(line.variance_pct or 0.0, 3),
        },
    )
    db.commit()
    db.refresh(line)
    return line


# ---------------------------------------------------------------------------
# Post wave (final QA sign-off)
# ---------------------------------------------------------------------------

def post_wave(
    db: Session,
    user: CurrentUser,
    wave_id: UUID,
    payload: InventoryWavePostRequest,
) -> InventoryCountWave:
    require_permission(user, "POST_INVENTORY_COUNT")
    wave = _get_wave(db, wave_id)
    if wave.status != "verification":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Wave must finish verification before it can be posted",
        )

    lines = (
        db.query(InventoryCountWaveLine)
        .filter(InventoryCountWaveLine.wave_id == wave.id)
        .all()
    )
    pending_verify = [
        line for line in lines if line.status == "needs_verification"
    ]
    if pending_verify:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot post — {len(pending_verify)} variance line(s) are still awaiting verification",
        )
    rejected = [line for line in lines if line.status == "rejected"]
    if rejected:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot post — {len(rejected)} line(s) were escalated and remain unresolved",
        )

    validate_signature(db, user, payload, "POST_INVENTORY_COUNT", "inventory_count_wave", str(wave.id))

    posted_at = now_utc()
    adjusted = 0
    for line in lines:
        if line.actual_quantity is None or line.actual_quantity == line.system_quantity:
            continue
        lot = db.get(Lot, line.lot_id)
        if not lot:
            continue
        delta = line.actual_quantity - lot.quantity
        old_qty = lot.quantity
        lot.quantity = line.actual_quantity
        db.add(
            InventoryMovement(
                movement_type="INVENTORY_COUNT",
                document_type="inventory_count_wave",
                document_id=wave.id,
                lot_id=lot.id,
                from_warehouse_id=lot.warehouse_id,
                from_location_id=lot.location_id,
                to_warehouse_id=lot.warehouse_id,
                to_location_id=lot.location_id,
                quantity_delta=delta,
                quantity_after=lot.quantity,
                unit=lot.unit,
                reason=f"{wave.wave_no}: {payload.reason or ''}".strip(),
                user_id=user.id,
                workstation_id=user.workstation_id,
            )
        )
        write_audit(
            db,
            user,
            object_type="lot",
            object_id=str(lot.id),
            action_type="POST_INVENTORY_COUNT",
            old_value={"quantity": old_qty},
            new_value={
                "quantity": lot.quantity,
                "variance": delta,
                "wave_no": wave.wave_no,
            },
            reason=payload.reason,
        )
        adjusted += 1

    wave.status = "posted"
    wave.posted_by = user.id
    wave.posted_at = posted_at

    write_audit(
        db,
        user,
        object_type="inventory_count_wave",
        object_id=str(wave.id),
        action_type="POST_INVENTORY_WAVE",
        new_value={
            "wave_no": wave.wave_no,
            "warehouse_type": wave.warehouse.warehouse_type if wave.warehouse else None,
            "lines": len(lines),
            "adjusted": adjusted,
        },
        reason=payload.reason,
    )
    db.commit()
    db.refresh(wave)
    return wave


# ---------------------------------------------------------------------------
# Cancel wave
# ---------------------------------------------------------------------------

def cancel_wave(
    db: Session,
    user: CurrentUser,
    wave_id: UUID,
    payload: InventoryWaveCancelRequest,
) -> InventoryCountWave:
    require_permission(user, "COUNT_INVENTORY")
    wave = _get_wave(db, wave_id)
    if wave.status in {"posted", "cancelled"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Wave cannot be cancelled in its current state")
    if wave.created_by != user.id and "POST_INVENTORY_COUNT" not in user.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the wave creator or a QA officer can cancel a wave",
        )
    wave.status = "cancelled"
    write_audit(
        db,
        user,
        object_type="inventory_count_wave",
        object_id=str(wave.id),
        action_type="CANCEL_INVENTORY_WAVE",
        new_value={"wave_no": wave.wave_no},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(wave)
    return wave


# ---------------------------------------------------------------------------
# Listing / reading
# ---------------------------------------------------------------------------

def list_waves(
    db: Session,
    user: CurrentUser,
    status_filter: str | None = None,
) -> list[InventoryCountWave]:
    if "VIEW_WAREHOUSE" not in user.permissions and "VIEW_QA" not in user.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission VIEW_WAREHOUSE or VIEW_QA is required",
        )
    query = db.query(InventoryCountWave).join(Warehouse, Warehouse.id == InventoryCountWave.warehouse_id)
    if user.warehouse_scope:
        query = query.filter(Warehouse.warehouse_type == user.warehouse_scope)
    if status_filter:
        query = query.filter(InventoryCountWave.status == status_filter)
    return query.order_by(InventoryCountWave.started_at.desc()).all()


def get_wave(db: Session, user: CurrentUser, wave_id: UUID) -> InventoryCountWave:
    if "VIEW_WAREHOUSE" not in user.permissions and "VIEW_QA" not in user.permissions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission VIEW_WAREHOUSE or VIEW_QA is required",
        )
    wave = _get_wave(db, wave_id)
    warehouse = db.get(Warehouse, wave.warehouse_id)
    if user.warehouse_scope and warehouse and warehouse.warehouse_type != user.warehouse_scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Wave is out of warehouse scope")
    return wave


__all__ = [
    "start_wave",
    "save_line",
    "submit_for_verification",
    "verify_line",
    "post_wave",
    "cancel_wave",
    "list_waves",
    "get_wave",
]
