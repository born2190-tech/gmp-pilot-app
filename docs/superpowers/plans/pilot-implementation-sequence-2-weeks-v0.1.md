# Pilot Implementation Sequence (2 Weeks) v0.1

Дата: 2026-05-10  
Назначение: практический порядок реализации пилотного вертикального потока без rewrite-рисков.

Основа: URS/FRS/TM + RBAC + e-signature + audit trail из текущего пакета документов.

Политика исполнения: `DEC-009 Prod-first policy` (без временных демо-реализаций с последующей полной переделкой).

## 1. Принцип порядка (почему именно так)

Реализация идет слоями:
1) Платформенное ядро (RBAC, audit trail, e-signature, quality status).
2) Материальный поток до QA release.
3) Production start gate + EBR minimum.
4) Интеграционные блокировки и acceptance tests.

Такой порядок исключает разработку экранов/операций без GMP-контролей.

## 2. Sprint Goal (10 рабочих дней)

К концу 2 недель должен работать сквозной сценарий:

`Material receipt -> quarantine -> sampling task -> QC result -> QA release -> issue to production -> start ZPS gate -> EBR mandatory step execution -> FG receipt (pilot stub)`

## 3. Day-by-Day план

## Day 1 — Foundation kickoff

- Зафиксировать baseline документов: URS/FRS/TM + RBAC + e-signature + audit trail.
- Создать `decision-log-v0.1` и зафиксировать открытые вопросы (override, dual-signature, emergency access).
- Подготовить технический backlog с link на URS/FRS IDs.

**Выход:** freeze scope Sprint-1, без открытых ambiguity по критичным блокировкам.

## Day 2 — Data model core

Реализовать минимальные сущности:
- `User`, `Role`, `Permission`
- `AuditEvent`, `SignatureEvent`
- `Material`, `Lot`, `QualityStatus`, `StockTransaction`
- `QCTask`, `QCResult`, `QAReleaseDecision`
- `ProductionOrder`, `EBRTemplate`, `EBRExecution`, `EBRStep`

**Выход:** миграции БД + seed quality statuses.

## Day 3 — RBAC enforcement

- Добавить middleware/guard на все pilot endpoints.
- Внедрить проверку операций `Approve/Release/Block/Override` по матрице ролей.
- Добавить тесты отказа доступа для критичных сценариев.

**Выход:** критичные операции защищены ролевыми блокировками.

## Day 4 — Audit trail engine

- Реализовать единый writer audit events для CRUD + status transitions + approvals.
- Реализовать обязательность `reason` для correction/block/reject/override.
- Добавить неизменяемость audit events на уровне приложения.

**Выход:** любая GxP-операция пишет валидное audit событие.

## Day 5 — E-signature service

- Реализовать подпись с re-auth и `signature_meaning`.
- Добавить record binding: подпись ссылается на объект и версию объекта.
- Реализовать dual-signature для override/критичных release сценариев.

**Выход:** критичные действия невозможны без валидной подписи.

## Day 6 — Material receipt + status model

- Реализовать приемку материала (`receipt`) с lot identity.
- Реализовать canonical quality statuses и transition rules.
- Запретить недопустимые переходы статусов.

**Выход:** материал проходит `received -> quarantine` с полной трассой.

## Day 7 — Sampling/QC result

- Реализовать создание `QCTask` из lot в карантине.
- Реализовать ввод `QCResult` с проверкой полей: value/unit/time/operator/instrument.
- Реализовать OOS/OOT flag как блокирующее условие для release.

**Выход:** QC результат формирует валидное quality решение для QA.

## Day 8 — QA release + issue blocking

- Реализовать `QAReleaseDecision` (`release/block/reject`).
- Сделать decision-driven обновление quality status (без ручного обхода).
- Реализовать блокировку `issue to production` для `quarantine/blocked/rejected/expired`.

**Выход:** в производство уходят только released lots.

## Day 9 — Production start gate + EBR minimum

- Реализовать pre-start check для `ProductionOrder` (released material required).
- Реализовать `EBRTemplate` и минимальный execution flow с mandatory steps.
- Запретить skip mandatory steps и close при missing signatures.

**Выход:** пилотный batch можно стартовать и провести через минимальный EBR.

## Day 10 — End-to-end hardening

- Реализовать FG receipt pilot stub с lot linkage.
- Пройти e2e сценарии из TM (critical positive/negative).
- Зафиксировать дефекты и backlog Sprint-2.

**Выход:** демонстрируемый, тестируемый сквозной поток с GMP-блокировками.

## 4. Минимальный API контур (pilot)

- `POST /materials/receipts`
- `POST /lots/{id}/sampling-tasks`
- `POST /qc/results`
- `POST /qa/release-decisions`
- `POST /warehouse/issues-to-production`
- `POST /production-orders`
- `POST /production-orders/{id}/start`
- `POST /ebr/templates`
- `POST /ebr/executions`
- `POST /ebr/executions/{id}/steps/{stepId}/complete`
- `POST /signatures`
- `GET /audit-events`

Каждый endpoint обязан:
- проходить RBAC check;
- писать audit event;
- требовать e-signature для критичных действий.

## 5. Минимальные UI экраны (без лишнего)

1. Material Receipt form
2. Lot status board
3. QC task/result screen
4. QA release decision screen
5. Issue to production screen
6. Production order pre-start check
7. EBR step execution screen (mandatory gates)
8. Audit trail viewer (QA)

## 6. Definition of Done (на конец 2 недель)

Обязательно выполнено:
1. Критичные URS (001-007, 009-013, 015-017, 019-023) имеют рабочую реализацию.
2. Для критичных URS есть минимум 1 positive + 1 negative e2e test.
3. Нет обхода QA release ручным изменением статуса склада.
4. Нет обхода e-signature на критичных операциях.
5. Нет возможности изменить finalized запись без correction trail.

## 7. Что не делать в эти 2 недели

- Не начинать sterile workflow.
- Не расширять в dispatch/recall.
- Не строить сложную аналитику/дашборды сверх критичных отчетов.
- Не добавлять новые бизнес-процессы вне pilot vertical slice.

## 8. Риск-контроль на каждый день

- Daily 30 min: QA + IT + Process owner triage.
- Любая новая функциональность без URS/FRS link — в backlog, не в текущий спринт.
- Любая спорная логика override — только через decision log и утверждение QA.
