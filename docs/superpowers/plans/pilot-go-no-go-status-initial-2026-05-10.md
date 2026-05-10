# Предварительная оценка Go/No-Go по пилоту (as-is)

Дата оценки: 2026-05-10  
Основание: только текущие файлы в папке `1-erp-gmp` (без скрытых внешних артефактов).

Использованные источники:
- `pilot_sop_to_system_matrix_v0_1.md`
- `pilot_readiness_report.md`
- `sop_process_map_summary.md`
- `docs/superpowers/plans/2026-05-08-gmp-erp-mes-platform-implementation.md`
- `docs/superpowers/plans/pilot-go-no-go-checklist.md`

## Сводка статусов

- GO: 0
- PARTIAL: 8
- NO-GO: 7

Итог по правилу из чеклиста: **NO-GO для старта разработки** (в критичных пунктах 1-10 нет полного закрытия, подтверждающих проектных/технических артефактов недостаточно).

## Детальная оценка 1-15

1. **Конфигурируемая модель сайта и процессов** — **PARTIAL**  
   Есть архитектурный принцип про конфигурируемый site PQS/SMK map в implementation plan, но нет ERD и конфигурационной спецификации.

2. **Единое GMP-ядро прав доступа (RBAC)** — **NO-GO**  
   Роли перечислены концептуально, но отсутствуют RBAC matrix и правила авторизации уровня системы.

3. **Electronic Signature как платформенный сервис** — **NO-GO**  
   Требования к e-signature описаны, но нет политики, дизайна сервиса и тестовых сценариев.

4. **Audit Trail как immutable слой** — **NO-GO**  
   Требования есть в матрице, но нет audit trail спецификации и тестов неизменяемости/негативных кейсов.

5. **Workflow Engine (конфигурируемый)** — **PARTIAL**  
   В плане заложен workflow-подход, но нет модели workflow definition/instance и примеров конфигов.

6. **Канонические статусы качества** — **PARTIAL**  
   Статусы и правила переходов отражены на уровне требований, но отсутствует формальный state model.

7. **Batch/Lot traceability end-to-end** — **PARTIAL**  
   Цепочка трассировки задекларирована в плане релизов, но нет фактического data design и отчетных спецификаций.

8. **EBR как шаблонный движок шагов** — **PARTIAL**  
   Есть детальный scope step types и gates, но нет технической спецификации EBR template engine.

9. **Разделение master data и transactional data** — **NO-GO**  
   Нет ERD/архитектурного документа с явным разделением и версионированием master data.

10. **Версионирование SOP/форм и привязка к исполнению** — **PARTIAL**  
    Документ-контроль и versioning описаны, но отсутствует модель привязки версии документа к транзакции исполнения.

11. **URS -> FRS -> Test Traceability Matrix** — **NO-GO**  
    URS/FRS/TM в папке не обнаружены.

12. **Data Integrity и correction model (ALCOA+)** — **PARTIAL**  
    В matrix есть требования по correction/late entry, но нет формализованной DI-спецификации и тест-набора.

13. **Integration contract-first** — **NO-GO**  
    Нет API/event contracts и контрактных тестов межмодульной интеграции.

14. **Migration and reference data strategy** — **NO-GO**  
    Нет migration playbook и dry-run протоколов загрузки справочников/остатков/документов.

15. **Operability (backup/restore/monitoring/periodic review)** — **NO-GO**  
    Нет операционных SOP/инструкций и подтвержденного restore-test.

## Что уже хорошо (факт)

- Сильная база требований по SOP и процессам.
- Есть пилотная SOP-to-system matrix для vertical slice.
- Есть поэтапный implementation plan по релизам.

## Что критично закрыть до старта кодинга (в порядке очереди)

1. URS v0.1 (pilot vertical slice).
2. FRS v0.1 (ядро + pilot flow).
3. Traceability Matrix v0.1 (URS->FRS->Tests).
4. Data model draft (ERD core objects + связи).
5. RBAC matrix.
6. e-signature policy.
7. audit trail specification.
8. Workflow model + 3 конфигурируемых workflow-сценария.
9. Migration playbook v0.1.
10. Operability baseline (backup/restore/access/change/periodic review).

## Решение на сегодня

- **Кодинг полного решения начинать рано.**
- **Разрешенный старт:** Discovery/Design/Validation stream (подготовка перечисленных 10 артефактов).  
- После закрытия пунктов 1-10 чеклиста (критичные) можно безопасно стартовать разработку пилота без риска rewrite на full версии.
