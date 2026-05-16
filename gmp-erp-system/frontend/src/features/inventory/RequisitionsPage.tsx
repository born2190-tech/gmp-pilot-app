import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CheckCircle2,
  ClipboardList,
  Eye,
  EyeOff,
  Inbox,
  PenLine,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import {
  allocateRequisition,
  createRequisition,
  issueRequisition,
  listLots,
  listMaterials,
  listRequisitions,
  updateRequisitionAllocation,
} from '../../lib/api'
import { translatedLocation } from '../../lib/display'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type {
  LotItem,
  MaterialItem,
  RequisitionAllocationLineItem,
  RequisitionItem,
  RequisitionLineItem,
} from '../../types/inventory'

interface RequisitionsPageProps {
  token: string
  user: CurrentUser
}

type Translate = ReturnType<typeof useI18n>['t']
type View = 'list' | 'detail' | 'create'
type Status = 'draft' | 'submitted' | 'processing' | 'partially_issued' | 'issued' | 'cancelled'
type StatusFilter = '' | Status
type KpiKey = 'todo' | 'partial' | 'closed'

const STATUS_FILTERS: StatusFilter[] = ['', 'draft', 'submitted', 'processing', 'partially_issued', 'issued', 'cancelled']

const STATUS_CHIP: Record<Status, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  processing: 'bg-amber-50 text-amber-700 border-amber-200',
  partially_issued: 'bg-orange-50 text-orange-700 border-orange-200',
  issued: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
}

function statusLabel(status: string, t: Translate): string {
  const camel = status
    .split('_')
    .map((part, idx) => (idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
  const key = `requisitions.status${camel.charAt(0).toUpperCase() + camel.slice(1)}` as never
  return t(key)
}

function StatusChip({ status, t }: { status: string; t: Translate }) {
  const cls = STATUS_CHIP[status as Status] ?? STATUS_CHIP.draft
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {statusLabel(status, t)}
    </span>
  )
}

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

function relativeFromNow(value: string, locale: string, t: Translate): string {
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.round(diffMs / 60_000)
  const hours = Math.round(diffMs / 3_600_000)
  const days = Math.round(diffMs / 86_400_000)
  if (minutes < 1) return t('requisitions.justNow')
  if (minutes < 60) return t('requisitions.minutesAgo', { n: String(minutes) })
  if (hours < 24) return t('requisitions.hoursAgo', { n: String(hours) })
  if (days < 30) return t('requisitions.daysAgo', { n: String(days) })
  return formatDate(value, locale)
}

function lineProgress(line: RequisitionLineItem): { allocated: number; pct: number } {
  const allocated = line.allocation_lines.reduce((s, a) => s + a.allocated_quantity, 0)
  const pct = line.requested_quantity > 0 ? (allocated / line.requested_quantity) * 100 : 0
  return { allocated, pct }
}

function totalProgress(req: RequisitionItem): { pct: number; full: number } {
  if (req.lines.length === 0) return { pct: 0, full: 0 }
  let req_total = 0
  let alloc_total = 0
  let full = 0
  for (const line of req.lines) {
    req_total += line.requested_quantity
    const { allocated, pct } = lineProgress(line)
    alloc_total += allocated
    if (pct >= 100) full += 1
  }
  return { pct: req_total > 0 ? (alloc_total / req_total) * 100 : 0, full }
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function RequisitionsPage({ token, user }: RequisitionsPageProps) {
  const { locale, t } = useI18n()

  // Production roles draft new requisitions; warehouse only sees the list
  // and runs FEFO/issue. We deliberately gate "+ Новое требование" off for
  // warehouse users — that's the user's explicit ask for this page.
  const canCreate = user.permissions.includes('VIEW_PRODUCTION')
  const canIssue = user.permissions.includes('POST_RECEIPT')
  const canEdit = canIssue || canCreate

  const [view, setView] = useState<View>('list')
  const [requisitions, setRequisitions] = useState<RequisitionItem[]>([])
  const [selected, setSelected] = useState<RequisitionItem | null>(null)
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [lots, setLots] = useState<LotItem[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const canReadWh = user.permissions.includes('VIEW_WAREHOUSE')
      const [reqRes, matRes, lotsRes] = await Promise.all([
        listRequisitions(token, statusFilter || undefined),
        listMaterials(token),
        canReadWh ? listLots(token) : Promise.resolve({ lots: [] }),
      ])
      setRequisitions(reqRes.requisitions)
      setMaterials(matRes.materials)
      setLots(lotsRes.lots)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requisitions.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
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
      setError(err instanceof Error ? err.message : t('requisitions.actionFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  // KPI counts (computed on full unfiltered list)
  const kpiTodo = requisitions.filter((r) => r.status === 'submitted' || r.status === 'processing').length
  const kpiPartial = requisitions.filter((r) => r.status === 'partially_issued').length
  const kpiClosed = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000
    return requisitions.filter((r) => r.status === 'issued' && new Date(r.created_at).getTime() >= cutoff).length
  }, [requisitions])

  function toggleKpi(kpi: KpiKey) {
    if (activeKpi === kpi) {
      setActiveKpi(null)
      setStatusFilter('')
      return
    }
    setActiveKpi(kpi)
    if (kpi === 'todo') setStatusFilter('submitted')
    else if (kpi === 'partial') setStatusFilter('partially_issued')
    else setStatusFilter('issued')
  }

  function setStatus(value: StatusFilter) {
    setStatusFilter(value)
    setActiveKpi(null)
  }

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return requisitions
    return requisitions.filter(
      (r) =>
        r.requisition_no.toLowerCase().includes(q) ||
        r.product_name.toLowerCase().includes(q) ||
        (r.product_series ?? '').toLowerCase().includes(q),
    )
  }, [requisitions, search])

  function openDetail(req: RequisitionItem) {
    setSelected(req)
    clearMessages()
    setView('detail')
  }

  function backToList() {
    setView('list')
    setSelected(null)
    clearMessages()
  }

  // ── Detail actions ────────────────────────────────────────────────────────

  async function handleAllocate() {
    if (!selected) return
    await runOp(async () => {
      const updated = await allocateRequisition(token, selected.id)
      setSelected(updated)
      setSuccess(t('requisitions.allocateDone'))
    })
  }

  async function handleSaveAlloc(updates: { id: string; allocated_quantity: number }[]) {
    if (!selected) return
    await runOp(async () => {
      const updated = await updateRequisitionAllocation(token, selected.id, { updates })
      setSelected(updated)
    })
  }

  async function handleRemoveAlloc(allocId: string) {
    if (!selected) return
    await runOp(async () => {
      const updated = await updateRequisitionAllocation(token, selected.id, { removals: [allocId] })
      setSelected(updated)
    })
  }

  async function handleAddLot(lineId: string, lotId: string, qty: number) {
    if (!selected) return
    await runOp(async () => {
      const updated = await updateRequisitionAllocation(token, selected.id, {
        additions: [{ requisition_line_id: lineId, lot_id: lotId, allocated_quantity: qty }],
      })
      setSelected(updated)
    })
  }

  async function handleIssue(password: string, reason: string) {
    if (!selected) return
    await runOp(async () => {
      const updated = await issueRequisition(token, selected.id, {
        username: user.username,
        password,
        meaning: t('requisitions.signatureMeaning'),
        reason: reason || undefined,
      })
      setSelected(updated)
      setSuccess(t('requisitions.issueDone'))
      void listRequisitions(token).then((r) => setRequisitions(r.requisitions))
    })
  }

  const availableLots = useMemo(
    () =>
      lots.filter(
        (lot) =>
          lot.quality_status === 'released' &&
          lot.quantity > 0 &&
          (!user.warehouse_scope || lot.warehouse_type === user.warehouse_scope),
      ),
    [lots, user.warehouse_scope],
  )

  // ─── Render ──────────────────────────────────────────────────────────────

  if (view === 'create' && canCreate) {
    return (
      <CreateView
        materials={materials}
        isLoading={isLoading}
        error={error}
        t={t}
        onCancel={backToList}
        onCreate={async (payload) => {
          await runOp(async () => {
            const created = await createRequisition(token, payload)
            setSuccess(t('requisitions.createdSuccess', { no: created.requisition_no }))
            setSelected(created)
            setView('detail')
            await loadData()
          })
        }}
      />
    )
  }

  if (view === 'detail' && selected) {
    return (
      <DetailView
        req={selected}
        canEdit={canEdit && !['issued', 'cancelled'].includes(selected.status)}
        canIssue={canIssue && ['submitted', 'processing', 'partially_issued'].includes(selected.status)}
        availableLots={availableLots}
        isLoading={isLoading}
        error={error}
        success={success}
        locale={locale}
        t={t}
        username={user.username}
        onBack={backToList}
        onAllocate={handleAllocate}
        onSaveAlloc={handleSaveAlloc}
        onRemoveAlloc={handleRemoveAlloc}
        onAddLot={handleAddLot}
        onIssue={handleIssue}
      />
    )
  }

  return (
    <ListView
      requisitions={filteredList}
      total={requisitions.length}
      isLoading={isLoading}
      error={error}
      success={success}
      search={search}
      onSearch={setSearch}
      statusFilter={statusFilter}
      onStatus={setStatus}
      activeKpi={activeKpi}
      onKpi={toggleKpi}
      kpiTodo={kpiTodo}
      kpiPartial={kpiPartial}
      kpiClosed={kpiClosed}
      canCreate={canCreate}
      onNew={() => {
        clearMessages()
        setView('create')
      }}
      onOpen={openDetail}
      locale={locale}
      t={t}
    />
  )
}

// ─── List view ─────────────────────────────────────────────────────────────

interface ListViewProps {
  requisitions: RequisitionItem[]
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
  kpiTodo: number
  kpiPartial: number
  kpiClosed: number
  canCreate: boolean
  onNew: () => void
  onOpen: (req: RequisitionItem) => void
  locale: string
  t: Translate
}

function ListView({
  requisitions,
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
  kpiTodo,
  kpiPartial,
  kpiClosed,
  canCreate,
  onNew,
  onOpen,
  locale,
  t,
}: ListViewProps) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            {t('requisitions.kicker')}
          </p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">
            {t('requisitions.title')}
          </h1>
          <p className="max-w-2xl text-sm text-slate-600">{t('requisitions.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <KpiTile
            icon={ClipboardList}
            accent="bg-slate-100 text-slate-700"
            label={t('requisitions.kpiTodo')}
            value={kpiTodo}
            sub={t('requisitions.kpiTodoSub')}
            active={activeKpi === 'todo'}
            onClick={() => onKpi('todo')}
          />
          <KpiTile
            icon={AlertCircle}
            accent="bg-amber-50 text-amber-700"
            label={t('requisitions.kpiPartial')}
            value={kpiPartial}
            sub={t('requisitions.kpiPartialSub')}
            active={activeKpi === 'partial'}
            onClick={() => onKpi('partial')}
          />
          <KpiTile
            icon={CheckCircle2}
            accent="bg-emerald-50 text-emerald-700"
            label={t('requisitions.kpiClosed')}
            value={kpiClosed}
            sub={t('requisitions.kpiClosedSub')}
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
            placeholder={t('requisitions.searchPlaceholder')}
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
            return (
              <button
                key={s || 'all'}
                type="button"
                onClick={() => onStatus(s)}
                className={`h-8 rounded px-2.5 text-xs font-medium transition ${
                  active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {s === '' ? t('requisitions.statusAll') : statusLabel(s, t)}
              </button>
            )
          })}
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={onNew}
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-md bg-slate-900 px-3.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            <Plus size={15} />
            {t('requisitions.newRequisition')}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          {t('common.loadingRecords')}
        </div>
      ) : requisitions.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-12 shadow-sm">
          <EmptyStateBox
            icon={Inbox}
            headline={total === 0 ? t('requisitions.emptyAll') : t('requisitions.emptyFiltered')}
            sub={total === 0 ? t('requisitions.emptyAllHint') : t('requisitions.emptyFilteredHint')}
          />
        </div>
      ) : (
        <div className="space-y-2">
          {requisitions.map((req) => (
            <RequisitionRow key={req.id} req={req} onOpen={() => onOpen(req)} locale={locale} t={t} />
          ))}
        </div>
      )}
    </section>
  )
}

function RequisitionRow({
  req,
  onOpen,
  locale,
  t,
}: {
  req: RequisitionItem
  onOpen: () => void
  locale: string
  t: Translate
}) {
  const { pct } = totalProgress(req)
  const barColor = pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-300'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm"
    >
      <div className="flex items-center gap-6">
        <div className="w-36 shrink-0">
          <div className="font-mono text-[14px] font-semibold text-slate-900">{req.requisition_no}</div>
          <div className="mt-1.5">
            <StatusChip status={req.status} t={t} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900">{req.product_name}</div>
          <div className="font-mono text-[11px] text-slate-500">{req.product_series ?? '—'}</div>
        </div>

        <div className="w-48 shrink-0">
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
            <span>{t('requisitions.progressLabel')}</span>
            <span className="tabular-nums">{Math.round(pct)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {t('requisitions.linesCount', { n: String(req.lines.length) })}
          </div>
        </div>

        <div className="w-44 shrink-0 text-right text-[11px] text-slate-500">
          <div>
            {t('requisitions.productionDate')}:{' '}
            <span className="text-slate-700">{formatDate(req.production_date, locale)}</span>
          </div>
          <div className="mt-0.5">
            {t('requisitions.createdShort')} {relativeFromNow(req.created_at, locale, t)}
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Detail view ───────────────────────────────────────────────────────────

interface DetailViewProps {
  req: RequisitionItem
  canEdit: boolean
  canIssue: boolean
  availableLots: LotItem[]
  isLoading: boolean
  error: string | null
  success: string | null
  locale: string
  t: Translate
  username: string
  onBack: () => void
  onAllocate: () => void
  onSaveAlloc: (updates: { id: string; allocated_quantity: number }[]) => Promise<void>
  onRemoveAlloc: (allocId: string) => void
  onAddLot: (lineId: string, lotId: string, qty: number) => Promise<void>
  onIssue: (password: string, reason: string) => Promise<void>
}

function DetailView({
  req,
  canEdit,
  canIssue,
  availableLots,
  isLoading,
  error,
  success,
  locale,
  t,
  username,
  onBack,
  onAllocate,
  onSaveAlloc,
  onRemoveAlloc,
  onAddLot,
  onIssue,
}: DetailViewProps) {
  const [expandedLines, setExpandedLines] = useState<string[]>(req.lines.map((l) => l.id))
  const [allocEdits, setAllocEdits] = useState<Record<string, string>>({})
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [addLotId, setAddLotId] = useState('')
  const [addLotQty, setAddLotQty] = useState('')
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const { pct, full } = totalProgress(req)
  const dirtyEdits = Object.entries(allocEdits)
    .filter(([, v]) => v !== '')
    .map(([id, v]) => ({ id, allocated_quantity: parseFloat(v) }))
    .filter((u) => !Number.isNaN(u.allocated_quantity))

  function toggleLine(id: string) {
    setExpandedLines((curr) => (curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]))
  }

  function startAddLot(lineId: string) {
    setAddingFor(lineId)
    setAddLotId(availableLots[0]?.id ?? '')
    setAddLotQty('')
  }

  function cancelAddLot() {
    setAddingFor(null)
    setAddLotId('')
    setAddLotQty('')
  }

  async function submitAddLot() {
    if (!addingFor || !addLotId || !addLotQty) return
    const qty = parseFloat(addLotQty)
    if (Number.isNaN(qty) || qty <= 0) return
    await onAddLot(addingFor, addLotId, qty)
    cancelAddLot()
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ChevronLeft size={15} />
            {t('requisitions.back')}
          </button>
          <h2 className="font-mono text-[18px] font-semibold tracking-tight text-slate-950">{req.requisition_no}</h2>
          <StatusChip status={req.status} t={t} />
          <span className="text-sm text-slate-600">{req.product_name}</span>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={onAllocate}
              disabled={isLoading}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Wand2 size={15} />
              {t('requisitions.allocate')}
            </button>
          )}
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

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200/60 md:grid-cols-4">
        <MetaCell label={t('requisitions.productName')} value={req.product_name} />
        <MetaCell label={t('requisitions.productSeries')} value={req.product_series ?? '—'} mono />
        <MetaCell label={t('requisitions.productionDate')} value={formatDate(req.production_date, locale)} />
        <MetaCell label={t('requisitions.productionOrderNo')} value={req.production_order_no ?? '—'} mono />
      </div>

      <div
        className={`rounded-lg border-2 p-3 ${
          pct >= 100
            ? 'border-emerald-200 bg-emerald-50/60'
            : pct > 0
            ? 'border-amber-200 bg-amber-50/60'
            : 'border-slate-200 bg-slate-50/60'
        }`}
      >
        <div className="mb-1.5 flex items-center justify-between text-[12.5px] font-medium text-slate-900">
          <span>
            {t('requisitions.progressBanner', {
              pct: String(Math.round(pct)),
              full: String(full),
              total: String(req.lines.length),
            })}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white">
          <div
            className={`h-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-300'}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {req.lines.map((line) => {
          const expanded = expandedLines.includes(line.id)
          const { allocated, pct: linePct } = lineProgress(line)
          const remaining = Math.max(line.requested_quantity - allocated, 0)
          const lineColor = linePct >= 100 ? 'bg-emerald-500' : linePct > 0 ? 'bg-amber-500' : 'bg-slate-300'
          return (
            <div key={line.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => toggleLine(line.id)}
                className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <div className="font-medium text-slate-900">{line.material_name}</div>
                    <div className="font-mono text-[11px] text-slate-500">{line.material_code}</div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        line.warehouse_type === 'SUBSTANCE_WAREHOUSE'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-purple-50 text-purple-700'
                      }`}
                    >
                      {line.warehouse_type === 'SUBSTANCE_WAREHOUSE'
                        ? t('requisitions.substance')
                        : t('requisitions.packaging')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="w-64">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
                        <span className="font-mono tabular-nums">
                          {allocated} / {line.requested_quantity} {line.unit}
                        </span>
                        <span className="tabular-nums">{Math.round(linePct)}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full transition-all ${lineColor}`} style={{ width: `${Math.min(linePct, 100)}%` }} />
                      </div>
                    </div>
                    {remaining > 0 && (
                      <span className="text-[11px] text-amber-700">
                        {t('requisitions.shortBy', { n: String(remaining), unit: line.unit })}
                      </span>
                    )}
                  </div>
                </div>
                {expanded ? (
                  <ChevronUp size={18} className="shrink-0 text-slate-400" />
                ) : (
                  <ChevronDown size={18} className="shrink-0 text-slate-400" />
                )}
              </button>

              {expanded && (
                <div className="border-t border-slate-200 bg-slate-50/60 p-4">
                  {line.allocation_lines.length === 0 ? (
                    <EmptyStateBox
                      icon={Wand2}
                      headline={t('requisitions.noAlloc')}
                      sub={t('requisitions.noAllocHint')}
                      className="py-6"
                    />
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">
                            <th className="w-10 px-3 py-2 text-center">№</th>
                            <th className="px-3 py-2">{t('requisitions.lot')}</th>
                            <th className="px-3 py-2">{t('requisitions.expiry')}</th>
                            <th className="px-3 py-2">{t('requisitions.location')}</th>
                            <th className="px-3 py-2 text-right">{t('requisitions.available')}</th>
                            <th className="px-3 py-2 text-right">{t('requisitions.allocatedQty')}</th>
                            {canEdit && <th className="w-10" />}
                          </tr>
                        </thead>
                        <tbody>
                          {line.allocation_lines.map((alloc, idx) => (
                            <AllocRow
                              key={alloc.id}
                              alloc={alloc}
                              idx={idx + 1}
                              canEdit={canEdit}
                              isLoading={isLoading}
                              edited={allocEdits[alloc.id] ?? String(alloc.allocated_quantity)}
                              onChange={(value) => setAllocEdits((curr) => ({ ...curr, [alloc.id]: value }))}
                              onRemove={() => onRemoveAlloc(alloc.id)}
                              locale={locale}
                              t={t}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {canEdit && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      {addingFor === line.id ? (
                        <>
                          <FormField label={t('requisitions.lot')}>
                            <select
                              value={addLotId}
                              onChange={(event) => setAddLotId(event.target.value)}
                              className="h-9 w-72 rounded-md border border-slate-300 bg-white px-2 text-[12.5px] outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
                            >
                              {availableLots.map((lot) => (
                                <option key={lot.id} value={lot.id}>
                                  {lot.internal_lot} · exp {formatDate(lot.expiry_date, locale)} · {lot.quantity} {lot.unit}
                                </option>
                              ))}
                            </select>
                          </FormField>
                          <FormField label={t('requisitions.allocatedQty')}>
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={addLotQty}
                              onChange={(event) => setAddLotQty(event.target.value)}
                              className="h-9 w-28 rounded-md border border-slate-300 bg-white px-2 text-right font-mono text-[12.5px] tabular-nums outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
                            />
                          </FormField>
                          <button
                            type="button"
                            onClick={() => void submitAddLot()}
                            disabled={isLoading || !addLotQty || !addLotId}
                            className="inline-flex h-9 items-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {t('requisitions.confirmAdd')}
                          </button>
                          <button
                            type="button"
                            onClick={cancelAddLot}
                            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {t('common.cancel')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startAddLot(line.id)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Plus size={13} />
                          {t('requisitions.addLotManual')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {canEdit && dirtyEdits.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-slate-500">
            {t('requisitions.dirtyEdits', { n: String(dirtyEdits.length) })}
          </span>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => {
              void onSaveAlloc(dirtyEdits).then(() => setAllocEdits({}))
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            {t('requisitions.saveAlloc')}
          </button>
        </div>
      )}

      {canIssue && (
        <div
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          style={{ borderTopWidth: 2, borderTopColor: '#0f172a' }}
        >
          <div className="mb-4 flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                {t('requisitions.issueTitle')}
              </h3>
              <p className="mt-0.5 text-sm text-slate-600">{t('requisitions.issueHint')}</p>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label={t('requisitions.signaturePassword')}>
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
            <FormField label={t('requisitions.signatureReason')}>
              <input
                type="text"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('requisitions.reasonPlaceholder')}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              />
            </FormField>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                {(username[0] ?? '?').toUpperCase()}
              </span>
              <span>{t('requisitions.signedBy', { name: username })}</span>
            </div>
            <button
              type="button"
              disabled={isLoading || !password}
              onClick={() => void onIssue(password, reason)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PenLine size={15} />
              {t('requisitions.issue')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function AllocRow({
  alloc,
  idx,
  canEdit,
  isLoading,
  edited,
  onChange,
  onRemove,
  locale,
  t,
}: {
  alloc: RequisitionAllocationLineItem
  idx: number
  canEdit: boolean
  isLoading: boolean
  edited: string
  onChange: (value: string) => void
  onRemove: () => void
  locale: string
  t: Translate
}) {
  const expiry = new Date(alloc.lot_expiry_date)
  const left = Math.round((expiry.getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000)
  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
      <td className="px-3 py-2 text-center font-mono text-[11.5px] tabular-nums text-slate-500">{idx}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12.5px] font-semibold text-slate-900">{alloc.lot_internal_lot}</span>
          <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700">FEFO</span>
        </div>
        {alloc.lot_supplier_lot && (
          <div className="font-mono text-[10.5px] text-slate-500">{alloc.lot_supplier_lot}</div>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="font-mono text-[12.5px] tabular-nums text-slate-700">{formatDate(alloc.lot_expiry_date, locale)}</div>
        <div className="text-[10.5px] text-slate-500">{t('requisitions.daysLeft', { n: String(left) })}</div>
      </td>
      <td className="px-3 py-2 text-[11px] text-slate-700">
        <div>{translatedLocation(alloc.lot_location_code, t)}</div>
        {(() => {
          const parts: string[] = []
          if (alloc.lot_rack_no) parts.push(`${t('warehouseOps.rackNo')} ${alloc.lot_rack_no}`)
          if (alloc.lot_sector_no) parts.push(`${t('warehouseOps.sectorNo')} ${alloc.lot_sector_no}`)
          if (alloc.lot_tier_no) parts.push(`${t('warehouseOps.tierNo')} ${alloc.lot_tier_no}`)
          if (alloc.lot_place_no) parts.push(`${t('warehouseOps.placeNo')} ${alloc.lot_place_no}`)
          if (alloc.lot_pallet_no) parts.push(`${t('warehouseOps.palletNo')} ${alloc.lot_pallet_no}`)
          return parts.length > 0 ? (
            <div className="mt-0.5 font-mono text-[10.5px] text-slate-500">{parts.join(' · ')}</div>
          ) : null
        })()}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">{alloc.lot_available}</td>
      <td className="px-3 py-2 text-right">
        {canEdit ? (
          <input
            type="number"
            min="0"
            step="0.001"
            value={edited}
            onChange={(event) => onChange(event.target.value)}
            className="h-7 w-20 rounded border border-slate-200 bg-white px-2 text-right font-mono text-[12px] tabular-nums outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
          />
        ) : (
          <span className="font-mono tabular-nums text-slate-900">{alloc.allocated_quantity}</span>
        )}
      </td>
      {canEdit && (
        <td className="px-2 py-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={onRemove}
            className="rounded p-1 text-rose-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
            aria-label="remove"
          >
            <Trash2 size={14} />
          </button>
        </td>
      )}
    </tr>
  )
}

// ─── Create view ───────────────────────────────────────────────────────────

interface CreateLine {
  id: string
  material_id: string
  requested_quantity: string
  unit: string
}

function CreateView({
  materials,
  isLoading,
  error,
  t,
  onCancel,
  onCreate,
}: {
  materials: MaterialItem[]
  isLoading: boolean
  error: string | null
  t: Translate
  onCancel: () => void
  onCreate: (payload: {
    product_name: string
    product_series: string | null
    production_date: string
    production_order_no: string | null
    lines: { material_id: string; requested_quantity: number; unit: string }[]
  }) => Promise<void>
}) {
  const [productName, setProductName] = useState('')
  const [productSeries, setProductSeries] = useState('')
  const [productionDate, setProductionDate] = useState(todayIso())
  const [productionOrderNo, setProductionOrderNo] = useState('')
  const [lines, setLines] = useState<CreateLine[]>([])

  function addLine() {
    setLines((curr) => [...curr, { id: makeId(), material_id: '', requested_quantity: '', unit: '' }])
  }

  function removeLine(id: string) {
    setLines((curr) => curr.filter((l) => l.id !== id))
  }

  function updateLine(id: string, patch: Partial<CreateLine>) {
    setLines((curr) =>
      curr.map((l) => {
        if (l.id !== id) return l
        const next = { ...l, ...patch }
        if (patch.material_id !== undefined) {
          const mat = materials.find((m) => m.id === patch.material_id)
          if (mat) next.unit = mat.default_unit
        }
        return next
      }),
    )
  }

  const validLines = lines.filter((l) => l.material_id && parseFloat(l.requested_quantity) > 0)
  const isValid = productName.trim() && productionDate && validLines.length > 0

  return (
    <section className="space-y-5 pb-24">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronLeft size={15} />
          {t('requisitions.back')}
        </button>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t('requisitions.createKicker')}
          </p>
          <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-slate-950">
            {t('requisitions.newRequisition')}
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
        <h3 className="text-[15px] font-semibold text-slate-900">{t('requisitions.headerCardTitle')}</h3>
        <p className="mb-4 mt-0.5 text-[12px] text-slate-500">{t('requisitions.headerCardHint')}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label={t('requisitions.productName')} required>
            <input
              type="text"
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              placeholder={t('requisitions.productNamePlaceholder')}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            />
          </FormField>
          <FormField label={t('requisitions.productSeries')}>
            <input
              type="text"
              value={productSeries}
              onChange={(event) => setProductSeries(event.target.value)}
              placeholder={t('requisitions.productSeriesPlaceholder')}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            />
          </FormField>
          <FormField label={t('requisitions.productionDate')} required>
            <input
              type="date"
              value={productionDate}
              onChange={(event) => setProductionDate(event.target.value)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            />
          </FormField>
          <FormField label={t('requisitions.productionOrderNo')}>
            <input
              type="text"
              value={productionOrderNo}
              onChange={(event) => setProductionOrderNo(event.target.value)}
              placeholder="PO-2026-0124"
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            />
          </FormField>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-slate-900">{t('requisitions.lines')}</h3>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Plus size={13} />
            {t('requisitions.addLine')}
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="rounded-md border-2 border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            {t('requisitions.linesEmpty')}
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => (
              <CreateLineRow
                key={line.id}
                line={line}
                materials={materials}
                onChange={(patch) => updateLine(line.id, patch)}
                onRemove={() => removeLine(line.id)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            {lines.length === 0 ? (
              t('requisitions.footerHintEmpty')
            ) : (
              <>
                {t('requisitions.footerHintCount', { n: String(lines.length) })}{' '}
                {isValid ? (
                  <span className="font-medium text-emerald-700">· {t('requisitions.footerReady')}</span>
                ) : (
                  <span className="text-amber-700">· {t('requisitions.footerFillRequired')}</span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!isValid || isLoading}
              onClick={() =>
                void onCreate({
                  product_name: productName.trim(),
                  product_series: productSeries.trim() || null,
                  production_date: productionDate,
                  production_order_no: productionOrderNo.trim() || null,
                  lines: validLines.map((l) => ({
                    material_id: l.material_id,
                    requested_quantity: parseFloat(l.requested_quantity),
                    unit: l.unit,
                  })),
                })
              }
              className="inline-flex h-9 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('requisitions.submitRequisition')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function CreateLineRow({
  line,
  materials,
  onChange,
  onRemove,
  t,
}: {
  line: CreateLine
  materials: MaterialItem[]
  onChange: (patch: Partial<CreateLine>) => void
  onRemove: () => void
  t: Translate
}) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-[1fr_120px_80px_36px] md:items-end">
      <FormField label={t('requisitions.material')} required>
        <MaterialPicker value={line.material_id} onChange={(v) => onChange({ material_id: v })} materials={materials} t={t} />
      </FormField>
      <FormField label={t('requisitions.requestedQty')} required>
        <input
          type="number"
          min="0"
          step="0.001"
          value={line.requested_quantity}
          onChange={(event) => onChange({ requested_quantity: event.target.value })}
          placeholder="0"
          className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-right font-mono text-sm tabular-nums outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
        />
      </FormField>
      <FormField label={t('requisitions.unit')}>
        <input
          type="text"
          readOnly
          value={line.unit}
          className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600"
        />
      </FormField>
      <button
        type="button"
        onClick={onRemove}
        aria-label="remove"
        className="inline-flex h-9 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 hover:text-rose-700"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

function MaterialPicker({
  value,
  onChange,
  materials,
  t,
}: {
  value: string
  onChange: (value: string) => void
  materials: MaterialItem[]
  t: Translate
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const selected = materials.find((m) => m.id === value)
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? materials.filter((m) => `${m.code} ${m.name}`.toLowerCase().includes(q)) : materials
    return list.slice(0, 30)
  }, [materials, query])

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function pick(id: string) {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={`flex items-center gap-2 rounded-md border bg-white pl-2.5 pr-2 transition ${
          open ? 'border-slate-400 ring-2 ring-slate-200/60' : 'border-slate-300'
        }`}
      >
        <Search size={14} className="shrink-0 text-slate-400" />
        <input
          value={open ? query : selected ? `${selected.code} · ${selected.name}` : ''}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (!open) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIdx((i) => Math.min(i + 1, results.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIdx((i) => Math.max(i - 1, 0))
            } else if (event.key === 'Enter' && results[activeIdx]) {
              event.preventDefault()
              pick(results[activeIdx].id)
            }
          }}
          placeholder={t('requisitions.materialSearchPlaceholder')}
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('')
              setQuery('')
            }}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="clear"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[280px] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.map((m, idx) => (
            <button
              key={m.id}
              type="button"
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => pick(m.id)}
              className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 ${
                idx === activeIdx ? 'bg-slate-50' : 'bg-white'
              }`}
            >
              <span className="font-mono text-[11.5px] font-semibold text-slate-900">{m.code}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700">{m.name}</span>
              <span className="text-[10.5px] text-slate-500">{m.default_unit}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Atoms ──────────────────────────────────────────────────────────────────

function KpiTile({
  icon: Icon,
  accent,
  label,
  value,
  sub,
  active,
  onClick,
}: {
  icon: typeof ClipboardList
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
  className,
}: {
  icon: typeof Inbox
  headline: string
  sub: string
  className?: string
}) {
  return (
    <div className={`mx-auto flex max-w-sm flex-col items-center gap-2 text-center ${className ?? ''}`}>
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon size={20} />
      </span>
      <p className="text-sm font-medium text-slate-900">{headline}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  )
}
