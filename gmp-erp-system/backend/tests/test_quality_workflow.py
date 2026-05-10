from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import create_app
from app.models.audit import AuditEvent, SignatureEvent
from app.models.inventory import Lot
from app.models.quality import QCReport, QCReportParameter
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


def test_qc_report_document_persists_parameters_and_submits_result() -> None:
    reset_inventory_data()
    client = TestClient(create_app())
    lot_id = create_quarantine_lot(client)
    qc_token = login(client, "head_qc", "qchead123")
    headers = {"Authorization": f"Bearer {qc_token}"}

    sample = client.post(f"/api/quality/lots/{lot_id}/sample", headers=headers, json={"reason": "Sample taken"})
    assert sample.status_code == 200

    report = client.post(
        "/api/quality/qc-reports",
        headers=headers,
        json={
            "lot_id": lot_id,
            "report_no": "QC-2026-0001",
            "analysis_started_at": "2026-05-10T09:00:00Z",
            "analysis_finished_at": "2026-05-10T12:30:00Z",
            "method_reference": "SOP-QC-001",
            "parameters": [
                {
                    "parameter_name": "Appearance",
                    "specification": "White powder",
                    "result_value": "White powder",
                    "unit": None,
                    "method_reference": "SOP-QC-001",
                    "complies": True,
                },
                {
                    "parameter_name": "Assay",
                    "specification": "98.0-102.0",
                    "result_value": "99.4",
                    "unit": "%",
                    "method_reference": "SOP-QC-ASSAY",
                    "complies": True,
                },
            ],
        },
    )
    assert report.status_code == 201
    assert report.json()["status"] == "draft"
    assert len(report.json()["parameters"]) == 2

    submit = client.post(
        f"/api/quality/qc-reports/{report.json()['id']}/submit",
        headers=headers,
        json={
            "username": "head_qc",
            "password": "qchead123",
            "meaning": "Submit QC report",
            "reason": "All parameters comply",
        },
    )
    assert submit.status_code == 200
    assert submit.json()["status"] == "submitted"
    assert submit.json()["overall_result"] == "complies"

    db = SessionLocal()
    try:
        saved_report = db.query(QCReport).filter(QCReport.report_no == "QC-2026-0001").one()
        assert saved_report.status == "submitted"
        assert saved_report.overall_result == "complies"
        assert db.query(QCReportParameter).filter(QCReportParameter.report_id == saved_report.id).count() == 2
        lot = db.get(Lot, lot_id)
        assert lot is not None
        assert lot.quality_status == "under_test"
        assert lot.qc_result_received_at is not None
    finally:
        db.close()
