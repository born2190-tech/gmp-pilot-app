# RBAC Matrix v0.1 (Pilot Vertical Slice)

Дата: 2026-05-10  
Статус: Draft for QA/IT approval  
Связь: URS-003, URS-009, URS-010, URS-013, URS-016, URS-019, URS-021

## 1. Цель

Определить единые права доступа для пилотного GMP-потока, чтобы исключить неавторизованные операции и обеспечить корректные блокировки по ролям.

## 2. Роли

- QA Manager
- QC Analyst
- QC Manager
- Warehouse Operator
- Warehouse Manager
- Production Operator
- Shift Master / Supervisor
- Technologist
- Document Control Specialist
- System Administrator

## 3. Категории операций

- `C` = Create
- `R` = Read
- `U` = Update (до финализации)
- `A` = Approve/Release
- `S` = Sign (electronic signature)
- `X` = Execute (выполнение операции/шага)
- `B` = Block/Reject/Hold
- `OVR` = Override (только по утвержденному workflow)

## 4. Матрица прав (пилотный минимум)

| Объект/Операция | QA Manager | QC Analyst | QC Manager | Warehouse Operator | Warehouse Manager | Production Operator | Shift Master | Technologist | DOC Specialist | Sys Admin |
|---|---|---|---|---|---|---|---|---|---|---|
| Document metadata (C/R/U) | R | R | R | R | R | R | R | R | C/R/U | R |
| Document approval/effective/obsolete (A/S) | A/S | - | - | - | - | - | - | - | C (подготовка) | - |
| Record correction (controlled addendum) | A/S | C/U/S (свои QC записи) | A/S | C/U/S (свои записи) | C/U/S (склад) | C/U/S (свои записи) | A/S | C/U/S (тех. записи) | - | - |
| Material receipt (C/X/S) | R | - | - | C/X/S | A/S | - | - | - | - | - |
| Quality status transition to `quarantine/sampled/under test` | R | C/X (task status) | A/S (QC status decision) | C/X | A/S | - | - | - | - | - |
| QC result entry (C/U/X/S) | R | C/U/X/S | A/S | - | - | - | - | - | - | - |
| QA release decision (`release/block/reject`) (A/B/S) | A/B/S | - | C | - | C | - | - | - | - | - |
| Issue to production (X/S) | C (oversight) | - | - | C/X/S | A/S | R | A/S | C | - | - |
| Production order start (A/X/S) | C | - | - | - | C | X/S | A/S | C | - | - |
| EBR step execution (X/S) | R | QC checkpoints only | A/S for QC checkpoints | - | - | X/S | A/S (checker) | X/S (технологические шаги) | - | - |
| EBR close/review (A/S) | A/S | C | C | - | - | - | C | C | - | - |
| Deviation initiation from EBR/QC (C/X/S) | A/S (closure) | C/X/S | A/S | C/X/S | C/X/S | C/X/S | C/X/S | C/X/S | - | - |
| Override workflow (OVR/S) | A/S | - | C | C (инициация) | C (инициация) | C (инициация) | C (инициация) | C (инициация) | - | - |
| User/Role administration | - | - | - | - | - | - | - | - | - | C/R/U/A |

## 5. Ограничения и обязательные правила

1. Sys Admin не имеет права выполнять QA release и производственные GMP-операции (разделение обязанностей).
2. Все операции `A`, `B`, `OVR` требуют `S` (электронной подписи).
3. Для критичных шагов EBR: оператор и проверяющий не должны быть одним и тем же пользователем.
4. Изменение качества статуса на `released` допускается только через QA decision workflow.
5. Любая роль без текущего обучения по требуемому SOP блокируется на `X`/`S` операциях.

## 6. Минимальный набор тестов RBAC

- RBAC-T01: неавторизованный пользователь пытается выполнить QA release -> отказ + audit event.
- RBAC-T02: Warehouse Operator пытается изменить released на blocked вручную вне workflow -> отказ.
- RBAC-T03: Production Operator пытается approve документ -> отказ.
- RBAC-T04: Sys Admin пытается подписать batch release -> отказ.
- RBAC-T05: пользователь без training пытается исполнить critical EBR step -> блокировка.

## 7. Пункты на утверждение

1. Нужен ли dual-signature для override в URS-013/URS-019.
2. Нужно ли разделять роль QA Manager на QA Reviewer и QA Approver в пилоте.
3. Допускается ли временный emergency access и как он журналируется.
