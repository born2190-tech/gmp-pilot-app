"""Накладные на перемещение ГП цех → склад ГП (СОП-205 Ф-1, KAR-FP)."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.core.database import get_db
from app.models.inventory import FGTransferNote, FGTransferNoteLine, Lot, ProductionBatch
from app.schemas.inventory import (
    CompletedBatchesResponse,
    CompletedBatchItem,
    FGTransferNoteCreate,
    FGTransferNoteItem,
    FGTransferNoteLineItem,
    FGTransferNotesResponse,
    SignatureRequest,
)
from app.services.fg_warehouse import (
    cancel_fg_transfer_note,
    create_fg_transfer_note,
    receive_fg_transfer_note,
)
from app.services.permissions import require_permission

router = APIRouter(prefix="/api/fg-transfer", tags=["fg-transfer"])


def _note_item(db: Session, note: FGTransferNote) -> FGTransferNoteItem:
    rows = (
        db.query(FGTransferNoteLine)
        .filter(FGTransferNoteLine.note_id == note.id)
        .order_by(FGTransferNoteLine.created_at)
        .all()
    )
    lines: list[FGTransferNoteLineItem] = []
    for row in rows:
        internal_lot = None
        if row.lot_id:
            lot = db.get(Lot, row.lot_id)
            internal_lot = lot.internal_lot if lot else None
        lines.append(
            FGTransferNoteLineItem(
                id=row.id,
                description=row.description,
                quantity=row.quantity,
                unit=row.unit,
                lot_id=row.lot_id,
                internal_lot=internal_lot,
            )
        )
    return FGTransferNoteItem(
        id=note.id,
        note_no=note.note_no,
        status=note.status,
        production_batch_id=note.production_batch_id,
        product_code=note.product_code,
        product_name=note.product_name,
        batch_no=note.batch_no,
        dosage_form=note.dosage_form,
        production_date=note.production_date,
        expiry_date=note.expiry_date,
        from_workshop=note.from_workshop,
        issued_at=note.issued_at,
        received_at=note.received_at,
        received_warehouse_id=note.received_warehouse_id,
        notes=note.notes,
        lines=lines,
    )


@router.get("/completed-batches", response_model=CompletedBatchesResponse)
def completed_batches_route(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> CompletedBatchesResponse:
    """Завершённые серии для выпуска накладной на склад ГП."""
    require_permission(user, "VIEW_PRODUCTION")
    batches = (
        db.query(ProductionBatch)
        .filter(ProductionBatch.status == "completed")
        .order_by(ProductionBatch.completed_at.desc())
        .all()
    )
    noted = {
        row.production_batch_id
        for row in db.query(FGTransferNote.production_batch_id).filter(FGTransferNote.status != "cancelled").all()
    }
    items = [
        CompletedBatchItem(
            id=b.id,
            batch_no=b.batch_no,
            product_code=b.product_code,
            product_name=b.product_name,
            dosage_form=b.dosage_form,
            production_date=b.production_date,
            expiry_date=b.expiry_date,
            batch_size=b.batch_size,
            batch_size_unit=b.batch_size_unit,
            has_note=b.id in noted,
        )
        for b in batches
    ]
    return CompletedBatchesResponse(batches=items)


@router.get("", response_model=FGTransferNotesResponse)
def list_notes_route(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> FGTransferNotesResponse:
    require_permission(user, "VIEW_WAREHOUSE")
    notes = db.query(FGTransferNote).order_by(FGTransferNote.issued_at.desc()).all()
    return FGTransferNotesResponse(notes=[_note_item(db, n) for n in notes])


@router.post("", response_model=FGTransferNoteItem)
def create_note_route(
    payload: FGTransferNoteCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> FGTransferNoteItem:
    note = create_fg_transfer_note(db, user, payload)
    return _note_item(db, note)


@router.post("/{note_id}/receive", response_model=FGTransferNoteItem)
def receive_note_route(
    note_id: UUID,
    payload: SignatureRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> FGTransferNoteItem:
    note = receive_fg_transfer_note(db, user, note_id, payload)
    return _note_item(db, note)


@router.post("/{note_id}/cancel", response_model=FGTransferNoteItem)
def cancel_note_route(
    note_id: UUID,
    payload: SignatureRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> FGTransferNoteItem:
    note = cancel_fg_transfer_note(db, user, note_id, payload)
    return _note_item(db, note)
