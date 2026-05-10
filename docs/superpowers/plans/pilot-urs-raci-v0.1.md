# URS RACI v0.1 (Pilot Vertical Slice)

Дата: 2026-05-10  
Назначение: закрепить ответственности по согласованию и приемке URS/FRS/Test.

## Обозначения

- R — Responsible (исполняет)
- A — Accountable (финально утверждает)
- C — Consulted (консультирует)
- I — Informed (информируется)

## Роли

- QA Manager
- QC Manager
- Production Manager
- Warehouse Manager
- Document Control Specialist
- IT/System Owner
- Validation Lead

## RACI по кластерам требований

| Кластер URS | URS ID | QA | QC | Production | Warehouse | DOC | IT | Validation |
|---|---|---|---|---|---|---|---|---|
| Document lifecycle & controlled versions | URS-001, URS-002 | A | I | I | I | R | C | C |
| Access, e-signature, audit trail | URS-003, URS-004, URS-005 | A | I | I | I | C | R | C |
| Data integrity & correction model | URS-006, URS-007, URS-008 | A | C | C | C | C | R | C |
| Record/EBR completion gates | URS-009 | A | C | R | I | I | C | C |
| Training gate for critical steps | URS-010 | A | C | C | C | I | C | R |
| Material receipt & quality statuses | URS-011, URS-012 | A | C | I | R | I | C | C |
| Issue blocking by quality status | URS-013 | A | C | C | R | I | C | C |
| Sampling and QC tasking | URS-014 | C | A/R | I | C | I | C | C |
| QC result integrity | URS-015 | C | A/R | I | I | I | C | C |
| QA release authority | URS-016, URS-017 | A/R | C | I | C | I | C | C |
| ZPS/material reservation and pre-start checks | URS-018, URS-019 | C | I | A/R | C | I | C | C |
| EBR template and execution data | URS-020, URS-021 | A | C | R | I | I | C | C |
| Deviation linkage from EBR/QC | URS-022 | A/R | C | C | I | I | C | C |
| Lot genealogy end-to-end | URS-023 | A | C | C | R | I | C | C |
| Retention and deletion controls | URS-024 | A | I | I | I | R | C | C |

## Правило согласования

- Critical URS: обязательное согласование QA + профильный процессный владелец + IT/System Owner.
- High URS: обязательное согласование профильного владельца и QA.
- Validation Lead подтверждает тестопригодность формулировок до статуса Approved.
