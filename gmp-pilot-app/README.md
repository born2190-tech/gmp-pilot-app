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

## Frontend (React + TypeScript + Vite)

The project now includes a frontend app in `gmp-pilot-app/web`:

- React + TypeScript + Vite
- Tailwind CSS (v4)
- Component-based UI foundation
- Bearer auth with `/auth/login` and `/auth/me`
- Dashboard wired to `/lots` and `/inventory/movements`

Run frontend locally:

```bash
cd gmp-pilot-app/web
npm install
npm run dev
```

Set backend URL if needed (default `http://127.0.0.1:8000`):

```bash
cp .env.example .env
```

Then edit `.env`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

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

## DB portability & migrations (Sprint 1)

The project now includes SQLAlchemy models and Alembic scaffold for migration-driven schema changes.

- Default local DB URL: `sqlite:///data/gmp_pilot.db`
- Override via env: `DATABASE_URL`
- Alembic config: `gmp-pilot-app/alembic.ini`

Typical flow:

```bash
cd gmp-pilot-app
alembic -c alembic.ini stamp 20260510_0001
alembic -c alembic.ini revision --autogenerate -m "next change"
alembic -c alembic.ini upgrade head
```

For PostgreSQL target environments, set:

```env
DATABASE_URL=postgresql+psycopg://user:password@host:5432/dbname
```

For local Docker Compose PostgreSQL in this repo, use:

```env
DATABASE_URL=postgresql+psycopg://gmp_user:gmp_pass@127.0.0.1:5433/gmp_pilot
```

Important current status:

- Alembic/SQLAlchemy portability scaffold is in place.
- API runtime in `app/main.py` still executes via `sqlite3` and requires a sqlite `DATABASE_URL` for now.
- Full runtime switch to PostgreSQL will happen during the next backend migration step (moving endpoint data access from `sqlite3` to SQLAlchemy sessions).
