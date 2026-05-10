from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import create_app
from app.models.audit import AuditEvent, SignatureEvent
from app.models.inventory import Lot
from test_receipt_lot_movements import create_reference_item, login, receipt_payload, reset_inventory_data


def create_quarantine_lot(client: TestClient) -> str:
    ref = create_reference_item()
    warehouse_token = login(client)
    headers = {"Authorization": f"Bearer {warehouse_token}"}
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
    return lots.json()["lots"][0]["id"]


def test_qc_and_qa_workflow_releases_lot_with_audit_and_signatures() -> None:
    reset_inventory_data()
    client = TestClient(create_app())
    lot_id = create_quarantine_lot(client)
    qc_token = login(client, "head_qc", "qchead123")
    qa_token = login(client, "head_qa", "qahead123")

    sample = client.post(
        f"/api/quality/lots/{lot_id}/sample",
        headers={"Authorization": f"Bearer {qc_token}"},
        json={"reason": "Incoming control sample taken"},
    )
    assert sample.status_code == 200
    assert sample.json()["quality_status"] == "sampled"
    assert sample.json()["sampling_date"] is not None

    result = client.post(
        f"/api/quality/lots/{lot_id}/qc-result",
        headers={"Authorization": f"Bearer {qc_token}"},
        json={
            "username": "head_qc",
            "password": "qchead123",
            "meaning": "Submit QC result",
            "reason": "All tested parameters comply",
            "result_summary": "Complies with specification",
        },
    )
    assert result.status_code == 200
    assert result.json()["quality_status"] == "under_test"
    assert result.json()["qc_result_received_at"] is not None

    decision = client.post(
        f"/api/quality/lots/{lot_id}/qa-decision",
        headers={"Authorization": f"Bearer {qa_token}"},
        json={
            "username": "head_qa",
            "password": "qahead123",
            "meaning": "QA release decision",
            "reason": "QC result reviewed and approved",
            "decision": "released",
        },
    )
    assert decision.status_code == 200
    assert decision.json()["quality_status"] == "released"
    assert decision.json()["qa_decision_at"] is not None

    db = SessionLocal()
    try:
        lot = db.get(Lot, lot_id)
        assert lot is not None
        assert lot.quality_status == "released"
        signature_actions = {row.action_type for row in db.query(SignatureEvent).all()}
        audit_actions = {row.action_type for row in db.query(AuditEvent).all()}
        assert "SUBMIT_QC_RESULT" in signature_actions
        assert "QA_DECISION" in signature_actions
        assert "SAMPLE_LOT" in audit_actions
        assert "SUBMIT_QC_RESULT" in audit_actions
        assert "QA_DECISION" in audit_actions
    finally:
        db.close()


def test_qa_decision_requires_qc_result_first() -> None:
    reset_inventory_data()
    client = TestClient(create_app())
    lot_id = create_quarantine_lot(client)
    qa_token = login(client, "head_qa", "qahead123")

    response = client.post(
        f"/api/quality/lots/{lot_id}/qa-decision",
        headers={"Authorization": f"Bearer {qa_token}"},
        json={
            "username": "head_qa",
            "password": "qahead123",
            "meaning": "QA release decision",
            "reason": "Tried too early",
            "decision": "released",
        },
    )

    assert response.status_code == 409
