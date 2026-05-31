"""Seed электронного BMR/ЗПС «Дапига 10 мг» (СОП-11) — полный маршрут стадий.

Эталон роллер-компактора Дапиги размножён на стадии ЗПС по комнатам
(dapiga_struct.txt). Документ один на серию, стадии идут в разных комнатах
(config.room) разными операторами; каждая стадия — это набор повторяющихся
блоков:

- process_header   — шапка процесса (процесс/комната/№, даты, предыдущий ЛС/серия)
- checklist        — контрольный список с двумя подписями (ДП «Выполнил» / ДОК)
- distribution_list — лист распределения сырья (вес нетто + подписи Склад/ДП/ДОК)
- environment      — условия среды (Начало/Окончание × наблюдение/ДП/ДОК)
- equipment        — справка по оборудованию (read-only)

Конвенция полей (для построчной независимой e-подписи на бэкенде): у каждой
секции config содержит структурированное описание И плоский `fields[]`, где
сигнатурные ячейки имеют type signature_operator / signature_qa /
signature_warehouse. field_index записи = позиция в fields[]. Фронтенд рисует
блок из структуры и вычисляет те же индексы.

Стадии in_process_control / production_formula / yield (прессование, формула,
материальный баланс) добавляются отдельным этапом задачи #16.

Идемпотентно: при повторном запуске сидера секции эталона переписываются
(структура шаблона = определение; снимки уже выданных экземпляров не трогаются —
у них своя копия секций).
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.identity import User
from app.models.inventory import BmrInstance, BmrSection, BmrTemplate, Material, Product

# Материалы рецепта Дапиги (для привязки листа распределения к справочнику и
# автозаполнения требования). code → (название, тип, ед.). Идемпотентно.
_DAPIGA_MATERIALS = [
    ("SUB-DAPA", "Дапаглифлозин (субстанция)", "raw_material", "kg"),
    ("EXC-MCC", "Микрокристаллическая целлюлоза (PH-102)", "raw_material", "kg"),
    ("EXC-LACTOSE", "Лактоза моногидрат (Flowlac 90)", "raw_material", "kg"),
    ("EXC-CROSPOV", "Кросповидон (Kollidon CL)", "raw_material", "kg"),
    ("EXC-AEROSIL", "Коллоидный диоксид кремния (Aerosil 200M)", "raw_material", "kg"),
    ("EXC-MGST", "Стеарат магния", "raw_material", "kg"),
    ("COAT-OPADRY", "Opadry 85F12273 Yellow", "raw_material", "kg"),
]

ETALON_MARKER = "__etalon_dapiga_opudrivanie__"
ETALON_TITLE = "ЗПС Дапига 10 мг — роллер-компактор (полный маршрут стадий)"


# ---------------------------------------------------------------------------
# Блоки (builders) — каждый возвращает dict секции с плоским fields[].
# ---------------------------------------------------------------------------

def _sig_pair() -> list[dict]:
    return [
        {"label": "Выполнено · ДП", "type": "signature_operator"},
        {"label": "Проверено · ДОК", "type": "signature_qa"},
    ]


def _process_header(process: str, room: str, room_no: str, sop: str) -> dict:
    return {
        "section_type": "process_header",
        "title": f"{process} — шапка процесса",
        "config": {
            "kind": "process_header",
            "room": room,
            "process": process,
            "room_no": room_no,
            "sop": sop,
            "fields": [
                {"label": "Дата-время начала", "type": "datetime"},
                {"label": "Дата-время окончания", "type": "datetime"},
                {"label": "Предыдущий ЛС", "type": "text"},
                {"label": "Предыдущая серия", "type": "text"},
            ],
        },
    }


def _checklist(title: str, room: str, steps: list[dict]) -> dict:
    fields: list[dict] = []
    for _ in steps:
        fields.extend(_sig_pair())
    return {
        "section_type": "checklist",
        "title": title,
        "config": {"kind": "checklist", "room": room, "steps": steps, "fields": fields},
    }


def _env(title: str, room: str, params: list[dict]) -> dict:
    per_param = [
        {"label": "Начало · наблюдение", "type": "number"},
        {"label": "Начало · ДП", "type": "signature_operator"},
        {"label": "Начало · ДОК", "type": "signature_qa"},
        {"label": "Окончание · наблюдение", "type": "number"},
        {"label": "Окончание · ДП", "type": "signature_operator"},
        {"label": "Окончание · ДОК", "type": "signature_qa"},
    ]
    fields: list[dict] = []
    for _ in params:
        fields.extend(per_param)
    return {
        "section_type": "environment",
        "title": title,
        "config": {"kind": "environment", "room": room, "params": params, "fields": fields},
    }


def _equipment(title: str, room: str, rows: list[dict]) -> dict:
    return {
        "section_type": "equipment",
        "title": title,
        "config": {"kind": "equipment", "room": room, "rows": rows, "fields": []},
    }


def _production_formula(title: str, rows: list[dict], note: str | None = None) -> dict:
    """Производственная формула — справочная (read-only) таблица состава серии."""
    return {
        "section_type": "production_formula",
        "title": title,
        "config": {"kind": "production_formula", "rows": rows, "note": note, "fields": []},
    }


def _yield_block(title: str, room: str, planned_label: str, actual_label: str, unit: str) -> dict:
    """Выход / материальный баланс: план + факт (числа) → авто % выхода / потерь,
    затем подписи ДП/ДОК. Порядок полей: план, факт, ДП, ДОК."""
    return {
        "section_type": "yield",
        "title": title,
        "config": {
            "kind": "yield",
            "room": room,
            "planned_label": planned_label,
            "actual_label": actual_label,
            "unit": unit,
            "fields": [
                {"label": planned_label, "type": "number", "unit": unit},
                {"label": actual_label, "type": "number", "unit": unit},
                {"label": "Рассчитал · ДП", "type": "signature_operator"},
                {"label": "Проверил · ДОК", "type": "signature_qa"},
            ],
        },
    }


def _ipc(title: str, room: str, params: list[dict], phases: list[dict]) -> dict:
    """Внутрипроизводственный контроль (ВПК): сетка параметр × пробы с пределами,
    авто-среднее и подсветкой вне предела; на каждую фазу (начало/середина/конец)
    свои замеры всех параметров и подписи ДП/ДОК. Порядок полей по фазам:
    [param1 sample1..N, param2 sample1..N, ..., ДП фазы, ДОК фазы]."""
    fields: list[dict] = []
    for phase in phases:
        for p in params:
            for s in range(int(p.get("samples", 1))):
                fields.append({"label": f"{phase['title']} · {p['name']} · проба {s + 1}", "type": "number", "unit": p.get("unit")})
        fields.append({"label": f"{phase['title']} · ДП", "type": "signature_operator"})
        fields.append({"label": f"{phase['title']} · ДОК", "type": "signature_qa"})
    return {
        "section_type": "in_process_control",
        "title": title,
        "config": {"kind": "in_process_control", "room": room, "params": params, "phases": phases, "fields": fields},
    }


def _distribution_list(title: str, room: str, groups: list[dict]) -> dict:
    """Лист распределения сырья. На каждый ингредиент 6 полей по порядку:
    № серии сырья → № аналит. листа → вес нетто (число) → подпись Склад «Выдал»
    → подпись ДП → подпись ДОК. (№ серии/аналит. листа подставляются из выданной
    накладной, можно поправить — task связки требование→BMR.)"""
    fields: list[dict] = []
    for group in groups:
        for item in group["items"]:
            name = item["name"]
            fields.append({"label": f"{name} · № серии сырья", "type": "text"})
            fields.append({"label": f"{name} · № аналит. листа", "type": "text"})
            fields.append({"label": f"{name} · вес нетто", "type": "number", "unit": "кг"})
            fields.append({"label": f"{name} · Выдал (Склад)", "type": "signature_warehouse"})
            fields.append({"label": f"{name} · Проверил (ДП)", "type": "signature_operator"})
            fields.append({"label": f"{name} · Проверил (ДОК)", "type": "signature_qa"})
    return {
        "section_type": "distribution_list",
        "title": title,
        "config": {"kind": "distribution_list", "room": room, "groups": groups, "fields": fields},
    }


# ---------------------------------------------------------------------------
# Переиспользуемые наборы (одинаковы по всему ЗПС).
# ---------------------------------------------------------------------------

def _cleaning_steps() -> list[dict]:
    return [
        {"no": "1", "text": "Убедитесь, что весь персонал надлежащим образом одет в чистую форму, шапки, маски и перчатки (СОП-417)."},
        {"no": "2", "text": "Обеспечьте очистку производственных помещений цеха согласно СОП-411."},
        {"no": "2.1", "text": "Убедитесь, что от предыдущей серии в комнате ничего не осталось (сырьё, промежуточные/готовые препараты удалены)."},
        {"no": "2.2", "text": "Пол, стена, потолок, стеклянная панель и помещение очищены; стикер на панели заменён на «ЗЕЛЁНЫЙ»."},
        {"no": "2.3", "text": "Все выступающие поверхности (трубопроводы, электропроводка, шланги и т. д.) очищены."},
        {"no": "2.4", "text": "Поддоны и совки визуально очищены и свободны от посторонних предметов."},
        {"no": "2.5", "text": "Контейнеры и бочки, которые необходимо использовать, вымыты и очищены."},
        {"no": "2.6", "text": "Журнал машины и комнаты обновлён последней записью."},
        {"no": "2.7", "text": "Температура, влажность и перепад давления зарегистрированы до и после работ в листе учёта."},
        {"no": "2.8", "text": "Если всё в порядке — стикер «ЗЕЛЁНЫЙ» («В работе») отображается на стеклянной панели спереди комнаты."},
    ]


def _env_full() -> list[dict]:
    return [
        {"name": "Температура", "unit": "°C", "limit": "18–25 °C"},
        {"name": "Относительная влажность", "unit": "%", "limit": "≤ 55 %"},
        {"name": "Перепад давления", "unit": "Па", "limit": "5–20 Па"},
    ]


def _env_temp_rh() -> list[dict]:
    return [
        {"name": "Температура", "unit": "°C", "limit": "18–25 °C"},
        {"name": "Относительная влажность", "unit": "%", "limit": "≤ 55 %"},
    ]


def _pressing_ipc_params() -> list[dict]:
    return [
        {"name": "Средняя масса таблетки", "unit": "мг", "limit": "231,25–268,75 мг", "lo": 231.25, "hi": 268.75, "samples": 5},
        {"name": "Высота таблетки", "unit": "мм", "limit": "3,85–4,45 мм", "lo": 3.85, "hi": 4.45, "samples": 5},
        {"name": "Твёрдость", "unit": "Н", "limit": "110–140 Н (цель 125)", "lo": 110, "hi": 140, "samples": 5},
        {"name": "Истираемость", "unit": "%", "limit": "≤ 1,0 %", "lo": 0, "hi": 1.0, "samples": 1},
        {"name": "Вес 20 таблеток", "unit": "г", "limit": "4,850–5,150 г", "lo": 4.850, "hi": 5.150, "samples": 1},
        {"name": "Распадаемость", "unit": "мин", "limit": "≤ 15 мин", "lo": 0, "hi": 15, "samples": 1},
    ]


def _pressing_phases() -> list[dict]:
    return [
        {"key": "start", "title": "Начало"},
        {"key": "middle", "title": "Середина"},
        {"key": "end", "title": "Конец"},
    ]


# ---------------------------------------------------------------------------
# Стадии маршрута. Каждая стадия: stage/stage_title/room/room_no/sop + sections.
# ---------------------------------------------------------------------------

def _stages() -> list[dict]:
    return [
        {
            "stage": "production_formula", "stage_title": "Производственная формула",
            "room": None, "room_no": "—", "sop": "ФСП42-Уз-25938724-5267-2023",
            "sections": [
                _production_formula("Производственная формула — состав серии (75 кг / 300 000 таблеток)", [
                    {"name": "Дапаглифлозин", "spec": "Евр.Ф", "per_tab": "12,30 мг", "per_series": "3,690 кг"},
                    {"name": "Микрокристаллическая целлюлоза (PH-102)", "spec": "Евр.Ф", "per_tab": "171,44 мг", "per_series": "51,432 кг"},
                    {"name": "Лактоза моногидрат (Flowlac 90)", "spec": "Евр.Ф", "per_tab": "50,00 мг", "per_series": "15,000 кг"},
                    {"name": "Кросповидон (Kollidon CL)", "spec": "Евр.Ф", "per_tab": "10,00 мг", "per_series": "3,000 кг"},
                    {"name": "Коллоидный диоксид кремния (Aerosil 200M)", "spec": "Евр.Ф", "per_tab": "3,76 мг", "per_series": "1,128 кг"},
                    {"name": "Стеарат магния (смешивание)", "spec": "Евр.Ф", "per_tab": "1,25 мг", "per_series": "0,375 кг"},
                    {"name": "Стеарат магния (опудривание)", "spec": "Евр.Ф", "per_tab": "1,25 мг", "per_series": "0,375 кг"},
                    {"name": "Основной вес таблетки (ядро)", "spec": "—", "per_tab": "250,00 мг", "per_series": "—"},
                    {"name": "Opadry 85F12273 Yellow", "spec": "Внутренний", "per_tab": "7,50 мг", "per_series": "2,250 кг"},
                    {"name": "Очищенная вода (испаряется при сушке)", "spec": "—", "per_tab": "—", "per_series": "22,500 кг"},
                    {"name": "Общий вес таблетки с оболочкой", "spec": "—", "per_tab": "257,50 мг", "per_series": "—"},
                ], note="Дапаглифлозин пропандиол дозируется по 100%-ному анализу (как основа); вес корректируется МКЦ (102). Очищенная вода испаряется при сушке."),
            ],
        },
        {
            "stage": "line_clearance_weighing", "stage_title": "Очистка линии — распаковка/взвешивание",
            "room": "Комн. 38", "room_no": "38/39", "sop": "СОП-411 · СОП-417",
            "sections": [
                _checklist("Контрольный список очистки линии", "Комн. 38", _cleaning_steps()),
                _env("Условия среды — комната распаковки", "Комн. 38", _env_temp_rh()),
                _equipment("Оборудование / инструмент", "Комн. 38", [
                    {"name": "Весы ТМ-А21", "model": "ТМ-А21", "serial": "—", "sop": "ДПСК-489", "calib": "по графику"},
                    {"name": "Весы электронные", "model": "FCC5001", "serial": "2217900326", "sop": "ДПСК-462", "calib": "по графику"},
                    {"name": "Ковш н/ж", "model": "—", "serial": "—", "sop": "—", "calib": "Не подлежит"},
                ]),
            ],
        },
        {
            "stage": "weighing", "stage_title": "Взвешивание (дозирование сырья)",
            "room": "Комн. 39", "room_no": "39", "sop": "СОП-497",
            "sections": [
                _checklist("Контрольный список взвешивания", "Комн. 39", [
                    {"no": "1", "text": "Убедитесь, что ламинарный поток в рабочем диапазоне, возвратный воздух низкого уровня промыт."},
                    {"no": "2", "text": "Проверьте название сырья, его состояние, код изделия и этикетку «ДОПУЩЕНО» на контейнере."},
                    {"no": "3", "text": "Принесите материал для дозирования в комнату согласно СОП-497."},
                    {"no": "4", "text": "Проверьте количество полученных материалов по соответствующему рабочему листу."},
                    {"no": "5", "text": "Распределите сырьё согласно Листу распределения (СОП-497)."},
                    {"no": "6", "text": "После завершения дозирования замените стикер статуса комнаты."},
                    {"no": "7", "text": "Убедитесь, что стикер «ЗЕЛЁНЫЙ» («В работе») отображается на панели спереди комнаты."},
                    {"no": "8", "text": "Перенесите дозированный материал в зону подготовки согласно СОП-497."},
                ]),
                _distribution_list("Лист распределения сырья", "Комн. 39", [
                    {"title": "Материалы для смешивания 1", "items": [
                        {"name": "Дапаглифлозин", "spec": "Евр.Ф", "qty": "3,690", "material_code": "SUB-DAPA"},
                        {"name": "Микрокристаллическая целлюлоза (PH-102)", "spec": "Евр.Ф", "qty": "51,432", "material_code": "EXC-MCC"},
                        {"name": "Лактоза моногидрат (Flowlac 90)", "spec": "Евр.Ф", "qty": "15,000", "material_code": "EXC-LACTOSE"},
                        {"name": "Кросповидон (Kollidon CL)", "spec": "Евр.Ф", "qty": "3,000", "material_code": "EXC-CROSPOV"},
                        {"name": "Коллоидный диоксид кремния (Aerosil 200M)", "spec": "Евр.Ф", "qty": "1,128", "material_code": "EXC-AEROSIL"},
                        {"name": "Стеарат магния", "spec": "Евр.Ф", "qty": "0,375", "material_code": "EXC-MGST"},
                    ]},
                    {"title": "Для опудривания", "items": [
                        {"name": "Стеарат магния (опудривание)", "spec": "Евр.Ф", "qty": "0,375", "material_code": "EXC-MGST"},
                    ]},
                    {"title": "Для оболочки", "items": [
                        {"name": "Opadry 85F12273 Yellow", "spec": "Внутренний", "qty": "2,250", "material_code": "COAT-OPADRY"},
                        {"name": "Очищенная вода", "spec": "—", "qty": "22,500", "material_code": "UTIL-WATER"},
                    ]},
                ]),
                _equipment("Оборудование / инструмент", "Комн. 39", [
                    {"name": "Весы электронные", "model": "FCC5001", "serial": "2217900327", "sop": "ДПСК-462", "calib": "по графику"},
                    {"name": "Весы электронные", "model": "BWS100K5", "serial": "300346", "sop": "ДПСК-445", "calib": "по графику"},
                ]),
            ],
        },
        {
            "stage": "line_clearance_dusting", "stage_title": "Очистка линии — опудривание",
            "room": "Комн. 29", "room_no": "29", "sop": "СОП-411 · СОП-417",
            "sections": [
                _checklist("Контрольный список очистки линии", "Комн. 29", _cleaning_steps()),
                _env("Условия среды — комната опудривания", "Комн. 29", _env_full()),
                _equipment("Оборудование / инструмент", "Комн. 29", [
                    {"name": "Гранулятор-измельчитель", "model": "YK-160", "serial": "221228749", "sop": "ДПСК-653", "calib": "Не подлежит"},
                    {"name": "Весы электронные", "model": "FCC5001", "serial": "2217900327", "sop": "ДПСК-462", "calib": "по графику"},
                ]),
            ],
        },
        {
            "stage": "sifting", "stage_title": "Просеивание",
            "room": "Комн. 29", "room_no": "29", "sop": "ТР-Дапига",
            "sections": [
                _checklist("Просеивание — технологические этапы", "Комн. 29", [
                    {"no": "1.3", "text": "Просеять Дапаглифлозин + МКЦ + лактозу моногидрат + кросповидон + коллоидный диоксид кремния через сетку 1,00 мм, собрать в двухслойный мешок, переместить в контейнеры, наклеить этикетку статуса. Проверить целостность сита до/после."},
                    {"no": "1.4", "text": "Просеять стеарат магния через сито #60 меш, собрать в ёмкость с двойным полиэтиленовым покрытием, наклеить этикетку статуса. Проверить целостность сита до/после."},
                ]),
            ],
        },
        {
            "stage": "opudrivanie", "stage_title": "Опудривание",
            "room": "Комн. 29", "room_no": "29", "sop": "СОП-204 · ТР-Дапига",
            "sections": [
                _checklist("Опудривание — технологические этапы", "Комн. 29", [
                    {"no": "3.1", "text": "Установите и работайте с вертикальным бункерным блендером согласно ДПСК-632."},
                    {"no": "3.2", "text": "Предварительное опудривание: загрузите материалы этапа 1.4 и перемешивайте 25 мин при 15 об/мин."},
                    {"no": "3.3", "text": "Опудривание: загрузите материалы этапа 3.2 и перемешивайте 5 мин при 15 об/мин."},
                    {"no": "3.4", "text": "Просеять магния стеарат через сито #60 меш, собрать в двухслойный мешок, прикрепить этикетку статуса."},
                    {"no": "3.6", "text": "Отбор образцов однородности смеси (минимум пять мест)."},
                    {"no": "3.7", "text": "Выгрузите опудренную смесь в двухслойные полиэтиленовые пакеты, прикрепите этикетку статуса."},
                ]),
                _env("Условия среды — комната опудривания", "Комн. 29", _env_full()),
                _equipment("Оборудование / инструмент", "Комн. 29", [
                    {"name": "Вертикальный бункерный блендер", "model": "HTD-250", "serial": "SS0620", "sop": "ДПСК-632", "calib": "Не подлежит"},
                    {"name": "Весы электронные", "model": "FCC5001", "serial": "2217900327", "sop": "ДПСК-462", "calib": "по графику"},
                    {"name": "Весы электронные", "model": "BWS100K5", "serial": "300346", "sop": "ДПСК-445", "calib": "по графику"},
                ]),
            ],
        },
        {
            "stage": "opudrivanie_final", "stage_title": "Финальное опудривание + выход смеси",
            "room": "Комн. 29", "room_no": "29", "sop": "ДПСК-632 · ТР-Дапига",
            "sections": [
                _checklist("Финальное опудривание — технологические этапы", "Комн. 29", [
                    {"no": "3.4", "text": "Просеять магния стеарат через сетку #60 меш, собрать в двухслойный мешок, наклеить этикетку статуса."},
                    {"no": "3.5", "text": "Опудривание: загрузите материалы этапа 3.4 и перемешивайте 5 мин при 15 об/мин."},
                    {"no": "3.6", "text": "Отбор образцов однородности смеси (минимум пять мест)."},
                    {"no": "3.7", "text": "Выгрузите опудренную смесь в двухслойные полиэтиленовые пакеты, прикрепите этикетку статуса; запишите детали взвешивания."},
                ]),
                _yield_block("Выход опудренной смеси", "Комн. 29", "Расчётный выход, кг", "Фактический выход, кг", "кг"),
            ],
        },
        {
            "stage": "line_clearance_drygran", "stage_title": "Очистка линии — сухая грануляция",
            "room": "Комн. Сухой грануляции", "room_no": "—", "sop": "СОП-411 · СОП-417",
            "sections": [
                _checklist("Контрольный список очистки линии", "Комн. Сухой грануляции", _cleaning_steps()),
                _env("Условия среды — сухая грануляция", "Комн. Сухой грануляции", _env_full()),
                _equipment("Оборудование / инструмент", "Комн. Сухой грануляции", [
                    {"name": "Roller Compactor", "model": "LGS-120E", "serial": "P030006", "sop": "СОП-666", "calib": "Не подлежит"},
                ]),
            ],
        },
        {
            "stage": "briquetting", "stage_title": "Брикетирование (роллер-компактор)",
            "room": "Комн. Сухой грануляции", "room_no": "—", "sop": "СОП-666",
            "sections": [
                _checklist("Брикетирование — технологические этапы", "Комн. Сухой грануляции", [
                    {"no": "2.1", "text": "Настройте и эксплуатируйте каток-уплотнитель согласно СОП-666."},
                    {"no": "2.2", "text": "Уплотните смешанные материалы роликовым уплотнителем (параметры R&D Roller Compactor). Зафиксируйте время начала/окончания уплотнения."},
                    {"no": "2.3", "text": "Выгрузите смесь в двухслойные полиэтиленовые пакеты, прикрепите этикетку статуса; запишите детали взвешивания."},
                ]),
                _env("Условия среды — сухая грануляция", "Комн. Сухой грануляции", _env_full()),
                _equipment("Оборудование / инструмент", "Комн. Сухой грануляции", [
                    {"name": "Вертикальный бункерный блендер", "model": "HTD-250", "serial": "SS0620", "sop": "ДПСК-632", "calib": "Не подлежит"},
                ]),
            ],
        },
        {
            "stage": "line_clearance_tableting", "stage_title": "Очистка линии — таблетирование",
            "room": "Комн. Таблетирования", "room_no": "—", "sop": "СОП-411 · СОП-417",
            "sections": [
                _checklist("Контрольный список очистки линии", "Комн. Таблетирования", _cleaning_steps()),
                _env("Условия среды — комната таблетирования", "Комн. Таблетирования", _env_full()),
                _equipment("Оборудование / инструмент", "Комн. Таблетирования", [
                    {"name": "Таблетпресс EU-D", "model": "S250C", "serial": "603149", "sop": "СОП-662", "calib": "Не подлежит"},
                    {"name": "Металлоискатель", "model": "LOMA INSIGHT", "serial": "EQPH-233", "sop": "СОП-664", "calib": "Не подлежит"},
                    {"name": "Твердомер", "model": "YD-1", "serial": "ОС-0065", "sop": "ДПСК-511", "calib": "по графику"},
                ]),
            ],
        },
        {
            "stage": "punch_check", "stage_title": "Проверка пуансонов / металлодетекция",
            "room": "Комн. Таблетирования", "room_no": "—", "sop": "ДПСК-624",
            "sections": [
                _checklist("Проверка пуансонов и металлоискателя", "Комн. Таблетирования", [
                    {"no": "6.1", "text": "Контрольный тест металлоискателя при каждом запуске, конце прессования и каждой остановке (ДПСК-624): блоки FE / SS / NFE — статус Проход/Недостаток."},
                    {"no": "6.2", "text": "Проверьте и запишите фактический вес смеси, взятой для прессования таблеток «Дапига» (этап 3.7В)."},
                    {"no": "6.3", "text": "Запишите детали взвешивания; подтверждение ДОК."},
                ]),
            ],
        },
        {
            "stage": "pressing", "stage_title": "Прессование (таблетирование)",
            "room": "Комн. Таблетирования", "room_no": "—", "sop": "ДПСК-624 · ТР-Дапига",
            "sections": [
                _checklist("Прессование — технологические этапы", "Комн. Таблетирования", [
                    {"no": "7.1", "text": "Запустите РТМ и металлоискатель согласно ДПСК-624."},
                    {"no": "7.2", "text": "Подключите пылеуловитель и металлоискатель к РТМ."},
                    {"no": "7.3", "text": "Загрузите смесь из этапа 6.3 в бункер; отрегулируйте вес заливки ~250 мг, затем толщину и твёрдость. Первые таблетки уничтожить."},
                    {"no": "7.5", "text": "При достижении параметров соберите таблетки для проверки; проверьте описание и явные дефекты."},
                    {"no": "7.6", "text": "Выполните первичные внутрипроцессные проверки (начальная настройка) и запишите в таблицу ВПК."},
                    {"no": "7.7", "text": "Выполняйте внутрипроцессные проверки с заданной частотой и записывайте в таблицу ВПК."},
                ]),
                _ipc("Внутрипроизводственный контроль прессования", "Комн. Таблетирования", _pressing_ipc_params(), _pressing_phases()),
                _env("Условия среды — комната таблетирования", "Комн. Таблетирования", _env_full()),
            ],
        },
        {
            "stage": "line_clearance_coating", "stage_title": "Очистка линии — покрытие оболочкой",
            "room": "Комн. 32", "room_no": "32", "sop": "СОП-411 · СОП-417",
            "sections": [
                _checklist("Контрольный список очистки линии", "Комн. 32", _cleaning_steps()),
                _env("Условия среды — область покрытия", "Комн. 32", _env_full()),
                _equipment("Оборудование / инструмент", "Комн. 32", [
                    {"name": "Машина покрытия оболочкой", "model": "—", "serial": "—", "sop": "ДПСК-628", "calib": "Не подлежит"},
                ]),
            ],
        },
        {
            "stage": "coating", "stage_title": "Покрытие оболочкой",
            "room": "Комн. 32", "room_no": "32", "sop": "ДПСК-628",
            "sections": [
                _checklist("Покрытие оболочкой — технологические этапы", "Комн. 32", [
                    {"no": "7.1", "text": "Проверьте и запишите фактический вес ядер таблеток, взятых для покрытия."},
                    {"no": "7.3", "text": "Взять очищенную воду в ёмкость из нержавеющей стали (запишите количество)."},
                    {"no": "7.4", "text": "Внести взвешенный Opadry в очищенную воду при постоянном перемешивании до равномерного распределения."},
                    {"no": "7.5", "text": "Перемешивать ~45 мин до однородной дисперсии; в конце профильтровать через сетку #60 меш."},
                    {"no": "8.1", "text": "Установите и эксплуатируйте машину покрытия согласно ДПСК-628."},
                    {"no": "8.2", "text": "Загрузите ядра таблеток во вращающий барабан для нанесения покрытия."},
                    {"no": "8.9", "text": "Контролируйте процесс и записывайте наблюдения вначале и каждые 15 мин до конца покрытия."},
                    {"no": "8.11", "text": "Высушите, охладите и выгрузите покрытые таблетки в двухслойные пакеты с силикагелем; прикрепите этикетку статуса."},
                ]),
                _env("Условия среды — область покрытия", "Комн. 32", _env_full()),
            ],
        },
        {
            "stage": "line_clearance_blister", "stage_title": "Очистка линии — блистеровка",
            "room": "Комн. Блистерная", "room_no": "—", "sop": "СОП-411 · СОП-417",
            "sections": [
                _checklist("Контрольный список очистки линии", "Комн. Блистерная", _cleaning_steps()),
                _env("Условия среды — блистерная", "Комн. Блистерная", _env_full()),
                _equipment("Оборудование / инструмент", "Комн. Блистерная", [
                    {"name": "Блистер-машина", "model": "DPP-400K AL/PL&AL/AL", "serial": "ОС-0026", "sop": "ДПСК-634", "calib": "Не подлежит"},
                ]),
            ],
        },
        {
            "stage": "blistering", "stage_title": "Блистеровка №30",
            "room": "Комн. Блистерная", "room_no": "—", "sop": "ДПСК-634",
            "sections": [
                _checklist("Блистеровка — технологические этапы", "Комн. Блистерная", [
                    {"no": "1", "text": "Склеивание фольги: температура 160 ± 5 °C; проверить качество и точность данных (серия, срок годности)."},
                    {"no": "2", "text": "Качество склеивания — по всей поверхности блистера; размер блистера 125 × 65 мм."},
                    {"no": "3", "text": "Периодически отбирайте блистеры и фиксируйте наблюдения (дата/время) в журнале блистеровки."},
                ]),
                _env("Условия среды — блистерная", "Комн. Блистерная", _env_full()),
            ],
        },
        {
            "stage": "line_clearance_packing", "stage_title": "Очистка линии — упаковка",
            "room": "Комн. 40", "room_no": "40", "sop": "СОП-411 · СОП-417",
            "sections": [
                _checklist("Контрольный список очистки линии", "Комн. 40", _cleaning_steps()),
                _env("Условия среды — участок упаковки", "Комн. 40", _env_temp_rh()),
                _equipment("Оборудование / инструмент", "Комн. 40", [
                    {"name": "Полуавтоматическая запечатывающая машина", "model": "FXJ6050B", "serial": "17F121", "sop": "ДПСК-642", "calib": "Не подлежит"},
                    {"name": "Каплеструйный маркиратор", "model": "9018 DOVER", "serial": "A46343-022", "sop": "ДПСК-645", "calib": "Не подлежит"},
                ]),
            ],
        },
        {
            "stage": "packing", "stage_title": "Упаковка + материальный баланс",
            "room": "Комн. 40", "room_no": "40", "sop": "СОП-414",
            "sections": [
                _checklist("Упаковка — технологические этапы", "Комн. 40", [
                    {"no": "1.1", "text": "Упаковщик(ца) визуально проверяет каждый блистер перед упаковкой в пеналы (СОП-414)."},
                    {"no": "1.2", "text": "Количество пеналов равно количеству инструкций в упаковке."},
                ]),
                _distribution_list("Использованные упаковочные материалы", "Комн. 40", [
                    {"title": "Упаковочные материалы", "items": [
                        {"name": "Алюминиевая фольга 215 мм", "spec": "по серии", "qty": "—"},
                        {"name": "Алюминиевая фольга (флексопечать)", "spec": "по серии", "qty": "—"},
                        {"name": "Дапига Пенал №30", "spec": "Без серии", "qty": "—"},
                        {"name": "Инструкция по применению", "spec": "Без серии", "qty": "—"},
                        {"name": "Групповая этикетка", "spec": "по серии", "qty": "—"},
                        {"name": "Гофрокоробка", "spec": "Без серии", "qty": "—"},
                    ]},
                ]),
                _yield_block("Материальный баланс упаковки", "Комн. 40", "По плану, пеналы", "Фактический выход, пеналы", "пеналы"),
            ],
        },
    ]


def _etalon_sections() -> list[dict]:
    """Плоский список секций всех стадий с инъекцией stage/stage_title в config.
    Каждой стадии предпосылается шапка процесса (даты, предыдущий ЛС/серия)."""
    out: list[dict] = []
    for stage in _stages():
        sections = [
            _process_header(stage["stage_title"], stage["room"], stage["room_no"], stage["sop"]),
            *stage["sections"],
        ]
        for section in sections:
            config = dict(section["config"])
            config.setdefault("stage", stage["stage"])
            config.setdefault("stage_title", stage["stage_title"])
            out.append({
                "section_type": section["section_type"],
                "title": section["title"],
                "config": config,
            })
    return out


# ---------------------------------------------------------------------------
# Запись шаблона (идемпотентно).
# ---------------------------------------------------------------------------

def _ensure_materials(db: Session) -> None:
    """Идемпотентно заводит материалы рецепта Дапиги в справочник (по коду)."""
    for code, name, item_type, unit in _DAPIGA_MATERIALS:
        if not db.query(Material).filter(Material.code == code).first():
            db.add(Material(code=code, name=name, item_type=item_type, default_unit=unit))
    db.flush()


def _find_dapiga(db: Session) -> Product | None:
    return (
        db.query(Product)
        .filter(Product.name.ilike("%Дапи%"), Product.market_code == "UZ")
        .order_by(Product.code)
        .first()
    )


def _retire_siblings(db: Session, product_id, keep_id) -> None:
    db.query(BmrTemplate).filter(
        BmrTemplate.product_id == product_id,
        BmrTemplate.status == "approved",
        BmrTemplate.id != keep_id,
    ).update({BmrTemplate.status: "obsolete"})


def _write_sections(db: Session, template_id) -> None:
    db.query(BmrSection).filter(BmrSection.template_id == template_id).delete()
    db.flush()
    for idx, sec in enumerate(_etalon_sections(), start=1):
        db.add(BmrSection(
            template_id=template_id, ordinal=idx,
            section_type=sec["section_type"], title=sec["title"], config=sec["config"],
        ))


def seed_bmr_etalon(db: Session) -> None:
    """Идемпотентно заводит/обновляет шаблон BMR Дапиги (полный маршрут стадий)."""
    product = _find_dapiga(db)
    if not product:
        return

    _ensure_materials(db)

    creator = db.query(User).filter(User.username == "sys_admin").first()
    approver = db.query(User).filter(User.username == "head_qa").first()
    if not creator:
        creator = db.query(User).first()
    if not creator:
        return

    existing = (
        db.query(BmrTemplate)
        .filter(BmrTemplate.notes == ETALON_MARKER)
        .order_by(BmrTemplate.version.desc())
        .first()
    )

    if existing:
        # Структура шаблона = определение; перезапись секций НЕ влияет на снимки уже
        # выданных экземпляров (у них своя копия). Держим шаблон актуальным.
        existing.title = ETALON_TITLE
        existing.product_id = product.id
        _write_sections(db, existing.id)
        _retire_siblings(db, product.id, existing.id)
        db.commit()
        return

    template = BmrTemplate(
        product_id=product.id,
        title=ETALON_TITLE,
        version=1,
        status="approved",
        notes=ETALON_MARKER,
        created_by=creator.id,
        approved_by=(approver.id if approver else creator.id),
        approved_at=func.now(),
        effective_date=date.today(),
    )
    db.add(template)
    db.flush()
    _write_sections(db, template.id)
    _retire_siblings(db, product.id, template.id)
    db.commit()
