"""Machine-API маркировки для DataMatrix-генератора (СОП-414 п.6.4).

Аутентификация — общий ключ в заголовке `X-Marking-Key` (сервис-к-сервису,
не пользовательский токен). Пустой `GMP_MARKING_API_KEY` = интеграция выключена.
"""
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.schemas.inventory import (
    MarkingOrderResponse,
    MarkingReportRequest,
    MarkingReportResponse,
)
from app.services.fg_marking import get_marking_order, upsert_marking_report

router = APIRouter(prefix="/api/marking", tags=["marking"])


def require_marking_key(x_marking_key: str | None = Header(default=None, alias="X-Marking-Key")) -> None:
    if not settings.marking_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Интеграция маркировки не настроена (GMP_MARKING_API_KEY не задан)",
        )
    if x_marking_key != settings.marking_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный ключ маркировки")


@router.get("/orders/{batch_no}", response_model=MarkingOrderResponse)
def marking_order_route(
    batch_no: str,
    _: None = Depends(require_marking_key),
    db: Session = Depends(get_db),
) -> MarkingOrderResponse:
    return get_marking_order(db, batch_no)


@router.post("/report", response_model=MarkingReportResponse)
def marking_report_route(
    payload: MarkingReportRequest,
    _: None = Depends(require_marking_key),
    db: Session = Depends(get_db),
) -> MarkingReportResponse:
    return upsert_marking_report(db, payload)
