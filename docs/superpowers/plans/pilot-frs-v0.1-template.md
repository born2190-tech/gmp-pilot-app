# FRS v0.1 (Pilot Vertical Slice)

Документ: Functional Requirements Specification  
Версия: 0.1 (рабочий шаблон)  
Дата: 2026-05-10  
Статус: Draft for solution design and test preparation

## 1. Назначение

Определить функциональные требования системы для реализации URS v0.1 по пилотному вертикальному потоку.

## 2. Область реализации v0.1

- GMP Core: RBAC, e-signature, audit trail, workflow.
- Материальный поток: receipt -> quarantine -> sampling -> QC -> QA release -> issue to production.
- Pilot EBR: исполнение серии с mandatory gates.
- Приемка finished goods в складской контур пилота.

## 3. Функциональные требования (FRS)

| FRS ID | Связь с URS | Функциональная реализация | Правило/блокировка | Выходной артефакт |
|---|---|---|---|---|
| FRS-001 | URS-001 | Реализовать модель `Document`/`DocumentVersion` с полями status, effective_date, obsolete_date. | Выбор obsolete/uncontrolled версии в новые workflow запрещен. | Реестр действующих версий документов |
| FRS-002 | URS-002 | Реализовать конфигурируемый workflow документа (draft/review/approve/effective/obsolete/rejected). | Переход в effective только после required approvals. | Лог переходов статуса документа |
| FRS-003 | URS-003 | Реализовать RBAC для документов и записей на уровне create/read/update/approve/archive. | Неавторизованные операции отклоняются с audit event. | Матрица прав + журнал отказов доступа |
| FRS-004 | URS-004 | Реализовать сервис электронных подписей с повторной аутентификацией и captured signature meaning. | Критичное действие не завершается без valid e-signature. | Журнал e-signature events |
| FRS-005 | URS-005 | Реализовать единый сервис audit trail для GxP-объектов (CRUD + approvals + status changes). | Audit event обязателен для всех GxP-значимых операций. | Audit trail report |
| FRS-006 | URS-006 | Реализовать correction model: хранение original и corrected value с reason/user/timestamp. | Прямое overwrite finalized-record запрещено. | История корректировок записи |
| FRS-007 | URS-007 | Реализовать контроль event time vs entry time и marker retrospective entry. | Late entry без reason и review route запрещен. | Журнал retrospective entries |
| FRS-008 | URS-008 | Реализовать валидацию обязательных полей записи: record ID, owner, batch/lot, timestamp (и другие по типу). | Сохранение incomplete записи в finalized status запрещено. | Валидируемая карточка записи |
| FRS-009 | URS-009 | Реализовать pre-close checklist для EBR/controlled record. | Close/complete блокируется при missing fields/signatures. | Протокол проверки полноты |
| FRS-010 | URS-010 | Реализовать training gate: проверка текущего training/qualification перед критичным шагом. | Исполнение/проверка шага без training blocked. | Лог training authorization checks |
| FRS-011 | URS-011 | Реализовать receipt transaction с созданием internal lot, supplier lot, quantity, location, initial quality status. | Receipt без lot identity и quality status запрещен. | Журнал приемки материалов |
| FRS-012 | URS-012 | Реализовать справочник quality statuses и матрицу допустимых переходов. | Недопустимые переходы статуса отклоняются. | История изменения quality status |
| FRS-013 | URS-013 | Реализовать проверку статуса материала при issue to production. | Issue blocked для quarantine/blocked/rejected/expired без approved override. | Лог блокировок выдачи |
| FRS-014 | URS-014 | Реализовать генерацию sampling/QC tasks из receipt/quarantine контекста. | QC task не создается без ссылки на lot/material/spec. | Список задач QC |
| FRS-015 | URS-015 | Реализовать экран ввода QC results с проверкой unit/instrument/time/operator и limit check against specification. | Result submit блокируется при отсутствии required fields. | Протокол QC результатов |
| FRS-016 | URS-016 | Реализовать workflow QA decision (release/block/reject/return for investigation), который обновляет quality status. | Manual stock status edit в обход QA decision запрещен. | QA release decision log |
| FRS-017 | URS-017 | Реализовать блокировку release при активных OOS/OOT/RNS/deviation workflows. | QA release невозможен до закрытия required investigations. | Отчет открытых quality блокировок |
| FRS-018 | URS-018 | Реализовать сущность ProductionOrder(ZPS) с расчетом material requirement и reservation logic. | Создание ZPS без BOM/master formula запрещено. | ZPS dashboard |
| FRS-019 | URS-019 | Реализовать pre-start check production order на доступность required released lots. | Start ZPS blocked при нехватке released material. | Лог pre-start blocking checks |
| FRS-020 | URS-020 | Реализовать EBR template engine: step types, sequence, mandatory flags, role ownership. | Пропуск mandatory step запрещен. | EBR template definition |
| FRS-021 | URS-021 | Реализовать EBR execution UI с фиксацией step data, IPC, signatures, timestamps, attachments. | Step completion без required data/signatures невозможен. | Controlled batch execution record |
| FRS-022 | URS-022 | Реализовать auto-link deviation workflow из EBR/QC при out-of-limit/critical events. | Batch closure blocked при открытых critical deviations. | Связка Batch <-> Deviation |
| FRS-023 | URS-023 | Реализовать lot genealogy model и traceability report по цепочке material->production->FG receipt. | Закрытие batch/FG receipt без linked consumed lots запрещено. | Lot genealogy report |
| FRS-024 | URS-024 | Реализовать retention policy engine и archive controls для GxP records. | Delete до retention end date запрещен. | Архивный журнал/лог удаления |

## 4. Нефункциональные требования (для пилота)

1. Все операции e-signature/audit trail должны иметь серверный timestamp.
2. Поисковая выдача должна позволять найти запись по batch/lot/document ID.
3. События audit trail и e-signature должны быть доступны для отчетности QA.
4. Критические блокировки должны отображать пользователю понятную причину отказа.

## 5. Критерии готовности FRS v0.1

- Для каждого FRS указан связанный URS.
- Для каждого FRS определен минимум 1 позитивный и 1 негативный тест-кейс.
- Все Critical URS покрыты FRS без пропусков.
