# PharmaFlow UX — v1.0 Change Request (implementation-aligned)

Дата: 2026-05-10  
Основание: сверка UX-документа с текущим backend (`gmp-pilot-app/app/main.py`).

## Цель
Снять расхождения между UX/handoff и уже работающим API, чтобы дизайн можно было сразу передать в реализацию без переинтерпретации.

## P0 (обязательно до старта фронта)

### 1) Исправить API-маршруты в разделе Handoff/Sprints
Заменить в UX-документе следующие строки:

- `GET /warehouse/movements` -> `GET /inventory/movements`
- `POST /warehouse/adjustments` -> `POST /warehouse/stock-adjustments`
- `POST /warehouse/issues` -> `POST /warehouse/issues-to-production`
- `POST /lots/:id/sampling-tasks` -> `POST /lots/{lot_id}/sampling-tasks`

Оставить без изменений:

- `POST /materials/receipts`
- `POST /qc/reports`
- `POST /qa/release-decisions`
- `GET /audit-events`

### 2) Зафиксировать решение по SoD (same-user QC+QA)
В UX сейчас есть правило: один и тот же пользователь не может подписывать и QC, и QA решение по партии.

В текущем backend явной серверной проверки SoD нет. Нужен один из вариантов:

- **Вариант A (рекомендуется):** оставить правило в UX, пометить как `Phase 2 / backend enhancement`.
- **Вариант B:** убрать это правило из AC текущего релиза, чтобы не блокировать приёмку несоответствующим требованием.

### 3) Уточнить autosave/draft как non-blocking requirement
UX описывает autosave для QC/приёмки каждые 10 секунд.

В текущем backend draft-статусы есть для production order, но не как общий механизм autosave для QC/receipt.

Правка формулировки:

- Было: «autosave drafts — обязательно»
- Стало: «autosave drafts — `UI-level optional in MVP`; обязательна защита от потери данных через локальный черновик/повторное заполнение формы»

### 4) Смягчить performance AC для MVP
Текущее AC: `first paint < 300 ms на 10k строк`.

Для MVP зафиксировать как target, не blocking AC:

- `Target`: 10k строк через виртуализацию без деградации UX.
- `Blocking AC`: отсутствие горизонтального скролла на 1280px + стабильная фильтрация/пагинация.

### 5) Нормализовать формат ключевых дат QC
Для колонок:

- `incoming_control_notified_at`
- `qc_result_received_at`

Зафиксировать единый визуальный стандарт:

- пусто: `—`
- ожидается результат: `В работе` (только если уже создана QC-задача/отчёт в процессе)
- заполнено: `DD.MM.YYYY HH:mm` (локальное) + доступ UTC в detail/audit

## P1 (желательно в этом же цикле)

### 6) Уточнить терминологию action_type в UX
Использовать в примерах и acceptance единые action labels:

- `CREATE_RECEIPT`
- `ENTER_QC_REPORT`
- `QA_RELEASE`
- `ADJUST_STOCK`

Чтобы не смешивать с display-формой (`QA_RELEASE_DECISION`) в разных секциях UX.

### 7) Упростить технологические привязки в Handoff
`react-window`, `react-table`, `storybook` оставить как **recommended stack**, а не hard requirement.

Причина: это implementation detail и не должно блокировать функциональную приёмку UX.

## Текстовые правки (готово к копипасте дизайнеру)

1. «Маршруты в sprint-блоках должны соответствовать backend v1.0: `/inventory/movements`, `/warehouse/stock-adjustments`, `/warehouse/issues-to-production`, `/lots/{lot_id}/sampling-tasks`.»
2. «SoD (same-user QC+QA) пометить как Phase-2 requirement до появления серверной проверки.»
3. «Autosave перевести из must-have в optional for MVP; обязательна только защита от потери введённых данных.»
4. «Перфоманс `<300ms/10k` — target metric, не blocking AC MVP.»
5. «Для `incoming_control_notified_at` и `qc_result_received_at` зафиксировать единый формат: `—` / `В работе` / `DD.MM.YYYY HH:mm`.»

## Критерий готовности документа после правок

Документ считается готовым к реализации, если:

- все API-роуты в UX совпадают с backend v1.0;
- в AC нет требований, которых backend не поддерживает в текущем релизе (или они явно помечены как Phase 2);
- у обязательных таблиц/дат зафиксирован единый формат отображения;
- блокирующие требования MVP остаются только функционально-критичными (scope/FSM/e-sign/audit/append-only).

## Архитектурные guardrails (добавлено после review)

### A1) DB-стратегия: SQLite только как runtime для локального MVP

Фиксируем целевой прод-контур: PostgreSQL.

Обязательные правила уже сейчас:

- SQLAlchemy как единый доступ к данным;
- Alembic для всех schema changes;
- запрет sqlite-only SQL и sqlite-specific зависимостей в доменной логике;
- `UUID` для внешних идентификаторов доменных сущностей;
- аудит хранить в отдельных таблицах append-only.

### A2) Frontend baseline для enterprise UI

Текущий базовый стек (`React + TypeScript + Vite + Tailwind`) подтверждён как корректный.

Для следующего инкремента принять как стандарт:

- UI primitives: `shadcn/ui`;
- data fetching/cache: `TanStack Query`;
- forms: `React Hook Form + Zod`;
- data tables: `TanStack Table` (обязательно для workflow-экранов).

### A3) UX-приоритет: "операционная читаемость > декоративность"

Для GMP/WMS/QC/QA экранов запрещаем в MVP:

- тяжёлые анимации;
- декоративные эффекты, снижающие контраст/читабельность;
- нестабильные паттерны навигации.

Требуемый приоритет:

- скорость принятия решения оператором;
- снижение вероятности ошибок ввода/подтверждения;
- предсказуемое поведение таблиц и форм.

### A4) Domain-first до наращивания фич

До расширения UI/API зафиксировать артефакты:

- inventory model: `lot`, `stock`, `location`, `movement`, `reservation`, `quarantine`;
- state machine лота: `received -> quarantine -> sampled -> under_test -> released/rejected`;
- матрица прав: кто и при каких условиях может переводить состояние;
- список обязательных audit events для каждого критичного перехода/действия.

### A5) Минимальная схема audit trail для GMP

Каждая критичная операция обязана сохранять:

- `who` (user/workstation);
- `when` (UTC timestamp);
- `what` (entity + action);
- `before` / `after` (изменённые значения);
- `why` (reason/comment/e-sign meaning).

## Definition of Done (дополнение)

Новая итерация считается готовой, только если одновременно выполнено:

- UX/API-контракты выровнены с backend;
- изменения не нарушают переносимость SQLite -> PostgreSQL;
- для новых workflow-экранов используется таблица/форма enterprise-паттерна (`TanStack Table`, `RHF+Zod`);
- все критичные действия проходят через audit trail с полями `who/when/what/before/after/why`.

## Execution plan (2 спринта)

### Границы плана

- Горизонт: 2 спринта по 2 недели.
- Цель: довести MVP до промышленно-переносимой архитектуры без «переписывания с нуля».
- Приоритет: сначала domain + audit + portability, затем расширение workflow/UI.

---

### Sprint 1 — Foundation & Portability (P0)

**Цель:** закрыть архитектурные риски (DB portability, FSM-контур, audit contract) и заложить frontend-паттерны enterprise UI.

#### Backend (P0)

1. **ORM/миграции**
	- ввести SQLAlchemy-модели как единую точку доступа;
	- зафиксировать Alembic baseline + первые ревизии;
	- убрать sqlite-specific конструкции из прикладной логики.

2. **ID и схема сущностей**
	- добавить `UUID` (внешние идентификаторы) для ключевых доменных сущностей;
	- сохранить совместимость текущих API-контрактов (без breaking changes для MVP UI).

3. **Audit contract v1**
	- внедрить единый формат audit event (`who/when/what/before/after/why`);
	- хранение в append-only таблице;
	- обязательный audit-hook на критичных эндпоинтах (receipt, QC report, QA release, stock adjustment).

4. **FSM и права**
	- формализовать state machine лота (`received -> quarantine -> sampled -> under_test -> released/rejected`);
	- формализовать матрицу RBAC/scope для переходов;
	- добавить server-side валидацию переходов.

#### Frontend (P0)

1. **Data/query слой**
	- подключить `TanStack Query` для API-запросов, retry, cache, stale-state.

2. **Forms/validation слой**
	- подключить `React Hook Form + Zod`;
	- вынести в общий паттерн валидацию обязательных GMP-полей.

3. **Table architecture**
	- внедрить `TanStack Table` как базовый table-engine;
	- сделать общий table-shell (sorting/filter/pagination/status formatting).

4. **UI primitives**
	- начать слой компонентов на `shadcn/ui` (без визуального «перекрашивания» UX).

#### Acceptance criteria Sprint 1

- приложение поднимается на SQLite и PostgreSQL без изменения прикладного кода;
- есть миграции Alembic для всех новых/изменённых таблиц;
- критичные действия пишут audit-события в согласованном формате;
- хотя бы один production-экран (Lots/Movements) использует `TanStack Table` + `TanStack Query`;
- хотя бы одна критичная форма использует `RHF + Zod`.

---

### Sprint 2 — Workflow Hardening (P0 + P1)

**Цель:** довести ключевой операционный контур до состояния «pilot-ready» с управляемым риском GMP-ошибок.

#### Backend (P0)

1. **Workflow endpoints hardening**
	- финализировать проверки RBAC/scope/FSM для всех переходов статусов;
	- унифицировать ошибки валидации для фронтенда (предсказуемые error-codes/messages).

2. **Audit completeness**
	- покрыть audit-логированием весь критичный путь: receipt -> QC -> QA -> stock adjustment -> issue to production.

3. **SoD roadmap marker**
	- оставить текущий релиз без hard-block SoD, но добавить флаг/проверку-ready point для Phase 2.

#### Frontend (P0)

1. **Workflow screens**
	- реализовать производственные формы: receipt, QC report, QA release decision, stock adjustment;
	- валидация и UX-защита от потери данных (локальный draft для MVP).

2. **Operational tables**
	- стандартизировать таблицы lots/movements/QC/QA: фильтрация, сортировка, пагинация, формат дат.

3. **Audit visibility**
	- добавить экран/панель просмотра audit trail с базовыми фильтрами (entity/action/date/user).

4. **UX safety rules**
	- фиксированные контраст/читаемость, отсутствие «тяжёлых» анимаций, предсказуемые confirm-потоки.

#### Acceptance criteria Sprint 2

- критичные workflow-операции доступны из UI и проходят backend-проверки RBAC/scope/FSM;
- все критичные действия отображаются в audit trail end-to-end;
- формат ключевых QC-дат соблюдён во всех таблицах (`—` / `В работе` / `DD.MM.YYYY HH:mm`);
- UX не содержит блокирующих отклонений от принципа «операционная читаемость > декоративность»;
- `npm run build` и базовые smoke-тесты API/UI проходят на целевой ветке.

---

## Release checklist (после 2 спринтов)

- [ ] подтверждена совместимость SQLite (dev) / PostgreSQL (target prod);
- [ ] миграции Alembic применяются без ручных правок;
- [ ] state machine и матрица прав задокументированы и реализованы server-side;
- [ ] audit trail покрывает все критичные GMP-операции;
- [ ] frontend использует `TanStack Query`, `TanStack Table`, `RHF + Zod` на ключевых экранах;
- [ ] нет известных P0-дефектов по RBAC/scope/FSM/audit.

## P1 backlog (после стабилизации MVP)

- hard SoD server-side enforcement (QC/QA same-user block);
- websocket/near-real-time статусы;
- barcode/datamatrix workflows;
- расширенный export (PDF/Excel) и отчётные шаблоны.
