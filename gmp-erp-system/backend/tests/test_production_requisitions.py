from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import create_app
from app.models.audit import AuditEvent, SignatureEvent
from app.models.identity import AuthSession
from app.models.inventory import (
    BmrSection,
    BmrTemplate,
    FGShipmentDocument,
    FGShipmentLine,
    InventoryCountDocument,
    InventoryCountLine,
    InventoryMovement,
    Lot,
    Product,
    ProductionBatch,
    ProductionRequisition,
    ReceiptDocument,
    ReceiptLine,
    RequisitionAllocationLine,
    RequisitionLine,
)
from app.models.master_data import Location, Manufacturer, Material, MaterialAlias, Warehouse
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
        db.query(ProductionBatch).delete()
        db.query(BmrSection).delete()
        db.query(BmrTemplate).delete()
        db.query(Product).delete()
        db.query(Lot).delete()
        db.query(ReceiptLine).delete()
        db.query(ReceiptDocument).delete()
        db.query(MaterialAlias).delete()
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


def create_bmr_with_substance_and_packaging() -> str:
    db = SessionLocal()
    try:
        user = db.query(AuthSession).first()
        created_by = user.user_id if user else None
        if created_by is None:
            from app.models.identity import User
            created_by = db.query(User).filter(User.username == "shift_master").one().id

        raw = Material(code="API-PREFILL-001", name="Тестовая субстанция", item_type="raw_material", default_unit="kg")
        product = Product(
            code="991",
            market_code="UZ",
            market_name="Узбекистан",
            name="Тестовый препарат",
            dosage_form="таблетки",
            default_shelf_life_months=24,
            is_active=True,
        )
        db.add_all([raw, product])
        db.flush()

        batch = ProductionBatch(
            batch_no="991N2607001",
            status="bmr_issued",
            product_id=product.id,
            product_code=product.code,
            serial_no=1,
            product_name=product.name,
            dosage_form=product.dosage_form,
            batch_size=8500,
            batch_size_unit="упак",
            production_date=date(2026, 7, 5),
            expiry_date=date(2028, 7, 31),
            shelf_life_months=24,
            bmr_no="BMR-991N2607001",
            created_by=created_by,
        )
        template = BmrTemplate(
            product_id=product.id,
            title="BMR test",
            version=1,
            status="approved",
            created_by=created_by,
        )
        db.add_all([batch, template])
        db.flush()
        db.add_all([
            BmrSection(
                template_id=template.id,
                ordinal=1,
                section_type="production_formula",
                title="Производственная формула",
                config={
                    "kind": "production_formula",
                    "rows": [
                        {
                            "material_code": raw.code,
                            "name": raw.name,
                            "per_series": "12,500",
                        }
                    ],
                },
            ),
            BmrSection(
                template_id=template.id,
                ordinal=2,
                section_type="process_table",
                title="Использованные упаковочные материалы",
                config={
                    "kind": "process_table",
                    "rows": [
                        {"cells": [
                            {"text": "№"},
                            {"text": "Наименование материала"},
                            {"text": "Номер серии, партии или счета"},
                            {"text": "№ заключение или отчёта"},
                            {"text": "Стандартное количество на серию 8500 упаковок"},
                            {"text": "Фактическое количество на серию"},
                        ]},
                        {"cells": [
                            {"text": "1"},
                            {"text": "Алюминиевая фольга, толщина 0,15мм, ширина 195 мм"},
                            {"text": "", "type": "text", "field_index": 0},
                            {"text": "", "type": "text", "field_index": 1},
                            {"text": "113,124"},
                            {"text": "", "type": "number", "field_index": 2},
                        ]},
                        {"cells": [
                            {"text": "1"},
                            {"text": "", "type": "text", "field_index": 3},
                            {"text": "", "type": "text", "field_index": 4},
                            {"text": "", "type": "text", "field_index": 5},
                            {"text": "113,124"},
                            {"text": "", "type": "number", "field_index": 6},
                        ]},
                        {"cells": [
                            {"text": "2"},
                            {"text": "Пенал «НовуСита-М» 850мг/50мг"},
                            {"text": "", "type": "text", "field_index": 7},
                            {"text": "", "type": "text", "field_index": 8},
                            {"text": "8500"},
                            {"text": "", "type": "number", "field_index": 9},
                        ]},
                    ],
                },
            ),
        ])
        db.commit()
        return str(batch.id)
    finally:
        db.close()


def test_bmr_prefill_creates_one_requisition_split_by_substance_and_packaging_warehouses(monkeypatch) -> None:
    batch_id = create_bmr_with_substance_and_packaging()
    client = TestClient(create_app())
    prod_token = login(client, "shift_master", "prod123", "WS-PROD-01")

    prefill = client.get(
        f"/api/requisitions/prefill/{batch_id}",
        headers={"Authorization": f"Bearer {prod_token}"},
    )
    assert prefill.status_code == 200, prefill.text
    prefill_payload = prefill.json()
    assert [line["material_name"] for line in prefill_payload["lines"]] == [
        "Тестовая субстанция",
        "Алюминиевая фольга, толщина 0,15мм, ширина 195 мм",
        "Пенал «НовуСита-М» 850мг/50мг",
    ]

    created = client.post(
        "/api/requisitions",
        headers={"Authorization": f"Bearer {prod_token}"},
        json={
            "product_name": prefill_payload["product_name"],
            "product_series": prefill_payload["product_series"],
            "production_date": prefill_payload["production_date"],
            "production_order_no": prefill_payload["production_order_no"],
            "production_batch_id": prefill_payload["production_batch_id"],
            "lines": [
                {
                    "material_id": line["material_id"],
                    "requested_quantity": line["requested_quantity"],
                    "unit": line["unit"],
                }
                for line in prefill_payload["lines"]
            ],
        },
    )
    assert created.status_code == 200, created.text
    requisition = created.json()
    assert len(requisition["lines"]) == 3
    assert {line["warehouse_type"] for line in requisition["lines"]} == {
        "SUBSTANCE_WAREHOUSE",
        "PACKAGING_WAREHOUSE",
    }

    sub_token = login(client, "warehouse_substance", "whs123", "WS-SUB-01")
    pkg_token = login(client, "warehouse_packaging", "whp123", "WS-PACK-01")

    sub_view = client.get(
        f"/api/requisitions/{requisition['id']}",
        headers={"Authorization": f"Bearer {sub_token}"},
    )
    assert sub_view.status_code == 200, sub_view.text
    assert sub_view.json()["is_partial_view"] is True
    assert [line["warehouse_type"] for line in sub_view.json()["lines"]] == ["SUBSTANCE_WAREHOUSE"]

    pkg_view = client.get(
        f"/api/requisitions/{requisition['id']}",
        headers={"Authorization": f"Bearer {pkg_token}"},
    )
    assert pkg_view.status_code == 200, pkg_view.text
    assert pkg_view.json()["is_partial_view"] is True
    assert [line["warehouse_type"] for line in pkg_view.json()["lines"]] == [
        "PACKAGING_WAREHOUSE",
        "PACKAGING_WAREHOUSE",
    ]

    from app.api.routes import requisitions as requisition_routes

    captured = {}

    def fake_render_pdf(req, materials_by_id, qr_payload=None, scope=None, batch=None, requested_by_name=None):
        captured["scope"] = scope
        captured["line_count"] = len(req.lines)
        return b"%PDF-1.4\n%%EOF"

    monkeypatch.setattr(requisition_routes, "render_internal_transfer_pdf", fake_render_pdf)
    pdf = client.get(
        f"/api/requisitions/{requisition['id']}/pdf",
        headers={"Authorization": f"Bearer {pkg_token}"},
    )
    assert pdf.status_code == 200, pdf.text
    assert captured == {"scope": None, "line_count": 3}


def test_bmr_prefill_resolves_alias_name_to_existing_material_id() -> None:
    db = SessionLocal()
    try:
        from app.models.identity import User

        user = db.query(User).filter(User.username == "shift_master").one()
        material = Material(code="API-MET", name="Метформин гидрохлорид", item_type="raw_material", default_unit="kg")
        product = Product(
            code="993",
            market_code="UZ",
            market_name="Узбекистан",
            name="Alias test tablet",
            dosage_form="таблетки",
            default_shelf_life_months=24,
            is_active=True,
        )
        db.add_all([material, product])
        db.flush()
        batch = ProductionBatch(
            batch_no="993N2607001",
            status="bmr_issued",
            product_id=product.id,
            product_code=product.code,
            serial_no=1,
            product_name=product.name,
            dosage_form=product.dosage_form,
            batch_size=1000,
            batch_size_unit="упак",
            production_date=date(2026, 7, 5),
            expiry_date=date(2028, 7, 31),
            shelf_life_months=24,
            bmr_no="BMR-993N2607001",
            created_by=user.id,
        )
        template = BmrTemplate(product_id=product.id, title="Alias BMR", version=1, status="approved", created_by=user.id)
        db.add_all([batch, template])
        db.flush()
        db.add(BmrSection(
            template_id=template.id,
            ordinal=1,
            section_type="production_formula",
            title="Производственная формула",
            config={"kind": "production_formula", "rows": [{"name": "Metformin HCl", "per_series": "10"}]},
        ))
        db.commit()
        batch_id = str(batch.id)
        material_id = str(material.id)
    finally:
        db.close()

    client = TestClient(create_app())
    token = login(client, "shift_master", "prod123", "WS-PROD-01")
    prefill = client.get(
        f"/api/requisitions/prefill/{batch_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert prefill.status_code == 200, prefill.text
    lines = prefill.json()["lines"]
    assert len(lines) == 1
    assert lines[0]["material_id"] == material_id
    assert lines[0]["material_code"] == "API-MET"


def test_production_batch_requires_bmr_before_start() -> None:
    client = TestClient(create_app())
    prod_token = login(client, "shift_master", "prod123", "WS-PROD-01")
    qa_token = login(client, "head_qa", "qahead123", "WS-QA-01")

    created = client.post(
        "/api/production/batches",
        headers={"Authorization": f"Bearer {prod_token}"},
        json={
            "product_code": "12",
            "product_name": "Тигралис 5 мг",
            "dosage_form": "таблетки, покрытые оболочкой",
            "batch_size": 10000,
            "batch_size_unit": "упак",
            "production_date": "2026-05-12",
            "shelf_life_months": 24,
        },
    )
    assert created.status_code == 200, created.text
    batch = created.json()
    assert batch["batch_no"] == "12N2605001"
    assert batch["status"] == "assigned"
    assert batch["expiry_date"] == "2028-05-31"

    blocked = client.post(
        f"/api/production/batches/{batch['id']}/start",
        headers={"Authorization": f"Bearer {prod_token}"},
        json={
            "username": "shift_master",
            "password": "prod123",
            "meaning": "Начало выпуска производственной серии",
            "reason": "test",
        },
    )
    assert blocked.status_code == 409
    assert "BMR must be issued" in blocked.text

    checked = client.post(
        f"/api/production/batches/{batch['id']}/check-number",
        headers={"Authorization": f"Bearer {qa_token}"},
        json={
            "username": "head_qa",
            "password": "qahead123",
            "meaning": "Проверка корректности номера серии",
            "reason": "test",
        },
    )
    assert checked.status_code == 200, checked.text
    assert checked.json()["status"] == "number_checked"

    issued = client.post(
        f"/api/production/batches/{batch['id']}/issue-bmr",
        headers={"Authorization": f"Bearer {qa_token}"},
        json={
            "username": "head_qa",
            "password": "qahead123",
            "meaning": "Выдача ЗПС/BMR на производство серии",
            "reason": "ЗПС выдана ДОК",
        },
    )
    assert issued.status_code == 200, issued.text
    assert issued.json()["status"] == "bmr_issued"

    started = client.post(
        f"/api/production/batches/{batch['id']}/start",
        headers={"Authorization": f"Bearer {prod_token}"},
        json={
            "username": "shift_master",
            "password": "prod123",
            "meaning": "Начало выпуска производственной серии",
            "reason": "Готовность подтверждена",
        },
    )
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "in_production"

    completed = client.post(
        f"/api/production/batches/{batch['id']}/complete",
        headers={"Authorization": f"Bearer {prod_token}"},
        json={
            "username": "shift_master",
            "password": "prod123",
            "meaning": "Завершение выпуска производственной серии",
            "reason": "Серия произведена",
        },
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert completed.json()["completed_at"]

    listed = client.get(
        "/api/production/batches",
        headers={"Authorization": f"Bearer {prod_token}"},
    )
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == batch["id"] and row["status"] == "completed" for row in listed.json()["batches"])


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
