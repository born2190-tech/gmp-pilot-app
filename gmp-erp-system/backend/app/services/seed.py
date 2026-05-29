from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.identity import Department, Permission, Role, User
from app.models.master_data import InventoryAccount, Location, Manufacturer, Material, Supplier, Warehouse
from app.models.quality import MaterialSpecification, SpecificationParameter
from app.services.reagents import seed_reagents


PERMISSIONS: list[tuple[str, str]] = [
    ("VIEW_WAREHOUSE", "View warehouse records"),
    ("CREATE_RECEIPT", "Create receipt documents"),
    ("POST_RECEIPT", "Post receipt documents"),
    ("VIEW_MASTER_DATA", "View master data"),
    ("MANAGE_MASTER_DATA", "Manage master data"),
    ("VIEW_QC", "View QC records"),
    ("ENTER_QC_RESULT", "Enter QC results"),
    ("MANAGE_SPECIFICATIONS", "Manage material specifications (НД) registry — ДКК"),
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
    ("COUNT_INVENTORY", "Start and record inventory count waves"),
    ("VERIFY_INVENTORY_COUNT", "Verify variance lines on an inventory count wave"),
    ("POST_INVENTORY_COUNT", "Post (sign off) an inventory count wave"),
    ("EQUIPMENT_MANAGE", "Manage equipment registry (КИП) and calibrations — ОКК"),
]

ROLE_PERMISSION_CODES: dict[str, list[str]] = {
    "WAREHOUSE_OPERATOR": ["VIEW_WAREHOUSE", "CREATE_RECEIPT", "POST_RECEIPT", "VIEW_MASTER_DATA", "COUNT_INVENTORY"],
    "WAREHOUSE_MANAGER": ["VIEW_WAREHOUSE", "CREATE_RECEIPT", "POST_RECEIPT", "VIEW_MASTER_DATA", "VIEW_AUDIT", "COUNT_INVENTORY"],
    "QC_ANALYST": ["VIEW_MASTER_DATA", "VIEW_QC", "ENTER_QC_RESULT", "UPLOAD_QC_SCAN", "VERIFY_INVENTORY_COUNT"],
    "QA_MANAGER": ["VIEW_MASTER_DATA", "VIEW_QA", "QA_DECISION", "VERIFY_QC_SCAN", "VIEW_AUDIT", "VERIFY_INVENTORY_COUNT", "POST_INVENTORY_COUNT"],
    "HEAD_QA": ["VIEW_MASTER_DATA", "VIEW_QA", "QA_DECISION", "VERIFY_QC_SCAN", "VIEW_AUDIT", "VERIFY_INVENTORY_COUNT", "POST_INVENTORY_COUNT"],
    "HEAD_QC": ["VIEW_MASTER_DATA", "VIEW_QC", "ENTER_QC_RESULT", "UPLOAD_QC_SCAN", "MANAGE_SPECIFICATIONS", "VERIFY_INVENTORY_COUNT", "EQUIPMENT_MANAGE"],
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

    db.flush()
    seed_specifications(db)
    seed_inventory_accounts(db)
    seed_reagents(db)

    db.commit()


# Счета учёта запасов: (код, наименование, группа, зона).
# КОДЫ — ВРЕМЕННЫЕ ЗАГЛУШКИ. Замените на реальные коды плана счетов.
# Счёт определяется парой (группа × зона): карантин / допущено / брак / цех.
INVENTORY_ACCOUNTS: list[tuple[str, str, str, str]] = [
    ("001-20", "АФИ — карантин", "SUBSTANCE_API", "QUARANTINE"),
    ("001-21", "АФИ — допущенные", "SUBSTANCE_API", "RELEASED"),
    ("001-29", "АФИ — брак", "SUBSTANCE_API", "REJECTED"),
    ("001-30", "Вспомогательные — карантин", "EXCIPIENT", "QUARANTINE"),
    ("001-31", "Вспомогательные — допущенные", "EXCIPIENT", "RELEASED"),
    ("001-39", "Вспомогательные — брак", "EXCIPIENT", "REJECTED"),
    ("002-20", "Упаковочные — карантин", "PACKAGING", "QUARANTINE"),
    ("002-21", "Упаковочные — допущенные", "PACKAGING", "RELEASED"),
    ("002-29", "Упаковочные — брак", "PACKAGING", "REJECTED"),
    ("002-40", "Незавершённое производство (цех)", "WIP", "WIP"),
]


def group_for_code(code: str) -> str | None:
    code = (code or "").upper()
    if code.startswith(("API", "TIG", "GLZ", "CLP", "ETR", "ESO", "TCG")):
        return "SUBSTANCE_API"
    if code.startswith(("EXC", "AUX")):
        return "EXCIPIENT"
    if code.startswith(("PACK", "PKG", "IM-", "ИМ")):
        return "PACKAGING"
    return None


def seed_inventory_accounts(db: Session) -> None:
    """Идемпотентно создаёт зонозависимые счета учёта (вид × зона) и проставляет
    материалам группу (вид). Коды — заглушки, правятся в справочнике счетов.
    Существующие счета обновляются по коду (имя/группа/зона)."""
    for code, name, group, zone in INVENTORY_ACCOUNTS:
        row = db.query(InventoryAccount).filter(InventoryAccount.code == code).first()
        if row:
            row.name = name
            row.account_group = group
            row.zone = zone
            row.is_active = True
        else:
            db.add(InventoryAccount(code=code, name=name, account_group=group, zone=zone, is_active=True))
    db.flush()

    # Проставляем материалам группу (вид) по коду, если ещё не задана.
    for material in db.query(Material).filter(Material.account_group.is_(None)).all():
        grp = group_for_code(material.code)
        if grp:
            material.account_group = grp


# Микробиологический метод-референс (общий для субстанций).
_MICRO_REF = "ГФ РУз, ЕР-11 2.6.12, 2.6.13, 5.1.4"
_MICRO_AEROBES = ("microbiological", "Общее число аэробных бактерий", "Не более 10³ КОЕ/г", "", "")
_MICRO_FUNGI = ("microbiological", "Общее число дрожжевых и плесневых грибов", "Не более 10² КОЕ/г", "", "")
_MICRO_ECOLI = ("microbiological", "Escherichia coli (в 1 г)", "Отсутствие", "", "")
_MICRO_SALMONELLA = ("microbiological", "Salmonella spp.", "Отсутствие", "", "")
_MICRO_SAUREUS = ("microbiological", "Staphylococcus aureus", "Отсутствие", "", "")
_MICRO_PSEUDOMONAS = ("microbiological", "Pseudomonas aeruginosa", "Отсутствие", "", "")

# (category, parameter_name, specification, method_reference, unit)
SPEC_SEED: list[dict] = [
    {
        "nd_code": "НД-SPC/СУБ/023/23", "material_name": "Гликлазид",
        "match_keywords": "гликлазид gliclazid",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Белый или почти белый порошок", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Практически нерастворим в воде; легко растворим в метиленхлориде; умеренно растворим в ацетоне; мало растворим в этаноле (96%)", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "ВЭЖХ: время удерживания совпадает с РСО; ИК-спектр совпадает с РСО", "ГФ РУз, ЕР-11 2.2.29, 2.2.24", "—"),
            ("physicochemical", "Родственные примеси (∑)", "Не более 0,5 %", "ГФ РУз, ЕР-11 2.2.29", "%"),
            ("physicochemical", "Потеря в массе при высушивании", "Не более 0,25 %", "ГФ РУз, ЕР-11 2.2.32", "%"),
            ("physicochemical", "Сульфатная зола", "Не более 0,1 %", "ГФ РУз, ЕР-11 2.4.14", "%"),
            ("physicochemical", "Количественное содержание", "99,0 — 101,0 % (на высушенное вещество)", "ГФ РУз, ЕР-11 2.2.29", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI,
        ],
    },
    {
        "nd_code": "НД-SPC/СУБ/009/23", "material_name": "Микрокристаллическая целлюлоза",
        "match_keywords": "микрокристалл целлюлоз mcc рн-102",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Белый или почти белый мелкий, слегка гигроскопичный порошок", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Практически не растворим в воде, ацетоне, безводном этаноле, толуоле, разбавленных кислотах и в 50 г/л растворе NaOH", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "ИК-спектр соответствует спектру РСО; с раствором йода — фиолетовое окрашивание", "ГФ РУз, ЕР-11", "—"),
            ("physicochemical", "pH", "От 5,0 до 7,0", "ГФ РУз, ЕР-11 2.2.3", "—"),
            ("physicochemical", "Удельная электропроводность", "Не более 75 мкСм·см⁻¹", "ГФ РУз, ЕР-11 2.2.38", "мкСм·см⁻¹"),
            ("physicochemical", "Растворимые в воде вещества", "Разница не должна превышать 12,5 мг", "ГФ РУз, ЕР-11", "мг"),
            ("physicochemical", "Потеря в массе при высушивании", "Не более 7,0 %", "ГФ РУз, ЕР-11 2.2.32", "%"),
            ("physicochemical", "Сульфатная зола", "Не более 0,1 %", "ГФ РУз, ЕР-11 2.4.14", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI, _MICRO_ECOLI, _MICRO_SALMONELLA, _MICRO_SAUREUS, _MICRO_PSEUDOMONAS,
        ],
    },
    {
        "nd_code": "НД-SPC/СУБ/017/23", "material_name": "Клопидогрел",
        "match_keywords": "клопидогрел clopidogrel",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Белый или почти белый порошок", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Легко растворим в воде; легко растворим в метаноле; практически не растворим в дихлорметане", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "ВЭЖХ: время удерживания совпадает с РСО; сульфаты — белый осадок; ИК-спектр совпадает с РСО", "ГФ РУз, ЕР-11 2.2.29", "—"),
            ("physicochemical", "Родственные примеси (∑)", "Не более 0,5 % (примесь A ≤ 0,2 %; примесь B ≤ 0,5 %)", "ГФ РУз, ЕР-11 2.2.29", "%"),
            ("physicochemical", "Вода", "Не более 0,5 %", "ГФ РУз, ЕР-11 2.5.12", "%"),
            ("physicochemical", "Сульфатная зола", "Не более 0,1 %", "ГФ РУз, ЕР-11 2.4.14", "%"),
            ("physicochemical", "Количественное содержание", "99,0 — 101,0 % (на безводное вещество)", "ГФ РУз, ЕР-11", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI,
        ],
    },
    {
        "nd_code": "НД-SPC/СУБ/055/24", "material_name": "Эторикоксиб",
        "match_keywords": "эторикоксиб etoricoxib",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Порошок от белого до кремового цвета", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Растворим в метаноле; свободно растворим в хлороформе; мало растворим в этаноле", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "ВЭЖХ: время удерживания совпадает с РСО; ИК-спектр соответствует спектру РСО", "ГФ РУз, ЕР-11", "—"),
            ("physicochemical", "Потеря в массе при высушивании", "Не более 0,5 %", "ГФ РУз, ЕР-11 2.2.32", "%"),
            ("physicochemical", "Абсорбция", "Не более 0,1 (при 430 нм)", "ГФ РУз, ЕР-11", "ЕА"),
            ("physicochemical", "Сульфатная зола", "Не более 0,2 %", "ГФ РУз, ЕР-11 2.4.14", "%"),
            ("physicochemical", "Тяжёлые металлы", "Не более 20 ppm", "ГФ РУз, ЕР-11 2.4.8", "ppm"),
            ("physicochemical", "Родственные примеси (∑)", "Не более 0,5 %", "ГФ РУз, ЕР-11 2.2.29", "%"),
            ("physicochemical", "Количественное содержание", "98,0 — 102,0 % (на безводное вещество)", "ГФ РУз, ЕР-11 2.2.29", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI, _MICRO_ECOLI, _MICRO_SALMONELLA, _MICRO_SAUREUS, _MICRO_PSEUDOMONAS,
        ],
    },
    {
        "nd_code": "НД-SPC/СУБ/040/23", "material_name": "Эзомепразол магния тригидрат",
        "match_keywords": "эзомепразол эзомепрозол esomeprazol",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Белые или почти белые гранулы сферической формы", "Визуально", "—"),
            ("physicochemical", "Подлинность", "ВЭЖХ: время удерживания совпадает с РСО; ИК-спектр совпадает с РСО", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Родственные примеси (∑)", "Не более 2,0 %", "ГФ РУз, ЕР-11 2.2.29", "%"),
            ("physicochemical", "Потеря в массе при высушивании", "Не более 1,5 %", "ГФ РУз, ЕР-11 2.2.32", "%"),
            ("physicochemical", "Растворение (кислая среда)", "Не более 10 %", "ГФ РУз, ЕР-11", "%"),
            ("physicochemical", "Растворение (буферный раствор)", "Не менее 80 %", "ГФ РУз, ЕР-11", "%"),
            ("physicochemical", "Количественное содержание", "95,0 — 110,0 %", "ГФ РУз, ЕР-11 2.2.25", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI, _MICRO_ECOLI,
        ],
    },
    {
        "nd_code": "НД-ДПСК/S.024", "material_name": "Тикагрелор",
        "match_keywords": "тикагрелор ticagrelor",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Порошок от белого или почти белого до бледно-розового цвета", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Практически не растворим в воде; легко растворим в безводном этаноле; растворим в метаноле; практически нерастворим в гептане", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "ВЭЖХ: время удерживания совпадает с РСО; ИК-спектр совпадает с РСО", "ГФ РУз, ЕР-11 2.2.29, 2.2.24", "—"),
            ("physicochemical", "Вода", "Не более 0,5 %", "ГФ РУз, ЕР-11 2.5.12", "%"),
            ("physicochemical", "Сульфатная зола", "Не более 0,6 %", "ГФ РУз, ЕР-11 2.4.14", "%"),
            ("physicochemical", "Родственные примеси (∑)", "Не более 1,0 %", "ГФ РУз, ЕР-11 2.2.29", "%"),
            ("physicochemical", "Количественное содержание", "98,0 — 102,0 % (на безводное вещество)", "ГФ РУз, ЕР-11", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI,
        ],
    },
]


def seed_specifications(db: Session) -> None:
    """Идемпотентно сидирует справочник спецификаций (НД).

    Если спецификация с таким nd_code уже есть — пропускаем (чтобы не
    затирать правки, сделанные через админ-экран).
    """
    for entry in SPEC_SEED:
        exists = db.query(MaterialSpecification).filter(MaterialSpecification.nd_code == entry["nd_code"]).first()
        if exists:
            continue
        material = (
            db.query(Material)
            .filter(Material.name.ilike(f"%{entry['material_name']}%"))
            .first()
        )
        if material is None:
            for kw in entry["match_keywords"].split():
                material = db.query(Material).filter(Material.name.ilike(f"%{kw}%")).first()
                if material:
                    break
        spec = MaterialSpecification(
            nd_code=entry["nd_code"],
            material_name=entry["material_name"],
            material_id=material.id if material else None,
            match_keywords=entry["match_keywords"],
            sop_form="533",
            micro_required=True,
            micro_method_ref=entry["micro_method_ref"],
            is_active=True,
        )
        db.add(spec)
        db.flush()
        ordinal = 0
        for category, name, spec_text, method, unit in entry["params"]:
            ordinal += 1
            db.add(
                SpecificationParameter(
                    specification_id=spec.id,
                    category=category,
                    ordinal=ordinal,
                    parameter_name=name,
                    specification=spec_text,
                    method_reference=method or None,
                    unit=unit or None,
                )
            )
