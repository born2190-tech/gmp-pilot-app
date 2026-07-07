"""Machine-API маркировки: DataMatrix-генератор ↔ GMP ERP (СОП-414 п.6.4).

Генератор подтягивает из ERP заказ на маркировку серии (GTIN, № серии, даты)
вместо ручного ввода `PRODUCTION_ORDER_ID`, а после нанесения/агрегации шлёт
обратно результат (reportId ASL, число кодов, список SSCC гофрокоробов).
Связь по № серии (`batch_no` == `Lot.internal_lot` партии ГП).
"""
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from sqlalchemy import func

from app.models.inventory import FGMarking, FGMarkingSscc, ProductionBatch, Product
from app.schemas.inventory import (
    FGMarkingItem,
    MarkingOrderResponse,
    MarkingReportRequest,
    MarkingReportResponse,
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _resolve_product(db: Session, batch: ProductionBatch) -> Product | None:
    if batch.product_id:
        product = db.get(Product, batch.product_id)
        if product:
            return product
    return db.query(Product).filter(Product.code == batch.product_code).first()


def get_marking_order(db: Session, batch_no: str) -> MarkingOrderResponse:
    batch = db.query(ProductionBatch).filter(ProductionBatch.batch_no == batch_no).first()
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Серия не найдена: {batch_no}")
    product = _resolve_product(db, batch)
    return MarkingOrderResponse(
        production_order_id=str(batch.id),
        series_number=batch.batch_no,
        gtin=product.gtin if product else None,
        product_code=batch.product_code,
        product_name=batch.product_name,
        production_date=batch.production_date,
        expiry_date=batch.expiry_date,
        quantity=batch.batch_size,
    )


def list_fg_markings(db: Session) -> list[FGMarkingItem]:
    """Сводка маркировки по всем сериям (для Реестра ГП). Число SSCC — одним
    агрегатным запросом, чтобы не дёргать БД по каждой серии."""
    sscc_counts = dict(
        db.query(FGMarkingSscc.marking_id, func.count(FGMarkingSscc.id))
        .group_by(FGMarkingSscc.marking_id)
        .all()
    )
    items: list[FGMarkingItem] = []
    for m in db.query(FGMarking).order_by(FGMarking.reported_at.desc().nullslast()).all():
        items.append(
            FGMarkingItem(
                batch_no=m.batch_no,
                status=m.status,
                gtin=m.gtin,
                report_id=m.report_id,
                code_count=m.code_count,
                sscc_count=int(sscc_counts.get(m.id, 0)),
                reported_at=m.reported_at,
            )
        )
    return items


def upsert_marking_report(db: Session, payload: MarkingReportRequest) -> MarkingReportResponse:
    batch = db.query(ProductionBatch).filter(ProductionBatch.batch_no == payload.batch_no).first()
    marking = db.query(FGMarking).filter(FGMarking.batch_no == payload.batch_no).first()
    if marking is None:
        marking = FGMarking(batch_no=payload.batch_no)
        db.add(marking)
        db.flush()

    marking.production_batch_id = batch.id if batch else marking.production_batch_id
    marking.status = payload.status or "applied"
    if payload.report_id is not None:
        marking.report_id = payload.report_id
    if payload.code_count is not None:
        marking.code_count = payload.code_count
    if payload.gtin is not None:
        marking.gtin = payload.gtin
    marking.reported_at = now_utc()

    # SSCC-агрегация приходит полным набором — заменяем целиком.
    if payload.sscc:
        db.query(FGMarkingSscc).filter(FGMarkingSscc.marking_id == marking.id).delete(synchronize_session=False)
        for line in payload.sscc:
            db.add(FGMarkingSscc(marking_id=marking.id, sscc=line.code.strip(), capacity=line.capacity))

    db.commit()
    db.refresh(marking)
    sscc_count = db.query(FGMarkingSscc).filter(FGMarkingSscc.marking_id == marking.id).count()
    return MarkingReportResponse(
        batch_no=marking.batch_no,
        status=marking.status,
        sscc_count=sscc_count,
        code_count=marking.code_count,
    )
