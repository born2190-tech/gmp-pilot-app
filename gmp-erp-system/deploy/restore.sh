#!/usr/bin/env sh
# Восстановление PostgreSQL GMP ERP из дампа pg_dump -Fc (созданного сервисом
# db-backup). По умолчанию восстанавливает в ОТДЕЛЬНУЮ проверочную БД
# (drill) — чтобы не затереть рабочую. Боевое восстановление — только с --force
# и явным TARGET, при остановленном backend.
#
# Использование:
#   # 1) Drill (проверка, что бэкап восстановим) — безопасно:
#   sh deploy/restore.sh                         # последний дамп -> gmp_restore_check
#   sh deploy/restore.sh gmp_erp_20260604_170531.dump
#
#   # 2) Боевое восстановление (ОСТОРОЖНО, перезапишет данные):
#   #    остановите backend, затем:
#   sh deploy/restore.sh <dump> gmp_erp --force
#
# Переменные: POSTGRES_USER (gmp_user), PG_CONTAINER (gmp-erp-postgres),
# BACKUP_CONTAINER (gmp-erp-db-backup).
set -eu

PG_CONTAINER="${PG_CONTAINER:-gmp-erp-postgres}"
BACKUP_CONTAINER="${BACKUP_CONTAINER:-gmp-erp-db-backup}"
POSTGRES_USER="${POSTGRES_USER:-gmp_user}"

DUMP="${1:-}"
TARGET="${2:-gmp_restore_check}"
FORCE="${3:-}"

if [ -z "$DUMP" ]; then
  DUMP="$(docker exec "$BACKUP_CONTAINER" sh -c 'ls -1t /backups/gmp_erp_*.dump 2>/dev/null | head -1 | xargs -n1 basename')"
  [ -n "$DUMP" ] || { echo "Дампы не найдены в /backups"; exit 1; }
  echo "Выбран последний дамп: $DUMP"
fi

if [ "$TARGET" = "gmp_erp" ] && [ "$FORCE" != "--force" ]; then
  echo "ОТКАЗ: восстановление в рабочую БД gmp_erp требует --force и остановленного backend." >&2
  exit 2
fi

echo "Цель восстановления: БД '$TARGET' (контейнер $PG_CONTAINER)"

# Пересоздаём целевую БД (отдельными командами — DROP/CREATE не в транзакции).
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$TARGET\";"
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"$TARGET\" OWNER \"$POSTGRES_USER\";"

# Восстанавливаем из дампа (pg_restore запускаем из контейнера бэкапа — у него
# смонтирован том /backups и есть клиент pg_restore).
docker exec -e PGPASSWORD="${PGPASSWORD:-gmp_pass}" "$BACKUP_CONTAINER" \
  pg_restore -h "$PG_CONTAINER" -U "$POSTGRES_USER" -d "$TARGET" --no-owner --no-privileges "/backups/$DUMP"

echo "Готово. Сводка по восстановленной БД:"
docker exec "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$TARGET" -tAc \
  "SELECT 'materials='||count(*) FROM materials UNION ALL SELECT 'lots='||count(*) FROM lots UNION ALL SELECT 'audit_events='||count(*) FROM audit_events;"

if [ "$TARGET" = "gmp_restore_check" ]; then
  echo "Проверочная БД оставлена для инспекции. Удалить:"
  echo "  docker exec $PG_CONTAINER psql -U $POSTGRES_USER -d postgres -c 'DROP DATABASE gmp_restore_check;'"
fi
