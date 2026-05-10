# Sprint-1 Task Board (Start Today)

Период: 2026-05-10 -> 2026-05-23  
Цель: запустить пилотную реализацию по вертикальному потоку с production-grade foundation.

## Статусы

- Todo
- In Progress
- Blocked
- Review
- Done

## Доска задач

| Task ID | Название | Priority | Owner | Due | Статус | Зависимость | URS/FRS Link | Критерий Done |
|---|---|---|---|---|---|---|---|---|
| SP1-001 | Freeze URS/FRS/TM baseline | P0 | QA + IT | 2026-05-10 | Todo | None | URS-001..024 / FRS-001..024 | Документы в статусе Reviewed |
| SP1-002 | Утвердить DEC-001..DEC-007 | P0 | QA Manager | 2026-05-10 | Todo | SP1-001 | Critical URS | Все блокирующие решения Approved |
| SP1-003 | RBAC implementation baseline | P0 | IT/System Owner | 2026-05-12 | Todo | SP1-001, SP1-002 | URS-003 / FRS-003 | Отказы доступа покрыты тестами |
| SP1-004 | E-signature service baseline | P0 | IT/System Owner | 2026-05-13 | Todo | SP1-002 | URS-004 / FRS-004 | Критичные операции требуют подпись |
| SP1-005 | Audit trail engine baseline | P0 | IT/System Owner | 2026-05-13 | Todo | SP1-002 | URS-005..007 / FRS-005..007 | Есть old/new/reason/timestamp |
| SP1-006 | Quality status model + transitions | P0 | QA + Warehouse | 2026-05-14 | Todo | SP1-002 | URS-011..013 / FRS-011..013 | Недопустимые переходы блокируются |
| SP1-007 | Material receipt + lot identity | P1 | Warehouse + IT | 2026-05-15 | Todo | SP1-006 | URS-011 / FRS-011 | Receipt формирует lot и статус |
| SP1-008 | Sampling task + QC result entry | P1 | QC + IT | 2026-05-16 | Todo | SP1-007 | URS-014,015 / FRS-014,015 | QC result валидируется по полям |
| SP1-009 | QA release decision workflow | P1 | QA + IT | 2026-05-17 | Todo | SP1-008 | URS-016,017 / FRS-016,017 | Release управляет quality status |
| SP1-010 | Issue to production blocking | P1 | Warehouse + Production + IT | 2026-05-18 | Todo | SP1-009 | URS-013,019 / FRS-013,019 | Невалидные статусы не проходят |
| SP1-011 | EBR minimal template + mandatory gates | P1 | Production + IT | 2026-05-20 | Todo | SP1-010 | URS-020,021 / FRS-020,021 | Нельзя skip mandatory step |
| SP1-012 | Deviation linkage from EBR/QC | P2 | QA + IT | 2026-05-21 | Todo | SP1-011 | URS-022 / FRS-022 | Out-of-limit создает deviation |
| SP1-013 | Lot genealogy report baseline | P2 | QA + Warehouse + IT | 2026-05-22 | Todo | SP1-011 | URS-023 / FRS-023 | Видна цепочка lot end-to-end |
| SP1-014 | E2E critical tests (pos/neg) | P0 | Validation Lead + IT | 2026-05-23 | Todo | SP1-003..SP1-013 | TM TST-001..TST-048 | Критичные тесты пройдены |

## Ежедневный ритм

- 10:00-10:30: triage QA + IT + Process Owners
- 17:30-17:45: статус задач и блокеров
- Любой Blocked > 24ч — эскалация владельцу решения из decision log

## Guardrails (обязательные)

- Работаем по `DEC-009 Prod-first policy`: временные демо-решения запрещены.
- Любой workaround допускается только через новый Decision ID с owner, сроком удаления и impact review.
- Задача не переводится в `Done`, если реализация требует плановой повторной переделки того же функционала.
