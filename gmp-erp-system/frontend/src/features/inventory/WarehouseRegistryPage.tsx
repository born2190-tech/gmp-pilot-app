import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpDown,
  Boxes,
  CalendarClock,
  CalendarRange,
  FileDown,
  FlaskConical,
  Inbox,
  MapPin,
  RotateCcw,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { downloadLotLedgerCardPdf, listLots, listMovements } from '../../lib/api'
import { translatedLocation } from '../../lib/display'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useI18n } from '../../i18n/I18nProvider'
import type { LotItem, MovementItem } from '../../types/inventory'
import {
  Chip,
  KpiTile,
  MovementTypeBadge,
  SegmentedControl,
  SortHeader,
  daysLeft,
  dateCompare,
  formatDate,
  formatDateTime,
  formatShortDateTime,
  numCompare,
  ruCompare,
  toDateInputValue,
  useEscape,
  useSort,
  type SortState,
} from './_registry/atoms'

type Tab = 'series' | 'movements'
type DateType = 'arrival' | 'expiry' | 'operation'
type DatePreset = 'today' | 'week' | 'month' | 'quarter' | 'all' | null
type KpiKey = 'active' | 'pending' | 'expiring'

interface RegistryFilters {
  material: string
  location: string
  qualityStatus: string
  manufacturer: string
  document: string
  movementType: string
}

const EMPTY_FILTERS: RegistryFilters = {
  material: '',
  location: '',
  qualityStatus: '',
  manufacturer: '',
  document: '',
  movementType: '',
}

const PRESET_KEYS: Exclude<DatePreset, null>[] = ['today', 'week', 'month', 'quarter', 'all']

interface WarehouseRegistryPageProps {
  token: string
}

function movementKey(rawType: string): string {
  return `movementType.${rawType.toUpperCase()}`
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => ruCompare(a, b))
}

// Format the physical coordinate (rack/sector/tier/place/pallet) as one line.
// Only includes filled segments. Returns '' if all segments are empty.
function formatPhysAddr(lot: LotItem): string {
  const parts: string[] = []
  if (lot.rack_no)   parts.push(lot.rack_no)
  if (lot.sector_no) parts.push(`С.${lot.sector_no}`)
  if (lot.tier_no)   parts.push(`Я.${lot.tier_no}`)
  if (lot.place_no)  parts.push(`М.${lot.place_no}`)
  if (lot.pallet_no) parts.push(`П.${lot.pallet_no}`)
  return parts.join(' · ')
}

function physAddrTooltip(lot: LotItem, t: Translate): string {
  const bits: string[] = []
  if (lot.rack_no)   bits.push(`${t('warehouseOps.rackNo')} ${lot.rack_no}`)
  if (lot.sector_no) bits.push(`${t('warehouseOps.sectorNo')} ${lot.sector_no}`)
  if (lot.tier_no)   bits.push(`${t('warehouseOps.tierNo')} ${lot.tier_no}`)
  if (lot.place_no)  bits.push(`${t('warehouseOps.placeNo')} ${lot.place_no}`)
  if (lot.pallet_no) bits.push(`${t('warehouseOps.palletNo')} ${lot.pallet_no}`)
  return bits.join(' / ')
}

// Full-label list for the lot detail panel — uses the same labels as the
// short version above ("Стеллаж", "Сектор", …) so it's never abbreviated.
function formatPhysAddrFull(lot: LotItem, t: Translate): string {
  const bits: string[] = []
  if (lot.rack_no)   bits.push(`${t('warehouseOps.rackNo')} ${lot.rack_no}`)
  if (lot.sector_no) bits.push(`${t('warehouseOps.sectorNo')} ${lot.sector_no}`)
  if (lot.tier_no)   bits.push(`${t('warehouseOps.tierNo')} ${lot.tier_no}`)
  if (lot.place_no)  bits.push(`${t('warehouseOps.placeNo')} ${lot.place_no}`)
  if (lot.pallet_no) bits.push(`${t('warehouseOps.palletNo')} ${lot.pallet_no}`)
  return bits.join(' · ')
}

const LOCATION_PILL: Record<string, string> = {
  RECEIVING:  'bg-slate-100 text-slate-700 ring-slate-200',
  QUARANTINE: 'bg-amber-50 text-amber-800 ring-amber-200',
  RELEASED:   'bg-emerald-50 text-emerald-800 ring-emerald-200',
  REJECTED:   'bg-rose-50 text-rose-800 ring-rose-200',
}

function countActiveAdv(f: RegistryFilters): number {
  return [f.material, f.location, f.qualityStatus, f.manufacturer, f.document, f.movementType].filter(Boolean).length
}

export function WarehouseRegistryPage({ token }: WarehouseRegistryPageProps) {
  const { locale, t } = useI18n()

  // Core state
  const [tab, setTab] = useState<Tab>('series')
  const [search, setSearch] = useState('')
  const [dateType, setDateType] = useState<DateType>('arrival')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [filters, setFilters] = useState<RegistryFilters>(EMPTY_FILTERS)
  const [draft, setDraft] = useState<RegistryFilters>(EMPTY_FILTERS)
  const [advOpen, setAdvOpen] = useState(false)
  const [kpi, setKpi] = useState<KpiKey | null>(null)
  const [selectedLot, setSelectedLot] = useState<LotItem | null>(null)

  // Data
  const [lots, setLots] = useState<LotItem[]>([])
  const [movements, setMovements] = useState<MovementItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Sort
  const seriesSortCtl = useSort({ key: 'internal_lot', dir: 'desc' })
  const movementsSortCtl = useSort({ key: 'created_at', dir: 'desc' })

  useEscape(() => setSelectedLot(null))

  // When switching tabs, normalize dateType (operation only valid on movements)
  useEffect(() => {
    if (tab === 'movements') setDateType('operation')
    else if (dateType === 'operation') setDateType('arrival')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Fetch
  async function fetchAll() {
    setIsLoading(true)
    setError(null)
    try {
      const lotsDateType: 'arrival' | 'expiry' = dateType === 'expiry' ? 'expiry' : 'arrival'
      const [lotsResponse, movementsResponse] = await Promise.all([
        listLots(token, {
          date_type: lotsDateType,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          material: filters.material || undefined,
          quality_status: filters.qualityStatus || undefined,
          location: filters.location || undefined,
          manufacturer: filters.manufacturer || undefined,
          search: search || undefined,
        }),
        listMovements(token, {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          material: filters.material || undefined,
          document: filters.document || undefined,
          movement_type: filters.movementType || undefined,
          search: search || undefined,
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

  useEffect(() => {
    void fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    void fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters, dateFrom, dateTo, dateType])

  // Derived KPI numbers (on full lots set)
  const kpiActive = useMemo(() => {
    const released = lots.filter((lot) => lot.quality_status === 'released')
    return {
      count: released.length,
      qty: released.reduce((sum, lot) => sum + (lot.quantity || 0), 0),
    }
  }, [lots])

  const kpiPending = useMemo(
    () => lots.filter((lot) => ['quarantine', 'sampled', 'under_test'].includes(lot.quality_status)).length,
    [lots],
  )

  const kpiExpiring = useMemo(
    () =>
      lots.filter((lot) => {
        const left = daysLeft(lot.expiry_date)
        return left !== null && left >= 0 && left <= 30
      }).length,
    [lots],
  )

  // Sort + KPI filter applied client-side on top of backend filtering
  const visibleLots = useMemo(() => {
    let rows = lots
    if (kpi === 'pending') rows = rows.filter((lot) => ['quarantine', 'sampled', 'under_test'].includes(lot.quality_status))
    if (kpi === 'expiring')
      rows = rows.filter((lot) => {
        const left = daysLeft(lot.expiry_date)
        return left !== null && left >= 0 && left <= 30
      })
    if (kpi === 'active') rows = rows.filter((lot) => lot.quality_status === 'released')
    return [...rows].sort((a, b) => compareLot(a, b, seriesSortCtl.sort))
  }, [lots, kpi, seriesSortCtl.sort])

  const visibleMovements = useMemo(
    () => [...movements].sort((a, b) => compareMovement(a, b, movementsSortCtl.sort)),
    [movements, movementsSortCtl.sort],
  )

  function applyPreset(preset: Exclude<DatePreset, null>) {
    setDatePreset(preset)
    const today = new Date()
    if (preset === 'all') {
      setDateFrom('')
      setDateTo('')
      return
    }
    if (preset === 'today') {
      const value = toDateInputValue(today)
      setDateFrom(value)
      setDateTo(value)
      return
    }
    if (preset === 'week') {
      const day = today.getDay() === 0 ? 7 : today.getDay()
      const ws = new Date(today)
      ws.setDate(today.getDate() - day + 1)
      const we = new Date(ws)
      we.setDate(ws.getDate() + 6)
      setDateFrom(toDateInputValue(ws))
      setDateTo(toDateInputValue(we))
      return
    }
    if (preset === 'month') {
      setDateFrom(toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)))
      setDateTo(toDateInputValue(new Date(today.getFullYear(), today.getMonth() + 1, 0)))
      return
    }
    const q = Math.floor(today.getMonth() / 3)
    setDateFrom(toDateInputValue(new Date(today.getFullYear(), q * 3, 1)))
    setDateTo(toDateInputValue(new Date(today.getFullYear(), q * 3 + 3, 0)))
  }

  function resetAll() {
    setSearch('')
    setFilters(EMPTY_FILTERS)
    setDraft(EMPTY_FILTERS)
    setKpi(null)
    setDateFrom('')
    setDateTo('')
    setDatePreset('all')
  }

  const advCount = countActiveAdv(filters)
  const hasSearchOrFilters = search.length > 0 || advCount > 0 || kpi !== null || Boolean(dateFrom || dateTo)
  const isEmptyResult = tab === 'series' ? visibleLots.length === 0 : visibleMovements.length === 0

  const qualityStatusOptions = useMemo(() => uniqueValues(lots.map((lot) => lot.quality_status)), [lots])
  const movementTypeOptions = useMemo(() => uniqueValues(movements.map((m) => m.movement_type)), [movements])

  return (
    <section className="space-y-4">
      {/* Header + KPI tiles */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{t('registry.kicker')}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">{t('registry.title')}</h1>
          <p className="max-w-2xl text-sm text-slate-600">{t('registry.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <KpiTile
            icon={Boxes}
            accent="bg-slate-100 text-slate-700"
            label={t('registry.kpiActive')}
            value={kpiActive.count}
            sub={t('registry.kpiActiveSub', { qty: kpiActive.qty.toLocaleString(locale) })}
            active={kpi === 'active'}
            onClick={() => setKpi(kpi === 'active' ? null : 'active')}
          />
          <KpiTile
            icon={FlaskConical}
            accent="bg-amber-50 text-amber-700"
            label={t('registry.kpiPending')}
            value={kpiPending}
            sub={t('registry.kpiPendingSub')}
            active={kpi === 'pending'}
            onClick={() => setKpi(kpi === 'pending' ? null : 'pending')}
          />
          <KpiTile
            icon={CalendarClock}
            accent="bg-rose-50 text-rose-700"
            label={t('registry.kpiExpiring')}
            value={kpiExpiring}
            sub={t('registry.kpiExpiringSub')}
            active={kpi === 'expiring'}
            onClick={() => setKpi(kpi === 'expiring' ? null : 'expiring')}
          />
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search + Tabs + Refine */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
        <div className="relative min-w-[280px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('registry.searchPlaceholder')}
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <SegmentedControl<Tab>
          options={[
            { value: 'series', label: t('registry.tabSeries'), icon: Boxes },
            { value: 'movements', label: t('registry.tabMovements'), icon: ArrowUpDown },
          ]}
          value={tab}
          onChange={(value) => {
            setTab(value)
            setSelectedLot(null)
          }}
        />

        <button
          type="button"
          onClick={() => setAdvOpen((current) => !current)}
          className={`inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition ${
            advOpen ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal size={14} />
          {t('registry.refine')}
          {advCount > 0 && (
            <span
              className={`ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 font-mono text-[11px] font-semibold ${
                advOpen ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'
              }`}
            >
              {advCount}
            </span>
          )}
        </button>
      </div>

      {/* Advanced filters */}
      {advOpen && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <FilterGroup title={t('registry.groupMaterial')}>
              <FilterInput
                label={t('registry.material')}
                value={draft.material}
                onChange={(value) => setDraft((current) => ({ ...current, material: value }))}
              />
              {tab === 'series' && (
                <FilterInput
                  label={t('registry.manufacturer')}
                  value={draft.manufacturer}
                  onChange={(value) => setDraft((current) => ({ ...current, manufacturer: value }))}
                />
              )}
            </FilterGroup>

            {tab === 'series' && (
              <FilterGroup title={t('registry.groupState')}>
                <FilterSelect
                  label={t('registry.qualityStatus')}
                  value={draft.qualityStatus}
                  onChange={(value) => setDraft((current) => ({ ...current, qualityStatus: value }))}
                  options={[
                    { value: '', label: t('registry.all') },
                    ...qualityStatusOptions.map((status) => ({
                      value: status,
                      label: t(`status.${status}` as never),
                    })),
                  ]}
                />
                <FilterInput
                  label={t('registry.location')}
                  value={draft.location}
                  onChange={(value) => setDraft((current) => ({ ...current, location: value }))}
                />
              </FilterGroup>
            )}

            {tab === 'movements' && (
              <FilterGroup title={t('registry.groupDocument')}>
                <FilterSelect
                  label={t('registry.movementType')}
                  value={draft.movementType}
                  onChange={(value) => setDraft((current) => ({ ...current, movementType: value }))}
                  options={[
                    { value: '', label: t('registry.all') },
                    ...movementTypeOptions.map((type) => {
                      const translated = t(movementKey(type) as never)
                      return { value: type, label: translated.startsWith('movementType.') ? type : translated }
                    }),
                  ]}
                />
                <FilterInput
                  label={t('registry.document')}
                  value={draft.document}
                  onChange={(value) => setDraft((current) => ({ ...current, document: value }))}
                />
              </FilterGroup>
            )}
          </div>
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_FILTERS)
                setFilters(EMPTY_FILTERS)
              }}
              className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              <RotateCcw size={13} />
              {t('registry.reset')}
            </button>
            <button
              type="button"
              onClick={() => {
                setFilters(draft)
                setAdvOpen(false)
              }}
              className="inline-flex h-8 items-center rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800"
            >
              {t('registry.apply')}
            </button>
          </div>
        </div>
      )}

      {/* Period card */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        {tab === 'series' ? (
          <SegmentedControl<DateType>
            options={[
              { value: 'arrival', label: t('registry.arrivalDate') },
              { value: 'expiry', label: t('registry.expiryDate') },
            ]}
            value={dateType === 'operation' ? 'arrival' : dateType}
            onChange={setDateType}
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
            <CalendarRange size={13} />
            {t('registry.operationDate')}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <DateField
            value={dateFrom}
            onChange={(value) => {
              setDateFrom(value)
              setDatePreset(null)
            }}
          />
          <span className="text-slate-300">→</span>
          <DateField
            value={dateTo}
            onChange={(value) => {
              setDateTo(value)
              setDatePreset(null)
            }}
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {PRESET_KEYS.map((key) => (
            <Chip key={key} active={datePreset === key} onClick={() => applyPreset(key)}>
              {t(`registry.period${capitalize(key)}` as never)}
            </Chip>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <SkeletonTable />
        ) : isEmptyResult ? (
          hasSearchOrFilters ? (
            <EmptyFiltered onReset={resetAll} t={t} />
          ) : (
            <EmptyData t={t} />
          )
        ) : tab === 'series' ? (
          <SeriesTable
            rows={visibleLots}
            sort={seriesSortCtl.sort}
            onSort={seriesSortCtl.onSort}
            onSelect={setSelectedLot}
            selectedId={selectedLot?.id ?? null}
            locale={locale}
            t={t}
          />
        ) : (
          <MovementsTable
            rows={visibleMovements}
            sort={movementsSortCtl.sort}
            onSort={movementsSortCtl.onSort}
            locale={locale}
            t={t}
          />
        )}
      </div>

      {/* Side panel */}
      <LotDetailPanel lot={selectedLot} onClose={() => setSelectedLot(null)} locale={locale} t={t} token={token} />
    </section>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Sorting comparators ─────────────────────────────────────────────────────

function compareLot(a: LotItem, b: LotItem, sort: SortState): number {
  const dir = sort.dir === 'asc' ? 1 : -1
  switch (sort.key) {
    case 'quantity':
      return numCompare(a.quantity, b.quantity) * dir
    case 'expiry_date':
      return dateCompare(a.expiry_date, b.expiry_date) * dir
    case 'internal_lot':
    case 'material_name':
    case 'manufacturer_name':
      return ruCompare((a as unknown as Record<string, string>)[sort.key], (b as unknown as Record<string, string>)[sort.key]) * dir
    default:
      return 0
  }
}

function compareMovement(a: MovementItem, b: MovementItem, sort: SortState): number {
  const dir = sort.dir === 'asc' ? 1 : -1
  switch (sort.key) {
    case 'created_at':
      return dateCompare(a.created_at, b.created_at) * dir
    case 'delta':
      return numCompare(a.quantity_delta, b.quantity_delta) * dir
    case 'internal_lot':
    case 'material_name':
    case 'material_code':
      return ruCompare((a as unknown as Record<string, string>)[sort.key], (b as unknown as Record<string, string>)[sort.key]) * dir
    default:
      return 0
  }
}

// ─── Small inputs ────────────────────────────────────────────────────────────

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function FilterInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
      />
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <CalendarRange size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-md border border-slate-200 bg-white pl-7 pr-2 font-mono text-xs text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
      />
    </div>
  )
}

// ─── Tables ──────────────────────────────────────────────────────────────────

type Translate = ReturnType<typeof useI18n>['t']

interface SeriesTableProps {
  rows: LotItem[]
  sort: SortState
  onSort: (key: string) => void
  onSelect: (lot: LotItem) => void
  selectedId: string | null
  locale: string
  t: Translate
}

function SeriesTable({ rows, sort, onSort, onSelect, selectedId, locale, t }: SeriesTableProps) {
  return (
    <div className="max-h-[640px] overflow-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur">
          <tr className="border-b border-slate-200">
            <Th><SortHeader label={t('registry.internalLot')} sortKey="internal_lot" sort={sort} onSort={onSort} /></Th>
            <Th><SortHeader label={t('registry.material')} sortKey="material_name" sort={sort} onSort={onSort} /></Th>
            <Th><SortHeader label={t('registry.manufacturer')} sortKey="manufacturer_name" sort={sort} onSort={onSort} /></Th>
            <Th>{t('registry.location')}</Th>
            <Th align="right"><SortHeader label={t('registry.qty')} sortKey="quantity" sort={sort} onSort={onSort} align="right" /></Th>
            <Th>{t('registry.qualityStatus')}</Th>
            <Th><SortHeader label={t('registry.expiryDate')} sortKey="expiry_date" sort={sort} onSort={onSort} /></Th>
            <Th>{t('registry.qcReportNo')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lot, index) => {
            const left = daysLeft(lot.expiry_date)
            const active = selectedId === lot.id
            return (
              <tr
                key={lot.id}
                onClick={() => onSelect(lot)}
                className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
                  active ? 'bg-slate-50' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
                }`}
              >
                <Td>
                  <div className="font-mono text-[12.5px] font-semibold text-slate-900">{lot.internal_lot || '—'}</div>
                  <div className="font-mono text-[11px] text-slate-500">{lot.supplier_lot || '—'}</div>
                </Td>
                <Td>
                  <div className="font-medium text-slate-900">{lot.material_name}</div>
                  <div className="font-mono text-[11px] text-slate-500">{lot.material_code}</div>
                </Td>
                <Td className="text-slate-700">{lot.manufacturer_name}</Td>
                <Td>
                  <div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                        LOCATION_PILL[lot.location_code] ?? LOCATION_PILL.RECEIVING
                      }`}
                    >
                      <MapPin size={11} /> {translatedLocation(lot.location_code, t)}
                    </span>
                  </div>
                  {(() => {
                    const addr = formatPhysAddr(lot)
                    return addr ? (
                      <div
                        className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-600"
                        title={physAddrTooltip(lot, t)}
                      >
                        {addr}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-[11px] italic text-slate-400">
                        {t('registry.physicalAddressEmpty')}
                      </div>
                    )
                  })()}
                </Td>
                <Td align="right">
                  <span className="font-mono tabular-nums text-slate-900">
                    <span className="font-semibold">{lot.quantity}</span> <span className="text-slate-500">{lot.unit}</span>
                  </span>
                </Td>
                <Td><StatusBadge status={lot.quality_status} /></Td>
                <Td>
                  <div className="font-mono tabular-nums text-slate-700">{formatDate(lot.expiry_date, locale)}</div>
                  {left !== null && left <= 30 && (
                    <div className={`text-[11px] ${left < 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                      {left < 0
                        ? t('registry.expiredHint', { days: String(Math.abs(left)) })
                        : t('registry.expiresInHint', { days: String(left) })}
                    </div>
                  )}
                  {lot.incoming_control_notified_at && (
                    <div className="font-mono text-[10.5px] text-slate-400">
                      {t('registry.arrivedHint', { date: formatDate(lot.incoming_control_notified_at, locale) })}
                    </div>
                  )}
                </Td>
                <Td>
                  <div className="font-mono text-[11.5px] text-blue-700">{lot.qc_report_no || '—'}</div>
                  {lot.qc_result_received_at && (
                    <div className="font-mono text-[10.5px] text-slate-400">
                      {t('registry.qcReceivedHint', { date: formatDate(lot.qc_result_received_at, locale) })}
                    </div>
                  )}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface MovementsTableProps {
  rows: MovementItem[]
  sort: SortState
  onSort: (key: string) => void
  locale: string
  t: Translate
}

function MovementsTable({ rows, sort, onSort, locale, t }: MovementsTableProps) {
  return (
    <div className="max-h-[640px] overflow-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur">
          <tr className="border-b border-slate-200">
            <Th><SortHeader label={t('registry.operationDate')} sortKey="created_at" sort={sort} onSort={onSort} /></Th>
            <Th>{t('registry.movementType')}</Th>
            <Th>{t('registry.document')}</Th>
            <Th>{t('registry.materialSeries')}</Th>
            <Th align="right"><SortHeader label={t('registry.delta')} sortKey="delta" sort={sort} onSort={onSort} align="right" /></Th>
            <Th align="right">{t('registry.qtyAfter')}</Th>
            <Th>{t('registry.reason')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, index) => {
            const translated = t(movementKey(m.movement_type) as never)
            const label = translated.startsWith('movementType.') ? m.movement_type : translated
            return (
              <tr
                key={m.id}
                className={`border-b border-slate-100 hover:bg-slate-50 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}
              >
                <Td>
                  <div className="font-mono tabular-nums text-slate-800">{formatShortDateTime(m.created_at, locale)}</div>
                  <div className="text-[10px] text-slate-400">{new Date(m.created_at).getFullYear()}</div>
                </Td>
                <Td><MovementTypeBadge rawType={m.movement_type} label={label} /></Td>
                <Td>
                  <div className="font-medium text-slate-800">{m.document_type}</div>
                  <div className="font-mono text-[11px] text-slate-500">#{m.document_id.slice(0, 8)}</div>
                </Td>
                <Td>
                  <div className="truncate font-medium text-slate-900" style={{ maxWidth: 280 }}>
                    {m.material_name || '—'}
                  </div>
                  <div className="font-mono text-[11px] text-slate-500">
                    {m.internal_lot || '—'} · {m.material_code || '—'}
                  </div>
                </Td>
                <Td align="right">
                  <span
                    className={`font-mono font-semibold tabular-nums ${
                      m.quantity_delta < 0 ? 'text-rose-700' : m.quantity_delta > 0 ? 'text-emerald-700' : 'text-slate-500'
                    }`}
                  >
                    {m.quantity_delta > 0 ? '+' : ''}
                    {m.quantity_delta} <span className="text-slate-400">{m.unit}</span>
                  </span>
                </Td>
                <Td align="right">
                  <span className="font-mono tabular-nums text-slate-800">
                    {m.quantity_after} <span className="text-slate-500">{m.unit}</span>
                  </span>
                </Td>
                <Td>
                  <div className="truncate text-slate-600" style={{ maxWidth: 320 }} title={m.reason || ''}>
                    {m.reason || '—'}
                  </div>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <td className={`px-3 py-2.5 align-top ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>{children}</td>
  )
}

// ─── Side panel ──────────────────────────────────────────────────────────────

interface LotDetailPanelProps {
  lot: LotItem | null
  onClose: () => void
  locale: string
  t: Translate
  token: string
}

function LotDetailPanel({ lot, onClose, locale, t, token }: LotDetailPanelProps) {
  const [pdfError, setPdfError] = useState<string | null>(null)
  async function handleLedgerCardPdf() {
    if (!lot) return
    setPdfError(null)
    try {
      const blob = await downloadLotLedgerCardPdf(token, lot.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : t('registry.ledgerCardFailed'))
    }
  }
  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-slate-950/30 backdrop-blur-sm transition-opacity ${
          lot ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        className={`fixed right-0 top-0 z-40 flex h-screen w-[480px] max-w-[92vw] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform ${
          lot ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {lot && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {t('registry.lotPassport')}
                </p>
                <h2 className="mt-1 font-mono text-[18px] font-semibold tracking-tight text-slate-950">
                  {lot.internal_lot || '—'}
                </h2>
                <p className="mt-0.5 text-sm font-medium text-slate-700">{lot.material_name}</p>
                <p className="font-mono text-[11px] text-slate-500">
                  {lot.material_code} · {lot.manufacturer_name}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleLedgerCardPdf()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  title={t('registry.ledgerCardHint')}
                >
                  <FileDown size={13} />
                  {t('registry.ledgerCard')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="close"
                  className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            {pdfError && (
              <div className="mx-5 mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{pdfError}</span>
              </div>
            )}
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="flex items-center gap-2">
                <StatusBadge status={lot.quality_status} />
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                    LOCATION_PILL[lot.location_code] ?? LOCATION_PILL.RECEIVING
                  }`}
                >
                  <MapPin size={11} /> {translatedLocation(lot.location_code, t)}
                </span>
                <span className="ml-auto font-mono tabular-nums text-slate-900">
                  <span className="text-base font-semibold">{lot.quantity}</span>{' '}
                  <span className="text-slate-500">{lot.unit}</span>
                </span>
              </div>

              <DetailSection title={t('registry.lotIdentification')}>
                <DetailRow label={t('registry.supplierLotShort')} value={lot.supplier_lot || '—'} mono />
                <DetailRow label={t('lots.manufacturer')} value={lot.manufacturer_name} />
                <DetailRow label={t('lots.warehouse')} value={t(`status.${lot.warehouse_type}` as never)} />
                <DetailRow
                  label={t('warehouseOps.physicalAddressTitle')}
                  value={formatPhysAddrFull(lot, t) || <span className="italic text-slate-400">{t('registry.physicalAddressEmpty')}</span>}
                />
              </DetailSection>

              <DetailSection title={t('registry.lotDates')}>
                <DetailRow label={t('receipt.productionDate')} value={formatDate(lot.production_date, locale)} mono />
                <DetailRow
                  label={t('registry.expiryDate')}
                  value={formatDate(lot.expiry_date, locale)}
                  mono
                  accent={(() => {
                    const left = daysLeft(lot.expiry_date)
                    return left !== null && left <= 30 ? 'amber' : null
                  })()}
                />
              </DetailSection>

              <DetailSection title={t('registry.lotControlChain')}>
                <DetailRow label={t('lots.qcNotified')} value={formatDateTime(lot.incoming_control_notified_at, locale)} mono />
                <DetailRow label={t('quality.sample')} value={formatDateTime(lot.sampling_date, locale)} mono />
                <DetailRow label={t('lots.qcResult')} value={formatDateTime(lot.qc_result_received_at, locale)} mono />
                <DetailRow label={t('registry.qcReportNo')} value={lot.qc_report_no || '—'} mono />
                <DetailRow label={t('quality.qaReview')} value={formatDateTime(lot.qa_decision_at, locale)} mono />
              </DetailSection>
            </div>
          </>
        )}
      </aside>
    </>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</h3>
      <div className="overflow-hidden rounded-md border border-slate-200">{children}</div>
    </section>
  )
}

function DetailRow({
  label,
  value,
  mono,
  accent,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  accent?: 'amber' | null
}) {
  const accentCls = accent === 'amber' ? 'text-amber-700' : 'text-slate-900'
  return (
    <div className="flex items-baseline justify-between border-b border-slate-100 px-3 py-2 last:border-b-0 odd:bg-slate-50/30">
      <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
      <span className={`text-[12.5px] ${mono ? 'font-mono tabular-nums' : ''} ${accentCls}`}>{value || '—'}</span>
    </div>
  )
}

// ─── Empty / loading states ──────────────────────────────────────────────────

function SkeletonTable() {
  const widths = [110, 200, 140, 90, 80, 110, 90]
  return (
    <div className="p-3">
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, row) => (
          <div key={row} className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-3">
            {widths.map((width, i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-slate-200" style={{ width }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyFiltered({ onReset, t }: { onReset: () => void; t: Translate }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-16">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <SearchX size={20} />
      </span>
      <p className="text-sm font-medium text-slate-900">{t('registry.emptyFiltered')}</p>
      <button
        type="button"
        onClick={onReset}
        className="text-xs font-medium text-blue-700 hover:underline"
      >
        {t('registry.resetFilters')}
      </button>
    </div>
  )
}

function EmptyData({ t }: { t: Translate }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-16">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Inbox size={22} />
      </span>
      <p className="text-sm font-medium text-slate-900">{t('registry.emptyAll')}</p>
      <p className="text-xs text-slate-500">{t('registry.emptyAllHint')}</p>
    </div>
  )
}
