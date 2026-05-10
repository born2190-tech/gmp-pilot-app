from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import create_app
from app.models.audit import AuditEvent, SignatureEvent
from app.models.identity import AuthSession, Department, Permission, Role, User, role_permissions
from app.models.inventory import FGShipmentDocument, FGShipmentLine, InventoryMovement, Lot, ReceiptDocument, ReceiptLine
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse
from app.models.quality import QCReport, QCReportParameter
from app.services.seed import seed_foundation_data


def reset_seeded_data() -> None:
    db = SessionLocal()
    try:
        db.query(SignatureEvent).delete()
        db.query(AuditEvent).delete()
        db.query(QCReportParameter).delete()
        db.query(QCReport).delete()
        db.query(InventoryMovement).delete()
        db.query(FGShipmentLine).delete()
        db.query(FGShipmentDocument).delete()
        db.query(ReceiptLine).delete()
        db.query(ReceiptDocument).delete()
        db.query(Lot).delete()
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


def login_as_warehouse_operator(client: TestClient) -> str:
    response = client.post(
        "/api/auth/login",
        json={"username": "warehouse_substance", "password": "whs123", "workstation_id": "WS-WH-01"},
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


def test_sys_admin_can_create_master_data_with_audit_events() -> None:
    reset_seeded_data()
    db = SessionLocal()
    try:
        seed_foundation_data(db)
    finally:
        db.close()

    client = TestClient(create_app())
    token = login_as_sys_admin(client)
    headers = {"Authorization": f"Bearer {token}"}

    supplier = client.post(
        "/api/master-data/suppliers",
        json={"code": "SUP-001", "name": "Validated Supplier"},
        headers=headers,
    )
    manufacturer = client.post(
        "/api/master-data/manufacturers",
        json={"code": "MFG-001", "name": "Validated Manufacturer"},
        headers=headers,
    )
    material = client.post(
        "/api/master-data/materials",
        json={"code": "MAT-001", "name": "Acetaminophen", "item_type": "SUBSTANCE", "default_unit": "kg"},
        headers=headers,
    )

    assert supplier.status_code == 201
    assert manufacturer.status_code == 201
    assert material.status_code == 201

    db = SessionLocal()
    try:
        assert db.query(Supplier).filter(Supplier.code == "SUP-001").count() == 1
        assert db.query(Manufacturer).filter(Manufacturer.code == "MFG-001").count() == 1
        assert db.query(Material).filter(Material.code == "MAT-001").count() == 1
        audit_actions = {(event.object_type, event.action_type) for event in db.query(AuditEvent).all()}
        assert ("supplier", "CREATE") in audit_actions
        assert ("manufacturer", "CREATE") in audit_actions
        assert ("material", "CREATE") in audit_actions
    finally:
        db.close()


def test_warehouse_operator_cannot_create_master_data() -> None:
    reset_seeded_data()
    db = SessionLocal()
    try:
        seed_foundation_data(db)
    finally:
        db.close()

    client = TestClient(create_app())
    token = login_as_warehouse_operator(client)
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/api/master-data/suppliers",
        json={"code": "SUP-LOCKED", "name": "Should Not Create"},
        headers=headers,
    )

    assert response.status_code == 403
