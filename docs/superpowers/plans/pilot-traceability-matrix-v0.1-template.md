# Traceability Matrix v0.1 (Pilot Vertical Slice)

Версия: 0.1 (рабочий шаблон)  
Дата: 2026-05-10  
Статус: Draft

## Правила ведения матрицы

- Один URS может маппиться на несколько FRS и тестов.
- Для всех `Critical` требований обязательны минимум 2 теста: позитивный и негативный.
- Статус покрытия: `Planned`, `In Progress`, `Implemented`, `Tested`, `Approved`.

## Матрица URS -> FRS -> Test

| URS ID | Criticality | FRS ID | Test ID (Positive) | Test ID (Negative) | SOP/Source Ref | Coverage Status | Owner |
|---|---|---|---|---|---|---|---|
| URS-001 | Critical | FRS-001 | TST-001 | TST-002 | DOC-001, DOC-003, REC-002 | Planned | QA + DOC |
| URS-002 | Critical | FRS-002 | TST-003 | TST-004 | DOC-004 | Planned | DOC |
| URS-003 | Critical | FRS-003 | TST-005 | TST-006 | DOC-005 | Planned | IT + QA |
| URS-004 | Critical | FRS-004 | TST-007 | TST-008 | DOC-001, REC-004 | Planned | IT + QA |
| URS-005 | Critical | FRS-005 | TST-009 | TST-010 | REC-004 | Planned | IT + QA |
| URS-006 | Critical | FRS-006 | TST-011 | TST-012 | REC-004 | Planned | QA |
| URS-007 | Critical | FRS-007 | TST-013 | TST-014 | REC-005 | Planned | QA |
| URS-008 | High | FRS-008 | TST-015 | TST-016 | REC-003 | Planned | QA + Process Owner |
| URS-009 | Critical | FRS-009 | TST-017 | TST-018 | REC-010 | Planned | QA + Production |
| URS-010 | Critical | FRS-010 | TST-019 | TST-020 | REC-007 | Planned | HR/Training + QA |
| URS-011 | Critical | FRS-011 | TST-021 | TST-022 | Release 2 scope | Planned | Warehouse |
| URS-012 | Critical | FRS-012 | TST-023 | TST-024 | Release 2 scope | Planned | Warehouse + QA |
| URS-013 | Critical | FRS-013 | TST-025 | TST-026 | Release 2 scope | Planned | Warehouse + QA |
| URS-014 | High | FRS-014 | TST-027 | TST-028 | Release 2-3 scope | Planned | QC |
| URS-015 | Critical | FRS-015 | TST-029 | TST-030 | REC-008, Release 3 | Planned | QC |
| URS-016 | Critical | FRS-016 | TST-031 | TST-032 | Release 3 scope | Planned | QA |
| URS-017 | Critical | FRS-017 | TST-033 | TST-034 | QMS-DEV-004, Release 3 | Planned | QA |
| URS-018 | High | FRS-018 | TST-035 | TST-036 | Release 4 scope | Planned | Production |
| URS-019 | Critical | FRS-019 | TST-037 | TST-038 | Release 4 scope | Planned | Production + Warehouse |
| URS-020 | Critical | FRS-020 | TST-039 | TST-040 | REC-006, Release 5 | Planned | Production + QA |
| URS-021 | Critical | FRS-021 | TST-041 | TST-042 | REC-006, REC-008, Release 5 | Planned | Production + QC + QA |
| URS-022 | Critical | FRS-022 | TST-043 | TST-044 | QMS-DEV-001, QMS-DEV-004 | Planned | QA |
| URS-023 | Critical | FRS-023 | TST-045 | TST-046 | Release 4-6/10 scope | Planned | QA + Warehouse + Production |
| URS-024 | High | FRS-024 | TST-047 | TST-048 | DOC-008, QMS-DEV-008, QMS-CHG-005 | Planned | QA + DOC |

## Быстрый контроль полноты

- Всего URS в scope v0.1: 24
- Покрытие FRS: 24/24
- Покрытие тестами (план): 48 тестов (24 positive + 24 negative)

## Шаблон для добавления новой строки

| URS-XXX | Critical/High/Medium | FRS-XXX | TST-XXX | TST-XXX | SOP-ID/Section | Planned | Owner |
