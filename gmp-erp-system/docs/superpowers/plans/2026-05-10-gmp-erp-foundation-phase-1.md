# GMP ERP Foundation Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-ready foundation of a configurable GMP ERP platform: auth, RBAC/scope access, master data, receipt documents, lots, movements, audit trail, and e-signature.

**Architecture:** Use a new FastAPI backend with PostgreSQL, SQLAlchemy, Alembic, and Pydantic. Use a React/TypeScript/Vite frontend with role-aware navigation, TanStack Query/Table, React Hook Form, Zod, Tailwind, and shadcn-style components. Keep GMP controls as shared platform services rather than one-off endpoint code.

**Tech Stack:** FastAPI, PostgreSQL, SQLAlchemy 2.x, Alembic, Pydantic, React, TypeScript, Vite, Tailwind, TanStack Query, TanStack Table, React Hook Form, Zod.

---

## File Structure

Create backend files:

- `backend/pyproject.toml`: Python dependencies and tooling.
- `backend/app/main.py`: FastAPI app factory and router registration.
- `backend/app/core/config.py`: environment settings.
- `backend/app/core/database.py`: SQLAlchemy engine/session.
- `backend/app/core/security.py`: password hashing and token helpers.
- `backend/app/core/errors.py`: shared HTTP error helpers.
- `backend/app/models/base.py`: declarative base and timestamp mixins.
- `backend/app/models/identity.py`: users, roles, departments, permissions, sessions.
- `backend/app/models/master_data.py`: warehouses, locations, suppliers, manufacturers, materials, employees.
- `backend/app/models/inventory.py`: receipt documents, lots, inventory movements.
- `backend/app/models/audit.py`: audit events and signature events.
- `backend/app/schemas/identity.py`: auth and current user DTOs.
- `backend/app/schemas/master_data.py`: master data DTOs.
- `backend/app/schemas/inventory.py`: receipt, lot, movement DTOs.
- `backend/app/schemas/audit.py`: audit and signature DTOs.
- `backend/app/services/permissions.py`: RBAC and warehouse scope checks.
- `backend/app/services/audit.py`: audit writer.
- `backend/app/services/signature.py`: e-signature validation and logging.
- `backend/app/services/inventory.py`: receipt posting, lot creation, movement creation.
- `backend/app/api/deps.py`: DB and current user dependencies.
- `backend/app/api/routes/auth.py`: login, logout, me.
- `backend/app/api/routes/master_data.py`: seed/read master data endpoints.
- `backend/app/api/routes/inventory.py`: receipt, lots, movements endpoints.
- `backend/app/api/routes/audit.py`: audit trail endpoints.
- `backend/alembic/env.py`: migration environment.
- `backend/alembic/versions/20260510_0001_foundation.py`: first real schema migration.
- `backend/tests/`: pytest tests.

Create frontend files:

- `frontend/package.json`: frontend dependencies and scripts.
- `frontend/vite.config.ts`: Vite setup.
- `frontend/src/main.tsx`: app entry.
- `frontend/src/App.tsx`: providers and routing.
- `frontend/src/lib/api.ts`: typed HTTP client.
- `frontend/src/lib/auth.ts`: auth storage helpers.
- `frontend/src/lib/permissions.ts`: menu/action visibility helpers.
- `frontend/src/types/*.ts`: shared TypeScript DTOs.
- `frontend/src/components/layout/AppShell.tsx`: role-aware shell.
- `frontend/src/components/layout/Sidebar.tsx`: permission-filtered navigation.
- `frontend/src/components/layout/Topbar.tsx`: search/user/scope display.
- `frontend/src/components/ui/*.tsx`: buttons, inputs, badges, dialogs, alerts.
- `frontend/src/components/table/DataTable.tsx`: TanStack table wrapper.
- `frontend/src/features/auth/LoginPage.tsx`: login.
- `frontend/src/features/dashboard/WarehouseDashboard.tsx`: warehouse dashboard.
- `frontend/src/features/inventory/ReceiptDocumentPage.tsx`: receipt document.
- `frontend/src/features/inventory/LotsBoardPage.tsx`: lots board.
- `frontend/src/features/inventory/MovementsPage.tsx`: movement register.
- `frontend/src/features/audit/AuditTimeline.tsx`: audit display.
- `frontend/src/features/signature/ESignatureModal.tsx`: signature modal.

---

### Task 1: Scaffold New Project

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/main.py`
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`

- [ ] **Step 1: Create backend package files**

Create `backend/pyproject.toml`:

```toml
[project]
name = "gmp-erp-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.9",
  "pydantic-settings>=2.6",
  "SQLAlchemy>=2.0",
  "alembic>=1.13",
  "psycopg[binary]>=3.2",
  "passlib[bcrypt]>=1.7",
  "python-jose[cryptography]>=3.3",
  "pytest>=8.3",
  "httpx>=0.27"
]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

Create `backend/app/main.py`:

```python
from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="GMP ERP Platform", version="0.1.0")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 2: Create frontend package files**

Create `frontend/package.json`:

```json
{
  "name": "gmp-erp-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "@hookform/resolvers": "^5.2.2",
    "@tanstack/react-query": "^5.100.9",
    "@tanstack/react-table": "^8.21.3",
    "clsx": "^2.1.1",
    "lucide-react": "^0.554.0",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-hook-form": "^7.75.0",
    "tailwind-merge": "^3.3.1",
    "tailwindcss": "^4.3.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@tailwindcss/vite": "^4.3.0",
    "@types/node": "^24.12.2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "eslint": "^10.2.1",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.5.0",
    "typescript": "~6.0.2",
    "typescript-eslint": "^8.58.2",
    "vite": "^8.0.10"
  }
}
```

Create `frontend/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
```

- [ ] **Step 3: Verify scaffold**

Run:

```bash
cd backend
py -3 -m compileall app
```

Expected: compile succeeds.

Run:

```bash
cd frontend
npm install
npm run build
```

Expected: Vite build succeeds.

---

### Task 2: Database and First Migration

**Files:**
- Create: `backend/app/core/config.py`
- Create: `backend/app/core/database.py`
- Create: `backend/app/models/base.py`
- Create: `backend/app/models/identity.py`
- Create: `backend/app/models/master_data.py`
- Create: `backend/app/models/inventory.py`
- Create: `backend/app/models/audit.py`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/versions/20260510_0001_foundation.py`

- [ ] **Step 1: Implement config and database**

Create `backend/app/core/config.py`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://gmp_user:gmp_pass@127.0.0.1:5433/gmp_erp"
    secret_key: str = "dev-change-me"
    access_token_minutes: int = 720

    model_config = SettingsConfigDict(env_file=".env", env_prefix="GMP_")


settings = Settings()
```

Create `backend/app/core/database.py`:

```python
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url, future=True, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 2: Implement model base**

Create `backend/app/models/base.py`:

```python
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class UUIDPrimaryKeyMixin:
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
```

- [ ] **Step 3: Implement identity models**

Create `backend/app/models/identity.py`:

```python
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Table, Column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", UUID(as_uuid=True), ForeignKey("roles.id"), primary_key=True),
    Column("permission_id", UUID(as_uuid=True), ForeignKey("permissions.id"), primary_key=True),
)


class Department(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "departments"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class Permission(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)


class Role(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "roles"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    permissions: Mapped[list[Permission]] = relationship(secondary=role_permissions)


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("roles.id"), nullable=False)
    department_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("departments.id"), nullable=True)
    warehouse_scope: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    role: Mapped[Role] = relationship()
    department: Mapped[Department | None] = relationship()


class AuthSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "auth_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    workstation_id: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped[User] = relationship()
```

- [ ] **Step 4: Implement master data, inventory, and audit models**

Use UUID primary keys and PostgreSQL-compatible columns only. Include these entities:

```python
# master_data.py entities:
# Warehouse(code, name, warehouse_type)
# Location(warehouse_id, code, name, storage_condition)
# Supplier(code, name)
# Manufacturer(code, name)
# Material(code, name, item_type, default_unit)
# Employee(user_id, personnel_no, position)

# inventory.py entities:
# ReceiptDocument(document_no, status, supplier_id, manufacturer_id, warehouse_id, received_date, posted_by, posted_at)
# ReceiptLine(receipt_id, material_id, supplier_lot, production_date, production_year, expiry_date, quantity, unit, location_id)
# Lot(material_id, supplier_id, manufacturer_id, supplier_lot, internal_lot, item_type, production_date, production_year, expiry_date, warehouse_id, location_id, quantity, unit, quality_status, incoming_control_notified_at, sampling_date, qc_result_received_at, qa_decision_at)
# InventoryMovement(movement_type, document_type, document_id, lot_id, from_warehouse_id, from_location_id, to_warehouse_id, to_location_id, quantity_delta, quantity_after, unit, reason, user_id, workstation_id)

# audit.py entities:
# AuditEvent(user_id, role_code, workstation_id, object_type, object_id, action_type, old_value_json, new_value_json, reason, source)
# SignatureEvent(user_id, role_code, workstation_id, object_type, object_id, action_type, meaning, reason, result)
```

- [ ] **Step 5: Create migration**

Create `backend/alembic/versions/20260510_0001_foundation.py` with explicit `op.create_table` calls for every model above. The migration must not contain `pass`.

- [ ] **Step 6: Verify migration**

Run:

```bash
cd backend
alembic upgrade head
```

Expected: PostgreSQL schema is created without errors.

---

### Task 3: Auth, Permissions, Audit, and Signature Services

**Files:**
- Create: `backend/app/core/security.py`
- Create: `backend/app/services/permissions.py`
- Create: `backend/app/services/audit.py`
- Create: `backend/app/services/signature.py`
- Create: `backend/app/api/deps.py`
- Create: `backend/app/api/routes/auth.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_auth_permissions.py`

- [ ] **Step 1: Write tests for login and role-aware current user**

Create tests that verify:

- login fails without workstation ID;
- inactive user cannot login;
- valid user receives token;
- `/api/auth/me` returns username, role, department, permissions, and warehouse_scope;
- warehouse user keeps only its assigned scope.

- [ ] **Step 2: Implement security helpers**

Implement:

- `hash_password(password: str) -> str`;
- `verify_password(password: str, password_hash: str) -> bool`;
- `create_token() -> tuple[str, str]` returning plain token and sha256 hash;
- no plain password storage.

- [ ] **Step 3: Implement permission helpers**

Implement:

- `require_permission(user, permission_code)`;
- `require_warehouse_scope(user, warehouse_id)`;
- `get_allowed_navigation(user)` returning only allowed menu sections.

- [ ] **Step 4: Implement audit writer**

Every audit event must include:

- user ID;
- role code;
- workstation ID;
- object type;
- object ID;
- action type;
- old value JSON;
- new value JSON;
- reason;
- UTC timestamp.

- [ ] **Step 5: Implement signature service**

Signature validation must:

- verify signer password;
- verify signer is active;
- verify signer matches current user unless second approval is requested;
- create success or failed `SignatureEvent`;
- never lose failed attempts because of a business transaction rollback.

- [ ] **Step 6: Implement auth routes**

Routes:

- `POST /api/auth/login`;
- `POST /api/auth/logout`;
- `GET /api/auth/me`.

- [ ] **Step 7: Verify tests**

Run:

```bash
cd backend
pytest tests/test_auth_permissions.py -v
```

Expected: all tests pass.

---

### Task 4: Master Data Seed and Read APIs

**Files:**
- Create: `backend/app/schemas/master_data.py`
- Create: `backend/app/api/routes/master_data.py`
- Test: `backend/tests/test_master_data.py`

- [ ] **Step 1: Write tests**

Tests must verify:

- warehouses include SUBSTANCE_WAREHOUSE, PACKAGING_WAREHOUSE, FG_WAREHOUSE;
- department roles include HEAD_QA, HEAD_QC, HEAD_PRODUCTION, WORKSHOP_HEAD, CHIEF_TECHNOLOGIST;
- material list supports item types raw_material, packaging_material, intermediate, bulk, finished_good.

- [ ] **Step 2: Implement seed function**

Create idempotent seed logic for:

- departments;
- roles;
- permissions;
- warehouse master data;
- demo suppliers;
- demo manufacturers;
- demo materials;
- demo users with hashed passwords.

- [ ] **Step 3: Implement read APIs**

Routes:

- `GET /api/master-data/warehouses`;
- `GET /api/master-data/locations`;
- `GET /api/master-data/suppliers`;
- `GET /api/master-data/manufacturers`;
- `GET /api/master-data/materials`;
- `GET /api/master-data/employees`.

- [ ] **Step 4: Verify tests**

Run:

```bash
cd backend
pytest tests/test_master_data.py -v
```

Expected: all tests pass.

---

### Task 5: Receipt Posting, Lots, and Movements

**Files:**
- Create: `backend/app/schemas/inventory.py`
- Create: `backend/app/services/inventory.py`
- Create: `backend/app/api/routes/inventory.py`
- Test: `backend/tests/test_receipt_lot_movements.py`

- [ ] **Step 1: Write tests**

Tests must verify:

- warehouse operator can create receipt only in own scope;
- receipt requires supplier, manufacturer, material, supplier_lot, production date/year, expiry date, quantity, unit, location;
- posting receipt requires e-signature;
- posted receipt creates internal lot;
- posted receipt creates RECEIPT movement;
- posted document cannot be edited;
- lots board includes manufacturer, production date, expiry date, incoming control notified date, and QC result received date.

- [ ] **Step 2: Implement inventory service**

Implement:

- `create_receipt_draft`;
- `post_receipt`;
- `generate_internal_lot`;
- `create_inventory_movement`;
- `list_lots`;
- `list_movements`.

- [ ] **Step 3: Implement inventory routes**

Routes:

- `POST /api/inventory/receipts`;
- `POST /api/inventory/receipts/{receipt_id}/post`;
- `GET /api/inventory/lots`;
- `GET /api/inventory/movements`.

- [ ] **Step 4: Verify tests**

Run:

```bash
cd backend
pytest tests/test_receipt_lot_movements.py -v
```

Expected: all tests pass.

---

### Task 6: Frontend Foundation and Role-Aware Shell

**Files:**
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/auth.ts`
- Create: `frontend/src/lib/permissions.ts`
- Create: `frontend/src/components/layout/AppShell.tsx`
- Create: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/layout/Topbar.tsx`
- Create: `frontend/src/features/auth/LoginPage.tsx`

- [ ] **Step 1: Implement typed API client**

The client must:

- use `/api` relative paths;
- attach bearer token;
- parse JSON errors;
- expose `login`, `logout`, `me`.

- [ ] **Step 2: Implement LoginPage**

Fields:

- username;
- password;
- workstation ID.

Rules:

- workstation ID is required;
- show loading and error states;
- on success, store token and load `/api/auth/me`.

- [ ] **Step 3: Implement role-aware navigation**

Navigation must render only sections returned by permissions:

- Warehouse users see warehouse sections;
- QC users see QC sections;
- QA users see QA sections;
- production users see production and BMR execution sections;
- SYS_ADMIN sees administration.

- [ ] **Step 4: Verify frontend build**

Run:

```bash
cd frontend
npm run build
```

Expected: TypeScript and Vite build pass.

---

### Task 7: Frontend Inventory Screens

**Files:**
- Create: `frontend/src/components/table/DataTable.tsx`
- Create: `frontend/src/features/dashboard/WarehouseDashboard.tsx`
- Create: `frontend/src/features/inventory/ReceiptDocumentPage.tsx`
- Create: `frontend/src/features/inventory/LotsBoardPage.tsx`
- Create: `frontend/src/features/inventory/MovementsPage.tsx`
- Create: `frontend/src/features/signature/ESignatureModal.tsx`

- [ ] **Step 1: Implement compact DataTable**

The table must support:

- sorting;
- filter bar composition;
- loading state;
- empty state;
- error state;
- compact 36-44px rows.

- [ ] **Step 2: Implement LotsBoardPage**

Columns:

- internal lot/series;
- material code/name;
- supplier;
- manufacturer;
- supplier lot;
- warehouse;
- location;
- quantity;
- unit;
- quality status;
- production date/year;
- expiry date;
- incoming control notified date;
- QC result received date;
- open deviation flag;
- available actions.

- [ ] **Step 3: Implement ReceiptDocumentPage**

The page must support:

- draft form;
- required fields;
- supplier/manufacturer/material/warehouse/location selectors;
- post action;
- e-signature modal;
- success and error states.

- [ ] **Step 4: Implement MovementsPage**

Columns:

- timestamp;
- movement type;
- document type/no;
- lot;
- material;
- from warehouse/location;
- to warehouse/location;
- quantity delta;
- quantity after;
- user;
- reason.

- [ ] **Step 5: Verify frontend build**

Run:

```bash
cd frontend
npm run build
```

Expected: TypeScript and Vite build pass.

---

## Final Verification

Run backend tests:

```bash
cd backend
pytest -v
```

Run frontend build:

```bash
cd frontend
npm run build
```

Run app smoke test:

```bash
cd backend
uvicorn app.main:app --reload
cd frontend
npm run dev
```

Expected:

- login works;
- user sees only allowed sections;
- warehouse scope is displayed;
- receipt can be posted with e-signature;
- lot appears in lots board;
- movement appears in movements register;
- audit events exist for login, receipt posting, lot creation, and movement creation.
