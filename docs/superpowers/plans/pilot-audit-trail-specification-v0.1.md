# Audit Trail Specification v0.1 (Pilot Vertical Slice)

Дата: 2026-05-10  
Статус: Draft for QA/IT approval  
Связь: URS-005, URS-006, URS-007, URS-009, URS-016, URS-022, URS-024

## 1. Цель

Определить единые требования к audit trail для GxP-значимых операций пилотного потока, включая корректировки данных, подписи, блокировки и release-решения.

## 2. Область охвата

В audit trail обязательно попадают:
- документы и их версии;
- controlled records и EBR шаги;
- quality status transitions;
- QC result entry/correction;
- QA release/block/reject;
- deviation link/closure события из EBR/QC;
- операции override;
- архивирование/удаление по retention policy.

## 3. Обязательные поля audit event

| Поле | Описание |
|---|---|
| `audit_event_id` | Уникальный идентификатор события |
| `timestamp_utc` | Серверное время события |
| `user_id` | Пользователь, совершивший действие |
| `role_at_time` | Роль пользователя на момент действия |
| `object_type` | Тип объекта (Document, Record, EBRStep, Lot, QARelease, Deviation...) |
| `object_id` | Идентификатор объекта |
| `action_type` | Create/Update/Delete/Approve/Reject/Release/Block/Sign/Override/Archive |
| `old_value` | Предыдущее значение (или null для Create) |
| `new_value` | Новое значение (или null для Delete) |
| `reason` | Причина изменения (обязательна для correction/override/block/reject) |
| `source` | Канал операции (UI/API/System task) |
| `correlation_id` | Идентификатор бизнес-транзакции/воркфлоу |

## 4. Классы событий и обязательность reason

- `Correction`: reason обязателен.
- `Retrospective entry`: reason обязателен + маркер retrospective.
- `Block/Reject`: reason обязателен.
- `Override`: reason обязателен + ссылка на approve event.
- `Status release`: reason опционален (если не требует SOP/политика).

## 5. Правила неизменяемости (immutability)

1. Audit event после записи не редактируется и не удаляется прикладными ролями.
2. Коррекция данных оформляется новой записью события, а не правкой прошлой.
3. Любая попытка изменения/удаления audit event системой администрирования требует отдельного специального протокола и фиксируется отдельным meta-audit слоем.
4. Экспорт отчета не должен менять содержимое audit trail.

## 6. Минимальные события по URS/FRS

| Бизнес-сценарий | События audit trail |
|---|---|
| Перевод SOP в effective | status change + approve/sign event |
| Коррекция QC результата | update old/new + reason + signature link |
| Late entry в EBR | create/update + retrospective marker + reason |
| QA release материала/партии | decision event + status transition + signature |
| Блокировка issue to production | validation fail/block event + user + reason |
| Запуск deviation из EBR | deviation create + link to batch/step |
| Закрытие batch record | completeness check pass + close/sign event |

## 7. Доступ к audit trail

- QA Manager: полный read/export доступ.
- Validation Lead: read доступ для верификации тестов/трассировки.
- IT/System Owner: read для расследований и поддержки.
- Процессные роли: ограниченный read по объектам своей зоны ответственности.

## 8. Retention и архив

- Audit trail хранится минимум в рамках retention периода соответствующих GxP-записей.
- Удаление событий до окончания retention запрещено.
- Архивирование должно сохранять полноту полей и читаемость old/new значений.

## 9. Минимальный набор тестов

- AT-T01: Create/Update/Approve фиксируют user/time/object/action.
- AT-T02: Correction фиксирует old/new + reason, без потери исходного значения.
- AT-T03: Retrospective entry без reason блокируется.
- AT-T04: Override без approve/sign link блокируется.
- AT-T05: Попытка удалить audit event прикладной ролью отклоняется.
- AT-T06: Экспорт audit report содержит полный набор обязательных полей.

## 10. Открытые решения

1. Формат и периодичность стандартных QA audit trail отчетов.
2. Нужно ли выделять отдельный неизменяемый storage-контур в пилоте или достаточно логической неизменяемости на уровне БД/приложения.
3. Требования к digital sealing/hash для экспортируемых отчетов на этапе пилота.
