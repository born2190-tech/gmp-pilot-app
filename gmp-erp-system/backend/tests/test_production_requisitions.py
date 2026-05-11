from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import create_app
from app.models.audit import AuditEvent, SignatureEvent
from app.models.identity import AuthSession
from app.models.inventory import (
    FGShipmentDocument,
    FGShipmentLine,
    InventoryCountDocument,
    InventoryCountLine,
    InventoryMovement,
    Lot,
    ProductionRequisition,
    ReceiptDocument,
    ReceiptLine,
    RequisitionAllocationLine,
    RequisitionLine,
)
from app.models.master_data import Location, Manufacturer, Material, Warehouse
from app.models.quality import QCNotification, QCNotificationLine, QCReport, QCReportParameter
from app.services.seed import seed_foundation_data


def reset_requisition_data() -> None:
    db = SessionLocal()
    try:
        db.query(SignatureEvent).delete()
        db.query(AuditEvent).delete()
        db.query(QCReportParameter).delete()
        db.query(QCReport).delete()
        db.query(QCNotificationLine).delete()
        db.query(QCNotification).delete()
        db.query(InventoryMovement).delete()
        db.query(InventoryCountLine).delete()
        db.query(InventoryCountDocument).delete()
        db.query(FGShipmentLine).delete()
        db.query(FGShipmentDocument).delete()
        db.query(RequisitionAllocationLine).delete()
        db.query(RequisitionLine).delete()
        db.query(ProductionRequisition).delete()
        db.query(Lot).delete()
        db.query(ReceiptLine).delete()
        db.query(ReceiptDocument).delete()
        db.query(AuthSession).delete()
        db.query(Material).delete()
        db.query(Manufacturer).delete()
        db.commit()
        seed_foundation_data(db)
    finally:
        db.close()


@pytest.fixture(autouse=True)
def clean_requisition_data():
    reset_requisition_data()
    yield
    reset_requisition_data()


def login(client: TestClient, username: str, password: str, workstation_id: str) -> str:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "workstation_id": workstation_id},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def create_released_fefo_lots() -> dict[str, str]:
    db = SessionLocal()
    try:
        material = Material(code="API-FEFO-001", name="FEFO API", item_type="raw_material", default_unit="kg")
        manufacturer = Manufacturer(code="MFG-FEFO-001", name="FEFO Manufacturer")
        db.add_all([material, manufacturer])
        db.flush()

        warehouse = db.query(Warehouse).filter(Warehouse.warehouse_type == "SUBSTANCE_WAREHOUSE").one()
        location = db.query(Location).filter(Location.warehouse_id == warehouse.id, Location.code == "RELEASED").one()

        later_lot = Lot(
            material_id=material.id,
            manufacturer_id=manufacturer.id,
            supplier_lot="SUP-LATE",
            internal_lot="LOT-FEFO-LATE",
            item_type=material.item_type,
            production_date=date(2026, 1, 10),
            production_year=2026,
            expiry_date=date(2028, 1, 10),
            warehouse_id=warehouse.id,
            location_id=location.id,
            quantity=50,
            unit="kg",
            quality_status="released",
        )
        earlier_lot = Lot(
            material_id=material.id,
            manufacturer_id=manufacturer.id,
            supplier_lot="SUP-EARLY",
            internal_lot="LOT-FEFO-EARLY",
            item_type=material.item_type,
            production_date=date(2026, 1, 1),
            production_year=2026,
            expiry_date=date(2027, 1, 1),
            warehouse_id=warehouse.id,
            location_id=location.id,
            quantity=80,
            unit="kg",
            quality_status="released",
        )
        db.add_all([later_lot, earlier_lot])
        db.commit()
        return {
            "material_id": str(material.id),
            "earlier_lot_id": str(earlier_lot.id),
            "later_lot_id": str(later_lot.id),
        }
    finally:
        db.close()


def test_production_requisition_creation_auto_allocates_released_lots_by_fefo() -> None:
    ref = create_released_fefo_lots()
    client = TestClient(create_app())
    token = login(client, "shift_master", "prod123", "WS-PROD-01")

    response = client.post(
        "/api/requisitions",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "product_name": "Tablet batch",
            "product_series": "TB-2026-001",
            "production_date": "2026-05-12",
            "production_order_no": "PO-2026-001",
            "lines": [
                {
                    "material_id": ref["material_id"],
                    "requested_quantity": 100,
                    "unit": "kg",
                }
            ],
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "processing"
    allocations = payload["lines"][0]["allocation_lines"]
    assert [row["lot_id"] for row in allocations] == [ref["earlier_lot_id"], ref["later_lot_id"]]
    assert [row["allocated_quantity"] for row in allocations] == [80, 20]


def test_production_user_can_edit_auto_allocation_before_issue() -> None:
    ref = create_released_fefo_lots()
    client = TestClient(create_app())
    token = login(client, "shift_master", "prod123", "WS-PROD-01")
    headers = {"Authorization": f"Bearer {token}"}

    created = client.post(
        "/api/requisitions",
        headers=headers,
        json={
            "product_name": "Tablet batch",
            "production_date": "2026-05-12",
            "lines": [{"material_id": ref["material_id"], "requested_quantity": 100, "unit": "kg"}],
        },
    )
    assert created.status_code == 200, created.text
    requisition_id = created.json()["id"]
    allocation_id = created.json()["lines"][0]["allocation_lines"][0]["id"]

    updated = client.patch(
        f"/api/requisitions/{requisition_id}/allocation",
        headers=headers,
        json={"updates": [{"id": allocation_id, "allocated_quantity": 70}]},
    )

    assert updated.status_code == 200, updated.text
    allocations = updated.json()["lines"][0]["allocation_lines"]
    edited_allocation = next(row for row in allocations if row["id"] == allocation_id)
    assert edited_allocation["allocated_quantity"] == 70
