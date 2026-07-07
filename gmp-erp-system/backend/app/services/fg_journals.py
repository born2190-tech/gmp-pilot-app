"""Журналы склада ГП (СОП-209): выводятся из существующих данных, без
отдельного хранения.

- Ф-9 приход ГП   — движения RECEIPT по накладным цеха (fg_transfer_note).
- Ф-6 расход ГП   — строки отгрузок (fg_shipment).
- Ф-5 извещения   — накладные на перемещение (FGTransferNote).
"""
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser
from app.models.inventory import (
    FGShipmentDocument,
    FGShipmentLine,
    FGTransferNote,
    FGTransferNoteLine,
    InventoryMovement,
    Lot,
)
from app.models.master_data import Material
from app.schemas.inventory import FGJournalRow
from app.services.permissions import require_permission


def _lot_series_product(db: Session, lot_id) -> tuple[str, str, str]:
    lot = db.get(Lot, lot_id)
    if lot is None:
        return ("—", "—", "упак")
    material = db.get(Material, lot.material_id)
    return (lot.internal_lot, material.name if material else "—", lot.unit)


def incoming_rows(db: Session) -> list[FGJournalRow]:
    rows = (
        db.query(InventoryMovement)
        .filter(InventoryMovement.document_type == "fg_transfer_note", InventoryMovement.movement_type == "RECEIPT")
        .order_by(InventoryMovement.created_at.desc())
        .all()
    )
    result: list[FGJournalRow] = []
    for m in rows:
        series, product, _ = _lot_series_product(db, m.lot_id)
        note = db.get(FGTransferNote, m.document_id)
        result.append(
            FGJournalRow(
                date=m.created_at,
                series=series,
                product=product,
                quantity=m.quantity_delta,
                unit=m.unit,
                document=note.note_no if note else None,
                counterparty=note.from_workshop if note else None,
            )
        )
    return result


def outgoing_rows(db: Session) -> list[FGJournalRow]:
    rows = (
        db.query(FGShipmentLine, FGShipmentDocument)
        .join(FGShipmentDocument, FGShipmentDocument.id == FGShipmentLine.shipment_id)
        .order_by(FGShipmentDocument.posted_at.desc())
        .all()
    )
    result: list[FGJournalRow] = []
    for line, shipment in rows:
        series, product, _ = _lot_series_product(db, line.lot_id)
        result.append(
            FGJournalRow(
                date=shipment.posted_at,
                series=series,
                product=product,
                quantity=line.quantity,
                unit=line.unit,
                document=shipment.document_no,
                counterparty=shipment.customer_name,
                note=shipment.waybill_no,
            )
        )
    return result


def notice_rows(db: Session) -> list[FGJournalRow]:
    notes = db.query(FGTransferNote).order_by(FGTransferNote.issued_at.desc()).all()
    result: list[FGJournalRow] = []
    for note in notes:
        lines = db.query(FGTransferNoteLine).filter(FGTransferNoteLine.note_id == note.id).all()
        qty = sum(line.quantity for line in lines)
        unit = lines[0].unit if lines else "упак"
        result.append(
            FGJournalRow(
                date=note.issued_at,
                series=note.batch_no,
                product=note.product_name,
                quantity=qty,
                unit=unit,
                document=note.note_no,
                counterparty=note.from_workshop,
                note=note.status,
            )
        )
    return result


def fg_journals(db: Session, user: CurrentUser) -> dict[str, list[FGJournalRow]]:
    require_permission(user, "VIEW_WAREHOUSE")
    return {
        "incoming": incoming_rows(db),
        "outgoing": outgoing_rows(db),
        "notices": notice_rows(db),
    }
