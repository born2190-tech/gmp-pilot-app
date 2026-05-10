from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.main import create_app
from app.models.audit import AuditEvent, SignatureEvent
from app.models.identity import AuthSession, Department, Permission, Role, User, role_permissions
from app.models.inventory import FGShipmentDocument, FGShipmentLine, InventoryCountDocument, InventoryCountLine, InventoryMovement, Lot, ReceiptDocument, ReceiptLine
from app.models.quality import QCReport, QCReportParameter


def seed_auth_user() -> None:
    db = SessionLocal()
    try:
        db.query(SignatureEvent).delete()
        db.query(AuditEvent).delete()
        db.query(QCReportParameter).delete()
        db.query(QCReport).delete()
        db.query(InventoryMovement).delete()
        db.query(InventoryCountLine).delete()
        db.query(InventoryCountDocument).delete()
        db.query(FGShipmentLine).delete()
        db.query(FGShipmentDocument).delete()
        db.query(ReceiptLine).delete()
        db.query(ReceiptDocument).delete()
        db.query(Lot).delete()
        db.query(AuthSession).delete()
        db.query(User).filter(User.username == "warehouse_substance").delete()
        db.execute(role_permissions.delete())
        db.query(Role).filter(Role.code == "WAREHOUSE_OPERATOR").delete()
        db.query(Permission).filter(Permission.code.in_(["VIEW_WAREHOUSE", "CREATE_RECEIPT"])).delete()
        db.query(Department).filter(Department.code == "WAREHOUSE").delete()
        db.commit()

        department = Department(code="WAREHOUSE", name="Warehouse")
        view = Permission(code="VIEW_WAREHOUSE", description="View warehouse records")
        create_receipt = Permission(code="CREATE_RECEIPT", description="Create receipt documents")
        role = Role(code="WAREHOUSE_OPERATOR", name="Warehouse Operator", permissions=[view, create_receipt])
        user = User(
            username="warehouse_substance",
            full_name="Warehouse Substance Operator",
            password_hash=hash_password("whs123"),
            role=role,
            department=department,
            warehouse_scope="SUBSTANCE_WAREHOUSE",
            is_active=True,
        )
        db.add(user)
        db.commit()
    finally:
        db.close()


def test_login_requires_workstation_id() -> None:
    seed_auth_user()
    client = TestClient(create_app())

    response = client.post("/api/auth/login", json={"username": "warehouse_substance", "password": "whs123"})

    assert response.status_code == 422


def test_login_and_me_return_role_permissions_and_scope() -> None:
    seed_auth_user()
    client = TestClient(create_app())

    login = client.post(
        "/api/auth/login",
        json={"username": "warehouse_substance", "password": "whs123", "workstation_id": "WS-SUB-01"},
    )

    assert login.status_code == 200
    token = login.json()["access_token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert me.status_code == 200
    payload = me.json()
    assert payload["username"] == "warehouse_substance"
    assert payload["role"] == "WAREHOUSE_OPERATOR"
    assert payload["department"] == "WAREHOUSE"
    assert payload["warehouse_scope"] == "SUBSTANCE_WAREHOUSE"
    assert payload["workstation_id"] == "WS-SUB-01"
    assert set(payload["permissions"]) == {"VIEW_WAREHOUSE", "CREATE_RECEIPT"}
