import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileDown,
  Inbox,
  PenLine,
  Plus,
  ScanBarcode,
  Search,
  ShieldCheck,
  Wand2,
  X,
} from 'lucide-react'
import {
  cancelInventoryWave,
  downloadInventoryWavePdf,
  getInventoryWave,
  listInventoryWaves,
  listLots,
  listWarehouses,
  postInventoryWave,
  saveInventoryWaveLine,
  startInventoryWave,
  submitInventoryWave,
  verifyInventoryWaveLine,
} from '../../lib/api'
import { translatedLocation } from '../../lib/display'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type {
  InventoryWaveItem,
  InventoryWaveLineItem,
  InventoryWaveStatus,
  LotItem,
  WarehouseItem,
} from '../../types/inventory'

interface InventoryCountPageProps {
  token: string
  user: CurrentUser
}

type Translate = ReturnType<typeof useI18n>['t']
type View = 'list' | 'planning' | 'walkthrough' | 'verification' | 'detail'
type StatusFilter = '' | InventoryWaveStatus
type KpiKey = 'active' | 'variance' | 'closed'

const STATUS_FILTERS: StatusFilter[] = ['', 'counting', 'verification', 'posted', 'cancelled']

const STATUS_CHIP: Record<InventoryWaveStatus, string> = {
  planning: 'bg-slate-100 text-slate-700 border-slate-200',
  counting: 'bg-amber-50 text-amber-700 border-amber-200',
  verification: 'bg-blue-50 text-blue-700 border-blue-200',
  posted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
}

function StatusChip({ status, t }: { status: InventoryWaveStatus; t: Translate }) {
  const labels: Record<InventoryWaveStatus, string> = {
    planning: t('inventoryCount.statusPlanning'),
    counting: t('inventoryCount.statusCounting'),
    verification: t('inventoryCount.statusVerification'),
    posted: t('inventoryCount.statusPosted'),
    cancelled: t('inventoryCount.statusCancelled'),
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_CHIP[status]}`}>
      {labels[status]}
    </span>
  )
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

function formatDateTime(value: string | null, locale: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function totalProgress(wave: InventoryWaveItem): number {
  if (wave.total_lines === 0) return 0
  return (wave.counted_lines / wave.total_lines) * 100
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function InventoryCountPage({ token, user }: InventoryCountPageProps) {
  const { locale, t } = useI18n()

  const canCount = user.permissions.includes('COUNT_INVENTORY')
  const canVerify = user.permissions.includes('VERIFY_INVENTORY_COUNT')
  const canPost = user.permissions.includes('POST_INVENTORY_COUNT')

  const [view, setView] = useState<View>('list')
  const [waves, setWaves] = useState<InventoryWaveItem[]>([])
  const [selected, setSelected] = useState<InventoryWaveItem | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(null)
  const [search, setSearch] = useState('')
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([])
  const [lots, setLots] = useState<LotItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadAll() {
    setIsLoading(true)
    setError(null)
    try {
      const [wavesRes, warehousesRes] = await Promise.all([
        listInventoryWaves(token, statusFilter || undefined),
        listWarehouses(token),
      ])
      setWaves(wavesRes.waves)
      setWarehouses(warehousesRes.warehouses)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventoryCount.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, statusFilter])

  function clearMessages() {
    setError(null)
    setSuccess(null)
  }

  async function runOp(fn: () => Promise<void>) {
    clearMessages()
    setIsLoading(true)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventoryCount.actionFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  async function openWave(wave: InventoryWaveItem) {
    clearMessages()
    try {
      const full = await getInventoryWave(token, wave.id)
      setSelected(full)
      if (full.status === 'counting') setView('walkthrough')
      else if (full.status === 'verification') setView(canVerify ? 'verification' : 'walkthrough')
      else setView('detail')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventoryCount.loadFailed'))
    }
  }

  function backToList() {
    setView('list')
    setSelected(null)
    clearMessages()
    void loadAll()
  }

  async function refreshSelected() {
    if (!selected) return
    const full = await getInventoryWave(token, selected.id)
    setSelected(full)
  }

  // KPI counts
  const kpiActive = waves.filter((w) => w.status === 'counting' || w.status === 'verification').length
  const kpiVariance = waves
    .filter((w) => w.status === 'counting' || w.status === 'verification')
    .reduce((s, w) => s + w.variance_lines, 0)
  const kpiClosed = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000
    return waves.filter(
      (w) => w.status === 'posted' && w.posted_at && new Date(w.posted_at).getTime() >= cutoff,
    ).length
  }, [waves])

  function toggleKpi(kpi: KpiKey) {
    if (activeKpi === kpi) {
      setActiveKpi(null)
      setStatusFilter('')
      return
    }
    setActiveKpi(kpi)
    if (kpi === 'active') setStatusFilter('counting')
    else if (kpi === 'variance') setStatusFilter('verification')
    else setStatusFilter('posted')
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return waves
    return waves.filter(
      (w) =>
        w.wave_no.toLowerCase().includes(q) ||
        w.scope_description.toLowerCase().includes(q) ||
        w.warehouse_name.toLowerCase().includes(q),
    )
  }, [waves, search])

  // ─── render ──────────────────────────────────────────────────────────────

  if (view === 'planning') {
    return (
      <PlanningView
        warehouses={warehouses}
        lots={lots}
        onLoadLots={async () => {
          const res = await listLots(token)
          setLots(res.lots)
        }}
        onCancel={backToList}
        onStart={async (payload) => {
          await runOp(async () => {
            const created = await startInventoryWave(token, payload)
            setSelected(created)
            setSuccess(t('inventoryCount.startedSuccess', { no: created.wave_no }))
            setView('walkthrough')
          })
        }}
        error={error}
        isLoading={isLoading}
        t={t}
      />
    )
  }

  if (view === 'walkthrough' && selected) {
    return (
      <WalkthroughView
        wave={selected}
        canCount={canCount && selected.status === 'counting'}
        canSubmit={canCount && selected.status === 'counting'}
        locale={locale}
        t={t}
        error={error}
        success={success}
        isLoading={isLoading}
        onBack={backToList}
        onSaveLine={async (lineId, payload) => {
          await runOp(async () => {
            await saveInventoryWaveLine(token, selected.id, lineId, payload)
            await refreshSelected()
          })
        }}
        onSubmit={async () => {
          await runOp(async () => {
            const updated = await submitInventoryWave(token, selected.id, {})
            setSelected(updated)
            setSuccess(t('inventoryCount.submittedSuccess'))
            if (canVerify) setView('verification')
          })
        }}
      />
    )
  }

  if (view === 'verification' && selected) {
    return (
      <VerificationView
        wave={selected}
        canVerify={canVerify && selected.status === 'verification'}
        canPost={canPost && selected.status === 'verification'}
        username={user.username}
        locale={locale}
        t={t}
        error={error}
        success={success}
        isLoading={isLoading}
        onBack={backToList}
        onVerify={async (lineId, decision, comment) => {
          await runOp(async () => {
            await verifyInventoryWaveLine(token, selected.id, lineId, { decision, comment: comment || null })
            await refreshSelected()
          })
        }}
        onPost={async (password, reason) => {
          await runOp(async () => {
            const posted = await postInventoryWave(token, selected.id, {
              username: user.username,
              password,
              meaning: t('inventoryCount.signatureMeaning'),
              reason: reason || undefined,
            })
            setSelected(posted)
            setSuccess(t('inventoryCount.postedSuccess', { no: posted.wave_no }))
            setView('detail')
          })
        }}
      />
    )
  }

  if (view === 'detail' && selected) {
    return (
      <DetailView
        wave={selected}
        token={token}
        locale={locale}
        t={t}
        onBack={backToList}
        onCancel={async (reason) => {
          await runOp(async () => {
            const cancelled = await cancelInventoryWave(token, selected.id, { reason })
            setSelected(cancelled)
            setSuccess(t('inventoryCount.cancelledSuccess'))
          })
        }}
        canCancel={
          (user.username === selected.created_by_name || canPost) &&
          selected.status !== 'posted' &&
          selected.status !== 'cancelled'
        }
      />
    )
  }

  return (
    <ListView
      waves={filtered}
      total={waves.length}
      isLoading={isLoading}
      error={error}
      success={success}
      search={search}
      onSearch={setSearch}
      statusFilter={statusFilter}
      onStatus={(value) => {
        setStatusFilter(value)
        setActiveKpi(null)
      }}
      activeKpi={activeKpi}
      onKpi={toggleKpi}
      kpiActive={kpiActive}
      kpiVariance={kpiVariance}
      kpiClosed={kpiClosed}
      canStart={canCount}
      onStart={() => {
        clearMessages()
        setView('planning')
      }}
      onOpen={openWave}
      locale={locale}
      t={t}
    />
  )
}

// ─── List view ────────────────────────────────────────────────────────────

interface ListViewProps {
  waves: InventoryWaveItem[]
  total: number
  isLoading: boolean
  error: string | null
  success: string | null
  search: string
  onSearch: (value: string) => void
  statusFilter: StatusFilter
  onStatus: (value: StatusFilter) => void
  activeKpi: KpiKey | null
  onKpi: (kpi: KpiKey) => void
  kpiActive: number
  kpiVariance: number
  kpiClosed: number
  canStart: boolean
  onStart: () => void
  onOpen: (wave: InventoryWaveItem) => void
  locale: string
  t: Translate
}

function ListView({
  waves,
  total,
  isLoading,
  error,
  success,
  search,
  onSearch,
  statusFilter,
  onStatus,
  activeKpi,
  onKpi,
  kpiActive,
  kpiVariance,
  kpiClosed,
  canStart,
  onStart,
  onOpen,
  locale,
  t,
}: ListViewProps) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            {t('inventoryCount.kicker')}
          </p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">
            {t('inventoryCount.title')}
          </h1>
          <p className="max-w-2xl text-sm text-slate-600">{t('inventoryCount.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <KpiTile
            icon={ClipboardCheck}
            accent="bg-slate-100 text-slate-700"
            label={t('inventoryCount.kpiActive')}
            value={kpiActive}
            sub={t('inventoryCount.kpiActiveSub')}
            active={activeKpi === 'active'}
            onClick={() => onKpi('active')}
          />
          <KpiTile
            icon={AlertTriangle}
            accent="bg-amber-50 text-amber-700"
            label={t('inventoryCount.kpiVariance')}
            value={kpiVariance}
            sub={t('inventoryCount.kpiVarianceSub')}
            active={activeKpi === 'variance'}
            onClick={() => onKpi('variance')}
          />
          <KpiTile
            icon={CheckCircle2}
            accent="bg-emerald-50 text-emerald-700"
            label={t('inventoryCount.kpiClosed')}
            value={kpiClosed}
            sub={t('inventoryCount.kpiClosedSub')}
            active={activeKpi === 'closed'}
            onClick={() => onKpi('closed')}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
        <div className="relative min-w-[280px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t('inventoryCount.searchPlaceholder')}
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="clear"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="inline-flex flex-wrap gap-1 rounded-md border border-slate-200 bg-slate-50/60 p-0.5">
          {STATUS_FILTERS.map((s) => {
            const active = statusFilter === s
            const label =
              s === ''
                ? t('inventoryCount.statusAll')
                : ({
                    counting: t('inventoryCount.statusCounting'),
                    verification: t('inventoryCount.statusVerification'),
                    posted: t('inventoryCount.statusPosted'),
                    cancelled: t('inventoryCount.statusCancelled'),
                    planning: t('inventoryCount.statusPlanning'),
                  } as Record<InventoryWaveStatus, string>)[s as InventoryWaveStatus]
            return (
              <button
                key={s || 'all'}
                type="button"
                onClick={() => onStatus(s)}
                className={`h-8 rounded px-2.5 text-xs font-medium transition ${
                  active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>

        {canStart && (
          <button
            type="button"
            onClick={onStart}
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-md bg-slate-900 px-3.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            <Plus size={15} />
            {t('inventoryCount.newCount')}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          {t('common.loadingRecords')}
        </div>
      ) : waves.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-12 shadow-sm">
          <EmptyStateBox
            icon={Inbox}
            headline={total === 0 ? t('inventoryCount.emptyAll') : t('inventoryCount.emptyFiltered')}
            sub={total === 0 ? t('inventoryCount.emptyAllHint') : t('inventoryCount.emptyFilteredHint')}
          />
        </div>
      ) : (
        <div className="space-y-2">
          {waves.map((wave) => (
            <WaveCard key={wave.id} wave={wave} onOpen={() => onOpen(wave)} locale={locale} t={t} />
          ))}
        </div>
      )}
    </section>
  )
}

function WaveCard({
  wave,
  onOpen,
  locale,
  t,
}: {
  wave: InventoryWaveItem
  onOpen: () => void
  locale: string
  t: Translate
}) {
  const pct = totalProgress(wave)
  const barColor =
    wave.status === 'posted'
      ? 'bg-emerald-500'
      : wave.status === 'verification'
      ? 'bg-blue-500'
      : wave.status === 'counting'
      ? 'bg-amber-500'
      : 'bg-slate-300'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm"
    >
      <div className="flex items-center gap-6">
        <div className="w-40 shrink-0">
          <div className="font-mono text-[14px] font-semibold text-slate-900">{wave.wave_no}</div>
          <div className="mt-1.5">
            <StatusChip status={wave.status} t={t} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate text-sm font-medium text-slate-900">
            <Boxes size={14} className="text-slate-400" />
            {wave.scope_description}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">{wave.warehouse_name}</div>
        </div>

        <div className="w-48 shrink-0">
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
            <span>
              {wave.counted_lines} / {wave.total_lines}
            </span>
            <span className="tabular-nums">{Math.round(pct)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          {wave.variance_lines > 0 && (
            <div className="mt-1 text-[11px] font-medium text-amber-700">
              {t('inventoryCount.varianceLines', { n: String(wave.variance_lines) })}
            </div>
          )}
        </div>

        <div className="w-44 shrink-0 text-right text-[11px] text-slate-500">
          <div>
            {t('inventoryCount.started')}:{' '}
            <span className="text-slate-700">{formatDate(wave.started_at, locale)}</span>
          </div>
          <div className="mt-0.5">
            {t('inventoryCount.createdBy')}: <span className="text-slate-700">{wave.created_by_name ?? '—'}</span>
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Planning view (start new wave) ───────────────────────────────────────

interface PlanningViewProps {
  warehouses: WarehouseItem[]
  lots: LotItem[]
  onLoadLots: () => Promise<void>
  onCancel: () => void
  onStart: (payload: {
    scope: { warehouse_id: string; location_code?: string | null; rack_no?: string | null; lot_ids?: string[] }
    tolerance_pct: number
    counters: string[]
    verifier_username?: string | null
  }) => Promise<void>
  error: string | null
  isLoading: boolean
  t: Translate
}

type ScopeType = 'all' | 'zone' | 'rack' | 'custom'

function PlanningView({ warehouses, lots, onLoadLots, onCancel, onStart, error, isLoading, t }: PlanningViewProps) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [scopeType, setScopeType] = useState<ScopeType>('all')
  const [zone, setZone] = useState('')
  const [rack, setRack] = useState('')
  const [tolerance, setTolerance] = useState(0.5)
  const [counters, setCounters] = useState<string>('')
  const [verifier, setVerifier] = useState<string>('')
  const [customLotIds, setCustomLotIds] = useState<string[]>([])
  const [customSearch, setCustomSearch] = useState('')

  useEffect(() => {
    if (warehouses.length > 0 && !warehouseId) setWarehouseId(warehouses[0].id)
  }, [warehouses, warehouseId])

  useEffect(() => {
    void onLoadLots()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scopeLots = useMemo(() => {
    if (scopeType === 'custom') {
      const ids = new Set(customLotIds)
      return lots.filter((lot) => ids.has(lot.id))
    }
    return lots.filter((lot) => {
      if (lot.warehouse_id !== warehouseId) return false
      if (scopeType === 'zone' && zone && lot.location_code !== zone) return false
      if (scopeType === 'rack' && rack && lot.rack_no !== rack) return false
      return lot.quantity > 0
    })
  }, [lots, warehouseId, scopeType, zone, rack, customLotIds])

  const customCandidates = useMemo(() => {
    const q = customSearch.trim().toLowerCase()
    const pool = lots.filter((lot) => lot.warehouse_id === warehouseId && lot.quantity > 0 && !customLotIds.includes(lot.id))
    if (!q) return pool.slice(0, 30)
    return pool
      .filter(
        (lot) =>
          lot.internal_lot.toLowerCase().includes(q) ||
          lot.material_code.toLowerCase().includes(q) ||
          lot.material_name.toLowerCase().includes(q),
      )
      .slice(0, 30)
  }, [lots, warehouseId, customLotIds, customSearch])

  const zones = useMemo(
    () => Array.from(new Set(lots.filter((l) => l.warehouse_id === warehouseId).map((l) => l.location_code))).sort(),
    [lots, warehouseId],
  )
  const racks = useMemo(
    () =>
      Array.from(new Set(lots.filter((l) => l.warehouse_id === warehouseId && l.rack_no).map((l) => l.rack_no!)))
        .filter(Boolean)
        .sort(),
    [lots, warehouseId],
  )
  const previewTotalQty = scopeLots.reduce((s, l) => s + l.quantity, 0)
  const previewRacks = useMemo(() => {
    const map = new Map<string, number>()
    for (const lot of scopeLots) {
      const key = lot.rack_no || '—'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return Array.from(map.entries()).sort()
  }, [scopeLots])

  const counterList = counters
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  const verifierClash = verifier && counterList.includes(verifier)
  const canStart = warehouseId && scopeLots.length > 0 && !verifierClash

  function handleStart() {
    if (!canStart) return
    void onStart({
      scope: {
        warehouse_id: warehouseId,
        location_code: scopeType === 'zone' ? zone || null : null,
        rack_no: scopeType === 'rack' ? rack || null : null,
        lot_ids: scopeType === 'custom' ? customLotIds : [],
      },
      tolerance_pct: tolerance,
      counters: counterList,
      verifier_username: verifier || null,
    })
  }

  return (
    <section className="space-y-5 pb-24">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft size={15} />
          {t('common.cancel')}
        </button>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t('inventoryCount.planningKicker')}
          </p>
          <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-slate-950">
            {t('inventoryCount.newCount')}
          </h1>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Wand2 size={14} className="text-slate-400" />
          <h3 className="text-[15px] font-semibold text-slate-900">{t('inventoryCount.parametersTitle')}</h3>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label={t('inventoryCount.warehouse')} required>
            <select
              value={warehouseId}
              onChange={(event) => {
                setWarehouseId(event.target.value)
                setZone('')
                setRack('')
              }}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              {warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t('inventoryCount.tolerance')}>
            <input
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={tolerance}
              onChange={(event) => setTolerance(parseFloat(event.target.value) || 0)}
              className="h-9 w-28 rounded-md border border-slate-300 bg-white px-3 font-mono text-sm tabular-nums outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            />
          </FormField>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
            {t('inventoryCount.scope')}
          </p>
          <div className="space-y-2">
            {([
              { value: 'all', label: t('inventoryCount.scopeAll') },
              { value: 'zone', label: t('inventoryCount.scopeZone') },
              { value: 'rack', label: t('inventoryCount.scopeRack') },
              { value: 'custom', label: t('inventoryCount.scopeCustom') },
            ] as const).map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="scope"
                  value={opt.value}
                  checked={scopeType === opt.value}
                  onChange={() => setScopeType(opt.value)}
                  className="accent-slate-900"
                />
                <span className="text-sm text-slate-700">{opt.label}</span>
                {opt.value === 'zone' && scopeType === 'zone' && (
                  <select
                    value={zone}
                    onChange={(event) => setZone(event.target.value)}
                    className="ml-1 h-8 rounded border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="">{t('inventoryCount.allZones')}</option>
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                )}
                {opt.value === 'rack' && scopeType === 'rack' && (
                  <select
                    value={rack}
                    onChange={(event) => setRack(event.target.value)}
                    className="ml-1 h-8 rounded border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="">{t('inventoryCount.allRacks')}</option>
                    {racks.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label={t('inventoryCount.counters')}>
            <input
              type="text"
              value={counters}
              onChange={(event) => setCounters(event.target.value)}
              placeholder={t('inventoryCount.countersPlaceholder')}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            />
          </FormField>
          <FormField label={t('inventoryCount.verifier')}>
            <input
              type="text"
              value={verifier}
              onChange={(event) => setVerifier(event.target.value)}
              placeholder={t('inventoryCount.verifierPlaceholder')}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            />
            {verifierClash && <p className="mt-1 text-[11px] text-rose-600">{t('inventoryCount.verifierClash')}</p>}
          </FormField>
        </div>
      </div>

      {scopeType === 'custom' && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-slate-900">{t('inventoryCount.customListTitle')}</h3>
            <span className="text-[11px] text-slate-500">
              {t('inventoryCount.customSelected', { n: String(customLotIds.length) })}
            </span>
          </div>

          {customLotIds.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {customLotIds.map((id) => {
                const lot = lots.find((l) => l.id === id)
                if (!lot) return null
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[12px] text-slate-800"
                  >
                    {lot.internal_lot}
                    <button
                      type="button"
                      onClick={() => setCustomLotIds((curr) => curr.filter((cid) => cid !== id))}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                      aria-label="remove"
                    >
                      <X size={11} />
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={customSearch}
              onChange={(event) => setCustomSearch(event.target.value)}
              placeholder={t('inventoryCount.customSearchPlaceholder')}
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            />
          </div>

          <div className="mt-2 max-h-[240px] overflow-y-auto rounded-md border border-slate-200">
            {customCandidates.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-500">
                {t('inventoryCount.customEmpty')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {customCandidates.map((lot) => (
                  <li key={lot.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[12.5px]">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-slate-900">{lot.internal_lot}</span>
                        <span className="text-slate-600">{lot.material_name}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {lot.material_code} · {lot.quantity} {lot.unit}
                        {lot.rack_no && ` · ${lot.rack_no}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCustomLotIds((curr) => [...curr, lot.id])}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2 text-[11px] font-medium text-white hover:bg-slate-800"
                    >
                      <Plus size={12} />
                      {t('inventoryCount.customAdd')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Boxes size={14} className="text-slate-400" />
          <h3 className="text-[15px] font-semibold text-slate-900">{t('inventoryCount.previewTitle')}</h3>
        </div>
        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {t('inventoryCount.previewSummary', {
            lots: String(scopeLots.length),
            racks: String(previewRacks.length),
            qty: previewTotalQty.toLocaleString('ru-RU'),
          })}
        </div>
        {previewRacks.length > 0 && (
          <ul className="mt-3 space-y-1">
            {previewRacks.map(([r, count]) => (
              <li key={r} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm">
                <span className="font-mono text-slate-700">
                  {r === '—' ? t('inventoryCount.noRack') : `${t('warehouseOps.rackNo')} ${r}`}
                </span>
                <span className="font-mono text-xs tabular-nums text-slate-500">
                  {t('inventoryCount.lotsCount', { n: String(count) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!canStart || isLoading}
            onClick={handleStart}
            className="inline-flex h-9 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('inventoryCount.startCounting')}
          </button>
        </div>
      </div>
    </section>
  )
}

// ─── Walkthrough view (counting) ──────────────────────────────────────────

interface WalkthroughViewProps {
  wave: InventoryWaveItem
  canCount: boolean
  canSubmit: boolean
  locale: string
  t: Translate
  error: string | null
  success: string | null
  isLoading: boolean
  onBack: () => void
  onSaveLine: (lineId: string, payload: { actual_quantity: number; notes?: string | null }) => Promise<void>
  onSubmit: () => Promise<void>
}

function WalkthroughView({
  wave,
  canCount,
  canSubmit,
  locale,
  t,
  error,
  success,
  isLoading,
  onBack,
  onSaveLine,
  onSubmit,
}: WalkthroughViewProps) {
  const [expandedRacks, setExpandedRacks] = useState<string[]>(
    Array.from(new Set(wave.lines.map((l) => l.rack_no || '—'))),
  )
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerInput, setScannerInput] = useState('')
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [focusedLineId, setFocusedLineId] = useState<string | null>(null)

  function scanLot(query: string) {
    const q = query.trim().toLowerCase()
    if (!q) return
    setScannerError(null)
    const match = wave.lines.find(
      (l) => l.internal_lot.toLowerCase() === q || (l.supplier_lot ?? '').toLowerCase() === q,
    )
    if (!match) {
      setScannerError(t('inventoryCount.scannerNotFound', { q: query }))
      return
    }
    const rack = match.rack_no || '—'
    setExpandedRacks((curr) => (curr.includes(rack) ? curr : [...curr, rack]))
    setFocusedLineId(match.id)
    setScannerOpen(false)
    setScannerInput('')
    // Allow the DOM to render the expanded section, then scroll into view.
    window.setTimeout(() => {
      const el = document.getElementById(`inv-line-${match.id}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const input = el.querySelector<HTMLInputElement>('input[type="number"]')
        input?.focus()
        input?.select()
      }
    }, 80)
  }

  // Group lines: rack → tier → lines
  const groups = useMemo(() => {
    const byRack = new Map<string, Map<string, InventoryWaveLineItem[]>>()
    for (const line of wave.lines) {
      const rack = line.rack_no || '—'
      const tier = line.tier_no || '—'
      if (!byRack.has(rack)) byRack.set(rack, new Map())
      const byTier = byRack.get(rack)!
      if (!byTier.has(tier)) byTier.set(tier, [])
      byTier.get(tier)!.push(line)
    }
    return Array.from(byRack.entries()).sort()
  }, [wave.lines])

  const pendingCount = wave.lines.filter((l) => l.status === 'pending').length
  const varianceCount = wave.lines.filter((l) => l.status === 'needs_verification').length
  const countedCount = wave.counted_lines

  function toggleRack(rack: string) {
    setExpandedRacks((curr) => (curr.includes(rack) ? curr.filter((r) => r !== rack) : [...curr, rack]))
  }

  return (
    <section className="space-y-4 pb-28">
      <div className="sticky top-0 z-10 -mx-4 border-b border-slate-200 bg-white px-4 py-3 shadow-sm md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ChevronLeft size={15} />
              {t('inventoryCount.back')}
            </button>
            <span className="font-mono text-[16px] font-semibold text-slate-950">{wave.wave_no}</span>
            <StatusChip status={wave.status} t={t} />
            <span className="text-sm text-slate-600">{wave.scope_description}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {canCount && (
              <button
                type="button"
                onClick={() => {
                  setScannerError(null)
                  setScannerInput('')
                  setScannerOpen(true)
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <ScanBarcode size={14} />
                {t('inventoryCount.scan')}
              </button>
            )}
            <span className="font-mono tabular-nums text-slate-700">
              {countedCount} / {wave.total_lines}
            </span>
            {varianceCount > 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                {t('inventoryCount.varianceLines', { n: String(varianceCount) })}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Rack navigator */}
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          {groups.map(([rack, tierMap]) => {
            const total = Array.from(tierMap.values()).reduce((s, arr) => s + arr.length, 0)
            const counted = Array.from(tierMap.values())
              .flat()
              .filter((l) => l.status !== 'pending').length
            return (
              <button
                key={rack}
                type="button"
                onClick={() =>
                  setExpandedRacks((curr) => (curr.includes(rack) ? curr.filter((r) => r !== rack) : [...curr, rack]))
                }
                className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition ${
                  expandedRacks.includes(rack)
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <span className="font-mono">{rack === '—' ? t('inventoryCount.noRack') : rack}</span>
                <span className="font-mono tabular-nums opacity-70">
                  {counted}/{total}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {groups.map(([rack, tierMap]) => {
        const expanded = expandedRacks.includes(rack)
        const allLines = Array.from(tierMap.values()).flat()
        const counted = allLines.filter((l) => l.status !== 'pending').length
        const varianceHere = allLines.filter((l) => l.status === 'needs_verification').length
        return (
          <div key={rack} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => toggleRack(rack)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-slate-50"
            >
              <div>
                <div className="font-mono text-[16px] font-semibold text-slate-950">
                  {rack === '—' ? t('inventoryCount.noRack') : `${t('warehouseOps.rackNo')} ${rack}`}
                </div>
                <div className="mt-1 text-[12px] text-slate-500">
                  {t('inventoryCount.countedOfTotal', { n: String(counted), total: String(allLines.length) })}
                  {varianceHere > 0 && (
                    <span className="ml-2 text-amber-700">
                      · {t('inventoryCount.varianceShort', { n: String(varianceHere) })}
                    </span>
                  )}
                </div>
              </div>
              {expanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
            </button>
            {expanded && (
              <div className="border-t border-slate-200 bg-slate-50/40">
                {Array.from(tierMap.entries())
                  .sort()
                  .map(([tier, tierLines]) => (
                    <div key={tier} className="border-b border-slate-100 last:border-b-0">
                      <div className="bg-slate-50 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                        {tier === '—' ? t('inventoryCount.noTier') : `${t('warehouseOps.tierNo')} ${tier}`}
                      </div>
                      <ul className="divide-y divide-slate-100">
                        {tierLines.map((line) => (
                          <CountLineRow
                            key={line.id}
                            line={line}
                            canCount={canCount}
                            locale={locale}
                            t={t}
                            tolerance={wave.tolerance_pct}
                            focused={focusedLineId === line.id}
                            onSave={(actual, notes) => onSaveLine(line.id, { actual_quantity: actual, notes })}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )
      })}

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white px-4 py-3 shadow-lg md:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            {t('inventoryCount.bottomBarSummary', {
              counted: String(countedCount),
              total: String(wave.total_lines),
              variance: String(varianceCount),
              tolerance: String(wave.tolerance_pct),
            })}
          </div>
          <button
            type="button"
            disabled={isLoading || !canSubmit || pendingCount > 0}
            onClick={() => void onSubmit()}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck size={15} />
            {t('inventoryCount.submitForVerification')}
          </button>
        </div>
      </div>

      {scannerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">{t('inventoryCount.scanTitle')}</h2>
              <button
                type="button"
                onClick={() => setScannerOpen(false)}
                aria-label="close"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="mb-2 text-sm text-slate-600">{t('inventoryCount.scanHint')}</p>
              <input
                autoFocus
                value={scannerInput}
                onChange={(event) => {
                  setScannerInput(event.target.value)
                  setScannerError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    scanLot(scannerInput)
                  }
                }}
                placeholder={t('inventoryCount.scanPlaceholder')}
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-base outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              />
              {scannerError && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-800">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>{scannerError}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setScannerOpen(false)}
                className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={!scannerInput.trim()}
                onClick={() => scanLot(scannerInput)}
                className="inline-flex h-9 items-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('inventoryCount.scanFind')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function CountLineRow({
  line,
  canCount,
  locale,
  t,
  tolerance,
  focused,
  onSave,
}: {
  line: InventoryWaveLineItem
  canCount: boolean
  locale: string
  t: Translate
  tolerance: number
  focused?: boolean
  onSave: (actual: number, notes: string | null) => Promise<void>
}) {
  const [actual, setActual] = useState(line.actual_quantity !== null ? String(line.actual_quantity) : '')
  const [notes, setNotes] = useState(line.notes ?? '')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const dirty = actual !== (line.actual_quantity !== null ? String(line.actual_quantity) : '') || notes !== (line.notes ?? '')
  const parsed = parseFloat(actual)
  const valid = !Number.isNaN(parsed) && parsed >= 0

  async function handleSave() {
    if (!valid) return
    setSaving(true)
    try {
      await onSave(parsed, notes.trim() || null)
    } finally {
      setSaving(false)
    }
  }

  const variancePct = line.variance_pct ?? 0
  const pillColor =
    line.status === 'within_tolerance' || line.status === 'verified'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : line.status === 'needs_verification' || line.status === 'rejected'
      ? variancePct > 0
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-rose-50 text-rose-700 border-rose-200'
      : 'bg-slate-100 text-slate-500 border-slate-200'

  return (
    <li id={`inv-line-${line.id}`} className={`px-4 py-3 ${focused ? 'bg-amber-50/60 ring-1 ring-amber-200' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-slate-900">{line.internal_lot}</span>
            <span className="text-[11px] text-slate-500">
              {line.place_no ? `${t('warehouseOps.placeNo')} ${line.place_no}` : ''}
            </span>
          </div>
          <div className="text-[12px] text-slate-600">
            {line.material_name} <span className="font-mono text-[11px] text-slate-400">· {line.material_code}</span>
          </div>
          <div className="font-mono text-[11px] text-slate-500">
            {t('inventoryCount.systemQty')}: {line.system_quantity} {line.unit}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="0.001"
            disabled={!canCount || saving}
            value={actual}
            onChange={(event) => setActual(event.target.value)}
            placeholder={t('inventoryCount.actualPlaceholder')}
            className="h-11 w-32 rounded-md border border-slate-300 bg-white px-3 text-right font-mono text-base tabular-nums outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60 disabled:bg-slate-50"
          />
          <span className="text-sm text-slate-500">{line.unit}</span>
        </div>

        <div className="w-24 text-right">
          {line.actual_quantity === null ? (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${pillColor}`}>
              {t('inventoryCount.pending')}
            </span>
          ) : (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${pillColor}`}>
              {variancePct > 0 ? '+' : ''}
              {variancePct.toFixed(1)}%
            </span>
          )}
        </div>

        {canCount && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="notes"
          >
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {open && canCount && (
        <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-white p-3">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('inventoryCount.notesPlaceholder')}
            rows={2}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
          />
        </div>
      )}

      {canCount && dirty && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={!valid || saving}
            onClick={() => void handleSave()}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? t('inventoryCount.saving') : t('inventoryCount.saveLine')}
          </button>
        </div>
      )}

      {line.counted_by_name && line.counted_at && (
        <div className="mt-1 text-[10.5px] text-slate-400">
          {t('inventoryCount.countedByAt', {
            name: line.counted_by_name,
            at: formatDateTime(line.counted_at, locale),
          })}
        </div>
      )}
    </li>
  )
}

// ─── Verification view ────────────────────────────────────────────────────

interface VerificationViewProps {
  wave: InventoryWaveItem
  canVerify: boolean
  canPost: boolean
  username: string
  locale: string
  t: Translate
  error: string | null
  success: string | null
  isLoading: boolean
  onBack: () => void
  onVerify: (lineId: string, decision: 'confirm' | 'escalate', comment: string) => Promise<void>
  onPost: (password: string, reason: string) => Promise<void>
}

function VerificationView({
  wave,
  canVerify,
  canPost,
  username,
  locale,
  t,
  error,
  success,
  isLoading,
  onBack,
  onVerify,
  onPost,
}: VerificationViewProps) {
  const [comments, setComments] = useState<Record<string, string>>({})
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const varianceLines = wave.lines.filter((l) => l.status === 'needs_verification')
  const verifiedLines = wave.lines.filter((l) => l.status === 'verified' || l.status === 'rejected')
  const totalToReview = varianceLines.length + verifiedLines.length
  const allHandled = varianceLines.length === 0

  return (
    <section className="space-y-4 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ChevronLeft size={15} />
            {t('inventoryCount.back')}
          </button>
          <span className="font-mono text-[16px] font-semibold text-slate-950">{wave.wave_no}</span>
          <StatusChip status={wave.status} t={t} />
          <span className="text-sm text-slate-600">
            {t('inventoryCount.verifyHeader', { done: String(verifiedLines.length), total: String(totalToReview) })}
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {varianceLines.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-12 shadow-sm">
          <EmptyStateBox
            icon={CheckCircle2}
            headline={t('inventoryCount.allVerified')}
            sub={t('inventoryCount.allVerifiedHint')}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {varianceLines.map((line) => (
            <div key={line.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-mono text-[14px] font-semibold text-slate-950">{line.internal_lot}</div>
                  <div className="text-[12px] text-slate-600">
                    {line.material_name} <span className="font-mono text-[11px] text-slate-400">· {line.material_code}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {line.rack_no && `${t('warehouseOps.rackNo')} ${line.rack_no}`}
                    {line.tier_no && ` · ${t('warehouseOps.tierNo')} ${line.tier_no}`}
                    {line.place_no && ` · ${t('warehouseOps.placeNo')} ${line.place_no}`}
                    {' · '}
                    {translatedLocation(line.location_code, t)}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">{t('inventoryCount.systemQty')}</div>
                    <div className="font-mono tabular-nums text-slate-700">
                      {line.system_quantity} {line.unit}
                    </div>
                  </div>
                  <span className="text-slate-300">→</span>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">{t('inventoryCount.actualQty')}</div>
                    <div className="font-mono tabular-nums text-slate-900">
                      {line.actual_quantity} {line.unit}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      (line.variance_pct ?? 0) > 0
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-rose-200 bg-rose-50 text-rose-700'
                    }`}
                  >
                    {(line.variance_pct ?? 0) > 0 ? '+' : ''}
                    {(line.variance_pct ?? 0).toFixed(2)}%
                  </span>
                </div>
              </div>

              <div className="mt-3 text-[11px] text-slate-500">
                {line.counted_by_name &&
                  line.counted_at &&
                  t('inventoryCount.countedByAt', {
                    name: line.counted_by_name,
                    at: formatDateTime(line.counted_at, locale),
                  })}
              </div>

              {canVerify && (
                <div className="mt-3">
                  <textarea
                    value={comments[line.id] ?? ''}
                    onChange={(event) => setComments((c) => ({ ...c, [line.id]: event.target.value }))}
                    placeholder={t('inventoryCount.verifierCommentPlaceholder')}
                    rows={2}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => void onVerify(line.id, 'escalate', comments[line.id] ?? '')}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 text-sm font-medium text-amber-700 hover:bg-amber-50"
                    >
                      <AlertTriangle size={14} />
                      {t('inventoryCount.escalate')}
                    </button>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => void onVerify(line.id, 'confirm', comments[line.id] ?? '')}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 size={14} />
                      {t('inventoryCount.confirm')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {allHandled && canPost && (
        <div
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          style={{ borderTopWidth: 2, borderTopColor: '#0f172a' }}
        >
          <div className="mb-4 flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">{t('inventoryCount.postTitle')}</h3>
              <p className="mt-0.5 text-sm text-slate-600">{t('inventoryCount.postHint')}</p>
            </div>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label={t('inventoryCount.signaturePassword')}>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 pr-9 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="toggle"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </FormField>
            <FormField label={t('common.reason')}>
              <input
                type="text"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('inventoryCount.reasonPlaceholder')}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              />
            </FormField>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                {(username[0] ?? '?').toUpperCase()}
              </span>
              <span>{t('inventoryCount.signedBy', { name: username })}</span>
            </div>
            <button
              type="button"
              disabled={isLoading || !password}
              onClick={() => void onPost(password, reason)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PenLine size={15} />
              {t('inventoryCount.post')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Detail (posted / cancelled) ──────────────────────────────────────────

function DetailView({
  wave,
  token,
  locale,
  t,
  onBack,
  onCancel,
  canCancel,
}: {
  wave: InventoryWaveItem
  token: string
  locale: string
  t: Translate
  onBack: () => void
  onCancel: (reason: string) => Promise<void>
  canCancel: boolean
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [pdfError, setPdfError] = useState<string | null>(null)

  async function handlePdf() {
    setPdfError(null)
    try {
      const blob = await downloadInventoryWavePdf(token, wave.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : t('inventoryCount.pdfFailed'))
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ChevronLeft size={15} />
            {t('inventoryCount.back')}
          </button>
          <span className="font-mono text-[18px] font-semibold text-slate-950">{wave.wave_no}</span>
          <StatusChip status={wave.status} t={t} />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handlePdf()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            <FileDown size={15} />
            {t('inventoryCount.printPdf')}
          </button>
          {canCancel && !cancelOpen && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50"
            >
              {t('inventoryCount.cancelWave')}
            </button>
          )}
        </div>
      </div>
      {pdfError && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{pdfError}</span>
        </div>
      )}

      {cancelOpen && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/30 p-4">
          <p className="mb-2 text-sm font-medium text-slate-900">{t('inventoryCount.cancelConfirm')}</p>
          <input
            type="text"
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder={t('common.reason')}
            className="mb-2 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!cancelReason.trim()}
              onClick={() => {
                void onCancel(cancelReason.trim()).then(() => setCancelOpen(false))
              }}
              className="inline-flex h-9 items-center rounded-md bg-rose-600 px-3 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('inventoryCount.cancelConfirmBtn')}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200/60 md:grid-cols-4">
        <MetaCell label={t('inventoryCount.warehouse')} value={wave.warehouse_name} />
        <MetaCell label={t('inventoryCount.scope')} value={wave.scope_description} />
        <MetaCell label={t('inventoryCount.tolerance')} value={`${wave.tolerance_pct}%`} mono />
        <MetaCell
          label={t('inventoryCount.signedBy', { name: '' })}
          value={
            wave.posted_by_name && wave.posted_at
              ? `${wave.posted_by_name} · ${formatDateTime(wave.posted_at, locale)}`
              : '—'
          }
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">
              <th className="w-12 px-3 py-2 text-center">№</th>
              <th className="px-3 py-2">{t('inventoryCount.lot')}</th>
              <th className="px-3 py-2">{t('inventoryCount.material')}</th>
              <th className="px-3 py-2">{t('inventoryCount.location')}</th>
              <th className="px-3 py-2 text-right">{t('inventoryCount.systemQty')}</th>
              <th className="px-3 py-2 text-right">{t('inventoryCount.actualQty')}</th>
              <th className="px-3 py-2 text-right">{t('inventoryCount.variance')}</th>
              <th className="px-3 py-2">{t('inventoryCount.lineStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {wave.lines.map((line, idx) => {
              const v = line.variance_pct ?? 0
              return (
                <tr key={line.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 text-center font-mono tabular-nums text-slate-500">{idx + 1}</td>
                  <td className="px-3 py-2 font-mono text-[12.5px] font-semibold text-slate-900">{line.internal_lot}</td>
                  <td className="px-3 py-2">
                    <div className="text-slate-800">{line.material_name}</div>
                    <div className="font-mono text-[11px] text-slate-500">{line.material_code}</div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-600">
                    {[line.rack_no, line.tier_no, line.place_no].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                    {line.system_quantity} {line.unit}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                    {line.actual_quantity ?? '—'} {line.unit}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono tabular-nums ${
                      v > 0 ? 'text-emerald-700' : v < 0 ? 'text-rose-700' : 'text-slate-700'
                    }`}
                  >
                    {v > 0 ? '+' : ''}
                    {v.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    <span className="text-slate-600">{line.status}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ─── Atoms ───────────────────────────────────────────────────────────────

function KpiTile({
  icon: Icon,
  accent,
  label,
  value,
  sub,
  active,
  onClick,
}: {
  icon: typeof ClipboardCheck
  accent: string
  label: string
  value: number
  sub: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-[200px] items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${
        active
          ? 'border-slate-900 bg-slate-50'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/40'
      }`}
    >
      <span className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md ${accent}`}>
        <Icon size={14} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
        <p className="font-mono text-[20px] font-semibold leading-tight tabular-nums text-slate-950">{value}</p>
        {sub && <p className="truncate text-[11px] text-slate-500">{sub}</p>}
      </div>
    </button>
  )
}

function MetaCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-0.5 text-[13px] font-medium text-slate-900 ${mono ? 'font-mono tabular-nums' : ''}`}>
        {value || '—'}
      </p>
    </div>
  )
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
    </div>
  )
}

function EmptyStateBox({
  icon: Icon,
  headline,
  sub,
}: {
  icon: typeof Inbox
  headline: string
  sub: string
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon size={22} />
      </span>
      <p className="text-sm font-medium text-slate-900">{headline}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  )
}
