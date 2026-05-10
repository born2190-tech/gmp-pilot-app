# Plant Profile Field Catalog (v1.0)

Назначение: быстрый и стандартизованный onboarding новой площадки без форка кода.

## Как использовать

- Копируй `plant_profile.template.yaml` в `plant_profile.<SITE>.yaml`.
- Заполняй поля в порядке `P0 -> P1 -> P2`.
- Валидация профиля должна пройти до UAT.

## P0 (обязательно до старта UAT)

| Section | Field | Required | Description |
|---|---|---|---|
| `meta` | `customer_name`, `site_name`, `country`, `timezone` | Yes | Идентификация площадки и локаль |
| `compliance.data_integrity` | all | Yes | Нельзя выключать базовые GMP-контроли |
| `plant_structure.warehouses` | `code`, `type`, `issue_policy` | Yes | Каркас многоскладского учета |
| `master_data` | `units`, `material_types`, `mandatory_material_fields` | Yes | Базовая нормализация справочников |
| `workflow.lot_fsm` | `states`, `transitions` | Yes | Формальная модель переходов |
| `workflow.blocking_rules` | all | Yes | Блокировки QA/production/training/equipment |
| `rbac.roles` | at least core roles | Yes | Роли и минимальные permissions |
| `signatures.require_e_sign_for` | list | Yes | Где обязательны e-sign |
| `acceptance_gate` | all | Yes | Критерии go-live |

## P1 (желательно для первой продуктивной итерации)

| Section | Field | Required | Description |
|---|---|---|---|
| `sod` | `enforce_same_user_qc_qa_block` | No | Включение server-side SoD |
| `notifications` | `channels`, `rules` | No | Пороги/получатели/уровни критичности |
| `reports` | `export_formats`, `templates` | No | Включение отчетов и выгрузок |
| `integrations.erp` | `enabled`, `mode`, `profile` | No | Профиль интеграции с ERP |

## P2 (масштабирование)

| Section | Field | Required | Description |
|---|---|---|---|
| `integrations.scanners` | `barcode_enabled`, `qr_enabled` | No | Скан-поток для склада |
| `feature_flags` | `mobile_warehouse`, `websocket_statuses` | No | Поэтапное включение каналов |
| `feature_flags` | `extension_pack_qr_batch` | No | Подключение отраслевого extension pack |

## Правила качества профиля

- Никаких клиентских отклонений в core-контролях (`audit`, `append-only`, `corrections with reason`).
- Любое ослабление блокирующего правила должно иметь явный риск-acceptance и QA approval.
- Все изменения профиля версионируются и проходят change-control.

## Минимальный onboarding-чеклист

- [ ] SOP register импортирован и сопоставлен с capability matrix.
- [ ] Plant Profile заполнен на P0 100%.
- [ ] Роли и e-sign маршруты согласованы QA/Production/Warehouse.
- [ ] FSM и блокирующие правила верифицированы на 3 сквозных сценариях.
- [ ] UAT пройден, P0-дефекты отсутствуют.
