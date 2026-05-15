from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.identity import Department, Permission, Role, User
from app.models.master_data import Location, Manufacturer, Material, Supplier, Warehouse


PERMISSIONS: list[tuple[str, str]] = [
    ("VIEW_WAREHOUSE", "View warehouse records"),
    ("CREATE_RECEIPT", "Create receipt documents"),
    ("POST_RECEIPT", "Post receipt documents"),
    ("VIEW_MASTER_DATA", "View master data"),
    ("MANAGE_MASTER_DATA", "Manage master data"),
    ("VIEW_QC", "View QC records"),
    ("ENTER_QC_RESULT", "Enter QC results"),
    ("UPLOAD_QC_SCAN", "Upload scanned QC notification (Ф-14 СОП-209) — ДКК"),
    ("VIEW_QA", "View QA records"),
    ("QA_DECISION", "Make QA decisions"),
    ("VERIFY_QC_SCAN", "Verify uploaded QC notification scan against wet-ink signatures — ДОК"),
    ("VIEW_PRODUCTION", "View production records"),
    ("MANAGE_PRODUCTION", "Manage production orders"),
    ("EXECUTE_BMR", "Execute BMR steps"),
    ("MANAGE_BMR_TEMPLATES", "Manage BMR templates"),
    ("VIEW_AUDIT", "View audit trail"),
    ("MANAGE_USERS", "Manage users and roles"),
]

ROLE_PERMISSION_CODES: dict[str, list[str]] = {
    "WAREHOUSE_OPERATOR": ["VIEW_WAREHOUSE", "CREATE_RECEIPT", "POST_RECEIPT", "VIEW_MASTER_DATA"],
    "WAREHOUSE_MANAGER": ["VIEW_WAREHOUSE", "CREATE_RECEIPT", "POST_RECEIPT", "VIEW_MASTER_DATA", "VIEW_AUDIT"],
    "QC_ANALYST": ["VIEW_MASTER_DATA", "VIEW_QC", "ENTER_QC_RESULT", "UPLOAD_QC_SCAN"],
    "QA_MANAGER": ["VIEW_MASTER_DATA", "VIEW_QA", "QA_DECISION", "VERIFY_QC_SCAN", "VIEW_AUDIT"],
    "HEAD_QA": ["VIEW_MASTER_DATA", "VIEW_QA", "QA_DECISION", "VERIFY_QC_SCAN", "VIEW_AUDIT"],
    "HEAD_QC": ["VIEW_MASTER_DATA", "VIEW_QC", "ENTER_QC_RESULT", "UPLOAD_QC_SCAN", "VIEW_AUDIT"],
    "PRODUCTION_OPERATOR": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "EXECUTE_BMR"],
    "SHIFT_MASTER": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "MANAGE_PRODUCTION", "EXECUTE_BMR"],
    "HEAD_PRODUCTION": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_AUDIT"],
    "WORKSHOP_HEAD": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "MANAGE_PRODUCTION", "EXECUTE_BMR"],
    "TECHNOLOGIST": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "MANAGE_BMR_TEMPLATES"],
    "CHIEF_TECHNOLOGIST": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "MANAGE_BMR_TEMPLATES", "VIEW_AUDIT"],
    "SYS_ADMIN": [code for code, _ in PERMISSIONS],
}

DEPARTMENTS: list[tuple[str, str]] = [
    ("WAREHOUSE", "Warehouse"),
    ("QC", "Quality Control"),
    ("QA", "Quality Assurance"),
    ("PRODUCTION", "Production"),
    ("TECHNOLOGY", "Technology"),
    ("ADMIN", "Administration"),
]


def get_or_create_department(db: Session, code: str, name: str) -> Department:
    row = db.query(Department).filter(Department.code == code).first()
    if row:
        row.name = name
        return row
    row = Department(code=code, name=name)
    db.add(row)
    return row


def get_or_create_permission(db: Session, code: str, description: str) -> Permission:
    row = db.query(Permission).filter(Permission.code == code).first()
    if row:
        row.description = description
        return row
    row = Permission(code=code, description=description)
    db.add(row)
    return row


def get_or_create_role(db: Session, code: str, name: str, permissions: list[Permission]) -> Role:
    row = db.query(Role).filter(Role.code == code).first()
    if row:
        row.name = name
        row.permissions = permissions
        return row
    row = Role(code=code, name=name, permissions=permissions)
    db.add(row)
    return row


def get_or_create_warehouse(db: Session, code: str, name: str, warehouse_type: str) -> Warehouse:
    row = db.query(Warehouse).filter(Warehouse.code == code).first()
    if row:
        row.name = name
        row.warehouse_type = warehouse_type
        return row
    row = Warehouse(code=code, name=name, warehouse_type=warehouse_type)
    db.add(row)
    return row


def get_or_create_location(db: Session, warehouse: Warehouse, code: str, name: str, storage_condition: str) -> Location:
    row = db.query(Location).filter(Location.warehouse == warehouse, Location.code == code).first()
    if row:
        row.name = name
        row.storage_condition = storage_condition
        return row
    row = Location(warehouse=warehouse, code=code, name=name, storage_condition=storage_condition)
    db.add(row)
    return row


def get_or_create_supplier(db: Session, code: str, name: str) -> Supplier:
    row = db.query(Supplier).filter(Supplier.code == code).first()
    if row:
        row.name = name
        return row
    row = Supplier(code=code, name=name)
    db.add(row)
    return row


def get_or_create_manufacturer(db: Session, code: str, name: str) -> Manufacturer:
    row = db.query(Manufacturer).filter(Manufacturer.code == code).first()
    if row:
        row.name = name
        return row
    row = Manufacturer(code=code, name=name)
    db.add(row)
    return row


def get_or_create_material(db: Session, code: str, name: str, item_type: str, default_unit: str) -> Material:
    row = db.query(Material).filter(Material.code == code).first()
    if row:
        row.name = name
        row.item_type = item_type
        row.default_unit = default_unit
        return row
    row = Material(code=code, name=name, item_type=item_type, default_unit=default_unit)
    db.add(row)
    return row


def get_or_create_user(
    db: Session,
    username: str,
    full_name: str,
    password: str,
    role: Role,
    department: Department,
    warehouse_scope: str | None = None,
) -> User:
    row = db.query(User).filter(User.username == username).first()
    if row:
        row.full_name = full_name
        row.role = role
        row.department = department
        row.warehouse_scope = warehouse_scope
        row.is_active = True
        return row
    row = User(
        username=username,
        full_name=full_name,
        password_hash=hash_password(password),
        role=role,
        department=department,
        warehouse_scope=warehouse_scope,
        is_active=True,
    )
    db.add(row)
    return row


def seed_foundation_data(db: Session) -> None:
    departments = {code: get_or_create_department(db, code, name) for code, name in DEPARTMENTS}
    permissions = {code: get_or_create_permission(db, code, description) for code, description in PERMISSIONS}
    db.flush()

    roles: dict[str, Role] = {}
    for code, permission_codes in ROLE_PERMISSION_CODES.items():
        roles[code] = get_or_create_role(
            db,
            code,
            code.replace("_", " ").title(),
            [permissions[permission_code] for permission_code in permission_codes],
        )
    db.flush()

    substance = get_or_create_warehouse(db, "SUB", "Substance and excipient warehouse", "SUBSTANCE_WAREHOUSE")
    packaging = get_or_create_warehouse(db, "PACK", "Packaging material warehouse", "PACKAGING_WAREHOUSE")
    fg = get_or_create_warehouse(db, "FG", "Finished goods warehouse", "FG_WAREHOUSE")
    db.flush()

    for warehouse in [substance, packaging, fg]:
        get_or_create_location(db, warehouse, "RECEIVING", "Receiving zone", "ambient")
        get_or_create_location(db, warehouse, "QUARANTINE", "Quarantine zone", "ambient")
        get_or_create_location(db, warehouse, "RELEASED", "Released zone", "ambient")
        get_or_create_location(db, warehouse, "REJECTED", "Rejected locked zone", "ambient")

    get_or_create_user(
        db,
        "warehouse_substance",
        "Warehouse Substance Operator",
        "whs123",
        roles["WAREHOUSE_OPERATOR"],
        departments["WAREHOUSE"],
        "SUBSTANCE_WAREHOUSE",
    )
    get_or_create_user(
        db,
        "head_qa",
        "Head of QA",
        "qahead123",
        roles["HEAD_QA"],
        departments["QA"],
    )
    get_or_create_user(
        db,
        "head_qc",
        "Head of QC",
        "qchead123",
        roles["HEAD_QC"],
        departments["QC"],
    )
    get_or_create_user(
        db,
        "shift_master",
        "Shift Master Production",
        "prod123",
        roles["SHIFT_MASTER"],
        departments["PRODUCTION"],
    )
    get_or_create_user(
        db,
        "sys_admin",
        "System Administrator",
        "admin123",
        roles["SYS_ADMIN"],
        departments["ADMIN"],
    )

    db.commit()
