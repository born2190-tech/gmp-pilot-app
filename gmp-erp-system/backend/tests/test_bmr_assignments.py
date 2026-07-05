from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import create_app
from app.models.audit import AuditEvent, SignatureEvent
from app.models.identity import AuthSession, User
from app.models.inventory import (
    BmrEntry,
    BmrInstance,
    BmrInstanceSection,
    BmrStageLock,
    ProductionBatch,
    Product,
)
from app.services.seed import seed_foundation_data


def reset_bmr_assignment_data() -> None:
    db = SessionLocal()
    try:
        db.query(SignatureEvent).delete()
        db.query(AuditEvent).delete()
        db.query(BmrStageLock).delete()
        db.query(BmrEntry).delete()
        db.query(BmrInstanceSection).delete()
        db.query(BmrInstance).delete()
        db.query(ProductionBatch).delete()
        db.query(Product).filter(Product.code == "TST").delete()
        db.query(AuthSession).delete()
        db.commit()
        seed_foundation_data(db)
    finally:
        db.close()


@pytest.fixture(autouse=True)
def clean_bmr_assignment_data():
    reset_bmr_assignment_data()
    yield
    reset_bmr_assignment_data()


def login(client: TestClient, username: str, password: str, workstation: str) -> str:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "workstation_id": workstation},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def create_bmr_instance() -> dict[str, str]:
    db = SessionLocal()
    try:
        shift_master = db.query(User).filter(User.username == "shift_master").one()
        product = Product(
            code="TST",
            market_code="UZ",
            market_name="Узбекистан",
            name="Тестовый продукт",
            dosage_form="таблетки",
        )
        db.add(product)
        db.flush()
        batch = ProductionBatch(
            batch_no="TST-001",
            status="bmr_issued",
            product_id=product.id,
            product_code=product.code,
            serial_no=1,
            product_name=product.name,
            dosage_form=product.dosage_form,
            batch_size=100,
            batch_size_unit="упак",
            production_date=date(2026, 6, 1),
            expiry_date=date(2028, 6, 1),
            shelf_life_months=24,
            bmr_no="BMR-TST-001",
            created_by=shift_master.id,
            bmr_requested_by=shift_master.id,
            bmr_requested_at=shift_master.created_at,
            bmr_issued_by=shift_master.id,
            bmr_issued_at=shift_master.created_at,
        )
        db.add(batch)
        db.flush()
        instance = BmrInstance(
            production_batch_id=batch.id,
            template_id=None,
            template_version=1,
            title="Тестовый BMR",
            status="issued",
            created_by=shift_master.id,
            assignments={},
        )
        db.add(instance)
        db.flush()
        section = BmrInstanceSection(
            instance_id=instance.id,
            ordinal=1,
            section_type="stage",
            title="Тестовый этап",
            config={
                "stage": "test_stage",
                "stage_title": "Тестовый этап",
                "room": "Комн. 29",
                "fields": [
                    {"label": "Показатель", "type": "text"},
                    {"label": "Выполнено ДП", "type": "signature_operator"},
                ],
            },
        )
        db.add(section)
        db.commit()
        return {
            "instance_id": str(instance.id),
            "section_id": str(section.id),
            "operator_id": str(db.query(User).filter(User.username == "oper_ivanov").one().id),
        }
    finally:
        db.close()


def test_bmr_stage_requires_operator_assignment_before_filling_and_signing() -> None:
    ids = create_bmr_instance()
    client = TestClient(create_app())
    operator_token = login(client, "oper_ivanov", "op123", "WS-PROD-29")

    save_without_assignment = client.post(
        f"/api/bmr/instances/{ids['instance_id']}/entries",
        headers={"Authorization": f"Bearer {operator_token}"},
        json={"entries": [{"section_id": ids["section_id"], "field_index": 0, "value": "ok"}]},
    )
    assert save_without_assignment.status_code == 403
    assert "не назначил операторов" in save_without_assignment.json()["detail"]

    sign_without_assignment = client.post(
        f"/api/bmr/instances/{ids['instance_id']}/sign",
        headers={"Authorization": f"Bearer {operator_token}"},
        json={
            "section_id": ids["section_id"],
            "field_index": 1,
            "username": "oper_ivanov",
            "password": "1111",
            "meaning": "Выполнено ДП",
            "reason": "Тест",
        },
    )
    assert sign_without_assignment.status_code in (403, 409)

    master_token = login(client, "shift_master", "prod123", "WS-SUB-01")
    assigned = client.put(
        f"/api/bmr/instances/{ids['instance_id']}/assignments",
        headers={"Authorization": f"Bearer {master_token}"},
        json={"assignments": {"test_stage": [ids["operator_id"]]}},
    )
    assert assigned.status_code == 200

    save_after_assignment = client.post(
        f"/api/bmr/instances/{ids['instance_id']}/entries",
        headers={"Authorization": f"Bearer {operator_token}"},
        json={"entries": [{"section_id": ids["section_id"], "field_index": 0, "value": "ok"}]},
    )
    assert save_after_assignment.status_code == 200

    sign_after_assignment = client.post(
        f"/api/bmr/instances/{ids['instance_id']}/sign",
        headers={"Authorization": f"Bearer {operator_token}"},
        json={
            "section_id": ids["section_id"],
            "field_index": 1,
            "username": "oper_ivanov",
            "password": "1111",
            "meaning": "Выполнено ДП",
            "reason": "Тест",
        },
    )
    assert sign_after_assignment.status_code == 200, sign_after_assignment.text


def test_assignable_operators_include_employee_metadata() -> None:
    client = TestClient(create_app())
    token = login(client, "shift_master", "prod123", "WS-PROD-01")

    response = client.get("/api/bmr/instances/operators", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    operators = response.json()["operators"]
    karabekov = next(item for item in operators if item["username"] == "karabekov_ergash")
    assert karabekov["full_name"] == "Карабеков Эргаш"
    assert karabekov["employee_no"] == "21"
    assert karabekov["position_title"] == "Оператор"
    assert karabekov["signature_initials"] == "К.Э.С."
