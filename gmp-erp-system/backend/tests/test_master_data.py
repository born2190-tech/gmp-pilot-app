from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import create_app
from app.models.audit import AuditEvent, SignatureEvent
from app.models.identity import AuthSession, Department, Permission, Role, User, role_permissions
from app.models.inventory import InventoryMovement, Lot, ReceiptDocument, ReceiptLine
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.services.seed import seed_foundation_data


def reset_seeded_data() -> None:
    db = SessionLocal()
    try:
        db.query(SignatureEvent).delete()
        db.query(AuditEvent).delete()
        db.query(InventoryMovement).delete()
        db.query(Lot).delete()
        db.query(ReceiptLine).delete()
        db.query(ReceiptDocument).delete()
        db.query(AuthSession).delete()
        db.query(User).delete()
        db.execute(role_permissions.delete())
        db.query(Role).delete()
        db.query(Permission).delete()
        db.query(Department).delete()
        db.query(Location).delete()
        db.query(Warehouse).delete()
        db.query(Supplier).delete()
        db.query(Manufacturer).delete()
        db.query(Material).delete()
        db.commit()
    finally:
        db.close()


def login_as_sys_admin(client: TestClient) -> str:
    response = client.post(
        "/api/auth/login",
        json={"username": "sys_admin", "password": "admin123", "workstation_id": "WS-ADMIN-01"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_seed_creates_warehouse_department_roles_and_material_types() -> None:
    reset_seeded_data()
    db = SessionLocal()
    try:
        seed_foundation_data(db)

        warehouse_types = {row.warehouse_type for row in db.query(Warehouse).all()}
        role_codes = {row.code for row in db.query(Role).all()}
        material_types = {row.item_type for row in db.query(Material).all()}

        assert {"SUBSTANCE_WAREHOUSE", "PACKAGING_WAREHOUSE", "FG_WAREHOUSE"} <= warehouse_types
        assert {"HEAD_QA", "HEAD_QC", "HEAD_PRODUCTION", "WORKSHOP_HEAD", "CHIEF_TECHNOLOGIST"} <= role_codes
        assert material_types == set()
    finally:
        db.close()


def test_master_data_read_apis_return_seeded_records() -> None:
    reset_seeded_data()
    db = SessionLocal()
    try:
        seed_foundation_data(db)
    finally:
        db.close()

    client = TestClient(create_app())
    token = login_as_sys_admin(client)
    headers = {"Authorization": f"Bearer {token}"}

    warehouses = client.get("/api/master-data/warehouses", headers=headers)
    materials = client.get("/api/master-data/materials", headers=headers)
    suppliers = client.get("/api/master-data/suppliers", headers=headers)
    manufacturers = client.get("/api/master-data/manufacturers", headers=headers)

    assert warehouses.status_code == 200
    assert materials.status_code == 200
    assert suppliers.status_code == 200
    assert manufacturers.status_code == 200
    assert {"SUBSTANCE_WAREHOUSE", "PACKAGING_WAREHOUSE", "FG_WAREHOUSE"} <= {
        item["warehouse_type"] for item in warehouses.json()["warehouses"]
    }
    assert materials.json()["materials"] == []
    assert suppliers.json()["suppliers"] == []
    assert manufacturers.json()["manufacturers"] == []
