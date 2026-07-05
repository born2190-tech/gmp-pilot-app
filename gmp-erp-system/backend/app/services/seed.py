from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.identity import Department, Permission, Role, User
from app.models.inventory import Product
from app.models.master_data import InventoryAccount, Location, Manufacturer, Material, Supplier, Warehouse
from app.models.quality import MaterialSpecification, SpecificationParameter
from app.services.material_groups import assign_default_material_groups, group_for_material_code
from app.services.products_catalog import MARKET_PRODUCT_VARIANTS, PRODUCTS
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
    ("ISSUE_BMR", "Issue production BMR/ZPS documents — QA"),
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
    "QA_MANAGER": ["VIEW_MASTER_DATA", "VIEW_QA", "QA_DECISION", "ISSUE_BMR", "VERIFY_QC_SCAN", "VIEW_AUDIT", "VERIFY_INVENTORY_COUNT", "POST_INVENTORY_COUNT"],
    "HEAD_QA": ["VIEW_MASTER_DATA", "VIEW_QA", "QA_DECISION", "ISSUE_BMR", "VERIFY_QC_SCAN", "VIEW_AUDIT", "VERIFY_INVENTORY_COUNT", "POST_INVENTORY_COUNT"],
    "HEAD_QC": ["VIEW_MASTER_DATA", "VIEW_QC", "ENTER_QC_RESULT", "UPLOAD_QC_SCAN", "MANAGE_SPECIFICATIONS", "VERIFY_INVENTORY_COUNT", "EQUIPMENT_MANAGE"],
    "PRODUCTION_OPERATOR": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "EXECUTE_BMR"],
    "SHIFT_MASTER": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "MANAGE_PRODUCTION", "EXECUTE_BMR", "MANAGE_BMR_TEMPLATES"],
    "HEAD_PRODUCTION": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "MANAGE_PRODUCTION", "VIEW_AUDIT"],
    "WORKSHOP_HEAD": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "MANAGE_PRODUCTION", "EXECUTE_BMR"],
    "TECHNOLOGIST": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "MANAGE_BMR_TEMPLATES"],
    "CHIEF_TECHNOLOGIST": ["VIEW_MASTER_DATA", "VIEW_PRODUCTION", "MANAGE_BMR_TEMPLATES", "VIEW_AUDIT"],
    "SYS_ADMIN": [code for code, _ in PERMISSIONS],
}

DEPARTMENTS: list[tuple[str, str]] = [
    ("WAREHOUSE", "Warehouse"),
    ("QC", "Quality Control / ДКК"),
    ("QA", "Quality Assurance / ДОК"),
    ("PRODUCTION", "Production"),
    ("TECHNOLOGY", "Technology"),
    ("ENGINEERING", "Engineering / ИД"),
    ("ADMIN", "Administration"),
]


# Актуальный список участников BMR/ЗПС. Стартовые данные для пилота:
# пароль = BmrNN!2026, PIN подписи = 10NN, где NN — номер в журнале.
# В промышленном контуре эти секреты должны выдаваться персонально и меняться
# при первом входе, но для локального пилота это даёт готовые учётки без ручного
# заведения 50+ сотрудников.
EMPLOYEE_MASTER: list[dict[str, str]] = [
    {"no": "1", "username": "ashish_kumar", "full_name": "Ashish Kumar", "position": "Director of Manufacturing project and Engineering", "department": "ADMIN", "role": "HEAD_PRODUCTION", "initials": "A.S.K"},
    {"no": "2", "username": "babar_hussain", "full_name": "Babar Hussain", "position": "Deputy Director Technical operations", "department": "PRODUCTION", "role": "HEAD_PRODUCTION", "initials": "H.B.M"},
    {"no": "3", "username": "muhammad_arsalan", "full_name": "Muhammad Arsalan", "position": "Operator", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "M.A"},
    {"no": "4", "username": "muhammad_zubair", "full_name": "Muhammad Zubair Afzal", "position": "Maintenance Engineer", "department": "ENGINEERING", "role": "PRODUCTION_OPERATOR", "initials": "M.Z.A"},
    {"no": "5", "username": "filatov_pavel", "full_name": "Филатов Павел", "position": "Начальник ДОК, УЛ", "department": "QA", "role": "HEAD_QA", "initials": "Ф.П.А."},
    {"no": "6", "username": "khalmetova_liliya", "full_name": "Хальметова Лилия", "position": "Начальник ДКК", "department": "QC", "role": "HEAD_QC", "initials": "Х.Л.Р."},
    {"no": "7", "username": "khodjimukhamedov_nodir", "full_name": "Ходжимухамедов Нодир", "position": "Специалист по документообороту", "department": "QA", "role": "QA_MANAGER", "initials": "Х.Н.Б."},
    {"no": "8", "username": "seitova_vaide", "full_name": "Сеитова Вайде", "position": "Начальник цеха", "department": "PRODUCTION", "role": "WORKSHOP_HEAD", "initials": "С.В.С."},
    {"no": "9", "username": "shamsiev_mansur", "full_name": "Шамсиев Мансур", "position": "Технолог", "department": "TECHNOLOGY", "role": "TECHNOLOGIST", "initials": "Ш.М.Р."},
    {"no": "10", "username": "tokhodzhaeva_sapargul", "full_name": "Токходжаева Сапаргуль", "position": "Химик ведущий", "department": "QC", "role": "QC_ANALYST", "initials": "Т.С.А."},
    {"no": "11", "username": "babakulova_iroda", "full_name": "Бабакулова Ирода", "position": "Химик аналитик", "department": "QC", "role": "QC_ANALYST", "initials": "Б.И.А."},
    {"no": "12", "username": "sunnatova_dildora", "full_name": "Суннатова Дилдора", "position": "Микробиолог", "department": "QC", "role": "QC_ANALYST", "initials": "С.Д.А."},
    {"no": "13", "username": "sharipov_shokhrukh", "full_name": "Шарипов Шохрух", "position": "Химик аналитик", "department": "QC", "role": "QC_ANALYST", "initials": "Ш.Ш.И."},
    {"no": "14", "username": "ibrokhimov_shakhzod", "full_name": "Иброхимов Шахзод", "position": "Химик аналитик", "department": "QC", "role": "QC_ANALYST", "initials": "И.Ш.Х."},
    {"no": "15", "username": "alimov_uktam", "full_name": "Алимов Уктам", "position": "Специалист по досье", "department": "QA", "role": "QA_MANAGER", "initials": "А.У.О."},
    {"no": "16", "username": "shukurova_nargiza", "full_name": "Шукурова Наргиза", "position": "Контролёр", "department": "QA", "role": "QA_MANAGER", "initials": "Ш.Н.М."},
    {"no": "17", "username": "sulaymonova_rano", "full_name": "Сулаймонова Рано", "position": "Контролёр", "department": "QA", "role": "QA_MANAGER", "initials": "С.Р.Р"},
    {"no": "18", "username": "muslimova_silvina", "full_name": "Муслимова Силвина", "position": "Контролёр", "department": "QA", "role": "QA_MANAGER", "initials": "М.С.Д."},
    {"no": "19", "username": "ramazonova_violetta", "full_name": "Рамазонова Виолетта", "position": "Контролёр", "department": "QA", "role": "QA_MANAGER", "initials": "Р.В.Г."},
    {"no": "20", "username": "sheraliyev_murod", "full_name": "Шералиев Мурод", "position": "Заведующий складом", "department": "WAREHOUSE", "role": "WAREHOUSE_MANAGER", "initials": "Ш.М.Ш."},
    {"no": "21", "username": "karabekov_ergash", "full_name": "Карабеков Эргаш", "position": "Оператор", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "К.Э.С."},
    {"no": "22", "username": "urinboev_otabek", "full_name": "Уринбоев Отабек", "position": "Оператор", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "У.О.А."},
    {"no": "23", "username": "khotamov_mukhriddin", "full_name": "Хотамов Мухриддин", "position": "Оператор", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Х.М.Т."},
    {"no": "24", "username": "abraev_gayrat", "full_name": "Абраев Ғайрат", "position": "Оператор", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "А.Ғ.Р."},
    {"no": "25", "username": "ummatov_otabek", "full_name": "Умматов Отабек", "position": "Оператор", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "У.О."},
    {"no": "26", "username": "kholmonov_sanzhar", "full_name": "Холмонов Санжар", "position": "Оператор", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Х.С.И."},
    {"no": "27", "username": "nazarov_sardor", "full_name": "Назаров Сардор", "position": "Оператор", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Н.С.А."},
    {"no": "28", "username": "kholmatov_bekzod", "full_name": "Холматов Бекзод", "position": "Оператор", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Х.Б"},
    {"no": "29", "username": "rakhmonberdiev_muso", "full_name": "Рахмонбердиев Мусо", "position": "Оператор", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Р.М.К."},
    {"no": "30", "username": "sharipova_dilshoda", "full_name": "Шарипова Дилшода", "position": "Оператор", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Ш.Д.А."},
    {"no": "31", "username": "kavlyametov_aziz", "full_name": "Кавляметов Азиз", "position": "Электрик-оператор", "department": "ENGINEERING", "role": "PRODUCTION_OPERATOR", "initials": "К.А.И."},
    {"no": "32", "username": "yakupov_artyom", "full_name": "Якупов Артём", "position": "Механик-оператор", "department": "ENGINEERING", "role": "PRODUCTION_OPERATOR", "initials": "Я.А.В."},
    {"no": "33", "username": "ernazarov_ikhtier", "full_name": "Ерназаров Ихтиер", "position": "Механик", "department": "ENGINEERING", "role": "PRODUCTION_OPERATOR", "initials": "Е.И.Б."},
    {"no": "34", "username": "sultonov_murodali", "full_name": "Султонов Муродали", "position": "Котельщик-оператор", "department": "ENGINEERING", "role": "PRODUCTION_OPERATOR", "initials": "С.М.Х."},
    {"no": "35", "username": "pulatova_makbal", "full_name": "Пулатова Макбал", "position": "Бригадир участка упаковки", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "П.М.Е."},
    {"no": "36", "username": "urdusheva_fotima", "full_name": "Урдушева Фотима", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "У.Ф.Х."},
    {"no": "37", "username": "khasanova_ugiloy", "full_name": "Хасанова Угилой", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Х.О.И."},
    {"no": "38", "username": "khaidarova_dilnavoz", "full_name": "Хайдарова Дилнавоз", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Х.Д.Х."},
    {"no": "39", "username": "narzikulova_mukhlisa", "full_name": "Нарзикулова Мухлиса", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Н.М.Р."},
    {"no": "40", "username": "makhammatova_komila", "full_name": "Махамматова Комила", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "М.К.Н."},
    {"no": "41", "username": "murtozokulova_dilfuza", "full_name": "Муртозокулова Дилфуза", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "М.Д.Ш."},
    {"no": "42", "username": "yakubova_shakhlo", "full_name": "Якубова Шахло", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Я.Ш.Т."},
    {"no": "43", "username": "turkmenova_dilora", "full_name": "Туркменова Дилора", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Т.Д.Н."},
    {"no": "44", "username": "karimova_farangiz", "full_name": "Каримова Фарангиз", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "К.Ф.А."},
    {"no": "45", "username": "azamkulova_shakhnoza", "full_name": "Азамкулова Шахноза", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "А.Ш.Б."},
    {"no": "46", "username": "khodjabekova_mohigul", "full_name": "Ходжабекова Мохигул", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Х.М.Ш."},
    {"no": "47", "username": "eralova_gavhar", "full_name": "Эралова Гавхар", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "Э.Г.Н."},
    {"no": "48", "username": "kushmurodova_d", "full_name": "Кушмуродова Д.", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "К.Д."},
    {"no": "49", "username": "kodirova_sh", "full_name": "Кодирова Ш.", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "К.Ш."},
    {"no": "50", "username": "melikulova_sabokhat", "full_name": "Меликулова Сабохат", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "М.С."},
    {"no": "51", "username": "mamanova_yanglish", "full_name": "Маманова Янглиш", "position": "Упаковщица", "department": "PRODUCTION", "role": "PRODUCTION_OPERATOR", "initials": "М.Я."},
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


RAW_MATERIAL_SEED: list[tuple[str, str, str, str]] = [
    ("API-MET", "Метформин гидрохлорид", "raw_material", "kg"),
    ("API-SITA", "Ситаглиптин фосфат моногидрат", "raw_material", "kg"),
    ("EXC-POV", "Повидон К-30", "raw_material", "kg"),
    ("EXC-SLS", "Натрий лаурил сульфат", "raw_material", "kg"),
    ("EXC-AEROSIL", "Коллоидный диоксид кремния (Aerosil 200M)", "raw_material", "kg"),
    ("EXC-MCC", "Целлюлоза микрокристаллическая (PH-102)", "raw_material", "kg"),
    ("EXC-SOD", "Натрия кроскармеллоза", "raw_material", "kg"),
    ("EXC-MGST", "Стеарат магния", "raw_material", "kg"),
    ("EXC-LACTOSE", "Лактоза моногидрат (Flowlac 90)", "raw_material", "kg"),
    ("EXC-CROSPOV", "Кросповидон (Kollidon CL)", "raw_material", "kg"),
    ("EXC-OPA-BLUE", "Opadry II Blue 85G205027-CN", "raw_material", "kg"),
    ("UTIL-WATER", "Очищенная вода", "raw_material", "kg"),
]


def seed_materials(db: Session) -> None:
    """Идемпотентно заводит базовые материалы, на которые ссылаются НД/BMR."""
    for code, name, item_type, unit in RAW_MATERIAL_SEED:
        get_or_create_material(db, code, name, item_type, unit)
    db.flush()


def get_or_create_user(
    db: Session,
    username: str,
    full_name: str,
    password: str,
    role: Role,
    department: Department,
    warehouse_scope: str | None = None,
    employee_no: str | None = None,
    position_title: str | None = None,
    signature_initials: str | None = None,
) -> User:
    row = db.query(User).filter(User.username == username).first()
    if row:
        row.full_name = full_name
        row.employee_no = employee_no
        row.position_title = position_title
        row.signature_initials = signature_initials
        row.role = role
        row.department = department
        row.warehouse_scope = warehouse_scope
        row.is_active = True
        return row
    row = User(
        username=username,
        full_name=full_name,
        employee_no=employee_no,
        position_title=position_title,
        signature_initials=signature_initials,
        password_hash=hash_password(password),
        role=role,
        department=department,
        warehouse_scope=warehouse_scope,
        is_active=True,
    )
    db.add(row)
    return row


def seed_employee_master(db: Session, roles: dict[str, Role], departments: dict[str, Department]) -> None:
    for item in EMPLOYEE_MASTER:
        no = int(item["no"])
        user = get_or_create_user(
            db,
            item["username"],
            item["full_name"],
            f"Bmr{no:02d}!2026",
            roles[item["role"]],
            departments[item["department"]],
            None,
            item["no"],
            item["position"],
            item["initials"],
        )
        user.signing_pin_hash = hash_password(f"{1000 + no}")


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

    substance = get_or_create_warehouse(db, "SUB", "Склад субстанций и вспомогательных веществ", "SUBSTANCE_WAREHOUSE")
    packaging = get_or_create_warehouse(db, "PACK", "Склад упаковочных материалов", "PACKAGING_WAREHOUSE")
    fg = get_or_create_warehouse(db, "FG", "Склад готовой продукции", "FG_WAREHOUSE")
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
        "warehouse_packaging",
        "Warehouse Packaging Operator",
        "whp123",
        roles["WAREHOUSE_OPERATOR"],
        departments["WAREHOUSE"],
        "PACKAGING_WAREHOUSE",
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
    # Личные операторские аккаунты (роль «Оператор производства» — только своя
    # функция/комната, без надзора). Комната определяется рабочим местом при входе.
    get_or_create_user(
        db, "oper_ivanov", "Иванов Иван (оператор ДП)", "op123",
        roles["PRODUCTION_OPERATOR"], departments["PRODUCTION"],
    )
    get_or_create_user(
        db, "oper_sidorov", "Сидоров Сергей (оператор ДП)", "op123",
        roles["PRODUCTION_OPERATOR"], departments["PRODUCTION"],
    )
    get_or_create_user(
        db,
        "sys_admin",
        "System Administrator",
        "admin123",
        roles["SYS_ADMIN"],
        departments["ADMIN"],
    )

    seed_employee_master(db, roles, departments)

    # Личные PIN-ы для построчных e-подписей BMR (пилот). Пароль — резерв.
    for username, pin in (("oper_ivanov", "1111"), ("oper_sidorov", "2222"), ("head_qa", "3333"), ("shift_master", "4444")):
        row = db.query(User).filter(User.username == username).first()
        if row is not None:
            row.signing_pin_hash = hash_password(pin)

    db.flush()
    seed_materials(db)
    seed_specifications(db)
    seed_inventory_accounts(db)
    seed_reagents(db)
    seed_products(db)

    db.commit()

    from app.services.seed_bmr import seed_bmr_etalon
    seed_bmr_etalon(db)
    assign_default_material_groups(db)
    from app.services.material_matching import ensure_default_material_aliases
    ensure_default_material_aliases(db)
    db.commit()


def seed_products(db: Session) -> None:
    """Идемпотентно наполняет справочник продуктов (ЛС) каталогом NOVUGEN
    (коды по СОП-409, 3 знака) и рыночными вариантами торговых названий."""
    existing = {(p.code, p.market_code) for p in db.query(Product.code, Product.market_code).all()}
    for code, name, dosage_form, afi in PRODUCTS:
        key = (code, "UZ")
        if key in existing:
            row = db.query(Product).filter(Product.code == code, Product.market_code == "UZ").first()
            if row:
                row.market_name = "Узбекистан"
                row.name = name
                row.dosage_form = dosage_form or None
                row.notes = f"АФИ: {afi}" if afi else None
            continue
        db.add(
            Product(
                code=code,
                market_code="UZ",
                market_name="Узбекистан",
                name=name,
                dosage_form=dosage_form or None,
                default_shelf_life_months=24,
                is_active=True,
                notes=f"АФИ: {afi}" if afi else None,
            )
        )
    for code, market_code, market_name, name, dosage_form, afi in MARKET_PRODUCT_VARIANTS:
        row = db.query(Product).filter(Product.code == code, Product.market_code == market_code).first()
        if row:
            row.market_name = market_name
            row.name = name
            row.dosage_form = dosage_form or None
            row.notes = f"АФИ: {afi}" if afi else None
            continue
        db.add(
            Product(
                code=code,
                market_code=market_code,
                market_name=market_name,
                name=name,
                dosage_form=dosage_form or None,
                default_shelf_life_months=24,
                is_active=True,
                notes=f"АФИ: {afi}" if afi else None,
            )
        )
    db.flush()


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
    return group_for_material_code(code)


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
    assign_default_material_groups(db)


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
        "nd_code": "НД-SPC/СУБ/039/23", "material_code": "API-MET", "material_name": "Метформин гидрохлорид",
        "match_keywords": "метформин гидрохлорид metformin hydrochloride hcl",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Белый кристаллический порошок", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Легко растворим в воде; мало растворим в спирте; практически не растворим в ацетоне; практически не растворим в метиленхлориде", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "Реакция на хлориды; ИК-спектр соответствует спектру РСО", "ГФ РУз, ЕР-11 2.3.1, 2.2.24", "—"),
            ("physicochemical", "Родственные примеси", "Общее количество примесей: не более 0,5 %", "ГФ РУз, ЕР-11 2.2.29", "%"),
            ("physicochemical", "Потери при высушивании", "Не более 0,5 %", "ГФ РУз, ЕР-11 2.2.32", "%"),
            ("physicochemical", "Сульфатная зола", "Не более 0,1 %", "ГФ РУз, ЕР-11 2.4.14", "%"),
            ("physicochemical", "Количественное содержание", "98,5 — 101,0 %", "ГФ РУз, ЕР-11 2.2.29", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI,
        ],
    },
    {
        "nd_code": "НД-SPC/СУБ/008/23", "material_code": "EXC-SLS", "material_name": "Натрия лаурил сульфат",
        "match_keywords": "натрия натрий лаурил сульфат sodium lauryl sulfate kolliphor sls",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Белый или бледно-жёлтый порошок, кристаллический порошок или полусферические гранулы", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Легко растворим в воде с опалесценцией; частично растворим в спирте", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "С водой образуется пена; в слое метиленхлорида образуется интенсивное синее окрашивание; реакция на натрий; с хлоридом бария образуется белый кристаллический осадок", "ГФ РУз, ЕР-11", "—"),
            ("physicochemical", "Щёлочность", "Окраска должна измениться при добавлении не более 0,5 мл 0,1 М HCl", "ГФ РУз, ЕР-11", "мл"),
            ("physicochemical", "Количественное определение", "Не менее 85 %", "ГФ РУз, ЕР-11", "%"),
            ("physicochemical", "Нэтерифицированные спирты", "Не более 4 %", "ГФ РУз, ЕР-11", "%"),
            ("physicochemical", "Натрия хлорид и натрия сульфат", "Не более 8 % суммы", "ГФ РУз, ЕР-11", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI,
        ],
    },
    {
        "nd_code": "SPC/СУБ/007/23", "material_code": "EXC-SOD", "material_name": "Кроскармеллоза натрия",
        "match_keywords": "кроскармеллоза натрия croscarmellose sodium primellose",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Порошок белый или серовато-белый, гигроскопичный", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Практически не растворим в спирте; практически не растворим в толуоле; практически не растворим в ацетоне", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "ИК-спектр соответствует спектру РСО; с метиленовым синим образуется волокнистая масса; раствор даёт реакцию натрия", "ГФ РУз, ЕР-11", "—"),
            ("physicochemical", "pH", "От 5,0 до 7,0", "ГФ РУз, ЕР-11 2.2.3", "—"),
            ("physicochemical", "Объём осаждения", "От 10 мл до 30 мл", "ГФ РУз, ЕР-11", "мл"),
            ("physicochemical", "Водорастворимые вещества", "Не более 10 %", "ГФ РУз, ЕР-11", "%"),
            ("physicochemical", "Потеря в массе при высушивании", "Не более 10,0 %", "ГФ РУз, ЕР-11 2.2.32", "%"),
            ("physicochemical", "Сульфатная зола", "От 14 % до 28 %", "ГФ РУз, ЕР-11 2.4.14", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI, _MICRO_ECOLI,
        ],
    },
    {
        "nd_code": "НД-SPC/Суб/003/23", "material_code": "EXC-MGST", "material_name": "Стеарат магния",
        "match_keywords": "стеарат магния magnesium stearate ligamed",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Очень мелкий, лёгкий, белый или почти белый порошок, жирный на ощупь", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Практически не растворим в воде и спирте", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "Реакция на магний; жирные кислоты соответствуют требованиям НД", "ГФ РУз, ЕР-11", "—"),
            ("physicochemical", "Кислотность или щёлочность", "Соответствует требованиям НД", "ГФ РУз, ЕР-11", "—"),
            ("physicochemical", "Потеря в массе при высушивании", "Не более 6,0 %", "ГФ РУз, ЕР-11 2.2.32", "%"),
            ("physicochemical", "Хлориды", "Не более 0,1 %", "ГФ РУз, ЕР-11", "%"),
            ("physicochemical", "Сульфаты", "Не более 1,0 %", "ГФ РУз, ЕР-11", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI,
        ],
    },
    {
        "nd_code": "SPC/СУБ/006/23", "material_code": "EXC-LACTOSE", "material_name": "Лактоза моногидрат",
        "match_keywords": "лактоза моногидрат lactose monohydrate flowlac",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Белый или почти белый кристаллический порошок", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Легко, но медленно растворим в воде; практически не растворим в спирте", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "ИК-спектр испытуемого образца соответствует спектру РСО", "ГФ РУз, ЕР-11 2.2.24", "—"),
            ("physicochemical", "Кислотность или щёлочность", "Не более 0,4 мл 0,1 М NaOH", "ГФ РУз, ЕР-11", "мл"),
            ("physicochemical", "Оптическая плотность", "При 400 нм не более 0,04; при 210-220 нм не более 0,25; при 270-300 нм не более 0,07", "ГФ РУз, ЕР-11", "—"),
            ("physicochemical", "Вода", "От 4,5 % до 5,5 %", "ГФ РУз, ЕР-11 2.5.12", "%"),
            ("physicochemical", "Сульфатная зола", "Не более 0,1 %", "ГФ РУз, ЕР-11 2.4.14", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI,
        ],
    },
    {
        "nd_code": "НД-SPC/СУБ/030/23", "material_code": "EXC-CROSPOV", "material_name": "Кросповидон",
        "match_keywords": "кросповидон crospovidone kollidon cl",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Белый или желтовато-белый порошок либо хлопья, гигроскопичен", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Практически не растворим в метиленхлориде, воде и спирте", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "ИК-спектр соответствует спектру РСО; с йодом/крахмалом даёт синее окрашивание; суспензия остаётся мутной не менее 15 минут", "ГФ РУз, ЕР-11", "—"),
            ("physicochemical", "pH", "От 5,0 до 8,0", "ГФ РУз, ЕР-11 2.2.3", "—"),
            ("physicochemical", "Растворимые в воде вещества", "Не более 1,5 %", "ГФ РУз, ЕР-11", "%"),
            ("physicochemical", "Сульфатная зола", "Не более 0,1 %", "ГФ РУз, ЕР-11 2.4.14", "%"),
            ("physicochemical", "Потеря массы при высушивании", "Не более 5,0 %", "ГФ РУз, ЕР-11 2.2.32", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI, _MICRO_ECOLI,
        ],
    },
    {
        "nd_code": "НД-SPC/СУБ/012/23", "material_code": "EXC-AEROSIL", "material_name": "Аэросил безводный",
        "match_keywords": "аэросил безводный aerosil colloidal silicon dioxide кремния диоксид",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Лёгкий, тонкий, аморфный порошок белого цвета с размером частиц около 15 нм", "Визуально", "—"),
            ("physicochemical", "Растворимость", "Практически не растворим в воде; растворяется в горячих растворах гидроксидов щелочных металлов; практически не растворим в минеральных кислотах", "ГФ РУз, ЕР-11 5.11", "—"),
            ("physicochemical", "Подлинность", "Даёт реакцию на силикаты: образуется белое кольцо", "ГФ РУз, ЕР-11", "—"),
            ("physicochemical", "pH", "От 3,5 до 5,5", "ГФ РУз, ЕР-11 2.2.3", "—"),
            ("physicochemical", "Хлориды", "Не более 250 ppm (0,0250 %)", "ГФ РУз, ЕР-11", "ppm"),
            ("physicochemical", "Потеря в массе при прокаливании", "Не более 5,0 %", "ГФ РУз, ЕР-11", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI, _MICRO_ECOLI, _MICRO_SALMONELLA, _MICRO_SAUREUS, _MICRO_PSEUDOMONAS,
        ],
    },
    {
        "nd_code": "НД-SPC/СУБ/010/23", "material_code": "EXC-OPA-BLUE", "material_name": "Opadry II Complete Film Coating System 85G205027-CN Blue",
        "match_keywords": "opadry blue 85g205027 cn complete film coating system оболочка",
        "micro_method_ref": _MICRO_REF,
        "params": [
            ("physicochemical", "Описание", "Порошок по цвету соответствует входящим в него ингредиентам", "Визуально", "—"),
            ("physicochemical", "Подлинность", "Инфракрасный спектр образца должен иметь полное совпадение полос поглощения с полосами поглощения прилагаемого спектра РСО", "ИК-спектроскопия", "—"),
            ("physicochemical", "Однородность", "Должен быть однородным", "Визуально", "—"),
            ("physicochemical", "Общая зола", "31,27 — 39,27 %", "ГФ РУз, ЕР-11 2.4.16", "%"),
            _MICRO_AEROBES, _MICRO_FUNGI,
        ],
    },
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
        "nd_code": "НД-SPC/СУБ/009/23", "material_code": "EXC-MCC", "material_name": "Микрокристаллическая целлюлоза",
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


def _find_material_for_spec_seed(db: Session, entry: dict) -> Material | None:
    material_code = entry.get("material_code")
    if material_code:
        material = db.query(Material).filter(Material.code == material_code).first()
        if material:
            return material
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
    return material


def seed_specifications(db: Session) -> None:
    """Идемпотентно сидирует справочник спецификаций (НД).

    Если спецификация уже есть — не перетираем параметры ДКК, но допривязываем
    НД к правильному material_code и обновляем поисковые ключи.
    """
    for entry in SPEC_SEED:
        material = _find_material_for_spec_seed(db, entry)
        exists = db.query(MaterialSpecification).filter(MaterialSpecification.nd_code == entry["nd_code"]).first()
        if exists:
            if material is not None:
                exists.material_id = material.id
            exists.match_keywords = entry["match_keywords"]
            exists.material_name = entry["material_name"]
            exists.sop_form = exists.sop_form or "533"
            exists.micro_required = True
            exists.micro_method_ref = exists.micro_method_ref or entry["micro_method_ref"]
            if not exists.parameters:
                ordinal = 0
                for category, name, spec_text, method, unit in entry["params"]:
                    ordinal += 1
                    db.add(
                        SpecificationParameter(
                            specification_id=exists.id,
                            category=category,
                            ordinal=ordinal,
                            parameter_name=name,
                            specification=spec_text,
                            method_reference=method or None,
                            unit=unit or None,
                        )
                    )
            continue
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
    db.flush()
