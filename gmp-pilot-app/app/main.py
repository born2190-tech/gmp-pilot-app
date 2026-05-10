from __future__ import annotations

import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

app = FastAPI(title="GMP Pilot App", version="0.1.0")

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "gmp_pilot.db"
UI_PATH = BASE_DIR / "app" / "ui.html"

WAREHOUSE_TYPES = {
    "SUBSTANCE_WAREHOUSE",
    "PACKAGING_WAREHOUSE",
    "FG_WAREHOUSE",
}

QUALITY_STATUSES = {
    "received",
    "quarantine",
    "sampled",
    "under_test",
    "released",
    "blocked",
    "rejected",
    "expired",
}

SOP_STATUS_BY_QUALITY_STATUS: dict[str, str] = {
    "received": "ПРИНЯТО",
    "quarantine": "КАРАНТИН",
    "sampled": "ОТОБРАНО",
    "under_test": "НА ИСПЫТАНИИ",
    "released": "ДОПУЩЕНО",
    "blocked": "БЛОКИРОВАНО",
    "rejected": "БРАК",
    "expired": "ПРОСРОЧЕНО",
}

INCOMING_CONTROL_PROFILES: dict[str, dict[str, Any]] = {
    "SUBSTANCE_WAREHOUSE": {
        "display_name": "Склад субстанций и вспомогательных веществ",
        "default_test_name": "Входной контроль сырья (СОП-533)",
        "default_specification_ref": "SOP-533/F1",
        "parameters": [
            {"parameter_name": "Идентификация (IR)", "unit": "pass/fail", "lower_limit": 1, "upper_limit": 1, "target_value": 1},
            {"parameter_name": "Количественное содержание", "unit": "%", "lower_limit": 95.0, "upper_limit": 105.0, "target_value": 99.0},
            {"parameter_name": "Примеси", "unit": "%", "lower_limit": 0.0, "upper_limit": 1.0, "target_value": 0.2},
            {"parameter_name": "Влага (KF)", "unit": "%", "lower_limit": 0.0, "upper_limit": 3.0, "target_value": 1.5},
            {"parameter_name": "Микробиологическая чистота", "unit": "CFU/g", "lower_limit": 0.0, "upper_limit": 1000.0, "target_value": 10.0},
        ],
    },
    "PACKAGING_WAREHOUSE": {
        "display_name": "Склад упаковочных и печатных материалов",
        "default_test_name": "Входной контроль упаковочных материалов",
        "default_specification_ref": "SOP-209/PACK",
        "parameters": [
            {"parameter_name": "Визуальная целостность", "unit": "pass/fail", "lower_limit": 1, "upper_limit": 1, "target_value": 1},
            {"parameter_name": "Читаемость печати", "unit": "pass/fail", "lower_limit": 1, "upper_limit": 1, "target_value": 1},
            {"parameter_name": "Соответствие макету", "unit": "pass/fail", "lower_limit": 1, "upper_limit": 1, "target_value": 1},
            {"parameter_name": "Размер/геометрия", "unit": "mm", "lower_limit": 0.0, "upper_limit": 9999.0, "target_value": 0.0},
        ],
    },
    "FG_WAREHOUSE": {
        "display_name": "Склад карантина и готовой продукции",
        "default_test_name": "Приемочный контроль готовой продукции (СОП-548)",
        "default_specification_ref": "SOP-548/F1",
        "parameters": [
            {"parameter_name": "Описание/внешний вид", "unit": "pass/fail", "lower_limit": 1, "upper_limit": 1, "target_value": 1},
            {"parameter_name": "Средняя масса", "unit": "mg", "lower_limit": 0.0, "upper_limit": 9999.0, "target_value": 0.0},
            {"parameter_name": "Распадаемость", "unit": "min", "lower_limit": 0.0, "upper_limit": 30.0, "target_value": 10.0},
            {"parameter_name": "Растворение", "unit": "%", "lower_limit": 75.0, "upper_limit": 100.0, "target_value": 85.0},
            {"parameter_name": "Количественное содержание", "unit": "%", "lower_limit": 95.0, "upper_limit": 105.0, "target_value": 99.0},
        ],
    },
}

ALLOWED_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "received": {"quarantine", "blocked"},
    "quarantine": {"sampled", "blocked", "rejected", "expired"},
    "sampled": {"under_test", "blocked", "rejected", "expired"},
    "under_test": {"released", "blocked", "rejected", "expired"},
    "released": {"blocked", "expired"},
    "blocked": {"released", "rejected", "expired"},
    "rejected": set(),
    "expired": set(),
}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "READ_OPERATIONAL_DATA": {
        "QA_MANAGER",
        "QC_ANALYST",
        "WAREHOUSE_OPERATOR",
        "WAREHOUSE_MANAGER",
        "PRODUCTION_OPERATOR",
        "SHIFT_MASTER",
        "TECHNOLOGIST",
        "SYS_ADMIN",
    },
    "READ_AUDIT_EVENTS": {"QA_MANAGER", "SYS_ADMIN"},
    "CREATE_RECEIPT": {"WAREHOUSE_OPERATOR", "WAREHOUSE_MANAGER"},
    "TRANSITION_STATUS": {"WAREHOUSE_OPERATOR", "WAREHOUSE_MANAGER", "QC_ANALYST", "QA_MANAGER"},
    "CREATE_SAMPLING_TASK": {"WAREHOUSE_OPERATOR", "WAREHOUSE_MANAGER", "QC_ANALYST"},
    "ENTER_QC_RESULT": {"QC_ANALYST"},
    "QA_RELEASE": {"QA_MANAGER"},
    "ISSUE_TO_PRODUCTION": {"WAREHOUSE_OPERATOR", "WAREHOUSE_MANAGER"},
    "ADJUST_STOCK": {"WAREHOUSE_MANAGER", "SYS_ADMIN"},
    "CREATE_PRODUCTION_ORDER": {"SHIFT_MASTER", "TECHNOLOGIST"},
    "START_PRODUCTION_ORDER": {"SHIFT_MASTER"},
    "CREATE_EBR_TEMPLATE": {"SHIFT_MASTER", "TECHNOLOGIST", "QA_MANAGER"},
    "CREATE_EBR_EXECUTION": {"SHIFT_MASTER", "PRODUCTION_OPERATOR"},
    "COMPLETE_EBR_STEP": {"SHIFT_MASTER", "PRODUCTION_OPERATOR"},
}

SEED_USERS = [
    ("qa_manager", "QA_MANAGER", "qa123"),
    ("qc_analyst", "QC_ANALYST", "qc123"),
    ("warehouse_operator", "WAREHOUSE_OPERATOR", "wh123"),
    ("warehouse_substance", "WAREHOUSE_OPERATOR", "whs123"),
    ("warehouse_packaging", "WAREHOUSE_OPERATOR", "whp123"),
    ("warehouse_fg", "WAREHOUSE_OPERATOR", "whfg123"),
    ("warehouse_manager", "WAREHOUSE_MANAGER", "whm123"),
    ("production_operator", "PRODUCTION_OPERATOR", "prod123"),
    ("shift_master", "SHIFT_MASTER", "shift123"),
    ("technologist", "TECHNOLOGIST", "tech123"),
    ("sys_admin", "SYS_ADMIN", "admin123"),
]


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON;")
    return connection


class SignatureRequest(BaseModel):
    username: str
    password: str
    meaning: str
    comment: Optional[str] = None


class MaterialReceiptRequest(BaseModel):
    material_code: str
    material_name: str
    supplier_lot: str
    warehouse_type: Literal["SUBSTANCE_WAREHOUSE", "PACKAGING_WAREHOUSE", "FG_WAREHOUSE"] = "SUBSTANCE_WAREHOUSE"
    production_year: int = Field(ge=2000, le=2100)
    expiry_date: str
    quantity: float = Field(gt=0)
    unit: str
    location: str
    signature: SignatureRequest


class StatusTransitionRequest(BaseModel):
    to_status: Literal[
        "received",
        "quarantine",
        "sampled",
        "under_test",
        "released",
        "blocked",
        "rejected",
        "expired",
    ]
    reason: Optional[str] = None
    signature: Optional[SignatureRequest] = None


class SamplingTaskRequest(BaseModel):
    test_name: Optional[str] = None
    specification_ref: Optional[str] = None
    signature: SignatureRequest


class QCResultRequest(BaseModel):
    task_id: int
    value: float
    unit: str
    lower_limit: Optional[float] = None
    upper_limit: Optional[float] = None
    instrument: str
    signature: SignatureRequest


class QCParameterResultRequest(BaseModel):
    parameter_name: str
    value: float
    unit: str
    lower_limit: Optional[float] = None
    upper_limit: Optional[float] = None
    instrument: str


class QCBatchReportRequest(BaseModel):
    task_id: int
    results: list[QCParameterResultRequest] = Field(min_length=1)
    signature: SignatureRequest


class QAReleaseRequest(BaseModel):
    lot_id: int
    decision: Literal["released", "blocked", "rejected"]
    reason: Optional[str] = None
    signature: SignatureRequest


class IssueToProductionRequest(BaseModel):
    lot_id: int
    quantity: float = Field(gt=0)
    production_area: str
    signature: SignatureRequest
    override_signature: Optional[SignatureRequest] = None
    override_reason: Optional[str] = None

class StockAdjustmentRequest(BaseModel):
    lot_id: int
    quantity_delta: float
    reason: str
    signature: SignatureRequest


class CreateProductionOrderRequest(BaseModel):
    product_code: str
    product_name: str
    planned_batch_size: float = Field(gt=0)
    required_lot_ids: list[int]
    signature: SignatureRequest


class StartProductionOrderRequest(BaseModel):
    signature: SignatureRequest
    override_signature: Optional[SignatureRequest] = None
    override_reason: Optional[str] = None


class EBRTemplateStep(BaseModel):
    step_no: int
    title: str
    mandatory: bool = True
    requires_signature: bool = True


class CreateEBRTemplateRequest(BaseModel):
    name: str
    product_code: str
    steps: list[EBRTemplateStep]
    signature: SignatureRequest


class CreateEBRExecutionRequest(BaseModel):
    template_id: int
    production_order_id: int
    signature: SignatureRequest


class CompleteEBRStepRequest(BaseModel):
    value: Optional[str] = None
    unit: Optional[str] = None
    instrument: Optional[str] = None
    comment: Optional[str] = None
    signature: SignatureRequest


class AuthUser(BaseModel):
    username: str
    role: str
    warehouse_scope: Optional[str] = None
    workstation_id: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str
    workstation_id: Optional[str] = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: str
    username: str
    role: str
    warehouse_scope: Optional[str] = None
    workstation_id: Optional[str] = None


def ensure_column(db: sqlite3.Connection, table_name: str, column_name: str, definition: str) -> None:
    cols = db.execute(f"PRAGMA table_info({table_name})").fetchall()
    existing = {row["name"] for row in cols}
    if column_name not in existing:
        db.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def ensure_qc_schema(db: sqlite3.Connection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS qc_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            lot_id INTEGER NOT NULL,
            parameters_count INTEGER NOT NULL,
            overall_out_of_spec INTEGER NOT NULL,
            entered_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(task_id) REFERENCES sampling_tasks(id),
            FOREIGN KEY(lot_id) REFERENCES lots(id)
        )
        """
    )
    ensure_column(db, "qc_results", "report_id", "INTEGER")
    ensure_column(db, "qc_results", "parameter_name", "TEXT")


def ensure_tables() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = get_db()
    try:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                role TEXT NOT NULL,
                password TEXT NOT NULL,
                warehouse_scope TEXT
            );

            CREATE TABLE IF NOT EXISTS materials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                material_code TEXT NOT NULL,
                material_name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                material_id INTEGER NOT NULL,
                supplier_lot TEXT NOT NULL,
                internal_lot TEXT NOT NULL UNIQUE,
                warehouse_type TEXT NOT NULL DEFAULT 'SUBSTANCE_WAREHOUSE',
                production_year INTEGER,
                expiry_date TEXT,
                quantity REAL NOT NULL,
                unit TEXT NOT NULL,
                location TEXT NOT NULL,
                quality_status TEXT NOT NULL,
                incoming_control_notified_at TEXT,
                qc_result_received_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(material_id) REFERENCES materials(id)
            );

            CREATE TABLE IF NOT EXISTS sampling_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lot_id INTEGER NOT NULL,
                test_name TEXT NOT NULL,
                specification_ref TEXT NOT NULL,
                status TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(lot_id) REFERENCES lots(id)
            );

            CREATE TABLE IF NOT EXISTS qc_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_id INTEGER,
                task_id INTEGER NOT NULL,
                lot_id INTEGER NOT NULL,
                parameter_name TEXT,
                value REAL NOT NULL,
                unit TEXT NOT NULL,
                lower_limit REAL,
                upper_limit REAL,
                out_of_spec INTEGER NOT NULL,
                instrument TEXT NOT NULL,
                entered_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(report_id) REFERENCES qc_reports(id),
                FOREIGN KEY(task_id) REFERENCES sampling_tasks(id),
                FOREIGN KEY(lot_id) REFERENCES lots(id)
            );

            CREATE TABLE IF NOT EXISTS qa_decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lot_id INTEGER NOT NULL,
                decision TEXT NOT NULL,
                reason TEXT,
                decided_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(lot_id) REFERENCES lots(id)
            );

            CREATE TABLE IF NOT EXISTS production_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_code TEXT NOT NULL,
                product_name TEXT NOT NULL,
                planned_batch_size REAL NOT NULL,
                required_lot_ids TEXT NOT NULL,
                status TEXT NOT NULL,
                created_by TEXT NOT NULL,
                started_by TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT
            );

            CREATE TABLE IF NOT EXISTS ebr_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                product_code TEXT NOT NULL,
                steps_json TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ebr_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                template_id INTEGER NOT NULL,
                production_order_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                closed_at TEXT,
                FOREIGN KEY(template_id) REFERENCES ebr_templates(id),
                FOREIGN KEY(production_order_id) REFERENCES production_orders(id)
            );

            CREATE TABLE IF NOT EXISTS ebr_steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                execution_id INTEGER NOT NULL,
                step_no INTEGER NOT NULL,
                title TEXT NOT NULL,
                mandatory INTEGER NOT NULL,
                requires_signature INTEGER NOT NULL,
                status TEXT NOT NULL,
                value TEXT,
                unit TEXT,
                instrument TEXT,
                comment TEXT,
                completed_by TEXT,
                completed_at TEXT,
                FOREIGN KEY(execution_id) REFERENCES ebr_executions(id),
                UNIQUE(execution_id, step_no)
            );

            CREATE TABLE IF NOT EXISTS deviations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lot_id INTEGER NOT NULL,
                source TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(lot_id) REFERENCES lots(id)
            );

            CREATE TABLE IF NOT EXISTS signature_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                role TEXT NOT NULL,
                action_type TEXT NOT NULL,
                object_type TEXT NOT NULL,
                object_id TEXT NOT NULL,
                meaning TEXT NOT NULL,
                comment TEXT,
                result TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp_utc TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role_at_time TEXT NOT NULL,
                object_type TEXT NOT NULL,
                object_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT,
                reason TEXT,
                source TEXT NOT NULL,
                correlation_id TEXT
            );

            CREATE TABLE IF NOT EXISTS auth_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT NOT NULL UNIQUE,
                workstation_id TEXT,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS inventory_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp_utc TEXT NOT NULL,
                movement_type TEXT NOT NULL,
                lot_id INTEGER NOT NULL,
                material_id INTEGER NOT NULL,
                warehouse_type TEXT NOT NULL,
                quantity_delta REAL NOT NULL,
                quantity_after REAL NOT NULL,
                unit TEXT NOT NULL,
                reference_type TEXT,
                reference_id TEXT,
                user_id TEXT NOT NULL,
                comment TEXT,
                FOREIGN KEY(lot_id) REFERENCES lots(id),
                FOREIGN KEY(material_id) REFERENCES materials(id)
            );
            """
        )

        ensure_qc_schema(db)
        ensure_column(db, "lots", "warehouse_type", "TEXT NOT NULL DEFAULT 'SUBSTANCE_WAREHOUSE'")
        ensure_column(db, "lots", "production_year", "INTEGER")
        ensure_column(db, "lots", "expiry_date", "TEXT")
        ensure_column(db, "lots", "incoming_control_notified_at", "TEXT")
        ensure_column(db, "lots", "qc_result_received_at", "TEXT")
        ensure_column(db, "users", "warehouse_scope", "TEXT")
        ensure_column(db, "auth_sessions", "workstation_id", "TEXT")

        warehouse_scopes = {
            "warehouse_substance": "SUBSTANCE_WAREHOUSE",
            "warehouse_packaging": "PACKAGING_WAREHOUSE",
            "warehouse_fg": "FG_WAREHOUSE",
        }

        for username, role, password in SEED_USERS:
            db.execute(
                """
                INSERT INTO users(username, role, password, warehouse_scope)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(username) DO UPDATE SET role=excluded.role, warehouse_scope=excluded.warehouse_scope
                """,
                (username, role, password, warehouse_scopes.get(username)),
            )
        db.commit()
    finally:
        db.close()


@app.on_event("startup")
def on_startup() -> None:
    ensure_tables()


def get_user_by_username(db: sqlite3.Connection, username: str) -> sqlite3.Row:
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")
    return row


def revoke_expired_sessions(db: sqlite3.Connection) -> None:
    now = now_utc()
    db.execute("UPDATE auth_sessions SET revoked = 1 WHERE revoked = 0 AND expires_at < ?", (now,))


def get_current_user(authorization: Optional[str] = Header(default=None, alias="Authorization")) -> AuthUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authorization Bearer token is required")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token")

    db = get_db()
    try:
        revoke_expired_sessions(db)
        session = db.execute(
            """
            SELECT s.id, s.expires_at, s.workstation_id, u.username, u.role, u.warehouse_scope
            FROM auth_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.revoked = 0
            LIMIT 1
            """,
            (token,),
        ).fetchone()
        if not session:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
        return AuthUser(
            username=session["username"],
            role=session["role"],
            warehouse_scope=session["warehouse_scope"],
            workstation_id=session["workstation_id"],
        )
    finally:
        db.close()


def require_permission(user: AuthUser, action: str) -> None:
    allowed_roles = ROLE_PERMISSIONS.get(action, set())
    if user.role not in allowed_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Action {action} is not permitted")


def write_audit(
    db: sqlite3.Connection,
    user: AuthUser,
    object_type: str,
    object_id: str,
    action_type: str,
    old_value: Optional[dict[str, Any]] = None,
    new_value: Optional[dict[str, Any]] = None,
    reason: Optional[str] = None,
    source: str = "API",
    correlation_id: Optional[str] = None,
) -> None:
    db.execute(
        """
        INSERT INTO audit_events(
            timestamp_utc, user_id, role_at_time, object_type, object_id,
            action_type, old_value, new_value, reason, source, correlation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            now_utc(),
            user.username,
            user.role,
            object_type,
            object_id,
            action_type,
            json.dumps(old_value) if old_value is not None else None,
            json.dumps(new_value) if new_value is not None else None,
            reason,
            source,
            correlation_id,
        ),
    )


def validate_signature(
    db: sqlite3.Connection,
    actor: AuthUser,
    signature: SignatureRequest,
    action_type: str,
    object_type: str,
    object_id: str,
    require_role: Optional[str] = None,
    require_different_user: bool = False,
) -> sqlite3.Row:
    signer = get_user_by_username(db, signature.username)
    if signer["password"] != signature.password:
        db.execute(
            """
            INSERT INTO signature_events(username, role, action_type, object_type, object_id, meaning, comment, result, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                signature.username,
                signer["role"],
                action_type,
                object_type,
                object_id,
                signature.meaning,
                signature.comment,
                "failed",
                now_utc(),
            ),
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid signature password")

    if require_role and signer["role"] != require_role:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Signature requires role {require_role}")

    if require_different_user and signer["username"] == actor.username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Second signature must be from a different user")

    if signer["username"] != actor.username and require_role is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Signature user must match acting user")

    db.execute(
        """
        INSERT INTO signature_events(username, role, action_type, object_type, object_id, meaning, comment, result, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            signer["username"],
            signer["role"],
            action_type,
            object_type,
            object_id,
            signature.meaning,
            signature.comment,
            "success",
            now_utc(),
        ),
    )
    return signer


def get_lot(db: sqlite3.Connection, lot_id: int) -> sqlite3.Row:
    lot = db.execute("SELECT * FROM lots WHERE id = ?", (lot_id,)).fetchone()
    if not lot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lot not found")
    return lot


def get_profile_by_warehouse_type(warehouse_type: str) -> dict[str, Any]:
    profile = INCOMING_CONTROL_PROFILES.get(warehouse_type)
    if not profile:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown warehouse_type: {warehouse_type}")
    return profile


def to_sop_status(quality_status: str) -> str:
    return SOP_STATUS_BY_QUALITY_STATUS.get(quality_status, "НЕ ОПРЕДЕЛЕН")


def to_sop_labels(quality_status: str) -> list[str]:
    if quality_status == "sampled":
        return ["ОТОБРАНО", "КАРАНТИН"]
    return [to_sop_status(quality_status)]


def write_inventory_movement(
    db: sqlite3.Connection,
    user: AuthUser,
    movement_type: str,
    lot: sqlite3.Row,
    quantity_delta: float,
    quantity_after: float,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    comment: Optional[str] = None,
) -> None:
    db.execute(
        """
        INSERT INTO inventory_movements(
            timestamp_utc, movement_type, lot_id, material_id, warehouse_type,
            quantity_delta, quantity_after, unit, reference_type, reference_id, user_id, comment
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            now_utc(),
            movement_type,
            lot["id"],
            lot["material_id"],
            lot["warehouse_type"],
            quantity_delta,
            quantity_after,
            lot["unit"],
            reference_type,
            reference_id,
            user.username,
            comment,
        ),
    )


def enforce_warehouse_scope(user: AuthUser, warehouse_type: str) -> None:
    if user.role not in {"WAREHOUSE_OPERATOR", "WAREHOUSE_MANAGER"}:
        return
    if not user.warehouse_scope:
        return
    if user.warehouse_scope != warehouse_type:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Warehouse access denied: user scope {user.warehouse_scope}, target {warehouse_type}",
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "gmp-pilot-app"}


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "gmp-pilot-app",
        "status": "running",
        "docs": "/docs",
        "ui": "/ui",
        "health": "/health",
    }


@app.get("/ui")
def ui() -> FileResponse:
    return FileResponse(UI_PATH)


@app.post("/auth/login", response_model=LoginResponse)
def auth_login(payload: LoginRequest) -> LoginResponse:
    db = get_db()
    try:
        revoke_expired_sessions(db)
        user = get_user_by_username(db, payload.username)
        if user["password"] != payload.password:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

        token = secrets.token_urlsafe(32)
        created_at = now_utc()
        expires_at = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=12)).isoformat()

        db.execute(
            """
            INSERT INTO auth_sessions(user_id, token, workstation_id, created_at, expires_at, revoked)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (user["id"], token, payload.workstation_id, created_at, expires_at),
        )
        db.commit()

        return LoginResponse(
            access_token=token,
            expires_at=expires_at,
            username=user["username"],
            role=user["role"],
            warehouse_scope=user["warehouse_scope"],
            workstation_id=payload.workstation_id,
        )
    finally:
        db.close()


@app.post("/auth/logout")
def auth_logout(current_user: AuthUser = Depends(get_current_user), authorization: Optional[str] = Header(default=None, alias="Authorization")) -> dict[str, str]:
    token = authorization.removeprefix("Bearer ").strip() if authorization else ""
    db = get_db()
    try:
        db.execute("UPDATE auth_sessions SET revoked = 1 WHERE token = ?", (token,))
        db.commit()
    finally:
        db.close()
    return {"message": f"Session revoked for {current_user.username}"}


@app.get("/auth/me")
def auth_me(current_user: AuthUser = Depends(get_current_user)) -> dict[str, str]:
    return {
        "username": current_user.username,
        "role": current_user.role,
        "warehouse_scope": current_user.warehouse_scope or "",
        "workstation_id": current_user.workstation_id or "",
    }


@app.get("/incoming-control/profiles")
def list_incoming_control_profiles(user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "READ_OPERATIONAL_DATA")
    profiles: list[dict[str, Any]] = []
    for warehouse_type, profile in INCOMING_CONTROL_PROFILES.items():
        profiles.append(
            {
                "warehouse_type": warehouse_type,
                "display_name": profile["display_name"],
                "default_test_name": profile["default_test_name"],
                "default_specification_ref": profile["default_specification_ref"],
                "parameters": profile["parameters"],
            }
        )
    return {"count": len(profiles), "profiles": profiles}


@app.get("/lots/{lot_id}/incoming-control-profile")
def get_lot_incoming_control_profile(lot_id: int, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "READ_OPERATIONAL_DATA")
    db = get_db()
    try:
        lot = get_lot(db, lot_id)
        enforce_warehouse_scope(user, lot["warehouse_type"])
        profile = get_profile_by_warehouse_type(lot["warehouse_type"])
        return {
            "lot_id": lot_id,
            "warehouse_type": lot["warehouse_type"],
            "display_name": profile["display_name"],
            "default_test_name": profile["default_test_name"],
            "default_specification_ref": profile["default_specification_ref"],
            "parameters": profile["parameters"],
        }
    finally:
        db.close()


@app.post("/materials/receipts")
def create_material_receipt(payload: MaterialReceiptRequest, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "CREATE_RECEIPT")
    if payload.warehouse_type not in WAREHOUSE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown warehouse_type")
    enforce_warehouse_scope(user, payload.warehouse_type)

    db = get_db()
    try:
        validate_signature(db, user, payload.signature, "CREATE_RECEIPT", "material_receipt", "new")

        created_at = now_utc()
        db.execute(
            "INSERT INTO materials(material_code, material_name, created_at) VALUES (?, ?, ?)",
            (payload.material_code, payload.material_name, created_at),
        )
        material_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

        internal_lot = f"LOT-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{material_id}"
        db.execute(
            """
            INSERT INTO lots(
                material_id, supplier_lot, internal_lot, warehouse_type, production_year, expiry_date,
                quantity, unit, location, quality_status, incoming_control_notified_at, qc_result_received_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                material_id,
                payload.supplier_lot,
                internal_lot,
                payload.warehouse_type,
                payload.production_year,
                payload.expiry_date,
                payload.quantity,
                payload.unit,
                payload.location,
                "received",
                None,
                None,
                created_at,
            ),
        )
        lot_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        lot = db.execute("SELECT * FROM lots WHERE id = ?", (lot_id,)).fetchone()

        write_inventory_movement(
            db,
            user,
            movement_type="RECEIPT",
            lot=lot,
            quantity_delta=payload.quantity,
            quantity_after=payload.quantity,
            reference_type="material_receipt",
            reference_id=str(lot_id),
            comment="Приход на склад",
        )

        write_audit(
            db,
            user,
            object_type="lot",
            object_id=str(lot_id),
            action_type="CREATE_RECEIPT",
            new_value={
                "material_code": payload.material_code,
                "supplier_lot": payload.supplier_lot,
                "warehouse_type": payload.warehouse_type,
                "internal_lot": internal_lot,
                "quality_status": "received",
                "sop_status": to_sop_status("received"),
                "production_year": payload.production_year,
                "expiry_date": payload.expiry_date,
                "quantity": payload.quantity,
                "unit": payload.unit,
                "location": payload.location,
            },
        )
        db.commit()
        return {
            "lot_id": lot_id,
            "internal_lot": internal_lot,
            "warehouse_type": payload.warehouse_type,
            "quality_status": "received",
            "sop_status": to_sop_status("received"),
            "production_year": payload.production_year,
            "expiry_date": payload.expiry_date,
            "message": "Material receipt created",
        }
    finally:
        db.close()


@app.get("/lots")
def list_lots(
    status_filter: Optional[str] = None,
    warehouse_type: Optional[Literal["SUBSTANCE_WAREHOUSE", "PACKAGING_WAREHOUSE", "FG_WAREHOUSE"]] = None,
    material_code: Optional[str] = None,
    q: Optional[str] = None,
    min_quantity: Optional[float] = None,
    max_quantity: Optional[float] = None,
    user: AuthUser = Depends(get_current_user),
) -> dict[str, Any]:
    require_permission(user, "READ_OPERATIONAL_DATA")
    effective_warehouse_type = warehouse_type
    if user.role in {"WAREHOUSE_OPERATOR", "WAREHOUSE_MANAGER"} and user.warehouse_scope:
        if warehouse_type and warehouse_type != user.warehouse_scope:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Warehouse access denied for requested filter")
        effective_warehouse_type = user.warehouse_scope

    db = get_db()
    try:
        base_query = """
            SELECT
                l.id,
                l.internal_lot,
                l.supplier_lot,
                l.warehouse_type,
                l.production_year,
                l.expiry_date,
                l.quantity,
                l.unit,
                l.location,
                l.quality_status,
                l.incoming_control_notified_at,
                l.qc_result_received_at,
                l.created_at,
                m.material_code,
                m.material_name,
                EXISTS(
                    SELECT 1
                    FROM deviations d
                    WHERE d.lot_id = l.id AND d.status = 'open'
                ) AS has_open_deviation
            FROM lots l
            JOIN materials m ON m.id = l.material_id
        """

        params: list[Any] = []
        where_parts: list[str] = []
        if status_filter:
            where_parts.append("l.quality_status = ?")
            params.append(status_filter)

        if effective_warehouse_type:
            where_parts.append("l.warehouse_type = ?")
            params.append(effective_warehouse_type)

        if material_code:
            where_parts.append("m.material_code = ?")
            params.append(material_code)

        if q:
            where_parts.append("(m.material_code LIKE ? OR m.material_name LIKE ? OR l.internal_lot LIKE ? OR l.supplier_lot LIKE ?)")
            like_q = f"%{q}%"
            params.extend([like_q, like_q, like_q, like_q])

        if min_quantity is not None:
            where_parts.append("l.quantity >= ?")
            params.append(min_quantity)

        if max_quantity is not None:
            where_parts.append("l.quantity <= ?")
            params.append(max_quantity)

        if where_parts:
            base_query += " WHERE " + " AND ".join(where_parts)

        base_query += " ORDER BY l.id DESC "
        rows = db.execute(base_query, tuple(params)).fetchall()

        lots: list[dict[str, Any]] = []
        for row in rows:
            lots.append(
                {
                    "id": row["id"],
                    "internal_lot": row["internal_lot"],
                    "supplier_lot": row["supplier_lot"],
                    "warehouse_type": row["warehouse_type"],
                    "material_code": row["material_code"],
                    "material_name": row["material_name"],
                    "production_year": row["production_year"],
                    "expiry_date": row["expiry_date"],
                    "quantity": row["quantity"],
                    "unit": row["unit"],
                    "location": row["location"],
                    "quality_status": row["quality_status"],
                    "sop_status": to_sop_status(row["quality_status"]),
                    "sop_labels": to_sop_labels(row["quality_status"]),
                    "incoming_control_notified_at": row["incoming_control_notified_at"],
                    "qc_result_received_at": row["qc_result_received_at"],
                    "created_at": row["created_at"],
                    "has_open_deviation": bool(row["has_open_deviation"]),
                }
            )

        return {"count": len(lots), "lots": lots}
    finally:
        db.close()


@app.get("/inventory/movements")
def list_inventory_movements(
    warehouse_type: Optional[Literal["SUBSTANCE_WAREHOUSE", "PACKAGING_WAREHOUSE", "FG_WAREHOUSE"]] = None,
    material_code: Optional[str] = None,
    lot_id: Optional[int] = None,
    movement_type: Optional[str] = None,
    limit: int = 200,
    user: AuthUser = Depends(get_current_user),
) -> dict[str, Any]:
    require_permission(user, "READ_OPERATIONAL_DATA")
    effective_warehouse_type = warehouse_type
    if user.role in {"WAREHOUSE_OPERATOR", "WAREHOUSE_MANAGER"} and user.warehouse_scope:
        if warehouse_type and warehouse_type != user.warehouse_scope:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Warehouse access denied for requested filter")
        effective_warehouse_type = user.warehouse_scope

    capped_limit = min(max(limit, 1), 1000)
    db = get_db()
    try:
        query = """
            SELECT
                im.id,
                im.timestamp_utc,
                im.movement_type,
                im.lot_id,
                im.material_id,
                im.warehouse_type,
                im.quantity_delta,
                im.quantity_after,
                im.unit,
                im.reference_type,
                im.reference_id,
                im.user_id,
                im.comment,
                l.internal_lot,
                l.supplier_lot,
                l.production_year,
                l.expiry_date,
                m.material_code,
                m.material_name
            FROM inventory_movements im
            JOIN lots l ON l.id = im.lot_id
            JOIN materials m ON m.id = im.material_id
        """
        where_parts: list[str] = []
        params: list[Any] = []

        if effective_warehouse_type:
            where_parts.append("im.warehouse_type = ?")
            params.append(effective_warehouse_type)
        if material_code:
            where_parts.append("m.material_code = ?")
            params.append(material_code)
        if lot_id is not None:
            where_parts.append("im.lot_id = ?")
            params.append(lot_id)
        if movement_type:
            where_parts.append("im.movement_type = ?")
            params.append(movement_type)

        if where_parts:
            query += " WHERE " + " AND ".join(where_parts)

        query += " ORDER BY im.id DESC LIMIT ?"
        params.append(capped_limit)

        rows = db.execute(query, tuple(params)).fetchall()
        movements = []
        for row in rows:
            movements.append(
                {
                    "id": row["id"],
                    "timestamp_utc": row["timestamp_utc"],
                    "movement_type": row["movement_type"],
                    "warehouse_type": row["warehouse_type"],
                    "lot_id": row["lot_id"],
                    "internal_lot": row["internal_lot"],
                    "supplier_lot": row["supplier_lot"],
                    "production_year": row["production_year"],
                    "expiry_date": row["expiry_date"],
                    "material_code": row["material_code"],
                    "material_name": row["material_name"],
                    "quantity_delta": row["quantity_delta"],
                    "quantity_after": row["quantity_after"],
                    "unit": row["unit"],
                    "reference_type": row["reference_type"],
                    "reference_id": row["reference_id"],
                    "user_id": row["user_id"],
                    "comment": row["comment"],
                }
            )
        return {"count": len(movements), "movements": movements}
    finally:
        db.close()


@app.get("/inventory/balances")
def get_inventory_balances(
    warehouse_type: Optional[Literal["SUBSTANCE_WAREHOUSE", "PACKAGING_WAREHOUSE", "FG_WAREHOUSE"]] = None,
    material_code: Optional[str] = None,
    quality_status: Optional[str] = None,
    user: AuthUser = Depends(get_current_user),
) -> dict[str, Any]:
    require_permission(user, "READ_OPERATIONAL_DATA")
    effective_warehouse_type = warehouse_type
    if user.role in {"WAREHOUSE_OPERATOR", "WAREHOUSE_MANAGER"} and user.warehouse_scope:
        if warehouse_type and warehouse_type != user.warehouse_scope:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Warehouse access denied for requested filter")
        effective_warehouse_type = user.warehouse_scope

    db = get_db()
    try:
        query = """
            SELECT
                l.warehouse_type,
                m.material_code,
                m.material_name,
                l.unit,
                SUM(l.quantity) AS total_quantity,
                COUNT(*) AS lots_count
            FROM lots l
            JOIN materials m ON m.id = l.material_id
        """
        where_parts: list[str] = []
        params: list[Any] = []

        if effective_warehouse_type:
            where_parts.append("l.warehouse_type = ?")
            params.append(effective_warehouse_type)
        if material_code:
            where_parts.append("m.material_code = ?")
            params.append(material_code)
        if quality_status:
            where_parts.append("l.quality_status = ?")
            params.append(quality_status)

        if where_parts:
            query += " WHERE " + " AND ".join(where_parts)

        query += " GROUP BY l.warehouse_type, m.material_code, m.material_name, l.unit ORDER BY l.warehouse_type, m.material_code"
        rows = db.execute(query, tuple(params)).fetchall()

        balances = []
        for row in rows:
            balances.append(
                {
                    "warehouse_type": row["warehouse_type"],
                    "material_code": row["material_code"],
                    "material_name": row["material_name"],
                    "unit": row["unit"],
                    "total_quantity": row["total_quantity"],
                    "lots_count": row["lots_count"],
                }
            )
        return {"count": len(balances), "balances": balances}
    finally:
        db.close()


@app.get("/sampling-tasks")
def list_sampling_tasks(status_filter: Optional[str] = None, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "READ_OPERATIONAL_DATA")
    warehouse_scope = user.warehouse_scope if user.role in {"WAREHOUSE_OPERATOR", "WAREHOUSE_MANAGER"} else None
    db = get_db()
    try:
        base_query = """
            SELECT
                st.id,
                st.lot_id,
                st.test_name,
                st.specification_ref,
                st.status,
                st.created_by,
                st.created_at,
                l.internal_lot,
                l.production_year,
                l.expiry_date,
                l.warehouse_type,
                l.quality_status
            FROM sampling_tasks st
            JOIN lots l ON l.id = st.lot_id
        """
        params: list[Any] = []
        where_parts: list[str] = []
        if status_filter:
            where_parts.append("st.status = ?")
            params.append(status_filter)

        if warehouse_scope:
            where_parts.append("l.warehouse_type = ?")
            params.append(warehouse_scope)

        if where_parts:
            base_query += " WHERE " + " AND ".join(where_parts)

        base_query += " ORDER BY st.id DESC "
        rows = db.execute(base_query, tuple(params)).fetchall()

        tasks: list[dict[str, Any]] = []
        for row in rows:
            tasks.append(
                {
                    "id": row["id"],
                    "lot_id": row["lot_id"],
                    "internal_lot": row["internal_lot"],
                    "production_year": row["production_year"],
                    "expiry_date": row["expiry_date"],
                    "warehouse_type": row["warehouse_type"],
                    "lot_quality_status": row["quality_status"],
                    "lot_sop_status": to_sop_status(row["quality_status"]),
                    "test_name": row["test_name"],
                    "specification_ref": row["specification_ref"],
                    "status": row["status"],
                    "created_by": row["created_by"],
                    "created_at": row["created_at"],
                }
            )

        return {"count": len(tasks), "tasks": tasks}
    finally:
        db.close()


@app.post("/lots/{lot_id}/status-transitions")
def transition_lot_status(
    lot_id: int,
    payload: StatusTransitionRequest,
    user: AuthUser = Depends(get_current_user),
) -> dict[str, Any]:
    require_permission(user, "TRANSITION_STATUS")
    db = get_db()
    try:
        lot = get_lot(db, lot_id)
        enforce_warehouse_scope(user, lot["warehouse_type"])
        from_status = lot["quality_status"]
        to_status = payload.to_status

        if from_status not in QUALITY_STATUSES or to_status not in QUALITY_STATUSES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown quality status")

        if to_status not in ALLOWED_STATUS_TRANSITIONS[from_status]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Transition {from_status} -> {to_status} is not allowed",
            )

        if to_status in {"blocked", "rejected"} and not payload.reason:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reason is required")

        if to_status in {"released", "blocked", "rejected"}:
            if not payload.signature:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Signature is required")
            validate_signature(db, user, payload.signature, "STATUS_TRANSITION", "lot", str(lot_id))

        db.execute("UPDATE lots SET quality_status = ? WHERE id = ?", (to_status, lot_id))

        write_audit(
            db,
            user,
            object_type="lot",
            object_id=str(lot_id),
            action_type="STATUS_TRANSITION",
            old_value={"quality_status": from_status},
            new_value={"quality_status": to_status},
            reason=payload.reason,
        )
        db.commit()
        return {
            "lot_id": lot_id,
            "from_status": from_status,
            "to_status": to_status,
            "from_sop_status": to_sop_status(from_status),
            "to_sop_status": to_sop_status(to_status),
        }
    finally:
        db.close()


@app.post("/lots/{lot_id}/sampling-tasks")
def create_sampling_task(
    lot_id: int,
    payload: SamplingTaskRequest,
    user: AuthUser = Depends(get_current_user),
) -> dict[str, Any]:
    require_permission(user, "CREATE_SAMPLING_TASK")
    db = get_db()
    try:
        lot = get_lot(db, lot_id)
        enforce_warehouse_scope(user, lot["warehouse_type"])
        if lot["quality_status"] not in {"quarantine", "sampled"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sampling allowed only for quarantine/sampled lots")

        validate_signature(db, user, payload.signature, "CREATE_SAMPLING_TASK", "lot", str(lot_id))
        profile = get_profile_by_warehouse_type(lot["warehouse_type"])
        test_name = payload.test_name or profile["default_test_name"]
        specification_ref = payload.specification_ref or profile["default_specification_ref"]

        db.execute(
            """
            INSERT INTO sampling_tasks(lot_id, test_name, specification_ref, status, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (lot_id, test_name, specification_ref, "open", user.username, now_utc()),
        )
        task_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        incoming_control_notified_at = now_utc()
        db.execute("UPDATE lots SET incoming_control_notified_at = ? WHERE id = ?", (incoming_control_notified_at, lot_id))

        if lot["quality_status"] == "quarantine":
            db.execute("UPDATE lots SET quality_status = ? WHERE id = ?", ("sampled", lot_id))

        write_audit(
            db,
            user,
            object_type="sampling_task",
            object_id=str(task_id),
            action_type="CREATE_SAMPLING_TASK",
            new_value={"lot_id": lot_id, "test_name": test_name, "specification_ref": specification_ref, "warehouse_type": lot["warehouse_type"]},
        )
        db.commit()
        return {
            "task_id": task_id,
            "status": "open",
            "lot_id": lot_id,
            "incoming_control_notified_at": incoming_control_notified_at,
        }
    finally:
        db.close()


@app.post("/qc/results")
def enter_qc_result(payload: QCResultRequest, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    mapped_payload = QCBatchReportRequest(
        task_id=payload.task_id,
        results=[
            QCParameterResultRequest(
                parameter_name="Primary",
                value=payload.value,
                unit=payload.unit,
                lower_limit=payload.lower_limit,
                upper_limit=payload.upper_limit,
                instrument=payload.instrument,
            )
        ],
        signature=payload.signature,
    )
    result = enter_qc_report(mapped_payload, user)
    return {
        "result_id": result["report_id"],
        "lot_id": result["lot_id"],
        "out_of_spec": result["out_of_spec"],
        "parameters_count": result["parameters_count"],
    }


@app.post("/qc/reports")
def enter_qc_report(payload: QCBatchReportRequest, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "ENTER_QC_RESULT")
    db = get_db()
    try:
        validate_signature(db, user, payload.signature, "ENTER_QC_REPORT", "sampling_task", str(payload.task_id))

        task = db.execute("SELECT * FROM sampling_tasks WHERE id = ?", (payload.task_id,)).fetchone()
        if not task:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sampling task not found")
        if task["status"] != "open":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sampling task is not open")

        overall_out_of_spec = False
        for param in payload.results:
            is_oos = False
            if param.lower_limit is not None and param.value < param.lower_limit:
                is_oos = True
            if param.upper_limit is not None and param.value > param.upper_limit:
                is_oos = True
            if is_oos:
                overall_out_of_spec = True

        db.execute(
            """
            INSERT INTO qc_reports(task_id, lot_id, parameters_count, overall_out_of_spec, entered_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                payload.task_id,
                task["lot_id"],
                len(payload.results),
                1 if overall_out_of_spec else 0,
                user.username,
                now_utc(),
            ),
        )
        report_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

        for param in payload.results:
            out_of_spec = False
            if param.lower_limit is not None and param.value < param.lower_limit:
                out_of_spec = True
            if param.upper_limit is not None and param.value > param.upper_limit:
                out_of_spec = True

            db.execute(
                """
                INSERT INTO qc_results(report_id, task_id, lot_id, parameter_name, value, unit, lower_limit, upper_limit, out_of_spec, instrument, entered_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    report_id,
                    payload.task_id,
                    task["lot_id"],
                    param.parameter_name,
                    param.value,
                    param.unit,
                    param.lower_limit,
                    param.upper_limit,
                    1 if out_of_spec else 0,
                    param.instrument,
                    user.username,
                    now_utc(),
                ),
            )

        db.execute("UPDATE sampling_tasks SET status = ? WHERE id = ?", ("completed", payload.task_id))
        db.execute("UPDATE lots SET quality_status = ? WHERE id = ?", ("under_test", task["lot_id"]))
        qc_result_received_at = now_utc()
        db.execute("UPDATE lots SET qc_result_received_at = ? WHERE id = ?", (qc_result_received_at, task["lot_id"]))

        if overall_out_of_spec:
            db.execute(
                """
                INSERT INTO deviations(lot_id, source, description, status, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (task["lot_id"], "QC", "OOS/OOT detected from QC batch report", "open", user.username, now_utc()),
            )

        write_audit(
            db,
            user,
            object_type="qc_report",
            object_id=str(report_id),
            action_type="ENTER_QC_REPORT",
            new_value={
                "task_id": payload.task_id,
                "lot_id": task["lot_id"],
                "parameters_count": len(payload.results),
                "out_of_spec": overall_out_of_spec,
                "status_after_report": "under_test",
            },
            reason="OOS/OOT" if overall_out_of_spec else None,
        )
        db.commit()
        return {
            "report_id": report_id,
            "lot_id": task["lot_id"],
            "out_of_spec": overall_out_of_spec,
            "parameters_count": len(payload.results),
            "lot_next_sop_status": to_sop_status("under_test"),
            "qc_result_received_at": qc_result_received_at,
        }
    finally:
        db.close()


@app.post("/qa/release-decisions")
def qa_release_decision(payload: QAReleaseRequest, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "QA_RELEASE")
    db = get_db()
    try:
        lot = get_lot(db, payload.lot_id)
        validate_signature(db, user, payload.signature, "QA_RELEASE", "lot", str(payload.lot_id))

        open_deviation = db.execute(
            "SELECT id FROM deviations WHERE lot_id = ? AND status = 'open' LIMIT 1", (payload.lot_id,)
        ).fetchone()
        if open_deviation:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="QA release is blocked due to open deviation",
            )

        if lot["quality_status"] not in {"under_test", "sampled", "blocked"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lot is not in releasable state")

        if payload.decision in {"blocked", "rejected"} and not payload.reason:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reason is required")

        db.execute(
            """
            INSERT INTO qa_decisions(lot_id, decision, reason, decided_by, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (payload.lot_id, payload.decision, payload.reason, user.username, now_utc()),
        )
        decision_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

        db.execute("UPDATE lots SET quality_status = ? WHERE id = ?", (payload.decision, payload.lot_id))

        write_audit(
            db,
            user,
            object_type="qa_decision",
            object_id=str(decision_id),
            action_type="QA_RELEASE_DECISION",
            old_value={"quality_status": lot["quality_status"]},
            new_value={"quality_status": payload.decision},
            reason=payload.reason,
        )
        db.commit()
        return {
            "decision_id": decision_id,
            "lot_id": payload.lot_id,
            "decision": payload.decision,
            "decision_sop_status": to_sop_status(payload.decision),
        }
    finally:
        db.close()


@app.post("/warehouse/issues-to-production")
def issue_to_production(payload: IssueToProductionRequest, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "ISSUE_TO_PRODUCTION")
    db = get_db()
    try:
        lot = get_lot(db, payload.lot_id)
        enforce_warehouse_scope(user, lot["warehouse_type"])
        validate_signature(db, user, payload.signature, "ISSUE_TO_PRODUCTION", "lot", str(payload.lot_id))

        override_used = False
        if lot["quality_status"] != "released":
            if not payload.override_signature or not payload.override_reason:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Only released lot can be issued unless approved override is provided",
                )
            validate_signature(
                db,
                user,
                payload.override_signature,
                "ISSUE_OVERRIDE",
                "lot",
                str(payload.lot_id),
                require_role="QA_MANAGER",
                require_different_user=True,
            )
            override_used = True

        if payload.quantity > lot["quantity"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Issue quantity exceeds available lot quantity")

        new_quantity = lot["quantity"] - payload.quantity
        db.execute("UPDATE lots SET quantity = ? WHERE id = ?", (new_quantity, payload.lot_id))

        lot_after = db.execute("SELECT * FROM lots WHERE id = ?", (payload.lot_id,)).fetchone()
        write_inventory_movement(
            db,
            user,
            movement_type="ISSUE_TO_PRODUCTION",
            lot=lot_after,
            quantity_delta=-payload.quantity,
            quantity_after=new_quantity,
            reference_type="issue_to_production",
            reference_id=str(payload.lot_id),
            comment=payload.override_reason if override_used else "Выдача в производство",
        )

        write_audit(
            db,
            user,
            object_type="lot",
            object_id=str(payload.lot_id),
            action_type="ISSUE_TO_PRODUCTION",
            old_value={"quantity": lot["quantity"], "status": lot["quality_status"]},
            new_value={"quantity": new_quantity, "production_area": payload.production_area},
            reason=payload.override_reason if override_used else None,
        )
        db.commit()
        return {
            "lot_id": payload.lot_id,
            "issued_quantity": payload.quantity,
            "remaining_quantity": new_quantity,
            "override_used": override_used,
        }
    finally:
        db.close()


@app.post("/warehouse/stock-adjustments")
def adjust_stock(payload: StockAdjustmentRequest, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "ADJUST_STOCK")
    if payload.quantity_delta == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="quantity_delta cannot be 0")

    db = get_db()
    try:
        lot = get_lot(db, payload.lot_id)
        enforce_warehouse_scope(user, lot["warehouse_type"])
        validate_signature(db, user, payload.signature, "ADJUST_STOCK", "lot", str(payload.lot_id))

        new_quantity = lot["quantity"] + payload.quantity_delta
        if new_quantity < 0:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Stock cannot become negative")

        db.execute("UPDATE lots SET quantity = ? WHERE id = ?", (new_quantity, payload.lot_id))
        lot_after = db.execute("SELECT * FROM lots WHERE id = ?", (payload.lot_id,)).fetchone()

        write_inventory_movement(
            db,
            user,
            movement_type="STOCK_ADJUSTMENT",
            lot=lot_after,
            quantity_delta=payload.quantity_delta,
            quantity_after=new_quantity,
            reference_type="stock_adjustment",
            reference_id=str(payload.lot_id),
            comment=payload.reason,
        )

        write_audit(
            db,
            user,
            object_type="lot",
            object_id=str(payload.lot_id),
            action_type="STOCK_ADJUSTMENT",
            old_value={"quantity": lot["quantity"]},
            new_value={"quantity": new_quantity, "delta": payload.quantity_delta},
            reason=payload.reason,
        )
        db.commit()
        return {"lot_id": payload.lot_id, "quantity_before": lot["quantity"], "quantity_after": new_quantity}
    finally:
        db.close()


@app.post("/production-orders")
def create_production_order(payload: CreateProductionOrderRequest, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "CREATE_PRODUCTION_ORDER")
    db = get_db()
    try:
        validate_signature(db, user, payload.signature, "CREATE_PRODUCTION_ORDER", "production_order", "new")
        if not payload.required_lot_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="required_lot_ids cannot be empty")

        for lot_id in payload.required_lot_ids:
            get_lot(db, lot_id)

        db.execute(
            """
            INSERT INTO production_orders(product_code, product_name, planned_batch_size, required_lot_ids, status, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.product_code,
                payload.product_name,
                payload.planned_batch_size,
                json.dumps(payload.required_lot_ids),
                "draft",
                user.username,
                now_utc(),
            ),
        )
        order_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

        write_audit(
            db,
            user,
            object_type="production_order",
            object_id=str(order_id),
            action_type="CREATE_PRODUCTION_ORDER",
            new_value={
                "product_code": payload.product_code,
                "planned_batch_size": payload.planned_batch_size,
                "required_lot_ids": payload.required_lot_ids,
                "status": "draft",
            },
        )
        db.commit()
        return {"production_order_id": order_id, "status": "draft"}
    finally:
        db.close()


@app.post("/production-orders/{order_id}/start")
def start_production_order(
    order_id: int,
    payload: StartProductionOrderRequest,
    user: AuthUser = Depends(get_current_user),
) -> dict[str, Any]:
    require_permission(user, "START_PRODUCTION_ORDER")
    db = get_db()
    try:
        order = db.execute("SELECT * FROM production_orders WHERE id = ?", (order_id,)).fetchone()
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Production order not found")
        if order["status"] != "draft":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Production order is not in draft status")

        validate_signature(db, user, payload.signature, "START_PRODUCTION_ORDER", "production_order", str(order_id))

        required_lot_ids = json.loads(order["required_lot_ids"])
        not_released = []
        for lot_id in required_lot_ids:
            lot = get_lot(db, lot_id)
            if lot["quality_status"] != "released":
                not_released.append({"lot_id": lot_id, "status": lot["quality_status"]})

        override_used = False
        if not_released:
            if not payload.override_signature or not payload.override_reason:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"message": "Production start blocked: non-released lots", "lots": not_released},
                )

            validate_signature(
                db,
                user,
                payload.override_signature,
                "START_PRODUCTION_OVERRIDE",
                "production_order",
                str(order_id),
                require_role="QA_MANAGER",
                require_different_user=True,
            )
            override_used = True

        db.execute(
            "UPDATE production_orders SET status = ?, started_by = ?, started_at = ? WHERE id = ?",
            ("started", user.username, now_utc(), order_id),
        )

        write_audit(
            db,
            user,
            object_type="production_order",
            object_id=str(order_id),
            action_type="START_PRODUCTION_ORDER",
            old_value={"status": "draft"},
            new_value={"status": "started"},
            reason=payload.override_reason if override_used else None,
        )
        db.commit()
        return {"production_order_id": order_id, "status": "started", "override_used": override_used}
    finally:
        db.close()


@app.post("/ebr/templates")
def create_ebr_template(payload: CreateEBRTemplateRequest, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "CREATE_EBR_TEMPLATE")
    db = get_db()
    try:
        validate_signature(db, user, payload.signature, "CREATE_EBR_TEMPLATE", "ebr_template", "new")

        if not payload.steps:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template must contain at least one step")

        sorted_steps = sorted(payload.steps, key=lambda s: s.step_no)
        expected = list(range(1, len(sorted_steps) + 1))
        actual = [step.step_no for step in sorted_steps]
        if actual != expected:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Step numbers must be continuous from 1")

        steps_json = json.dumps([step.model_dump() for step in sorted_steps])
        db.execute(
            """
            INSERT INTO ebr_templates(name, product_code, steps_json, created_by, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (payload.name, payload.product_code, steps_json, user.username, now_utc()),
        )
        template_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

        write_audit(
            db,
            user,
            object_type="ebr_template",
            object_id=str(template_id),
            action_type="CREATE_EBR_TEMPLATE",
            new_value={"name": payload.name, "product_code": payload.product_code, "steps_count": len(sorted_steps)},
        )
        db.commit()
        return {"template_id": template_id, "steps": len(sorted_steps)}
    finally:
        db.close()


@app.post("/ebr/executions")
def create_ebr_execution(payload: CreateEBRExecutionRequest, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "CREATE_EBR_EXECUTION")
    db = get_db()
    try:
        validate_signature(db, user, payload.signature, "CREATE_EBR_EXECUTION", "ebr_execution", "new")

        template = db.execute("SELECT * FROM ebr_templates WHERE id = ?", (payload.template_id,)).fetchone()
        if not template:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="EBR template not found")

        order = db.execute("SELECT * FROM production_orders WHERE id = ?", (payload.production_order_id,)).fetchone()
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Production order not found")
        if order["status"] != "started":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Production order must be started")

        db.execute(
            """
            INSERT INTO ebr_executions(template_id, production_order_id, status, created_by, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (payload.template_id, payload.production_order_id, "in_progress", user.username, now_utc()),
        )
        execution_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

        for step in json.loads(template["steps_json"]):
            db.execute(
                """
                INSERT INTO ebr_steps(execution_id, step_no, title, mandatory, requires_signature, status)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    execution_id,
                    step["step_no"],
                    step["title"],
                    1 if step["mandatory"] else 0,
                    1 if step["requires_signature"] else 0,
                    "pending",
                ),
            )

        write_audit(
            db,
            user,
            object_type="ebr_execution",
            object_id=str(execution_id),
            action_type="CREATE_EBR_EXECUTION",
            new_value={"template_id": payload.template_id, "production_order_id": payload.production_order_id, "status": "in_progress"},
        )
        db.commit()
        return {"execution_id": execution_id, "status": "in_progress"}
    finally:
        db.close()


@app.post("/ebr/executions/{execution_id}/steps/{step_no}/complete")
def complete_ebr_step(
    execution_id: int,
    step_no: int,
    payload: CompleteEBRStepRequest,
    user: AuthUser = Depends(get_current_user),
) -> dict[str, Any]:
    require_permission(user, "COMPLETE_EBR_STEP")
    db = get_db()
    try:
        execution = db.execute("SELECT * FROM ebr_executions WHERE id = ?", (execution_id,)).fetchone()
        if not execution:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="EBR execution not found")
        if execution["status"] != "in_progress":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="EBR execution is not in progress")

        step = db.execute(
            "SELECT * FROM ebr_steps WHERE execution_id = ? AND step_no = ?",
            (execution_id, step_no),
        ).fetchone()
        if not step:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="EBR step not found")
        if step["status"] == "completed":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="EBR step already completed")

        previous_incomplete_mandatory = db.execute(
            """
            SELECT 1
            FROM ebr_steps
            WHERE execution_id = ?
              AND step_no < ?
              AND mandatory = 1
              AND status != 'completed'
            LIMIT 1
            """,
            (execution_id, step_no),
        ).fetchone()
        if previous_incomplete_mandatory:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Previous mandatory step is not completed")

        if step["requires_signature"] == 1:
            validate_signature(db, user, payload.signature, "COMPLETE_EBR_STEP", "ebr_step", f"{execution_id}:{step_no}")

        db.execute(
            """
            UPDATE ebr_steps
            SET status = ?, value = ?, unit = ?, instrument = ?, comment = ?, completed_by = ?, completed_at = ?
            WHERE execution_id = ? AND step_no = ?
            """,
            (
                "completed",
                payload.value,
                payload.unit,
                payload.instrument,
                payload.comment,
                user.username,
                now_utc(),
                execution_id,
                step_no,
            ),
        )

        write_audit(
            db,
            user,
            object_type="ebr_step",
            object_id=f"{execution_id}:{step_no}",
            action_type="COMPLETE_EBR_STEP",
            old_value={"status": "pending"},
            new_value={"status": "completed", "value": payload.value, "unit": payload.unit},
            reason=payload.comment,
        )

        open_required = db.execute(
            """
            SELECT 1
            FROM ebr_steps
            WHERE execution_id = ?
              AND mandatory = 1
              AND status != 'completed'
            LIMIT 1
            """,
            (execution_id,),
        ).fetchone()

        execution_closed = False
        if not open_required:
            db.execute(
                "UPDATE ebr_executions SET status = ?, closed_at = ? WHERE id = ?",
                ("completed", now_utc(), execution_id),
            )
            execution_closed = True
            write_audit(
                db,
                user,
                object_type="ebr_execution",
                object_id=str(execution_id),
                action_type="CLOSE_EBR_EXECUTION",
                old_value={"status": "in_progress"},
                new_value={"status": "completed"},
            )

        db.commit()
        return {"execution_id": execution_id, "step_no": step_no, "step_status": "completed", "execution_closed": execution_closed}
    finally:
        db.close()


@app.get("/audit-events")
def list_audit_events(limit: int = 100, user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    require_permission(user, "READ_AUDIT_EVENTS")
    capped_limit = min(max(limit, 1), 500)
    db = get_db()
    try:
        rows = db.execute(
            """
            SELECT id, timestamp_utc, user_id, role_at_time, object_type, object_id, action_type, old_value, new_value, reason, source, correlation_id
            FROM audit_events
            ORDER BY id DESC
            LIMIT ?
            """,
            (capped_limit,),
        ).fetchall()

        events: list[dict[str, Any]] = []
        for row in rows:
            events.append(
                {
                    "id": row["id"],
                    "timestamp_utc": row["timestamp_utc"],
                    "user_id": row["user_id"],
                    "role_at_time": row["role_at_time"],
                    "object_type": row["object_type"],
                    "object_id": row["object_id"],
                    "action_type": row["action_type"],
                    "old_value": json.loads(row["old_value"]) if row["old_value"] else None,
                    "new_value": json.loads(row["new_value"]) if row["new_value"] else None,
                    "reason": row["reason"],
                    "source": row["source"],
                    "correlation_id": row["correlation_id"],
                }
            )

        return {"count": len(events), "events": events}
    finally:
        db.close()
