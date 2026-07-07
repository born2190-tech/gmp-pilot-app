"""Didox (ЭДО/ЭСФ) — скаффолд машинной интеграции для отгрузки ГП.

Контракт восстановлен из открытого npm-SDK `didox` (v1.0.6): база
`api-partners.didox.uz`, два заголовка `Partner-Authorization` (partner token,
выдаёт Didox под ИНН) + `Authorization` (сессия компании, `loginLegalEntity`
taxId+password → access token, 360 мин), документы — `POST /v2/documents`
(ЭСФ = тип 002).

⚠️ Пока интеграция ВЫКЛючена (нет partner token): реальные вызовы не идут,
`issue_esf` отвечает 503. Точные пути логина/подписи E-IMZO сверить по
партнёрскому пакету Didox, когда будет токен. Билдер тела ЭСФ (`build_esf_document`)
— чистый и тестируемый уже сейчас.
"""
import json
import urllib.request
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.inventory import FGShipmentDocument, FGShipmentLine, Lot
from app.models.master_data import Material

# Классификатор единиц Soliq: 796 = штука/упаковка (уточнить под номенклатуру).
DEFAULT_MEASURE_ID = 796
DEFAULT_VAT_RATE = 12
DOCUMENTS_PATH = "/v2/documents"
LOGIN_PATH = "/login"  # ⚠️ сверить с партнёрским пакетом Didox


def didox_enabled() -> bool:
    return bool(settings.didox_partner_token and settings.didox_tax_id and settings.didox_password)


def build_esf_document(db: Session, shipment: FGShipmentDocument, lines: list[FGShipmentLine]) -> dict:
    """Чистый билдер тела ЭСФ (тип 002) из отгрузки ГП. Не ходит в сеть."""
    products = []
    for idx, line in enumerate(lines, start=1):
        lot = db.get(Lot, line.lot_id)
        material = db.get(Material, lot.material_id) if lot else None
        products.append(
            {
                "ordNo": idx,
                "name": material.name if material else (lot.internal_lot if lot else "—"),
                "measureId": DEFAULT_MEASURE_ID,
                "count": line.quantity,
                # ⚠️ Цена/НДС по строке пока не хранятся на отгрузке ГП — 0-заглушка.
                "price": 0,
                "vatRate": DEFAULT_VAT_RATE,
            }
        )
    return {
        "documentType": 2,  # 002 — ЭСФ
        "seller": {
            "tin": settings.didox_tax_id,
            "name": settings.didox_seller_name,
            "account": settings.didox_seller_account,
            "bankId": settings.didox_seller_bank_id,
        },
        "buyer": {
            "tin": shipment.customer_tax_id or "",
            "name": shipment.customer_name,
        },
        "basicInfo": {
            "contractNumber": shipment.document_no,
            "contractDate": shipment.shipment_date.strftime("%d.%m.%Y"),
        },
        "products": products,
    }


class DidoxClient:
    def __init__(self) -> None:
        self.base = settings.didox_base_url.rstrip("/")
        self.partner_token = settings.didox_partner_token
        self._access_token: str | None = None

    def _post(self, path: str, body: dict, with_auth: bool = True) -> dict:
        req = urllib.request.Request(f"{self.base}{path}", data=json.dumps(body).encode("utf-8"), method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Partner-Authorization", self.partner_token)
        if with_auth and self._access_token:
            req.add_header("Authorization", self._access_token)
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 — партнёрский HTTPS-эндпоинт
            return json.loads(resp.read().decode("utf-8"))

    def login(self) -> None:
        data = self._post(LOGIN_PATH, {"taxId": settings.didox_tax_id, "password": settings.didox_password}, with_auth=False)
        self._access_token = data.get("token")

    def create_document(self, body: dict) -> dict:
        if not self._access_token:
            self.login()
        return self._post(DOCUMENTS_PATH, body)


def issue_esf(db: Session, shipment_id: UUID) -> FGShipmentDocument:
    if not didox_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Интеграция Didox не настроена (нет partner token / логина). См. GMP_DIDOX_*.",
        )
    shipment = db.get(FGShipmentDocument, shipment_id)
    if shipment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Отгрузка не найдена")
    lines = db.query(FGShipmentLine).filter(FGShipmentLine.shipment_id == shipment.id).all()
    body = build_esf_document(db, shipment, lines)
    result = DidoxClient().create_document(body)
    shipment.didox_id = result.get("documentId") or result.get("id")
    shipment.didox_status = result.get("status") or "draft"
    db.commit()
    db.refresh(shipment)
    return shipment
