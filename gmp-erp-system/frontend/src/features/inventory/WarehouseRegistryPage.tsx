import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { listLots, listMovements } from '../../lib/api'
import { translatedLocation } from '../../lib/display'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useI18n } from '../../i18n/I18nProvider'
import type { LotItem, MovementItem } from '../../types/inventory'

type RegistryTab = 'series' | 'movements'
type DateType = 'arrival' | 'expiry' | 'operation'
type DatePreset = 'today' | 'week' | 'month' | 'quarter' | 'all'

interface RegistryFilters {
  dateType: DateType
  dateFrom: string
  dateTo: string
  material: string
  qualityStatus: string
  location: string
  manufacturer: string
  internalLot: string
  document: string
  movementType: string
  search: string
}

interface WarehouseRegistryPageProps {
  token: string
}

const DEFAULT_FILTERS: RegistryFilters = {
  dateType: 'arrival',
  dateFrom: '',
  dateTo: '',
  material: '',
  qualityStatus: '',
  location: '',
  manufacturer: '',
  internalLot: '',
  document: '',
  movementType: '',
  search: '',
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(value: string | null, locale: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

function formatSeries(value: string) {
  const series = String(value || '').trim()
  return series || '-'
}

function movementTypeToTranslationKey(movementType: string) {
  return `movementType.${movementType.toUpperCase()}`
}

const MOVEMENT_TYPE_STYLES: Record<string, { icon: string; bg: string; text: string; border: string }> = {
  RECEIPT:           { icon: '↓', bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  SHIPMENT:          { icon: '↑', bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200'   },
  TRANSFER:          { icon: '⇆', bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200'  },
  ADJUSTMENT:        { icon: '△', bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  ISSUE_PRODUCTION:  { icon: '↑', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200'},
  INVENTORY_COUNT:   { icon: '≡', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200'},
  RETURN:            { icon: '↩', bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200'},
}

function MovementTypeBadge({ rawType, label }: { rawType: string; label: string }) {
  const key = rawType.toUpperCase()
  const style = MOVEMENT_TYPE_STYLES[key] ?? { icon: '•', bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${style.bg} ${style.text} ${style.border}`}>
      <span className="text-sm leading-none">{style.icon}</span>
      {label}
    </span>
  )
}

export function WarehouseRegistryPage({ token }: WarehouseRegistryPageProps) {
  const { locale, t } = useI18n()
  const [activeTab, setActiveTab] = useState<RegistryTab>('series')
  const [lots, setLots] = useState<LotItem[]>([])
  const [movements, setMovements] = useState<MovementItem[]>([])
  const [filtersDraft, setFiltersDraft] = useState<RegistryFilters>(DEFAULT_FILTERS)
  const [filtersVisible, setFiltersVisible] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void applyFilters(DEFAULT_FILTERS)
  }, [token])

  useEffect(() => {
    if (activeTab === 'movements') {
      setFiltersDraft((current) => ({ ...current, dateType: 'operation' }))
    }
  }, [activeTab])

  async function applyFilters(next: RegistryFilters) {
    setIsLoading(true)
    setError(null)
    try {
      const lotsDateType = next.dateType === 'expiry' ? 'expiry' : 'arrival'
      const [lotsResponse, movementsResponse] = await Promise.all([
        listLots(token, {
          date_type: lotsDateType,
          date_from: next.dateFrom || undefined,
          date_to: next.dateTo || undefined,
          material: next.material || undefined,
          quality_status: next.qualityStatus || undefined,
          location: next.location || undefined,
          manufacturer: next.manufacturer || undefined,
          internal_lot: next.internalLot || undefined,
          supplier_lot: next.internalLot || undefined,
          search: next.search || undefined,
        }),
        listMovements(token, {
          date_from: next.dateFrom || undefined,
          date_to: next.dateTo || undefined,
          material: next.material || undefined,
          internal_lot: next.internalLot || undefined,
          supplier_lot: next.internalLot || undefined,
          document: next.document || undefined,
          movement_type: next.movementType || undefined,
          search: next.search || undefined,
        }),
      ])
      setLots(lotsResponse.lots)
      setMovements(movementsResponse.movements)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('registry.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const lotColumns = useMemo<ColumnDef<LotItem, unknown>[]>(
    () => [
      {
        accessorKey: 'internal_lot',
        header: t('registry.internalLot'),
        cell: ({ row }) => formatSeries(row.original.internal_lot),
      },
      {
        id: 'material',
        header: t('registry.material'),
        cell: ({ row }) => `${row.original.material_code} · ${row.original.material_name}`,
      },
      { accessorKey: 'manufacturer_name', header: t('registry.manufacturer') },
      {
        accessorKey: 'location_code',
        header: t('registry.location'),
        cell: ({ row }) => translatedLocation(row.original.location_code, t),
      },
      {
        id: 'qty',
        header: t('registry.qty'),
        cell: ({ row }) => `${row.original.quantity} ${row.original.unit}`,
      },
      {
        accessorKey: 'quality_status',
        header: t('registry.qualityStatus'),
        cell: ({ row }) => <StatusBadge status={row.original.quality_status} />,
      },
      {
        accessorKey: 'incoming_control_notified_at',
        header: t('registry.arrivalDate'),
        cell: ({ row }) => formatDate(row.original.incoming_control_notified_at, locale),
      },
      {
        accessorKey: 'expiry_date',
        header: t('registry.expiryDate'),
        cell: ({ row }) => formatDate(row.original.expiry_date, locale),
      },
      {
        accessorKey: 'qc_result_received_at',
        header: t('registry.qcNotification'),
        cell: ({ row }) => (row.original.incoming_control_notified_at ? formatDate(row.original.incoming_control_notified_at, locale) : '-'),
      },
    ],
    [locale, t],
  )

  const movementColumns = useMemo<ColumnDef<MovementItem, unknown>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('registry.operationDate'),
        cell: ({ row }) => formatDateTime(row.original.created_at, locale),
      },
      {
        accessorKey: 'movement_type',
        header: t('registry.movementType'),
        cell: ({ row }) => {
          const rawType = row.original.movement_type
          const translationKey = movementTypeToTranslationKey(rawType)
          const localized = t(translationKey as never)
          const label = localized.startsWith('movementType.') ? rawType : localized
          return <MovementTypeBadge rawType={rawType} label={label} />
        },
      },
      {
        id: 'document',
        header: t('registry.document'),
        cell: ({ row }) => `${row.original.document_type} · ${row.original.document_id.slice(0, 8)}`,
      },
      {
        accessorKey: 'material_name',
        header: t('common.name'),
        cell: ({ row }) => row.original.material_name?.trim() || '-',
      },
      {
        accessorKey: 'internal_lot',
        header: t('registry.internalLot'),
        cell: ({ row }) => formatSeries(row.original.internal_lot),
      },
      { accessorKey: 'material_code', header: t('common.code') },
      {
        id: 'delta',
        header: t('registry.delta'),
        cell: ({ row }) => `${row.original.quantity_delta > 0 ? '+' : ''}${row.original.quantity_delta} ${row.original.unit}`,
      },
      {
        id: 'after',
        header: t('registry.qtyAfter'),
        cell: ({ row }) => `${row.original.quantity_after} ${row.original.unit}`,
      },
      { accessorKey: 'reason', header: t('registry.reason') },
      { accessorKey: 'workstation_id', header: t('registry.workstation') },
    ],
    [locale, t],
  )

  const qualityStatuses = useMemo(() => uniqueValues(lots.map((lot) => lot.quality_status)), [lots])
  const movementTypes = useMemo(() => uniqueValues(movements.map((movement) => movement.movement_type)), [movements])

  function applyPreset(preset: DatePreset) {
    const today = new Date()
    if (preset === 'all') {
      setFiltersDraft((current) => ({ ...current, dateFrom: '', dateTo: '' }))
      return
    }

    if (preset === 'today') {
      const value = toDateInputValue(today)
      setFiltersDraft((current) => ({ ...current, dateFrom: value, dateTo: value }))
      return
    }

    if (preset === 'week') {
      const day = today.getDay() === 0 ? 7 : today.getDay()
      const weekStart = new Date(today)
      weekStart.setDate(today.getDate() - day + 1)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 6)
      setFiltersDraft((current) => ({ ...current, dateFrom: toDateInputValue(weekStart), dateTo: toDateInputValue(weekEnd) }))
      return
    }

    if (preset === 'month') {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      setFiltersDraft((current) => ({ ...current, dateFrom: toDateInputValue(monthStart), dateTo: toDateInputValue(monthEnd) }))
      return
    }

    const quarter = Math.floor(today.getMonth() / 3)
    const quarterStart = new Date(today.getFullYear(), quarter * 3, 1)
    const quarterEnd = new Date(today.getFullYear(), quarter * 3 + 3, 0)
    setFiltersDraft((current) => ({ ...current, dateFrom: toDateInputValue(quarterStart), dateTo: toDateInputValue(quarterEnd) }))
  }

  return (
    <section className="space-y-4">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('registry.kicker')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('registry.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          {(() => {
            const activeCount = [
              filtersDraft.material, filtersDraft.location, filtersDraft.internalLot,
              filtersDraft.document, filtersDraft.movementType, filtersDraft.qualityStatus,
              filtersDraft.manufacturer, filtersDraft.search, filtersDraft.dateFrom, filtersDraft.dateTo,
            ].filter(Boolean).length
            return activeCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                {activeCount} фильтр{activeCount >= 5 ? 'ов' : activeCount >= 2 ? 'а' : ''}
              </span>
            ) : null
          })()}
          <button
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            onClick={() => setFiltersVisible((v) => !v)}
            type="button"
          >
            {filtersVisible ? '▲ Скрыть фильтры' : '▼ Фильтры'}
          </button>
        </div>
      </div>

      {filtersVisible && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button className="mode-button" onClick={() => applyPreset('today')} type="button">{t('registry.periodToday')}</button>
            <button className="mode-button" onClick={() => applyPreset('week')} type="button">{t('registry.periodWeek')}</button>
            <button className="mode-button" onClick={() => applyPreset('month')} type="button">{t('registry.periodMonth')}</button>
            <button className="mode-button" onClick={() => applyPreset('quarter')} type="button">{t('registry.periodQuarter')}</button>
            <button className="mode-button" onClick={() => applyPreset('all')} type="button">{t('registry.periodAll')}</button>
          </div>

          <div className="grid gap-3 xl:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">
            {t('registry.dateType')}
            <select className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, dateType: event.target.value as DateType }))} value={filtersDraft.dateType}>
              {activeTab === 'series' ? (
                <>
                  <option value="arrival">{t('registry.arrivalDate')}</option>
                  <option value="expiry">{t('registry.expiryDate')}</option>
                </>
              ) : (
                <option value="operation">{t('registry.operationDate')}</option>
              )}
            </select>
          </label>

          <label className="text-sm font-medium text-slate-700">
            {t('registry.dateFrom')}
            <input className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, dateFrom: event.target.value }))} type="date" value={filtersDraft.dateFrom} />
          </label>

          <label className="text-sm font-medium text-slate-700">
            {t('registry.dateTo')}
            <input className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, dateTo: event.target.value }))} type="date" value={filtersDraft.dateTo} />
          </label>

          <label className="text-sm font-medium text-slate-700">
            {t('registry.search')}
            <input className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, search: event.target.value }))} placeholder={t('registry.searchPlaceholder')} value={filtersDraft.search} />
          </label>

          <label className="text-sm font-medium text-slate-700">
            {t('registry.material')}
            <input className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, material: event.target.value }))} value={filtersDraft.material} />
          </label>

          {activeTab === 'series' && (
            <label className="text-sm font-medium text-slate-700">
              {t('registry.qualityStatus')}
              <select className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, qualityStatus: event.target.value }))} value={filtersDraft.qualityStatus}>
                <option value="">{t('registry.all')}</option>
                {qualityStatuses.map((status) => (
                  <option key={status} value={status}>{t(`status.${status}` as never)}</option>
                ))}
              </select>
            </label>
          )}

          <label className="text-sm font-medium text-slate-700">
            {t('registry.location')}
            <input className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, location: event.target.value }))} value={filtersDraft.location} />
          </label>

          {activeTab === 'series' && (
            <label className="text-sm font-medium text-slate-700">
              {t('registry.manufacturer')}
              <input className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, manufacturer: event.target.value }))} value={filtersDraft.manufacturer} />
            </label>
          )}

          <label className="text-sm font-medium text-slate-700">
            {t('registry.internalLot')}
            <input className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, internalLot: event.target.value }))} value={filtersDraft.internalLot} />
          </label>

          {activeTab === 'movements' && (
            <>
              <label className="text-sm font-medium text-slate-700">
                {t('registry.document')}
                <input className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, document: event.target.value }))} value={filtersDraft.document} />
              </label>

              <label className="text-sm font-medium text-slate-700">
                {t('registry.movementType')}
                <select className="input mt-1" onChange={(event) => setFiltersDraft((current) => ({ ...current, movementType: event.target.value }))} value={filtersDraft.movementType}>
                  <option value="">{t('registry.all')}</option>
                  {movementTypes.map((movementType) => (
                      <option key={movementType} value={movementType}>
                        {(() => {
                          const translationKey = movementTypeToTranslationKey(movementType)
                          const localized = t(translationKey as never)
                          return localized.startsWith('movementType.') ? movementType : localized
                        })()}
                      </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <button className="mode-button mode-button-active" onClick={() => void applyFilters(filtersDraft)} type="button">{t('registry.apply')}</button>
          <button className="mode-button" onClick={() => {
            const reset = activeTab === 'series' ? { ...DEFAULT_FILTERS, dateType: 'arrival' as DateType } : { ...DEFAULT_FILTERS, dateType: 'operation' as DateType }
            setFiltersDraft(reset)
            void applyFilters(reset)
          }} type="button">{t('registry.reset')}</button>
        </div>
      </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <div className="flex gap-2 border-b border-slate-200 px-2 pb-2">
          <button className={activeTab === 'series' ? 'mode-button mode-button-active' : 'mode-button'} onClick={() => setActiveTab('series')} type="button">{t('registry.tabSeries')}</button>
          <button className={activeTab === 'movements' ? 'mode-button mode-button-active' : 'mode-button'} onClick={() => setActiveTab('movements')} type="button">{t('registry.tabMovements')}</button>
        </div>
        <div className="p-2">
          {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {activeTab === 'series' ? (
            <DataTable columns={lotColumns} data={lots} emptyLabel={t('registry.emptySeries')} isLoading={isLoading} />
          ) : (
            <DataTable columns={movementColumns} data={movements} emptyLabel={t('registry.emptyMovements')} isLoading={isLoading} />
          )}
        </div>
      </div>
    </section>
  )
}
