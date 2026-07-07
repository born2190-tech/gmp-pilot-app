import { useEffect, useMemo, useState } from 'react'
import { ArrowUpDown, Boxes, MapPin } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { listFgMarkings, listLots, listMovements, moveFgToStorage } from '../../lib/api'
import { translatedLocation } from '../../lib/display'
import { useI18n } from '../../i18n/I18nProvider'
import { MovementTypeBadge, formatShortDateTime } from './_registry/atoms'
import type { FGMarkingItem, LotItem, MovementItem } from '../../types/inventory'
import type { CurrentUser } from '../../types/auth'

interface FGRegistryPageProps {
  token: string
  user: CurrentUser
}

type Tab = 'series' | 'movements'

const LOCATION_PILL: Record<string, string> = {
  RECEIVING: 'bg-slate-100 text-slate-700 ring-slate-200',
  QUARANTINE: 'bg-amber-50 text-amber-800 ring-amber-200',
  RELEASED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-800 ring-rose-200',
}

function formatDate(value: string | null, locale: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

function daysToExpiry(expiry: string): number {
  return Math.floor((new Date(expiry).getTime() - Date.now()) / 86_400_000)
}

export function FGRegistryPage({ token, user }: FGRegistryPageProps) {
  const { locale, t } = useI18n()
  const canMove = user.permissions.includes('RECEIVE_FINISHED_GOODS')

  const [tab, setTab] = useState<Tab>('series')
  const [lots, setLots] = useState<LotItem[]>([])
  const [movements, setMovements] = useState<MovementItem[]>([])
  const [markings, setMarkings] = useState<Record<string, FGMarkingItem>>({})
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const [lotsResponse, movementsResponse, markingsResponse] = await Promise.all([
        listLots(token),
        listMovements(token),
        listFgMarkings(token),
      ])
      const fg = lotsResponse.lots
        .filter((lot) => lot.warehouse_type === 'FG_WAREHOUSE')
        .sort((a, b) => new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()) // FEFO
      setLots(fg)
      const fgSerials = new Set(fg.map((lot) => lot.internal_lot))
      setMovements(
        movementsResponse.movements.filter(
          (m) => fgSerials.has(m.internal_lot) || m.document_type.startsWith('fg_'),
        ),
      )
      // Маркировка приходит по № серии = internal_lot партии ГП.
      setMarkings(Object.fromEntries(markingsResponse.markings.map((m) => [m.batch_no, m])))
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

  async function handleMove(lot: LotItem) {
    const password = window.prompt(t('fgRegistry.passwordPrompt'))
    if (!password) return
    setError(null)
    setSuccess(null)
    try {
      await moveFgToStorage(token, lot.id, {
        username: user.username,
        password,
        meaning: t('fgRegistry.moveMeaning'),
        reason: t('fgRegistry.moveMeaning'),
      })
      setSuccess(t('fgRegistry.moved'))
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgRegistry.actionFailed'))
    }
  }

  const stats = useMemo(() => {
    const s = { quarantine: 0, released: 0, rejected: 0, marked: 0 }
    for (const lot of lots) {
      if (lot.quality_status === 'released') s.released += 1
      else if (lot.quality_status === 'rejected') s.rejected += 1
      else s.quarantine += 1
      if (markings[lot.internal_lot]) s.marked += 1
    }
    return s
  }, [lots, markings])

  const seriesColumns = useMemo<ColumnDef<LotItem>[]>(
    () => [
      { accessorKey: 'internal_lot', header: t('fgRegistry.batch') },
      { accessorKey: 'material_name', header: t('fgRegistry.product') },
      {
        accessorKey: 'location_code',
        header: t('fgRegistry.zone'),
        cell: ({ row }) => (
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${LOCATION_PILL[row.original.location_code] ?? LOCATION_PILL.RECEIVING}`}>
            <MapPin size={11} /> {translatedLocation(row.original.location_code, t)}
          </span>
        ),
      },
      { accessorKey: 'quality_status', header: t('fgRegistry.status'), cell: ({ row }) => <StatusBadge status={row.original.quality_status} /> },
      { accessorKey: 'quantity', header: t('fgRegistry.quantity'), cell: ({ row }) => `${row.original.quantity} ${row.original.unit}` },
      {
        id: 'marking',
        header: t('fgRegistry.marking'),
        cell: ({ row }) => {
          const mk = markings[row.original.internal_lot]
          if (!mk) return <span className="text-slate-400">—</span>
          return (
            <div className="flex flex-col gap-0.5" title={mk.report_id ? `reportId: ${mk.report_id}` : undefined}>
              <span className="inline-flex w-fit items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                {t(`fgRegistry.mk.${mk.status}` as never)}
              </span>
              <span className="text-[11px] text-slate-500">
                {t('fgRegistry.mkCounts', { codes: String(mk.code_count ?? 0), boxes: String(mk.sscc_count) })}
              </span>
            </div>
          )
        },
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
          return parts.length ? parts.join(' / ') : '—'
        },
      },
      {
        id: 'actions',
        header: t('fgRegistry.actions'),
        cell: ({ row }) => {
          const lot = row.original
          // Допущенная партия ещё в зоне карантина → склад перемещает в хранение.
          if (canMove && lot.quality_status === 'released' && lot.location_code === 'QUARANTINE') {
            return (
              <button className="btn-primary px-2 py-1 text-[12px]" onClick={() => handleMove(lot)} type="button">
                {t('fgRegistry.move')}
              </button>
            )
          }
          return <span className="text-slate-400">—</span>
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, t, canMove, markings],
  )

  const movementsColumns = useMemo<ColumnDef<MovementItem>[]>(
    () => [
      { accessorKey: 'created_at', header: t('fgRegistry.mvDate'), cell: ({ row }) => formatShortDateTime(row.original.created_at, locale) },
      {
        accessorKey: 'movement_type',
        header: t('fgRegistry.mvType'),
        cell: ({ row }) => {
          const translated = t(`movementType.${row.original.movement_type.toUpperCase()}` as never)
          const label = translated.startsWith('movementType.') ? row.original.movement_type : translated
          return <MovementTypeBadge rawType={row.original.movement_type} label={label} />
        },
      },
      { accessorKey: 'document_type', header: t('fgRegistry.mvDoc') },
      {
        id: 'series',
        header: t('fgRegistry.mvSeries'),
        cell: ({ row }) => `${row.original.material_name} · ${row.original.internal_lot}`,
      },
      {
        accessorKey: 'quantity_delta',
        header: t('fgRegistry.mvDelta'),
        cell: ({ row }) => {
          const d = row.original.quantity_delta
          const tone = d < 0 ? 'text-rose-700' : d > 0 ? 'text-emerald-700' : 'text-slate-500'
          return <span className={`font-mono font-semibold ${tone}`}>{d > 0 ? '+' : ''}{d} {row.original.unit}</span>
        },
      },
      { accessorKey: 'quantity_after', header: t('fgRegistry.mvAfter'), cell: ({ row }) => `${row.original.quantity_after} ${row.original.unit}` },
      { accessorKey: 'reason', header: t('fgRegistry.mvReason'), cell: ({ row }) => row.original.reason || '—' },
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

      {(error || success) && <div className={error ? 'alert-error' : 'alert-success'}>{error || success}</div>}

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label={t('fgRegistry.zoneQuarantine')} tone="text-amber-700" value={stats.quarantine} />
        <StatTile label={t('fgRegistry.zoneReleased')} tone="text-emerald-700" value={stats.released} />
        <StatTile label={t('fgRegistry.zoneRejected')} tone="text-rose-700" value={stats.rejected} />
        <StatTile label={t('fgRegistry.marked')} tone="text-slate-900" value={stats.marked} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
          <TabButton active={tab === 'series'} icon={<Boxes size={14} />} label={t('fgRegistry.tabSeries')} onClick={() => setTab('series')} />
          <TabButton active={tab === 'movements'} icon={<ArrowUpDown size={14} />} label={t('fgRegistry.tabMovements')} onClick={() => setTab('movements')} />
        </div>
        <input autoComplete="off" className="input w-80" onChange={(event) => setFilter(event.target.value)} placeholder={t('movements.search')} value={filter} />
      </div>

      {tab === 'series' ? (
        <DataTable columns={seriesColumns} data={lots} emptyLabel={t('fgRegistry.empty')} globalFilter={filter} isLoading={isLoading} />
      ) : (
        <DataTable columns={movementsColumns} data={movements} emptyLabel={t('fgRegistry.movementsEmpty')} globalFilter={filter} isLoading={isLoading} />
      )}
    </div>
  )
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-medium transition ${
        active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {icon}
      {label}
    </button>
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
