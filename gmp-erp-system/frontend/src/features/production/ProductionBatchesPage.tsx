import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  ListFilter,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Ban, Boxes, FileText, History, Package } from 'lucide-react'

import {
  assignProductionBatch,
  cancelProductionBatch,
  completeProductionBatch,
  createProduct,
  createProductionBatch,
  getBatchBmrInstance,
  getProductionBatchAudit,
  getProductionBatchRequisitions,
  listProductionBatches,
  listProducts,
  previewProductionBatch,
  requestProductionBmr,
  startProductionBatch,
  updateProduct,
} from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { BmrInstanceItem, ProductionBatchAuditItem, ProductionBatchItem, ProductItem, RequisitionItem } from '../../types/inventory'
import { BmrFillModal } from './BmrFillModal'

type Translate = ReturnType<typeof useI18n>['t']
function bmrInstanceStatus(s: string, t: Translate): string {
  return ['issued', 'in_progress', 'completed', 'reviewed'].includes(s) ? t(`prodBatch.bmrInst.${s}` as Parameters<Translate>[0]) : s
}
function reqStatusLabel(s: string, t: Translate): string {
  return ['draft', 'submitted', 'processing', 'partially_issued', 'issued', 'cancelled'].includes(s) ? t(`prodBatch.reqStatus.${s}` as Parameters<Translate>[0]) : s
}
function actionLabel(a: string, t: Translate): string {
  const known = ['SAVE_DRAFT_BATCH', 'ASSIGN_BATCH_NO', 'REQUEST_BMR', 'ISSUE_BMR', 'UPDATE_START_CHECKLIST', 'START_PRODUCTION_BATCH', 'COMPLETE_PRODUCTION_BATCH', 'CANCEL_PRODUCTION_BATCH']
  return known.includes(a) ? t(`prodBatch.action.${a}` as Parameters<Translate>[0]) : a
}
function statusLabel(s: string, t: Translate): string {
  return STATUS_FILTERS.includes(s) && s ? t(`prodBatch.status.${s}` as Parameters<Translate>[0]) : s
}

const REQ_STATUS_STYLE: Record<string, string> = {
  submitted: 'border-amber-200 bg-amber-50 text-amber-700',
  processing: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  partially_issued: 'border-blue-200 bg-blue-50 text-blue-700',
  issued: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
}

interface ProductionBatchesPageProps {
  token: string
  user: CurrentUser
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-100 text-slate-600',
  assigned: 'border-amber-200 bg-amber-50 text-amber-700',
  bmr_requested: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  bmr_issued: 'border-blue-200 bg-blue-50 text-blue-700',
  ready_to_start: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  in_production: 'border-slate-300 bg-slate-900 text-white',
  completed: 'border-violet-200 bg-violet-50 text-violet-700',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
}


const STATUS_FILTERS = ['', 'draft', 'assigned', 'bmr_requested', 'bmr_issued', 'ready_to_start', 'in_production', 'completed', 'cancelled']

const BATCH_ROUTE = [
  { key: 'draft' },
  { key: 'assigned' },
  { key: 'bmr_requested' },
  { key: 'bmr_issued' },
  { key: 'ready_to_start' },
  { key: 'in_production' },
  { key: 'completed' },
]

const ROUTE_INDEX = Object.fromEntries(BATCH_ROUTE.map((step, index) => [step.key, index]))

const KPI_TONES: Record<string, string> = {
  draft: 'bg-slate-400',
  assigned: 'bg-amber-400',
  bmr_requested: 'bg-cyan-400',
  in_production: 'bg-slate-900',
  completed: 'bg-violet-400',
  cancelled: 'bg-rose-400',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value))
}

function formatDateTime(value: string | null): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function waitingFor(batch: ProductionBatchItem, t: Translate) {
  switch (batch.status) {
    case 'draft':
      return { text: t('prodBatch.wait.assign' as Parameters<Translate>[0]), tone: 'border-amber-200 bg-amber-50 text-amber-700' }
    case 'assigned':
      return { text: t('prodBatch.wait.requestBmr' as Parameters<Translate>[0]), tone: 'border-amber-200 bg-amber-50 text-amber-700' }
    case 'bmr_requested':
      return { text: t('prodBatch.wait.issueBmr' as Parameters<Translate>[0]), tone: 'border-cyan-200 bg-cyan-50 text-cyan-700' }
    case 'bmr_issued':
    case 'ready_to_start':
      return { text: t('prodBatch.wait.start' as Parameters<Translate>[0]), tone: 'border-blue-200 bg-blue-50 text-blue-700' }
    case 'in_production':
      return { text: t('prodBatch.wait.inProduction' as Parameters<Translate>[0]), tone: 'border-slate-200 bg-slate-50 text-slate-600' }
    default:
      return null
  }
}

function routeState(stepKey: string, batch: ProductionBatchItem): 'done' | 'current' | 'upcoming' {
  const current = ROUTE_INDEX[batch.status] ?? 0
  const index = ROUTE_INDEX[stepKey] ?? 0
  if (batch.status === 'cancelled') return index <= current ? 'done' : 'upcoming'
  if (index < current) return 'done'
  if (index === current) return 'current'
  return 'upcoming'
}

function makeInitialForm(unit = 'pcs') {
  return {
    product_id: '',
    product_code: '',
    product_name: '',
    dosage_form: '',
    batch_size: '10000',
    batch_size_unit: unit,
    production_date: todayIso(),
    shelf_life_months: '24',
    notes: '',
    manual_number: false,
    batch_no_override: '',
    override_reason: '',
  }
}

type BatchForm = ReturnType<typeof makeInitialForm>

export function ProductionBatchesPage({ token, user }: ProductionBatchesPageProps) {
  const { t } = useI18n()
  const canCreate = user.permissions.includes('MANAGE_PRODUCTION')
  const canRequestBmr = user.permissions.includes('MANAGE_PRODUCTION') || user.role === 'SYS_ADMIN'
  const canExecute = user.permissions.includes('EXECUTE_BMR') || user.permissions.includes('MANAGE_PRODUCTION')
  // Журнал серии (audit trail) — у админа и ДОК; проверка номера/выдача ЗПС —
  // у ДКК/ДОК, не у производства.
  const canViewAudit = user.role === 'SYS_ADMIN' || user.permissions.includes('VIEW_AUDIT') || user.permissions.includes('VIEW_QA') || user.permissions.includes('QA_DECISION')

  const [batches, setBatches] = useState<ProductionBatchItem[]>([])
  const [products, setProducts] = useState<ProductItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showProducts, setShowProducts] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [form, setForm] = useState(() => makeInitialForm(t('prodBatch.defaultUnit')))
  const [preview, setPreview] = useState<{ batch_no: string; expiry_date: string; serial_no: number } | null>(null)
  const [startPassword, setStartPassword] = useState('')
  const [startReason, setStartReason] = useState(() => t('prodBatch.startReasonDefault'))
  const [completePassword, setCompletePassword] = useState('')
  const [completeReason, setCompleteReason] = useState(() => t('prodBatch.completeReasonDefault'))
  const [cancelPassword, setCancelPassword] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [audit, setAudit] = useState<ProductionBatchAuditItem[]>([])
  const [linkedReqs, setLinkedReqs] = useState<RequisitionItem[]>([])
  const [bmrInstance, setBmrInstance] = useState<BmrInstanceItem | null>(null)
  const [fillInstanceId, setFillInstanceId] = useState<string | null>(null)

  const selected = useMemo(
    () => batches.find((batch) => batch.id === selectedId) ?? batches[0] ?? null,
    [batches, selectedId],
  )

  const filteredBatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return batches.filter((batch) => {
      if (statusFilter && batch.status !== statusFilter) return false
      if (!q) return true
      return (
        batch.batch_no.toLowerCase().includes(q) ||
        batch.product_name.toLowerCase().includes(q) ||
        batch.product_code.toLowerCase().includes(q) ||
        (batch.bmr_no ?? '').toLowerCase().includes(q)
      )
    })
  }, [batches, search, statusFilter])

  const lastForProduct = useMemo(() => {
    if (!form.product_id) return null
    return [...batches]
      .filter((batch) => batch.product_id === form.product_id)
      .sort((a, b) => b.serial_no - a.serial_no)[0] ?? null
  }, [batches, form.product_id])

  async function load() {
    setIsLoading(true)
    setError(null)
    try {
      const [batchResp, productResp] = await Promise.all([
        listProductionBatches(token),
        listProducts(token).catch(() => ({ products: [] as ProductItem[] })),
      ])
      setBatches(batchResp.batches)
      setProducts(productResp.products)
      setSelectedId((current) => {
        if (current && batchResp.batches.some((batch) => batch.id === current)) return current
        return batchResp.batches[0]?.id ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('prodBatch.loadError'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const selectedAuditId = selected?.id ?? null
  useEffect(() => {
    let ignore = false
    async function loadAudit() {
      if (!selectedAuditId) { setAudit([]); setLinkedReqs([]); setBmrInstance(null); return }
      try {
        const [auditResp, reqResp, bmrResp] = await Promise.all([
          getProductionBatchAudit(token, selectedAuditId),
          getProductionBatchRequisitions(token, selectedAuditId).catch(() => ({ requisitions: [] as RequisitionItem[] })),
          getBatchBmrInstance(token, selectedAuditId).catch(() => ({ instance: null })),
        ])
        if (!ignore) { setAudit(auditResp.events); setLinkedReqs(reqResp.requisitions); setBmrInstance(bmrResp.instance) }
      } catch {
        if (!ignore) { setAudit([]); setLinkedReqs([]); setBmrInstance(null) }
      }
    }
    void loadAudit()
    return () => { ignore = true }
    // refetch when selection changes or batches reload after an action
  }, [selectedAuditId, batches, token])

  useEffect(() => {
    let ignore = false
    async function runPreview() {
      if (!showCreate || !form.product_id || !form.production_date || Number(form.shelf_life_months) < 1) {
        setPreview(null)
        return
      }
      try {
        const response = await previewProductionBatch(token, {
          product_id: form.product_id,
          production_date: form.production_date,
          shelf_life_months: Number(form.shelf_life_months),
        })
        if (!ignore) setPreview(response)
      } catch {
        if (!ignore) setPreview(null)
      }
    }
    const timer = window.setTimeout(() => void runPreview(), 250)
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [form.product_id, form.production_date, form.shelf_life_months, showCreate, token])

  async function runAction(fn: () => Promise<void>, done: string) {
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      await fn()
      setSuccess(done)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('prodBatch.opFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCreate(asDraft: boolean) {
    await runAction(async () => {
      const created = await createProductionBatch(token, {
        product_id: form.product_id,
        product_name: form.product_name || null,
        dosage_form: form.dosage_form || null,
        batch_size: Number(form.batch_size),
        batch_size_unit: form.batch_size_unit,
        production_date: form.production_date,
        shelf_life_months: Number(form.shelf_life_months),
        notes: form.notes || null,
        batch_no_override: form.manual_number ? form.batch_no_override.trim() || null : null,
        override_reason: form.manual_number ? form.override_reason.trim() || null : null,
        as_draft: asDraft,
      })
      setSelectedId(created.id)
      setShowCreate(false)
      setForm(makeInitialForm(t('prodBatch.defaultUnit')))
    }, asDraft ? t('prodBatch.draftSaved') : t('prodBatch.assignedSop'))
  }

  async function handleAssign(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await assignProductionBatch(token, batch.id)
      setSelectedId(updated.id)
    }, t('prodBatch.assignedDone'))
  }

  async function handleCancel(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await cancelProductionBatch(token, batch.id, {
        username: user.username,
        password: cancelPassword,
        meaning: t('prodBatch.cancelMeaning'),
        reason: cancelReason,
      })
      setSelectedId(updated.id)
      setCancelPassword('')
      setCancelReason('')
    }, t('prodBatch.cancelDone'))
  }

  async function handleSaveProduct(input: Parameters<typeof createProduct>[1], id: string | null) {
    await runAction(async () => {
      if (id) await updateProduct(token, id, input)
      else await createProduct(token, input)
    }, id ? t('prodBatch.productUpdated') : t('prodBatch.productAdded'))
  }

  async function handleRequestBmr(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await requestProductionBmr(token, batch.id)
      setSelectedId(updated.id)
    }, t('prodBatch.bmrRequestedDone'))
  }

  async function handleStart(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await startProductionBatch(token, batch.id, {
        username: user.username,
        password: startPassword,
        meaning: t('prodBatch.startMeaning'),
        reason: startReason,
      })
      setSelectedId(updated.id)
      setStartPassword('')
    }, t('prodBatch.startDone'))
  }

  async function handleComplete(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await completeProductionBatch(token, batch.id, {
        username: user.username,
        password: completePassword,
        meaning: t('prodBatch.completeMeaning'),
        reason: completeReason,
      })
      setSelectedId(updated.id)
      setCompletePassword('')
    }, t('prodBatch.completeDone'))
  }

  const createInvalid =
    !canCreate ||
    !form.product_id ||
    !form.product_name.trim() ||
    Number(form.batch_size) <= 0 ||
    Number(form.shelf_life_months) <= 0 ||
    (form.manual_number && form.batch_no_override.trim().length > 0 && !form.override_reason.trim())

  const kpiDraft = batches.filter((batch) => batch.status === 'draft').length
  const kpiAssigned = batches.filter((batch) => batch.status === 'assigned').length
  const kpiBmrRequested = batches.filter((batch) => batch.status === 'bmr_requested').length
  const kpiActive = batches.filter((batch) => batch.status === 'in_production').length
  const kpiCompleted = batches.filter((batch) => batch.status === 'completed').length
  const kpiCancelled = batches.filter((batch) => batch.status === 'cancelled').length
  const myActionCount = batches.filter((batch) => {
    if (batch.status === 'bmr_requested') return canViewAudit
    if (['draft', 'assigned', 'bmr_issued', 'ready_to_start', 'in_production'].includes(batch.status)) return canCreate || canExecute || canRequestBmr
    return false
  }).length
  const toggleFilter = (s: string) => setStatusFilter((cur) => (cur === s ? '' : s))

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('prodBatch.eyebrow')}</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-slate-950">{t('prodBatch.title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            {t('prodBatch.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={15} />
            {t('common.refresh')}
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => setShowProducts(true)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Package size={16} />
              {t('prodBatch.productsCatalog')}
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => { setForm(makeInitialForm(t('prodBatch.defaultUnit'))); setShowCreate(true) }}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Plus size={16} />
              {t('prodBatch.newBatch')}
            </button>
          )}
        </div>
      </div>

      {error && <Notice tone="error" text={error} />}
      {success && <Notice tone="success" text={success} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={t('prodBatch.kpiDraft')} value={kpiDraft} tone={KPI_TONES.draft} active={statusFilter === 'draft'} onClick={() => toggleFilter('draft')} />
        <KpiCard label={t('prodBatch.kpiAssigned')} value={kpiAssigned} tone={KPI_TONES.assigned} active={statusFilter === 'assigned'} onClick={() => toggleFilter('assigned')} />
        <KpiCard label={t('prodBatch.kpiBmrRequested')} value={kpiBmrRequested} tone={KPI_TONES.bmr_requested} active={statusFilter === 'bmr_requested'} onClick={() => toggleFilter('bmr_requested')} />
        <KpiCard label={t('prodBatch.kpiActive')} value={kpiActive} tone={KPI_TONES.in_production} active={statusFilter === 'in_production'} onClick={() => toggleFilter('in_production')} />
        <KpiCard label={t('prodBatch.kpiCompleted')} value={kpiCompleted} tone={KPI_TONES.completed} active={statusFilter === 'completed'} onClick={() => toggleFilter('completed')} />
        <KpiCard label={t('prodBatch.kpiCancelled')} value={kpiCancelled} tone={KPI_TONES.cancelled} active={statusFilter === 'cancelled'} onClick={() => toggleFilter('cancelled')} />
      </div>

      {myActionCount > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          <AlertTriangle size={17} className="shrink-0" />
          <span>{t('prodBatch.myActionsCount' as Parameters<Translate>[0], { n: myActionCount })}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[260px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              name="production-batch-registry-search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('prodBatch.searchPlaceholder')}
              className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/70"
            />
          </div>
          <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
            <ListFilter size={15} className="mx-1 text-slate-400" />
            {STATUS_FILTERS.map((status) => (
              <button
                key={status || 'all'}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`h-8 rounded px-2.5 text-xs font-medium ${
                  statusFilter === status ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                {status ? statusLabel(status, t) : t('prodBatch.allFilter')}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-4 py-3">{t('prodBatch.thBatchNo')} · {t('prodBatch.thProduct')}</th>
                <th className="px-4 py-3">{t('prodBatch.thSize')}</th>
                <th className="px-4 py-3">{t('prodBatch.thProdDate')}</th>
                <th className="px-4 py-3">{t('prodBatch.thExpiry')}</th>
                <th className="px-4 py-3">{t('prodBatch.thStatus')}</th>
                <th className="px-4 py-3">{t('prodBatch.thIndicator' as Parameters<Translate>[0])}</th>
              </tr>
            </thead>
            <tbody>
              {filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">
                    {isLoading ? t('prodBatch.loading') : t('prodBatch.notFound')}
                  </td>
                </tr>
              ) : (
                filteredBatches.map((batch) => (
                  <tr
                    key={batch.id}
                    onClick={() => setSelectedId(batch.id)}
                    className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
                      selected?.id === batch.id ? 'bg-blue-50/60' : 'bg-white'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold text-slate-950">{batch.batch_no}</div>
                      <div className="text-xs text-slate-500">{batch.product_name} · {t('prodBatch.codeShort')} {batch.product_code}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{batch.batch_size} {batch.batch_size_unit}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{formatDate(batch.production_date)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{formatDate(batch.expiry_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={batch.status} /></td>
                    <td className="px-4 py-3"><WaitingPill batch={batch} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? (
        <BatchDetail
          batch={selected}
          audit={audit}
          linkedReqs={linkedReqs}
          bmrInstance={bmrInstance}
          onOpenBmr={(id) => setFillInstanceId(id)}
          canRequestBmr={canRequestBmr}
          canExecute={canExecute}
          canManage={canCreate}
          canViewAudit={canViewAudit}
          cancelPassword={cancelPassword}
          cancelReason={cancelReason}
          onCancelPassword={setCancelPassword}
          onCancelReason={setCancelReason}
          onCancel={() => void handleCancel(selected)}
          onAssign={() => void handleAssign(selected)}
          onRequestBmr={() => void handleRequestBmr(selected)}
          startPassword={startPassword}
          startReason={startReason}
          completePassword={completePassword}
          completeReason={completeReason}
          onStartPassword={setStartPassword}
          onStartReason={setStartReason}
          onCompletePassword={setCompletePassword}
          onCompleteReason={setCompleteReason}
          onStart={() => void handleStart(selected)}
          onComplete={() => void handleComplete(selected)}
          isLoading={isLoading}
        />
      ) : (
        <ProductionEmptyState />
      )}

      {showCreate && (
        <CreateBatchModal
          form={form}
          products={products}
          preview={preview}
          lastForProduct={lastForProduct}
          createInvalid={createInvalid}
          isLoading={isLoading}
          onChange={setForm}
          onClose={() => setShowCreate(false)}
          onCreate={(asDraft) => void handleCreate(asDraft)}
        />
      )}

      {showProducts && (
        <ProductsManagerModal
          products={products}
          isLoading={isLoading}
          onSave={(input, id) => void handleSaveProduct(input, id)}
          onClose={() => setShowProducts(false)}
        />
      )}

      {fillInstanceId && (
        <BmrFillModal
          token={token}
          user={user}
          instanceId={fillInstanceId}
          onClose={() => setFillInstanceId(null)}
          onChanged={() => void load()}
        />
      )}
    </section>
  )
}

function ProductionEmptyState() {
  const { t } = useI18n()
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <div className="text-[16px] font-semibold text-slate-950">{t('prodBatch.emptyPanelTitle' as Parameters<Translate>[0])}</div>
          <div className="mt-1 text-sm text-slate-500">{t('prodBatch.emptyPanelHint' as Parameters<Translate>[0])}</div>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('prodBatch.routeTitle' as Parameters<Translate>[0])}</div>
        <ol className="hidden items-start md:flex">
          {BATCH_ROUTE.map((step, index) => (
            <li key={step.key} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span className={`h-0.5 flex-1 rounded ${index === 0 ? 'opacity-0' : 'bg-slate-200'}`} />
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400">
                  <span className="font-mono text-[13px] font-semibold">{index + 1}</span>
                </span>
                <span className={`h-0.5 flex-1 rounded ${index === BATCH_ROUTE.length - 1 ? 'opacity-0' : 'bg-slate-200'}`} />
              </div>
              <span className="mt-2 text-center text-xs leading-tight text-slate-400">{t(`prodBatch.route.${step.key}.short` as Parameters<Translate>[0])}</span>
            </li>
          ))}
        </ol>
        <ol className="space-y-0 md:hidden">
          {BATCH_ROUTE.map((step, index) => (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400">
                  <span className="font-mono text-[13px] font-semibold">{index + 1}</span>
                </span>
                {index < BATCH_ROUTE.length - 1 && <span className="w-0.5 flex-1 bg-slate-200" style={{ minHeight: 18 }} />}
              </div>
              <span className="pb-3 pt-1.5 text-sm text-slate-400">{t(`prodBatch.route.${step.key}.label` as Parameters<Translate>[0])}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function BatchDetail({
  batch,
  audit,
  linkedReqs,
  bmrInstance,
  onOpenBmr,
  canRequestBmr,
  canExecute,
  canManage,
  canViewAudit,
  cancelPassword,
  cancelReason,
  onCancelPassword,
  onCancelReason,
  onCancel,
  onAssign,
  onRequestBmr,
  startPassword,
  startReason,
  completePassword,
  completeReason,
  onStartPassword,
  onStartReason,
  onCompletePassword,
  onCompleteReason,
  onStart,
  onComplete,
  isLoading,
}: {
  batch: ProductionBatchItem
  audit: ProductionBatchAuditItem[]
  linkedReqs: RequisitionItem[]
  bmrInstance: BmrInstanceItem | null
  onOpenBmr: (id: string) => void
  canRequestBmr: boolean
  canExecute: boolean
  canManage: boolean
  canViewAudit: boolean
  cancelPassword: string
  cancelReason: string
  onCancelPassword: (value: string) => void
  onCancelReason: (value: string) => void
  onCancel: () => void
  onAssign: () => void
  onRequestBmr: () => void
  startPassword: string
  startReason: string
  completePassword: string
  completeReason: string
  onStartPassword: (value: string) => void
  onStartReason: (value: string) => void
  onCompletePassword: (value: string) => void
  onCompleteReason: (value: string) => void
  onStart: () => void
  onComplete: () => void
  isLoading: boolean
}) {
  const { t } = useI18n()
  const canStart = canExecute && batch.bmr_issued_at && !['in_production', 'completed', 'cancelled'].includes(batch.status)
  const canComplete = canExecute && batch.status === 'in_production' && !batch.completed_at
  const isTerminal = ['in_production', 'completed', 'cancelled'].includes(batch.status)
  const canCancel = canManage && !isTerminal
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-[24px] font-semibold tracking-tight text-slate-950">{batch.batch_no}</h2>
              <StatusBadge status={batch.status} />
            </div>
            <p className="mt-1 text-sm text-slate-600">{batch.product_name}{batch.dosage_form ? ` · ${batch.dosage_form}` : ''}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right text-xs lg:grid-cols-4">
            <Info label={t('prodBatch.thSize')} value={`${batch.batch_size} ${batch.batch_size_unit}`} />
            <Info label={t('prodBatch.thProdDate')} value={formatDate(batch.production_date)} />
            <Info label={t('prodBatch.validUntil')} value={formatDate(batch.expiry_date)} />
            <Info label={t('prodBatch.zps')} value={batch.bmr_no || '-'} />
          </div>
        </div>
      </div>

      {batch.status === 'cancelled' && (
        <InfoStrip tone="rose" icon={Ban}>
          <span className="font-semibold">{t('prodBatch.cancelledLabel')}</span> {formatDate(batch.cancelled_at)}
          {batch.cancel_reason ? ` · ${batch.cancel_reason}` : ''}. {t('prodBatch.staysInLog')}
        </InfoStrip>
      )}

      <RouteStepper batch={batch} />

      <ActionPanel
        batch={batch}
        bmrInstance={bmrInstance}
        canManage={canManage}
        canRequestBmr={canRequestBmr}
        canExecute={canExecute}
        canStart={!!canStart}
        canComplete={!!canComplete}
        startPassword={startPassword}
        startReason={startReason}
        completePassword={completePassword}
        completeReason={completeReason}
        onAssign={onAssign}
        onRequestBmr={onRequestBmr}
        onStartPassword={onStartPassword}
        onStartReason={onStartReason}
        onCompletePassword={onCompletePassword}
        onCompleteReason={onCompleteReason}
        onStart={onStart}
        onComplete={onComplete}
        onOpenBmr={onOpenBmr}
        isLoading={isLoading}
      />

      {canCancel && (
        <CancelStrip
          cancelPassword={cancelPassword}
          cancelReason={cancelReason}
          onCancelPassword={onCancelPassword}
          onCancelReason={onCancelReason}
          onCancel={onCancel}
          isLoading={isLoading}
        />
      )}

      <DetailTabs
        batch={batch}
        audit={audit}
        linkedReqs={linkedReqs}
        bmrInstance={bmrInstance}
        canViewAudit={canViewAudit}
        onOpenBmr={onOpenBmr}
      />
    </section>
  )
}

function RouteStepper({ batch }: { batch: ProductionBatchItem }) {
  const { t } = useI18n()
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('prodBatch.routeTitle' as Parameters<Translate>[0])}</span>
        <span className="text-xs text-slate-400">{statusLabel(batch.status, t)}</span>
      </div>
      <ol className="hidden items-start md:flex">
        {BATCH_ROUTE.map((step, index) => {
          const state = routeState(step.key, batch)
          const nextState = BATCH_ROUTE[index + 1] ? routeState(BATCH_ROUTE[index + 1].key, batch) : 'upcoming'
          return (
            <li key={step.key} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span className={`h-0.5 flex-1 rounded ${index === 0 ? 'opacity-0' : state === 'done' || state === 'current' ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                <StepDot state={state} index={index} />
                <span className={`h-0.5 flex-1 rounded ${index === BATCH_ROUTE.length - 1 ? 'opacity-0' : nextState === 'done' ? 'bg-emerald-300' : 'bg-slate-200'}`} />
              </div>
              <span className={`mt-2 text-center text-xs leading-tight ${state === 'current' ? 'font-semibold text-blue-700' : state === 'done' ? 'text-slate-700' : 'text-slate-400'}`}>
                {t(`prodBatch.route.${step.key}.short` as Parameters<Translate>[0])}
              </span>
            </li>
          )
        })}
      </ol>
      <ol className="space-y-0 md:hidden">
        {BATCH_ROUTE.map((step, index) => {
          const state = routeState(step.key, batch)
          return (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <StepDot state={state} index={index} />
                {index < BATCH_ROUTE.length - 1 && <span className={`w-0.5 flex-1 ${state === 'done' ? 'bg-emerald-300' : 'bg-slate-200'}`} style={{ minHeight: 18 }} />}
              </div>
              <span className={`pb-3 pt-1.5 text-sm ${state === 'current' ? 'font-semibold text-blue-700' : state === 'done' ? 'text-slate-800' : 'text-slate-400'}`}>
                {t(`prodBatch.route.${step.key}.label` as Parameters<Translate>[0])}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function StepDot({ state, index }: { state: 'done' | 'current' | 'upcoming'; index: number }) {
  if (state === 'done') {
    return <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm"><CheckCircle2 size={17} /></span>
  }
  if (state === 'current') {
    return <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm ring-4 ring-blue-100"><span className="font-mono text-[13px] font-bold">{index + 1}</span></span>
  }
  return <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400"><span className="font-mono text-[13px] font-semibold">{index + 1}</span></span>
}

function ActionPanel({
  batch,
  bmrInstance,
  canManage,
  canRequestBmr,
  canExecute,
  canStart,
  canComplete,
  startPassword,
  startReason,
  completePassword,
  completeReason,
  onAssign,
  onRequestBmr,
  onStartPassword,
  onStartReason,
  onCompletePassword,
  onCompleteReason,
  onStart,
  onComplete,
  onOpenBmr,
  isLoading,
}: {
  batch: ProductionBatchItem
  bmrInstance: BmrInstanceItem | null
  canManage: boolean
  canRequestBmr: boolean
  canExecute: boolean
  canStart: boolean
  canComplete: boolean
  startPassword: string
  startReason: string
  completePassword: string
  completeReason: string
  onAssign: () => void
  onRequestBmr: () => void
  onStartPassword: (value: string) => void
  onStartReason: (value: string) => void
  onCompletePassword: (value: string) => void
  onCompleteReason: (value: string) => void
  onStart: () => void
  onComplete: () => void
  onOpenBmr: (id: string) => void
  isLoading: boolean
}) {
  const { t } = useI18n()
  if (batch.status === 'draft') {
    return (
      <PanelShell icon={ShieldCheck} tone="blue" title={t('prodBatch.assignBatch')} sub={t('prodBatch.assignSub' as Parameters<Translate>[0])}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">{t('prodBatch.draftNotice')}</p>
          <button type="button" disabled={!canManage || isLoading} onClick={onAssign} className="inline-flex h-11 items-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            <ShieldCheck size={17} />
            {t('prodBatch.assignBatch')}
          </button>
        </div>
      </PanelShell>
    )
  }
  if (batch.status === 'assigned') {
    return (
      <PanelShell icon={FileSignature} tone="blue" title={t('prodBatch.requestBmrTitle')} sub={t('prodBatch.requestBmrSub')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">{t('prodBatch.requestBmrHint')}</p>
          <button type="button" disabled={!canRequestBmr || isLoading} onClick={onRequestBmr} className="inline-flex h-11 items-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            <FileSignature size={17} />
            {t('prodBatch.requestBmrBtn')}
          </button>
        </div>
      </PanelShell>
    )
  }
  if (batch.status === 'bmr_requested') {
    return (
      <InfoStrip tone="cyan" icon={FileSignature}>
        {t('prodBatch.waitingDokIssue' as Parameters<Translate>[0], { date: formatDate(batch.bmr_requested_at) })}
      </InfoStrip>
    )
  }
  if (batch.status === 'bmr_issued' || batch.status === 'ready_to_start') {
    return (
      <PanelShell icon={Play} tone="blue" title={t('prodBatch.startTitle')} sub={t('prodBatch.startSub')}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <Field label={t('prodBatch.eSignPassword')}>
            <input
              type="password"
              name="production-start-esign-password"
              autoComplete="new-password"
              className="input"
              value={startPassword}
              onChange={(e) => onStartPassword(e.target.value)}
              disabled={!canStart}
            />
          </Field>
          <Field label={t('prodBatch.basis')}>
            <input name="production-start-reason" autoComplete="off" className="input" value={startReason} onChange={(e) => onStartReason(e.target.value)} disabled={!canStart} />
          </Field>
          <button type="button" disabled={!canStart || !startPassword || isLoading} onClick={onStart} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            <Play size={16} />
            {t('prodBatch.startBtn')}
          </button>
        </div>
      </PanelShell>
    )
  }
  if (batch.status === 'in_production') {
    return (
      <PanelShell icon={CheckCircle2} tone="violet" title={t('prodBatch.completeTitle')} sub={t('prodBatch.completeSub')}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <Field label={t('prodBatch.eSignPassword')}>
            <input
              type="password"
              name="production-complete-esign-password"
              autoComplete="new-password"
              className="input"
              value={completePassword}
              onChange={(e) => onCompletePassword(e.target.value)}
              disabled={!canComplete}
            />
          </Field>
          <Field label={t('prodBatch.basis')}>
            <input autoComplete="off" className="input" value={completeReason} onChange={(e) => onCompleteReason(e.target.value)} disabled={!canComplete} />
          </Field>
          <button type="button" disabled={!canComplete || !completePassword || isLoading} onClick={onComplete} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
            <CheckCircle2 size={16} />
            {t('prodBatch.completeBtn')}
          </button>
        </div>
      </PanelShell>
    )
  }
  if (batch.status === 'completed') {
    return (
      <InfoStrip tone="violet" icon={CheckCircle2}>
        {t('prodBatch.completedRegistryNote' as Parameters<Translate>[0], { date: formatDate(batch.completed_at) })}
      </InfoStrip>
    )
  }
  if (batch.status === 'cancelled') {
    return <InfoStrip tone="slate" icon={Ban}>{t('prodBatch.cancelledBlockedNote' as Parameters<Translate>[0])}</InfoStrip>
  }
  return (
    <InfoStrip tone="slate" icon={FileText}>
      {bmrInstance ? `${bmrInstance.title}` : t('prodBatch.selectOrCreate')}
    </InfoStrip>
  )
}

function CancelStrip({
  cancelPassword,
  cancelReason,
  onCancelPassword,
  onCancelReason,
  onCancel,
  isLoading,
}: {
  cancelPassword: string
  cancelReason: string
  onCancelPassword: (value: string) => void
  onCancelReason: (value: string) => void
  onCancel: () => void
  isLoading: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-3 text-left shadow-sm hover:bg-slate-50">
        <span className="flex items-center gap-2 text-sm text-slate-500"><Ban size={16} /> {t('prodBatch.cancelTitle')}</span>
        <span className="text-xs text-slate-400">{t('prodBatch.cancelSub')}</span>
      </button>
    )
  }
  return (
    <PanelShell icon={Ban} tone="rose" title={t('prodBatch.cancelTitle')} sub={t('prodBatch.cancelSub')}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <Field label={t('prodBatch.cancelReasonLabel')}>
          <input autoComplete="off" className="input" value={cancelReason} onChange={(e) => onCancelReason(e.target.value)} placeholder={t('prodBatch.cancelReasonPh')} />
        </Field>
        <Field label={t('prodBatch.eSignPassword')}>
          <input
            type="password"
            name="production-cancel-esign-password"
            autoComplete="new-password"
            className="input"
            value={cancelPassword}
            onChange={(e) => onCancelPassword(e.target.value)}
          />
        </Field>
        <button type="button" disabled={!cancelReason.trim() || !cancelPassword || isLoading} onClick={onCancel} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-rose-600 px-5 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">
          <Ban size={16} />
          {t('prodBatch.cancelBtn')}
        </button>
      </div>
      <button type="button" onClick={() => setOpen(false)} className="mt-3 text-xs font-medium text-slate-500 hover:text-slate-800">{t('prodBatch.collapse' as Parameters<Translate>[0])}</button>
    </PanelShell>
  )
}

function DetailTabs({
  batch,
  audit,
  linkedReqs,
  bmrInstance,
  canViewAudit,
  onOpenBmr,
}: {
  batch: ProductionBatchItem
  audit: ProductionBatchAuditItem[]
  linkedReqs: RequisitionItem[]
  bmrInstance: BmrInstanceItem | null
  canViewAudit: boolean
  onOpenBmr: (id: string) => void
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'bmr' | 'reqs' | 'audit'>('bmr')
  const tabs = [
    { key: 'bmr' as const, label: t('prodBatch.eBmrTitle'), icon: FileText },
    { key: 'reqs' as const, label: t('prodBatch.linkedReqsTitle'), icon: Boxes, n: linkedReqs.length },
    ...(canViewAudit ? [{ key: 'audit' as const, label: t('prodBatch.auditTitle'), icon: History, n: audit.length }] : []),
  ]
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap gap-1 border-b border-slate-100 p-1.5">
        {tabs.map((item) => {
          const Icon = item.icon
          const active = tab === item.key
          return (
            <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`inline-flex h-10 items-center gap-2 rounded-md px-3.5 text-sm font-medium ${active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              <Icon size={16} />
              {item.label}
              {typeof item.n === 'number' && <span className={`rounded px-1.5 font-mono text-[11px] ${active ? 'bg-white/20' : 'bg-slate-200 text-slate-600'}`}>{item.n}</span>}
            </button>
          )
        })}
      </div>
      <div className="p-5">
        {tab === 'bmr' && <BmrTab bmrInstance={bmrInstance} onOpenBmr={onOpenBmr} />}
        {tab === 'reqs' && <ReqsTab linkedReqs={linkedReqs} />}
        {tab === 'audit' && <AuditTab audit={audit} batch={batch} />}
      </div>
    </div>
  )
}

function BmrTab({ bmrInstance, onOpenBmr }: { bmrInstance: BmrInstanceItem | null; onOpenBmr: (id: string) => void }) {
  const { t } = useI18n()
  if (!bmrInstance) return <p className="text-sm text-slate-500">{t('prodBatch.eBmrEmpty')}</p>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">{bmrInstanceStatus(bmrInstance.status, t)}</span>
        <span className="text-sm text-slate-700"><b>{bmrInstance.title}</b> · {t('prodBatch.templateV', { v: bmrInstance.template_version })} · {t('prodBatch.sectionsN', { n: bmrInstance.sections.length })}</span>
        <button type="button" onClick={() => onOpenBmr(bmrInstance.id)} className="ml-auto inline-flex h-9 items-center gap-2 rounded-md bg-blue-600 px-3 text-[13px] font-semibold text-white hover:bg-blue-700"><FileText size={15} />{t('prodBatch.openBmr')}</button>
      </div>
      <ol className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
        {bmrInstance.sections.map((section) => (
          <li key={section.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-slate-100 font-mono text-[11px] font-bold text-slate-600">{section.ordinal}</span>
            <span className="font-medium text-slate-900">{section.title}</span>
            <span className="ml-auto text-[11px] text-slate-400">{t('prodBatch.fieldsN', { n: (section.config?.fields ?? []).length })}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-slate-500">{t('prodBatch.eBmrTabletHint')}</p>
    </div>
  )
}

function ReqsTab({ linkedReqs }: { linkedReqs: RequisitionItem[] }) {
  const { t } = useI18n()
  if (linkedReqs.length === 0) return <p className="text-sm text-slate-500">{t('prodBatch.linkedReqsEmpty')}</p>
  return (
    <div className="space-y-3">
      {linkedReqs.map((req) => (
        <div key={req.id} className="rounded-md border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="font-mono text-sm font-semibold text-slate-900">{req.requisition_no}</span>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${REQ_STATUS_STYLE[req.status] ?? 'border-slate-200 bg-slate-100 text-slate-600'}`}>{reqStatusLabel(req.status, t)}</span>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-1.5">{t('prodBatch.thMaterial')}</th>
                <th className="px-3 py-1.5 text-right">{t('prodBatch.thRequested')}</th>
                <th className="px-3 py-1.5 text-right">{t('prodBatch.thIssued')}</th>
              </tr>
            </thead>
            <tbody>
              {req.lines.map((line) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-800">{line.material_name}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">{line.requested_quantity} {line.unit}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-900">{line.issued_quantity} {line.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function AuditTab({ audit, batch }: { audit: ProductionBatchAuditItem[]; batch: ProductionBatchItem }) {
  const { t } = useI18n()
  if (audit.length === 0) return <p className="text-sm text-slate-500">{t('prodBatch.auditEmpty')}</p>
  return (
    <ol className="space-y-0">
      {audit.map((ev, i) => (
        <li key={ev.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-white ${ev.action_type.includes('BATCH') ? 'border-emerald-500' : 'border-blue-500'}`} />
            {i < audit.length - 1 && <span className="w-px flex-1 bg-slate-200" />}
          </div>
          <div className="pb-4">
            <div className="text-sm font-medium text-slate-900">{actionLabel(ev.action_type, t)}</div>
            <div className="text-xs text-slate-500">
              {formatDateTime(ev.created_at)} · {ev.user_name ?? '—'}{ev.role_code ? ` (${ev.role_code})` : ''} · {batch.batch_no}
            </div>
            {ev.reason && <div className="mt-0.5 text-xs italic text-slate-600">«{ev.reason}»</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function PanelShell({ icon: Icon, tone, title, sub, children }: { icon: LucideIcon; tone: 'blue' | 'violet' | 'rose' | 'slate'; title: string; sub: string; children: ReactNode }) {
  const ring = { blue: 'border-blue-200', violet: 'border-violet-200', rose: 'border-rose-200', slate: 'border-slate-200' }[tone]
  const badge = { blue: 'bg-blue-100 text-blue-700', violet: 'bg-violet-100 text-violet-700', rose: 'bg-rose-100 text-rose-700', slate: 'bg-slate-100 text-slate-700' }[tone]
  return (
    <div className={`rounded-lg border bg-white p-5 shadow-sm ${ring}`}>
      <div className="mb-4 flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${badge}`}><Icon size={19} /></span>
        <div>
          <div className="text-[16px] font-semibold text-slate-950">{title}</div>
          <div className="text-[13px] text-slate-500">{sub}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

function InfoStrip({ tone, icon: Icon, children }: { tone: 'slate' | 'cyan' | 'violet' | 'rose'; icon: LucideIcon; children: ReactNode }) {
  const cls = {
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    cyan: 'border-cyan-200 bg-cyan-50 text-cyan-800',
    violet: 'border-violet-200 bg-violet-50 text-violet-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
  }[tone]
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function CreateBatchModal({
  form,
  products,
  preview,
  lastForProduct,
  createInvalid,
  isLoading,
  onChange,
  onClose,
  onCreate,
}: {
  form: BatchForm
  products: ProductItem[]
  preview: { batch_no: string; expiry_date: string; serial_no: number } | null
  lastForProduct: ProductionBatchItem | null
  createInvalid: boolean
  isLoading: boolean
  onChange: (form: BatchForm) => void
  onClose: () => void
  onCreate: (asDraft: boolean) => void
}) {
  const { t } = useI18n()
  const activeProducts = products.filter((p) => p.is_active || p.id === form.product_id)

  function selectProduct(productId: string) {
    const product = products.find((p) => p.id === productId)
    if (!product) {
      onChange({ ...form, product_id: '', product_code: '', product_name: '', dosage_form: '' })
      return
    }
    onChange({
      ...form,
      product_id: product.id,
      product_code: product.code,
      product_name: product.name,
      dosage_form: product.dosage_form ?? '',
      shelf_life_months: String(product.default_shelf_life_months),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-[18px] font-semibold text-slate-950">{t('prodBatch.createTitle')}</h2>
            <p className="text-xs text-slate-500">{t('prodBatch.createSubtitle')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {products.length === 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('prodBatch.noProductsHint')}
            </div>
          )}
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label={t('prodBatch.product')}>
              <select className="input" value={form.product_id} onChange={(e) => selectProduct(e.target.value)}>
                <option value="">{t('prodBatch.selectProduct')}</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.market_code} · {p.name}{p.dosage_form ? ` · ${p.dosage_form}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('prodBatch.productCode')}>
              <input autoComplete="off" className="input font-mono bg-slate-50" value={form.product_code} readOnly />
            </Field>
          </div>
          <Field label={t('prodBatch.productNameEditable')}>
            <input autoComplete="off" className="input" value={form.product_name} onChange={(e) => onChange({ ...form, product_name: e.target.value })} />
          </Field>
          <Field label={t('prodBatch.dosageForm')}>
            <input autoComplete="off" className="input" value={form.dosage_form} onChange={(e) => onChange({ ...form, dosage_form: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('prodBatch.thProdDate')}>
              <input type="date" className="input" value={form.production_date} onChange={(e) => onChange({ ...form, production_date: e.target.value })} />
            </Field>
            <Field label={t('prodBatch.shelfLifeMonths')}>
              <input type="number" min={1} className="input" value={form.shelf_life_months} onChange={(e) => onChange({ ...form, shelf_life_months: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label={t('prodBatch.batchSize')}>
              <input type="number" min={0} className="input" value={form.batch_size} onChange={(e) => onChange({ ...form, batch_size: e.target.value })} />
            </Field>
            <Field label={t('prodBatch.unitShort')}>
              <input autoComplete="off" className="input" value={form.batch_size_unit} onChange={(e) => onChange({ ...form, batch_size_unit: e.target.value })} />
            </Field>
          </div>
          <Field label={t('prodBatch.note')}>
            <textarea rows={2} className="input min-h-[70px] py-2" value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} />
          </Field>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{t('prodBatch.lastBatchForProduct')}</div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-950">{lastForProduct?.batch_no ?? '-'}</div>
              <div className="mt-1 text-xs text-slate-500">
                {lastForProduct ? `${lastForProduct.product_name} · № ${String(lastForProduct.serial_no).padStart(3, '0')}` : t('prodBatch.noBatchesYet')}
              </div>
            </div>
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-blue-600">{t('prodBatch.suggestedNumber')}</div>
              <div className="mt-1 font-mono text-lg font-semibold text-blue-950">{preview?.batch_no ?? '-'}</div>
              <div className="mt-1 text-xs text-blue-700">{t('prodBatch.validUntilColon', { date: formatDate(preview?.expiry_date ?? null) })}</div>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 px-3 py-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={form.manual_number}
                onChange={(e) => onChange({ ...form, manual_number: e.target.checked, batch_no_override: e.target.checked ? (preview?.batch_no ?? '') : '', override_reason: '' })}
              />
              {t('prodBatch.manualNumber')}
            </label>
            {form.manual_number && (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={t('prodBatch.manualNumberField')}>
                  <input autoComplete="off" className="input font-mono" value={form.batch_no_override} onChange={(e) => onChange({ ...form, batch_no_override: e.target.value })} />
                </Field>
                <Field label={t('prodBatch.overrideReasonField')}>
                  <input autoComplete="off" className="input" value={form.override_reason} onChange={(e) => onChange({ ...form, override_reason: e.target.value })} placeholder={t('prodBatch.overrideReasonPh')} />
                </Field>
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
          <p className="text-xs text-slate-500">{t('prodBatch.createFooterHint')}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={createInvalid || isLoading}
              onClick={() => onCreate(true)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('prodBatch.saveDraftBtn')}
            </button>
            <button
              type="button"
              disabled={createInvalid || isLoading}
              onClick={() => onCreate(false)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck size={16} />
              {t('prodBatch.assignBatch')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProductsManagerModal({
  products,
  isLoading,
  onSave,
  onClose,
}: {
  products: ProductItem[]
  isLoading: boolean
  onSave: (input: { code?: string; market_code: string; market_name: string; name: string; dosage_form: string | null; default_shelf_life_months: number; batch_format: string | null; is_active: boolean; notes: string | null }, id: string | null) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [editId, setEditId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [marketCode, setMarketCode] = useState('UZ')
  const [marketName, setMarketName] = useState(() => t('prodBatch.defaultMarketName'))
  const [name, setName] = useState('')
  const [dosageForm, setDosageForm] = useState('')
  const [shelfLife, setShelfLife] = useState('24')
  const [isActive, setIsActive] = useState(true)

  function reset() {
    setEditId(null); setCode(''); setMarketCode('UZ'); setMarketName(t('prodBatch.defaultMarketName')); setName(''); setDosageForm(''); setShelfLife('24'); setIsActive(true)
  }
  function startEdit(p: ProductItem) {
    setEditId(p.id); setCode(p.code); setMarketCode(p.market_code); setMarketName(p.market_name); setName(p.name); setDosageForm(p.dosage_form ?? '')
    setShelfLife(String(p.default_shelf_life_months)); setIsActive(p.is_active)
  }
  function submit() {
    onSave({
      code: editId ? undefined : code.trim(),
      market_code: marketCode.trim().toUpperCase(),
      market_name: marketName.trim(),
      name: name.trim(),
      dosage_form: dosageForm.trim() || null,
      default_shelf_life_months: Number(shelfLife) || 24,
      batch_format: null,
      is_active: isActive,
      notes: null,
    }, editId)
    reset()
  }
  const invalid = (!editId && !/^\d{2,8}$/.test(code.trim())) || !/^[A-Z_]{2,16}$/.test(marketCode.trim().toUpperCase()) || !marketName.trim() || !name.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-[18px] font-semibold text-slate-950">{t('prodBatch.catalogTitle')}</h2>
            <p className="text-xs text-slate-500">{t('prodBatch.catalogSubtitle')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[110px_120px_1fr_140px]">
            <Field label={t('prodBatch.fieldCode')}>
              <input autoComplete="off" className="input font-mono disabled:bg-slate-100" maxLength={8} value={code} disabled={!!editId} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </Field>
            <Field label={t('prodBatch.market')}>
              <input autoComplete="off" className="input font-mono uppercase" maxLength={16} value={marketCode} onChange={(e) => setMarketCode(e.target.value.toUpperCase().replace(/[^A-Z_]/g, '').slice(0, 16))} />
            </Field>
            <Field label={t('prodBatch.marketName')}>
              <input autoComplete="off" className="input" value={marketName} onChange={(e) => setMarketName(e.target.value)} />
            </Field>
            <Field label={t('prodBatch.productName')}>
              <input autoComplete="off" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('prodBatch.shelfLifeShort')}>
              <input type="number" min={1} className="input" value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} />
            </Field>
            <Field label={t('prodBatch.dosageForm')}>
              <input autoComplete="off" className="input" value={dosageForm} onChange={(e) => setDosageForm(e.target.value)} />
            </Field>
            <Field label={t('prodBatch.activeLabel')}>
              <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                {t('prodBatch.inUse')}
              </label>
            </Field>
            <div className="flex items-end gap-2">
              {editId && (
                <button type="button" onClick={reset} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  {t('prodBatch.reset')}
                </button>
              )}
              <button type="button" disabled={invalid || isLoading} onClick={submit} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                <Plus size={16} />
                {editId ? t('common.save') : t('prodBatch.addBtn')}
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">{t('prodBatch.fieldCode')}</th>
                  <th className="px-3 py-2">{t('prodBatch.market')}</th>
                  <th className="px-3 py-2">{t('prodBatch.thName')}</th>
                  <th className="px-3 py-2">{t('prodBatch.thForm')}</th>
                  <th className="px-3 py-2">{t('prodBatch.thShelfLife')}</th>
                  <th className="px-3 py-2">{t('prodBatch.thStatus')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">{t('prodBatch.catalogEmpty')}</td></tr>
                ) : (
                  products.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono font-semibold text-slate-900">{p.code}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                          {p.market_code}
                        </span>
                        <div className="mt-0.5 text-[11px] text-slate-500">{p.market_name}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-800">{p.name}</td>
                      <td className="px-3 py-2 text-slate-600">{p.dosage_form || '-'}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{t('prodBatch.monthsN', { n: p.default_shelf_life_months })}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${p.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
                          {p.is_active ? t('prodBatch.productActive') : t('prodBatch.productArchived')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => startEdit(p)} className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                          {t('common.edit')}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, tone, active, onClick }: { label: string; value: number; tone?: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-lg border bg-white px-4 py-3 text-left shadow-sm transition ${active ? 'border-slate-900 ring-1 ring-slate-900/10' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${tone ?? 'bg-slate-400'}`} />
        <span className="text-xs font-medium leading-tight text-slate-500">{label}</span>
      </div>
      <div className="font-mono text-[26px] font-semibold leading-none text-slate-950">{value}</div>
    </button>
  )
}

function WaitingPill({ batch }: { batch: ProductionBatchItem }) {
  const { t } = useI18n()
  const waiting = waitingFor(batch, t)
  if (!waiting) return <span className="text-xs text-slate-400">-</span>
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${waiting.tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {waiting.text}
    </span>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.assigned}`}>
      {statusLabel(status, t)}
    </span>
  )
}

function SectionTitle({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700">
        <Icon size={17} />
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-slate-950">{title}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
    </div>
  )
}

function Notice({ tone, text }: { tone: 'error' | 'success'; text: string }) {
  const isError = tone === 'error'
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {isError ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
      <span>{text}</span>
    </div>
  )
}
