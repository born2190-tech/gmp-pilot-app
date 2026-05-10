# Decision Log v0.1 (Pilot Start)

Дата старта: 2026-05-10  
Назначение: фиксировать решения, которые влияют на архитектуру, комплаенс и сроки.

## Статусы

- Proposed
- Approved
- Rejected
- Deferred

## Лог решений

| Decision ID | Тема | Описание решения | Варианты | Owner | Due Date | Статус | Влияние на URS/FRS | Примечание |
|---|---|---|---|---|---|---|---|---|
| DEC-001 | Override policy | Разрешить override только через workflow с обязательной причиной и e-signature. | Allow / Disallow / Limited | QA Manager | 2026-05-10 | Proposed | URS-013, URS-019, FRS-013, FRS-019 | Критично для запуска склад->производство |
| DEC-002 | Dual-signature scope | Dual-signature обязателен для override и условных QA release сценариев. | Minimal / Extended | QA Manager + IT | 2026-05-10 | Proposed | URS-004, URS-016, FRS-004, FRS-016 | Влияет на e-signature implementation |
| DEC-003 | Re-auth method | Метод повторной аутентификации на пилот: password re-entry. | Password / MFA / Equivalent | IT/System Owner | 2026-05-10 | Proposed | URS-004, FRS-004 | Нужно для Sprint Day 5 |
| DEC-004 | Emergency access | В пилоте: emergency access только для Sys Admin с обязательным meta-audit и временным токеном. | Enable / Disable | QA + IT | 2026-05-11 | Proposed | URS-003, URS-005 | Не должен обходить QA release |
| DEC-005 | Quality status dictionary freeze | Зафиксировать статусы: received/quarantine/sampled/under test/released/blocked/rejected/expired. | Freeze / Extend | QA + Warehouse | 2026-05-10 | Proposed | URS-012, FRS-012 | Блокер для Day 6 |
| DEC-006 | OOS/OOT blocking rule | Любой открытый OOS/OOT/RNS блокирует QA release до закрытия required workflow. | Hard block / Soft warning | QA + QC | 2026-05-10 | Proposed | URS-017, FRS-017 | Блокер для Day 7-8 |
| DEC-007 | Pilot product route | Использовать solid route на основе СОП-461 как первый EBR шаблон. | Route A / Route B | Production + QA | 2026-05-10 | Proposed | URS-020, URS-021 | Блокер для Day 9 |
| DEC-008 | FG receipt scope | На пилоте реализовать FG receipt как controlled stub без dispatch. | Stub / Full | Production + Warehouse | 2026-05-11 | Proposed | URS-023 | Снижает scope риск |
| DEC-009 | Prod-first policy | Реализация ведется в production-grade режиме с первого прохода: без временных демо-решений, которые требуют повторной переделки. Любой временный workaround допускается только через отдельное решение в decision log с сроком удаления. | Prod-first / Fast-demo | Product Owner + QA + IT | 2026-05-10 | Approved | Все Critical URS/FRS | Базовая политика разработки на все этапы |

## Правила ведения

1. Любое решение по Critical URS принимается только после QA подтверждения.
2. Решение без owner и due date считается недействительным.
3. Изменение Approved решения требует нового Decision ID и impact review.
4. Каждое Approved решение должно ссылаться на обновленные URS/FRS/TM пункты.
