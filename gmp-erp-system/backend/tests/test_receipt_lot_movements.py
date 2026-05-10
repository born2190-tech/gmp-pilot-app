from datetime import date

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import create_app
from app.models.audit import AuditEvent, SignatureEvent
from app.models.identity import AuthSession
from app.models.inventory import InventoryMovement, Lot, ReceiptDocument, ReceiptLine
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.models.quality import QCReport, QCReportParameter
from app.services.seed import seed_foundation_data


def reset_inventory_data() -> None:
    db = SessionLocal()
    try:
        db.query(SignatureEvent).delete()
        db.query(AuditEvent).delete()
        db.query(QCReportParameter).delete()
        db.query(QCReport).delete()
        db.query(InventoryMovement).delete()
        db.query(Lot).delete()
        db.query(ReceiptLine).delete()
        db.query(ReceiptDocument).delete()
        db.query(AuthSession).delete()
        db.query(Material).delete()
        db.query(Supplier).delete()
        db.query(Manufacturer).delete()
        db.commit()
        seed_foundation_data(db)
    finally:
        db.close()


def create_reference_item() -> dict[str, str]:
    db = SessionLocal()
    try:
        supplier = Supplier(code="SUP-REAL-001", name="Validated Supplier")
        manufacturer = Manufacturer(code="MFG-REAL-001", name="Validated Manufacturer")
        material = Material(code="API-REAL-001", name="Validated API", item_type="raw_material", default_unit="kg")
        db.add_all([supplier, manufacturer, material])
        db.commit()
        warehouse = db.query(Warehouse).filter(Warehouse.warehouse_type == "SUBSTANCE_WAREHOUSE").one()
        location = db.query(Location).filter(Location.warehouse_id == warehouse.id, Location.code == "RECEIVING").one()
        return {
            "supplier_id": str(supplier.id),
            "manufacturer_id": str(manufacturer.id),
            "warehouse_id": str(warehouse.id),
            "material_id": str(material.id),
            "location_id": str(location.id),
        }
    finally:
        db.close()


def login(client: TestClient, username: str = "warehouse_substance", password: str = "whs123") -> str:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "workstation_id": "WS-SUB-01"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def receipt_payload(ref: dict[str, str]) -> dict:
    return {
        "document_no": "REC-2026-0001",
        "supplier_id": ref["supplier_id"],
        "manufacturer_id": ref["manufacturer_id"],
        "warehouse_id": ref["warehouse_id"],
        "received_date": "2026-05-10",
        "lines": [
            {
                "material_id": ref["material_id"],
                "supplier_lot": "SUP-LOT-001",
                "production_date": "2026-01-15",
                "production_year": 2026,
                "expiry_date": "2028-01-14",
                "quantity": 125.5,
                "unit": "kg",
                "location_id": ref["location_id"],
            }
        ],
    }


def test_receipt_posting_creates_lot_and_receipt_movement() -> None:
    reset_inventory_data()
    ref = create_reference_item()
    client = TestClient(create_app())
    token = login(client)
    headers = {"Authorization": f"Bearer {token}"}

    draft = client.post("/api/inventory/receipts", headers=headers, json=receipt_payload(ref))
    assert draft.status_code == 200

    posted = client.post(
        f"/api/inventory/receipts/{draft.json()['id']}/post",
        headers=headers,
        json={
            "username": "warehouse_substance",
            "password": "whs123",
            "meaning": "Post receipt",
            "reason": "Supplier delivery accepted",
        },
    )

    assert posted.status_code == 200
    assert posted.json()["status"] == "posted"
    assert posted.json()["lots_created"] == 1

    lots = client.get("/api/inventory/lots", headers=headers)
    movements = client.get("/api/inventory/movements", headers=headers)

    assert lots.status_code == 200
    assert movements.status_code == 200
    lot = lots.json()["lots"][0]
    assert lot["manufacturer_name"] == "Validated Manufacturer"
    assert lot["production_date"] == "2026-01-15"
    assert lot["expiry_date"] == "2028-01-14"
    assert lot["incoming_control_notified_at"] is not None
    assert lot["qc_result_received_at"] is None
    assert movements.json()["movements"][0]["movement_type"] == "RECEIPT"


def test_warehouse_scope_blocks_receipt_for_other_warehouse() -> None:
    reset_inventory_data()
    ref = create_reference_item()
    db = SessionLocal()
    try:
        fg = db.query(Warehouse).filter(Warehouse.warehouse_type == "FG_WAREHOUSE").one()
        fg_location = db.query(Location).filter(Location.warehouse_id == fg.id, Location.code == "RECEIVING").one()
        ref["warehouse_id"] = str(fg.id)
        ref["location_id"] = str(fg_location.id)
    finally:
        db.close()

    client = TestClient(create_app())
    token = login(client)

    response = client.post("/api/inventory/receipts", headers={"Authorization": f"Bearer {token}"}, json=receipt_payload(ref))

    assert response.status_code == 403
    assert "Warehouse scope" in response.json()["detail"]
