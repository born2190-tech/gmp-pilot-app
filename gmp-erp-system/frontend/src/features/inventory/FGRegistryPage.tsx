import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { listLots } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import type { TranslationKey } from '../../i18n/translations'
import type { LotItem } from '../../types/inventory'

interface FGRegistryPageProps {
  token: string
}

function formatDate(value: string | null, locale: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

/** Дней до истечения срока годности (может быть отрицательным). */
function daysToExpiry(expiry: string): number {
  const ms = new Date(expiry).getTime() - Date.now()
  return Math.floor(ms / 86_400_000)
}

function zoneMeta(status: string): { key: TranslationKey; tone: string } {
  if (status === 'released') return { key: 'fgRegistry.zoneReleased', tone: 'bg-emerald-50 text-emerald-700' }
  if (status === 'rejected') return { key: 'fgRegistry.zoneRejected', tone: 'bg-rose-50 text-rose-700' }
  return { key: 'fgRegistry.zoneQuarantine', tone: 'bg-amber-50 text-amber-700' }
}

export function FGRegistryPage({ token }: FGRegistryPageProps) {
  const { locale, t } = useI18n()
  const [lots, setLots] = useState<LotItem[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const response = await listLots(token)
      // Реестр только по складу готовой продукции — своя витрина, отдельно
      // от сырьевого реестра.
      const fg = response.lots
        .filter((lot) => lot.warehouse_type === 'FG_WAREHOUSE')
        .sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()) // FEFO
      setLots(fg)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgRegistry.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const stats = useMemo(() => {
    const s = { quarantine: 0, released: 0, rejected: 0, packs: 0 }
    for (const lot of lots) {
      if (lot.quality_status === 'released') s.released += 1
      else if (lot.quality_status === 'rejected') s.rejected += 1
      else s.quarantine += 1
      s.packs += lot.quantity
    }
    return s
  }, [lots])

  const columns = useMemo<ColumnDef<LotItem>[]>(
    () => [
      { accessorKey: 'material_name', header: t('fgRegistry.product') },
      { accessorKey: 'internal_lot', header: t('fgRegistry.batch') },
      {
        accessorKey: 'quality_status',
        header: t('fgRegistry.zone'),
        cell: ({ row }) => {
          const meta = zoneMeta(row.original.quality_status)
          return <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${meta.tone}`}>{t(meta.key)}</span>
        },
      },
      {
        accessorKey: 'quantity',
        header: t('fgRegistry.quantity'),
        cell: ({ row }) => `${row.original.quantity} ${row.original.unit}`,
      },
      {
        accessorKey: 'expiry_date',
        header: t('fgRegistry.expiry'),
        cell: ({ row }) => {
          const days = daysToExpiry(row.original.expiry_date)
          const tone = days < 0 ? 'text-rose-600 font-semibold' : days < 90 ? 'text-amber-600 font-medium' : 'text-slate-700'
          return <span className={tone}>{formatDate(row.original.expiry_date, locale)}</span>
        },
      },
      {
        id: 'location',
        header: t('fgRegistry.location'),
        cell: ({ row }) => {
          const l = row.original
          const parts = [l.rack_no, l.sector_no, l.tier_no, l.place_no, l.pallet_no].filter(Boolean)
          return parts.length ? parts.join(' / ') : l.location_code
        },
      },
      { accessorKey: 'production_date', header: t('fgRegistry.productionDate'), cell: ({ row }) => formatDate(row.original.production_date, locale) },
    ],
    [locale, t],
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('fgRegistry.trace')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('fgRegistry.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('fgRegistry.subtitle')}</p>
        </div>
        <button className="btn-secondary" onClick={loadData} type="button">
          {t('common.refresh')}
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label={t('fgRegistry.zoneQuarantine')} tone="text-amber-700" value={stats.quarantine} />
        <StatTile label={t('fgRegistry.zoneReleased')} tone="text-emerald-700" value={stats.released} />
        <StatTile label={t('fgRegistry.zoneRejected')} tone="text-rose-700" value={stats.rejected} />
        <StatTile label={t('fgRegistry.totalPacks')} tone="text-slate-900" value={stats.packs} />
      </div>

      <div className="flex justify-end">
        <input autoComplete="off" className="input w-80" onChange={(event) => setFilter(event.target.value)} placeholder={t('movements.search')} value={filter} />
      </div>
      <DataTable columns={columns} data={lots} emptyLabel={t('fgRegistry.empty')} globalFilter={filter} isLoading={isLoading} />
    </div>
  )
}

function StatTile({ label, tone, value }: { label: string; tone: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[12px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  )
}
