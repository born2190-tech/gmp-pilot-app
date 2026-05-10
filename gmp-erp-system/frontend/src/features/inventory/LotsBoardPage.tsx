import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { listLots } from '../../lib/api'
import type { LotItem } from '../../types/inventory'
import { DataTable } from '../../components/table/DataTable'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useI18n } from '../../i18n/I18nProvider'

function formatDate(value: string | null, locale: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

interface LotsBoardPageProps {
  token: string
}

export function LotsBoardPage({ token }: LotsBoardPageProps) {
  const { locale, t } = useI18n()
  const [lots, setLots] = useState<LotItem[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      try {
        const response = await listLots(token)
        setLots(response.lots)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('lots.loadFailed'))
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [token])

  const columns = useMemo<ColumnDef<LotItem, unknown>[]>(
    () => [
      { accessorKey: 'internal_lot', header: t('lots.internalSeries') },
      { accessorKey: 'material_code', header: t('lots.material') },
      { accessorKey: 'manufacturer_name', header: t('lots.manufacturer') },
      { accessorKey: 'supplier_lot', header: t('lots.supplierLot') },
      { accessorKey: 'warehouse_type', header: t('lots.warehouse') },
      { accessorKey: 'location_code', header: t('lots.location') },
      {
        id: 'quantity',
        header: t('lots.qty'),
        cell: ({ row }) => `${row.original.quantity} ${row.original.unit}`,
      },
      {
        accessorKey: 'quality_status',
        header: t('common.status'),
        cell: ({ row }) => <StatusBadge status={row.original.quality_status} />,
      },
      { accessorKey: 'production_year', header: t('lots.productionYear') },
      { accessorKey: 'expiry_date', header: t('lots.expiry'), cell: ({ row }) => formatDate(row.original.expiry_date, locale) },
      {
        accessorKey: 'incoming_control_notified_at',
        header: t('lots.qcNotified'),
        cell: ({ row }) => formatDate(row.original.incoming_control_notified_at, locale),
      },
      {
        accessorKey: 'qc_result_received_at',
        header: t('lots.qcResult'),
        cell: ({ row }) => formatDate(row.original.qc_result_received_at, locale),
      },
    ],
    [locale, t],
  )

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('lots.register')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('lots.title')}</h1>
        </div>
        <input
          className="h-9 w-80 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-700"
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('lots.search')}
          value={filter}
        />
      </div>
      {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <DataTable columns={columns} data={lots} emptyLabel={t('lots.empty')} globalFilter={filter} isLoading={isLoading} />
    </section>
  )
}
