# URS v0.1 (Pilot Vertical Slice)

Документ: User Requirements Specification  
Версия: 0.1 (рабочий шаблон)  
Дата: 2026-05-10  
Статус: Draft for cross-functional review

## 1. Цель

Зафиксировать пользовательские требования для пилотного вертикального потока:

`Приемка материала -> Карантин -> Отбор проб -> QC тестирование -> QA release -> Выдача в производство -> EBR исполнение -> Приемка ГП на склад`

Требования сформированы строго на базе текущих документов проекта и pilot SOP-to-system matrix.

## 2. Область применения

Включено в v0.1:
- GMP Core (roles/access, e-signature, audit trail, workflows).
- Document/Record control в части, необходимой для пилотного потока.
- Materials/Warehouse статусы и перемещения пилотного потока.
- QC/QA решения, влияющие на quality status.
- Pilot EBR (solid dosage route candidate).

Не включено в v0.1:
- Финансы, бухучет, payroll, налоги, treasury.
- Полный sterile контур (вне текущего пилота).
- Полный dispatch/complaints/recall контур (кроме базовой прослеживаемости партии в пилоте).

## 3. Нормативные и проектные источники

- `ПСК-1`, `ПСК-2`, `СОП-121`
- `ПСК-5`, `ПСК-6`, `ПСК-8`, `ПСК-10`
- `СОП-205`, `СОП-209`, `СОП-217`, `СОП-223`, `СОП-231`
- `СОП-409`, `СОП-414`, `СОП-415`, `СОП-436`, `СОП-442`, `СОП-461`
- `СОП-512`, `SOP-533`, `СОП-540`, `СОП-548`, `СОП-549`
- `СОП-618`, `ДПСК-607`, `ДПСК-619`
- Файлы проекта: `pilot_sop_to_system_matrix_v0_1.md`, `pilot_readiness_report.md`, `2026-05-08-gmp-erp-mes-platform-implementation.md`

## 4. Роли пилота

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

## 5. Пользовательские требования (URS)

| URS ID | Требование пользователя | Приоритет | Owner (подразделение) | Источник/трассировка |
|---|---|---|---|---|
| URS-001 | Система должна различать и обеспечивать использование только действующих версий SOP/форм в активных GMP-процессах. | Critical | QA + DOC | DOC-001, DOC-003, REC-002 |
| URS-002 | Система должна поддерживать workflow документа: draft -> review -> approve -> effective -> obsolete/rejected. | Critical | DOC + QA | DOC-004 |
| URS-003 | Система должна вести контроль доступа к документам и записям по ролям и запрещать неавторизованное изменение/изъятие. | Critical | IT + QA | DOC-005 |
| URS-004 | Для критичных действий должна применяться электронная подпись с идентификацией пользователя, значением подписи и timestamp. | Critical | QA + IT | DOC-001, REC-004, план Release 1 |
| URS-005 | Для GxP-значимых действий должен формироваться audit trail с old/new value, user, timestamp, reason (где применимо). | Critical | QA + IT | REC-004, план Release 1 |
| URS-006 | Система должна поддерживать корректировки записей без перезаписи исходного значения (addendum-подход). | Critical | QA | REC-004 |
| URS-007 | Система должна запрещать backdating и требовать обоснование для retrospective entries. | Critical | QA | REC-005 |
| URS-008 | Для пилотных записей должны фиксироваться обязательные поля идентификации (record ID, owner, batch/lot, equipment where applicable). | High | QA + Process Owners | REC-003 |
| URS-009 | Система должна блокировать закрытие записи/EBR при незаполненных обязательных полях и неподписанных шагах. | Critical | Production + QA | REC-010 |
| URS-010 | Система должна проверять training/qualification пользователя перед выполнением критичных шагов (operator/checker). | Critical | HR/Training + QA | REC-007 |
| URS-011 | Система должна поддерживать приемку материалов с присвоением статуса качества и записью партии/лота. | Critical | Warehouse + QA | План Release 2 |
| URS-012 | Система должна поддерживать статусы качества минимум: received, quarantine, sampled, under test, released, blocked, rejected, expired. | Critical | QA + Warehouse | План Release 2 |
| URS-013 | Система должна запрещать выдачу в производство материалов со статусами quarantine/blocked/rejected/expired без авторизованного override workflow. | Critical | Warehouse + QA + Production | План Release 2 |
| URS-014 | Система должна создавать задания на отбор проб и QC тестирование из материального потока. | High | QC + Warehouse | План Release 2-3 |
| URS-015 | Система должна обеспечивать ввод QC результатов с контролем обязательных полей (значение, единицы, время, исполнитель) и привязкой к спецификации/лимитам. | Critical | QC | REC-008, План Release 3 |
| URS-016 | QA release decision должен быть единственным источником изменения статуса качества на released/block/reject для пилотного потока. | Critical | QA | План Release 3 |
| URS-017 | При OOS/OOT/RNS или нерешенных отклонениях система должна блокировать release до завершения required workflow. | Critical | QA + QC | План Release 3, QMS-DEV-004 |
| URS-018 | Система должна поддерживать production order (ZPS) с расчетом потребности и резервированием released-материалов. | High | Production + Warehouse | План Release 4 |
| URS-019 | Старт производственного заказа должен быть заблокирован без required released materials или approved exception. | Critical | Production + QA + Warehouse | План Release 4 |
| URS-020 | EBR должен быть template-driven с обязательными шагами и блокировками пропуска шагов. | Critical | Production + QA | REC-006, План Release 5 |
| URS-021 | EBR должен фиксировать исполнителя, время шага, параметры процесса, IPC и required signatures/checkpoints. | Critical | Production + QC + QA | REC-006, REC-008, План Release 5 |
| URS-022 | Для отклонений в процессе EBR/QC система должна инициировать deviation workflow и не допускать закрытие batch record без required resolution. | Critical | QA + Production + QC | QMS-DEV-001, QMS-DEV-004, План Release 5 |
| URS-023 | Система должна обеспечивать lot genealogy: от входящего lot сырья до выпуска и приемки ГП на склад. | Critical | QA + Warehouse + Production | План Release 4-6/10 |
| URS-024 | Система должна поддерживать retention rules и запрет раннего удаления GxP-записей. | High | QA + DOC | DOC-008, QMS-DEV-008, QMS-CHG-005 |

## 6. Критерии приемки URS этапа

- Каждое URS-требование имеет owner (QA/QC/Production/Warehouse/IT).
- Каждое URS-требование имеет целевое FRS и Test ID в traceability matrix.
- По требованиям Critical определены негативные сценарии (blocking behavior).

## 7. Открытые пункты к согласованию

1. Подтвердить финальный перечень SOP-замен (СОП-436 вместо СОП-435 в пилоте).
2. Подтвердить pilot product route (на базе СОП-461) и границы первой EBR-шаблонизации.
3. Утвердить, какие override-сценарии допустимы и какие требуют dual-signature.
