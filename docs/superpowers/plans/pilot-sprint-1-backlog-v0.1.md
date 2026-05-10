# Sprint-1 Backlog v0.1 (Pilot Foundation)

Дата: 2026-05-10  
Цель спринта: закрыть production-grade foundation для пилотного потока без демо-реализаций.

## Границы Sprint-1

Включено:
- URS/FRS/TM baseline approval cycle.
- RBAC baseline.
- e-signature policy baseline.
- audit trail specification baseline.
- Canonical quality status model.
- Workflow model baseline (документы + QA decision + deviation trigger).

Не включено:
- Полная реализация UI/форм всех модулей.
- Полный EBR контур исполнения серии.
- Полный dispatch/recall контур.

## Приоритизированный backlog

| Priority | Work Item ID | Название | Связь с URS/FRS | Результат на выходе | Зависимости |
|---|---|---|---|---|---|
| P0 | SP1-001 | Freeze URS/FRS/TM v0.1 | URS-001..024, FRS-001..024 | Согласованные версии URS/FRS/TM с owner и status | Нет |
| P0 | SP1-002 | RBAC Matrix v0.1 | URS-003, FRS-003 | Матрица прав по ролям и операциям (CRUD/approve/sign/release/block) | SP1-001 |
| P0 | SP1-003 | Electronic Signature Policy v0.1 | URS-004, FRS-004 | Политика подписи (meaning, re-auth, binding, dual-signature scenarios) | SP1-001 |
| P0 | SP1-004 | Audit Trail Specification v0.1 | URS-005..007, FRS-005..007 | События, поля old/new, reason rules, неизменяемость, отчеты QA | SP1-001 |
| P0 | SP1-005 | Canonical Quality Status Model | URS-011..013,016,017, FRS-011..017 | Справочник статусов + матрица допустимых переходов + blocking rules | SP1-001 |
| P1 | SP1-006 | Workflow Definitions v0.1 | URS-002,013,016,017,022 | 3 workflow-определения: document lifecycle, QA decision, deviation trigger | SP1-001, SP1-004, SP1-005 |
| P1 | SP1-007 | Data Model Draft (core objects) | URS-001..024 | ERD core entities + ключевые связи для пилотного среза | SP1-001, SP1-005 |
| P1 | SP1-008 | Validation Baseline Pack | Все critical URS | GxP impact, DI assessment, traceability gate criteria, OQ test skeleton | SP1-001..SP1-006 |
| P2 | SP1-009 | Sprint-2 Ready Dev Backlog | Все critical URS | Разбитый backlog реализации (API/UI/tests) без архитектурных пробелов | SP1-001..SP1-008 |

## Definition of Done (Sprint-1)

1. Нет открытых `NO-GO` по пунктам 1-5 и 11 чеклиста.
2. Все Critical URS имеют owner, FRS и минимум 2 тест-кейса (positive/negative) в TM.
3. RBAC, e-signature, audit trail и quality status утверждены QA + IT/System Owner.
4. Утверждены как минимум 3 baseline workflow definition.
5. Подготовлен Sprint-2 backlog на реализацию без изменений в архитектурном фундаменте.

## Риски спринта и контроль

- Риск: затяжное согласование формулировок Critical URS.  
  Контроль: ежедневный triage QA/IT/Process Owners (30 мин).

- Риск: разногласия по override/dual-signature сценариям.  
  Контроль: отдельный decision log с фиксированными правилами и owner.

- Риск: разрыв между требованиями и тест-кейсами.  
  Контроль: validation review на каждое изменение URS/FRS до статуса Approved.
