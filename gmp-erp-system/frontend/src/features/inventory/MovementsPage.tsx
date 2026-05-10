import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { listMovements } from '../../lib/api'
import type { MovementItem } from '../../types/inventory'
import { useI18n } from '../../i18n/I18nProvider'

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function MovementsPage({ token }: { token: string }) {
  const { locale, t } = useI18n()
  const [movements, setMovements] = useState<MovementItem[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      try {
        const response = await listMovements(token)
        setMovements(response.movements)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('movements.loadFailed'))
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [token])

  const columns = useMemo<ColumnDef<MovementItem, unknown>[]>(
    () => [
      { accessorKey: 'created_at', header: t('movements.time'), cell: ({ row }) => formatDateTime(row.original.created_at, locale) },
      { accessorKey: 'movement_type', header: t('common.type') },
      { accessorKey: 'document_type', header: t('movements.document') },
      { accessorKey: 'internal_lot', header: t('movements.lot') },
      { accessorKey: 'material_code', header: t('lots.material') },
      {
        id: 'delta',
        header: t('movements.delta'),
        cell: ({ row }) => `${row.original.quantity_delta > 0 ? '+' : ''}${row.original.quantity_delta} ${row.original.unit}`,
      },
      {
        id: 'after',
        header: t('movements.qtyAfter'),
        cell: ({ row }) => `${row.original.quantity_after} ${row.original.unit}`,
      },
      { accessorKey: 'workstation_id', header: t('movements.workstation') },
      { accessorKey: 'reason', header: t('common.reason') },
    ],
    [locale, t],
  )

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('movements.register')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('movements.title')}</h1>
        </div>
        <input
          className="h-9 w-80 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-700"
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('movements.search')}
          value={filter}
        />
      </div>
      {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <DataTable columns={columns} data={movements} emptyLabel={t('movements.empty')} globalFilter={filter} isLoading={isLoading} />
    </section>
  )
}
