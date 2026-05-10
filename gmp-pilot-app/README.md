# GMP Pilot App

Production-oriented pilot backend for the vertical flow:

`Material receipt -> quarantine -> sampling -> QC -> QA release -> issue to production -> EBR -> FG receipt (stub)`

## What is implemented

- RBAC checks by business action.
- Electronic signature for critical operations.
- Immutable audit trail entries for all critical actions.
- Canonical quality statuses and transition rules.
- Pilot APIs for materials, QC/QA, production start, EBR execution.
- SQLite persistence (file-based DB).

## Quick start

### Option A: Docker (recommended)

Run from `gmp-pilot-app` folder:

```bash
docker compose up --build
```

API will be available at `http://127.0.0.1:8001`.

Stop:

```bash
docker compose down
```

Data is persisted in Docker volume `gmp_pilot_data` mounted to `/app/data`.

### Option B: Local Python

1. Create virtual env and install dependencies.
2. Run server:

```bash
uvicorn app.main:app --reload --app-dir gmp-pilot-app
```

Server starts at `http://127.0.0.1:8000`.

## Auth model (pilot)

Every protected request must include header:

- `X-User: <username>`

Seeded users:

- `qa_manager` / role `QA_MANAGER`
- `qc_analyst` / role `QC_ANALYST`
- `warehouse_operator` / role `WAREHOUSE_OPERATOR`
- `warehouse_manager` / role `WAREHOUSE_MANAGER`
- `production_operator` / role `PRODUCTION_OPERATOR`
- `shift_master` / role `SHIFT_MASTER`
- `sys_admin` / role `SYS_ADMIN`

For critical actions requiring e-signature, include `signature` object in request body:

```json
{
  "username": "qa_manager",
  "password": "qa123",
  "meaning": "Released by QA",
  "comment": "review complete"
}
```

## API highlights

- `POST /materials/receipts`
- `POST /lots/{lot_id}/status-transitions`
- `POST /lots/{lot_id}/sampling-tasks`
- `POST /qc/results`
- `POST /qa/release-decisions`
- `POST /warehouse/issues-to-production`
- `POST /production-orders`
- `POST /production-orders/{order_id}/start`
- `POST /ebr/templates`
- `POST /ebr/executions`
- `POST /ebr/executions/{execution_id}/steps/{step_no}/complete`
- `GET /audit-events`

## Notes

- DB file is created at `gmp-pilot-app/data/gmp_pilot.db`.
- This is a pilot foundation and can be extended without rewriting core controls.
