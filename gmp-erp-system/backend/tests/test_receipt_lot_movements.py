from datetime import date

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import create_app
from app.models.audit import AuditEvent, SignatureEvent
from app.models.identity import AuthSession
from app.models.inventory import FGShipmentDocument, FGShipmentLine, InventoryMovement, Lot, ReceiptDocument, ReceiptLine
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
        db.query(FGShipmentLine).delete()
        db.query(FGShipmentDocument).delete()
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


def create_posted_lot(client: TestClient) -> tuple[str, dict[str, str], str]:
    ref = create_reference_item()
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
    lots = client.get("/api/inventory/lots", headers=headers)
    assert lots.status_code == 200
    return lots.json()["lots"][0]["id"], ref, token


def test_transfer_and_adjustment_create_movements_and_update_lot() -> None:
    reset_inventory_data()
    client = TestClient(create_app())
    lot_id, ref, token = create_posted_lot(client)
    headers = {"Authorization": f"Bearer {token}"}
    db = SessionLocal()
    try:
        warehouse = db.get(Warehouse, ref["warehouse_id"])
        released_location = db.query(Location).filter(Location.warehouse_id == warehouse.id, Location.code == "RELEASED").one()
        released_location_id = str(released_location.id)
    finally:
        db.close()

    transfer = client.post(
        f"/api/inventory/lots/{lot_id}/transfer",
        headers=headers,
        json={
            "to_location_id": released_location_id,
            "reason": "Move to released zone after physical relocation",
        },
    )
    assert transfer.status_code == 200
    assert transfer.json()["location_code"] == "RELEASED"

    adjustment = client.post(
        f"/api/inventory/lots/{lot_id}/adjust",
        headers=headers,
        json={
            "new_quantity": 120.5,
            "username": "warehouse_substance",
            "password": "whs123",
            "meaning": "Adjust stock",
            "reason": "Inventory count correction",
        },
    )
    assert adjustment.status_code == 200
    assert adjustment.json()["quantity"] == 120.5

    movements = client.get("/api/inventory/movements", headers=headers)
    movement_types = [item["movement_type"] for item in movements.json()["movements"]]
    assert "TRANSFER" in movement_types
    assert "ADJUSTMENT" in movement_types


def test_issue_to_production_requires_released_lot_and_reduces_quantity() -> None:
    reset_inventory_data()
    client = TestClient(create_app())
    lot_id, _, token = create_posted_lot(client)
    headers = {"Authorization": f"Bearer {token}"}

    blocked = client.post(
        f"/api/inventory/lots/{lot_id}/issue-production",
        headers=headers,
        json={
            "quantity": 10,
            "production_order_no": "PO-2026-001",
            "username": "warehouse_substance",
            "password": "whs123",
            "meaning": "Issue to production",
            "reason": "Manufacturing request",
        },
    )
    assert blocked.status_code == 409

    db = SessionLocal()
    try:
        lot = db.get(Lot, lot_id)
        lot.quality_status = "released"
        db.commit()
    finally:
        db.close()

    issued = client.post(
        f"/api/inventory/lots/{lot_id}/issue-production",
        headers=headers,
        json={
            "quantity": 25.5,
            "production_order_no": "PO-2026-001",
            "username": "warehouse_substance",
            "password": "whs123",
            "meaning": "Issue to production",
            "reason": "Manufacturing request",
        },
    )
    assert issued.status_code == 200
    assert issued.json()["quantity"] == 100.0

    movements = client.get("/api/inventory/movements", headers=headers)
    first = movements.json()["movements"][0]
    assert first["movement_type"] == "ISSUE_PRODUCTION"
    assert first["quantity_delta"] == -25.5


def test_finished_goods_shipment_records_customer_traceability_and_reduces_stock() -> None:
    reset_inventory_data()
    db = SessionLocal()
    try:
        supplier = Supplier(code="SUP-FG-001", name="In-house packaging")
        manufacturer = Manufacturer(code="MFG-FG-001", name="Validated Finished Goods Site")
        material = Material(code="FG-TAB-500", name="Paracetamol tablets 500 mg", item_type="finished_good", default_unit="pack")
        fg = db.query(Warehouse).filter(Warehouse.warehouse_type == "FG_WAREHOUSE").one()
        location = db.query(Location).filter(Location.warehouse_id == fg.id, Location.code == "RELEASED").one()
        db.add_all([supplier, manufacturer, material])
        db.flush()
        lot = Lot(
            material_id=material.id,
            supplier_id=supplier.id,
            manufacturer_id=manufacturer.id,
            supplier_lot="BMR-2026-015",
            internal_lot="FG-2026-00015",
            item_type="finished_good",
            production_date=date(2026, 4, 20),
            production_year=2026,
            expiry_date=date(2028, 4, 19),
            warehouse_id=fg.id,
            location_id=location.id,
            quantity=1000,
            unit="pack",
            quality_status="released",
        )
        db.add(lot)
        db.commit()
        lot_id = str(lot.id)
    finally:
        db.close()

    client = TestClient(create_app())
    token = login(client, username="sys_admin", password="admin123")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/api/inventory/fg-shipments",
        headers=headers,
        json={
            "document_no": "SHP-2026-0001",
            "customer_name": "Tashkent Hospital No. 1",
            "customer_tax_id": "301234567",
            "destination_address": "Tashkent, Chilanzar district",
            "shipment_date": "2026-05-10",
            "vehicle_no": "01A123AA",
            "waybill_no": "WB-2026-0001",
            "lines": [{"lot_id": lot_id, "quantity": 250}],
            "username": "sys_admin",
            "password": "admin123",
            "meaning": "Ship finished goods",
            "reason": "Approved customer order",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "posted"
    assert response.json()["lines"][0]["internal_lot"] == "FG-2026-00015"
    assert response.json()["lines"][0]["quantity"] == 250

    lots = client.get("/api/inventory/lots", headers=headers).json()["lots"]
    shipped_lot = next(item for item in lots if item["id"] == lot_id)
    assert shipped_lot["quantity"] == 750

    shipments = client.get("/api/inventory/fg-shipments", headers=headers)
    assert shipments.status_code == 200
    assert shipments.json()["shipments"][0]["customer_name"] == "Tashkent Hospital No. 1"
    assert shipments.json()["shipments"][0]["lines"][0]["internal_lot"] == "FG-2026-00015"

    movements = client.get("/api/inventory/movements", headers=headers).json()["movements"]
    assert movements[0]["movement_type"] == "SHIPMENT"
    assert movements[0]["quantity_delta"] == -250
