import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Beaker,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Filter,
  FlaskConical,
  Lock,
  MapPin,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import {
  changeReagentStatus,
  createReagent,
  downloadReagentCardPdf,
  downloadReagentCertificate,
  getReagent,
  getReagentAudit,
  listReagents,
  uploadReagentCertificate,
  useReagent,
} from '../../lib/api'
import type {
  ReagentAuditEvent,
  ReagentCertificateItem,
  ReagentCreate,
  ReagentDetail,
  ReagentItem,
  ReagentMovementItem,
} from '../../types/inventory'

type ReagentType = 'reagent' | 'reference_standard' | 'working_standard' | 'volumetric_solution' | 'consumable'
type ReagentStatus =
  | 'draft'
  | 'received'
  | 'quarantine'
  | 'approved'
  | 'opened'
  | 'in_use'
  | 'expiring'
  | 'expired'
  | 'blocked'
  | 'disposed'
  | 'depleted'
type OperationType = 'receipt' | 'opening' | 'consumption' | 'adjustment' | 'blocking' | 'disposal' | 'return' | string

interface Reagent {
  id: string
  code: string
  name: string
  type: ReagentType
  grade: string
  manufacturer: string
  supplier: string
  batchNumber: string
  internalBatchNumber: string
  receivedDate: string
  openedDate: string | null
  expiryDateUnopened: string
  expiryDateAfterOpening: number
  status: ReagentStatus
  quantity: number
  unit: string
  storageLocation: string
  storageConditions: string
  responsible: string
  coaAttached: boolean
  notes: string
}

interface Movement {
  id: string
  reagentId: string
  date: string
  type: OperationType
  quantityBefore: number
  quantityOperation: number
  quantityAfter: number
  analyticalSheet: string
  materialBatch: string
  user: string
  reason: string
  signature: boolean
}

interface Props {
  token: string
  user: CurrentUser
}

type Translate = ReturnType<typeof useI18n>['t']
function typeLabel(v: string, t: Translate): string {
  return t(`reagents.type.${v}` as Parameters<Translate>[0])
}
function statusLabel(v: string, t: Translate): string {
  return t(`reagents.status.${v}` as Parameters<Translate>[0])
}
const OP_KEYS: Record<string, string> = {
  receipt: 'reagents.op.receipt', opening: 'reagents.op.opening', consumption: 'reagents.op.consumption',
  adjustment: 'reagents.op.adjustment', blocking: 'reagents.op.blocking', blocked: 'reagents.op.blocking',
  disposal: 'reagents.op.disposal', disposed: 'reagents.op.disposal', approved: 'reagents.op.approved',
  quarantine: 'reagents.op.quarantine', return: 'reagents.op.return',
}
function opLabel(v: string, t: Translate): string {
  const k = OP_KEYS[v]
  return k ? t(k as Parameters<Translate>[0]) : v
}

const REAGENT_TYPE_VALUES: ReagentType[] = ['reagent', 'reference_standard', 'working_standard', 'volumetric_solution', 'consumable']
const REAGENT_STATUS_VALUES: ReagentStatus[] = ['draft', 'received', 'quarantine', 'approved', 'opened', 'in_use', 'expiring', 'expired', 'blocked', 'disposed', 'depleted']

const statusClass: Record<ReagentStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  received: 'bg-blue-50 text-blue-700 ring-blue-200',
  quarantine: 'bg-amber-50 text-amber-700 ring-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  opened: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  in_use: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  expiring: 'bg-orange-50 text-orange-700 ring-orange-200',
  expired: 'bg-rose-50 text-rose-700 ring-rose-200',
  blocked: 'bg-rose-50 text-rose-700 ring-rose-200',
  disposed: 'bg-slate-100 text-slate-500 ring-slate-200',
  depleted: 'bg-slate-100 text-slate-500 ring-slate-200',
}

function effectiveExpiry(reagent: Reagent): Date {
  if (!reagent.openedDate) return new Date(reagent.expiryDateUnopened)
  return new Date(new Date(reagent.openedDate).getTime() + reagent.expiryDateAfterOpening * 86_400_000)
}

function daysToExpiry(reagent: Reagent): number {
  return Math.ceil((effectiveExpiry(reagent).getTime() - Date.now()) / 86_400_000)
}

function canUse(reagent: Reagent): boolean {
  return !['expired', 'blocked', 'disposed', 'depleted'].includes(reagent.status) && daysToExpiry(reagent) > 0
}

function mapReagent(row: ReagentItem): Reagent {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as ReagentType,
    grade: row.grade || '—',
    manufacturer: row.manufacturer || '—',
    supplier: row.supplier || '—',
    batchNumber: row.batch_number || '—',
    internalBatchNumber: row.internal_batch_number,
    receivedDate: row.received_date,
    openedDate: row.opened_date,
    expiryDateUnopened: row.expiry_date_unopened,
    expiryDateAfterOpening: row.expiry_date_after_opening_days,
    status: row.status as ReagentStatus,
    quantity: row.quantity,
    unit: row.unit,
    storageLocation: row.storage_location || '—',
    storageConditions: row.storage_conditions || '—',
    responsible: row.responsible || '—',
    coaAttached: row.has_certificate,
    notes: row.notes || '',
  }
}

function mapMovement(row: ReagentMovementItem): Movement {
  return {
    id: row.id,
    reagentId: row.reagent_id,
    date: new Date(row.performed_at).toLocaleString('ru-RU'),
    type: row.operation_type,
    quantityBefore: row.quantity_before,
    quantityOperation: row.quantity_operation,
    quantityAfter: row.quantity_after,
    analyticalSheet: row.analytical_sheet || '—',
    materialBatch: row.material_batch || '—',
    user: row.performed_by || '—',
    reason: row.reason || '—',
    signature: row.signature_required,
  }
}

function toCreatePayload(form: Partial<Reagent>, user: CurrentUser): ReagentCreate {
  const today = new Date().toISOString().slice(0, 10)
  const seq = String(Date.now()).slice(-6)
  return {
    code: form.code || `RE-2026-${seq}`,
    name: form.name || form.code || 'RE-NEW',
    type: form.type || 'reagent',
    grade: form.grade || null,
    manufacturer: form.manufacturer || null,
    supplier: form.supplier || null,
    batch_number: form.batchNumber || null,
    internal_batch_number: form.internalBatchNumber || `QC-NEW-${seq}`,
    received_date: form.receivedDate || today,
    opened_date: form.openedDate || null,
    expiry_date_unopened: form.expiryDateUnopened || today,
    expiry_date_after_opening_days: Number(form.expiryDateAfterOpening || 365),
    status: form.status || 'draft',
    quantity: Number(form.quantity || 0),
    unit: form.unit || 'mL',
    storage_location: form.storageLocation || null,
    storage_conditions: form.storageConditions || null,
    responsible: form.responsible || user.full_name || user.username,
    notes: form.notes || null,
  }
}

export function ReagentsRegistryPage({ token, user }: Props) {
  const { t } = useI18n()
  const [reagents, setReagents] = useState<Reagent[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [certificates, setCertificates] = useState<ReagentCertificateItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [showUsageModal, setShowUsageModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [auditEvents, setAuditEvents] = useState<ReagentAuditEvent[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<ReagentType | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<ReagentStatus | 'all'>('all')
  const [filterOpenedOnly, setFilterOpenedOnly] = useState(false)

  const selected = reagents.find((r) => r.id === selectedId) ?? null

  const loadReagents = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await listReagents(token, {
        search: searchQuery,
        type: filterType === 'all' ? undefined : filterType,
        status: filterStatus === 'all' ? undefined : filterStatus,
        opened_only: filterOpenedOnly,
      })
      const mapped = response.reagents.map(mapReagent)
      setReagents(mapped)
      setSelectedId((current) => (current && mapped.some((item) => item.id === current) ? current : mapped[0]?.id || ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reagents.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [filterOpenedOnly, filterStatus, filterType, searchQuery, token, t])

  const loadDetail = useCallback(async (id: string): Promise<ReagentDetail | null> => {
    if (!id) return null
    setDetailLoading(true)
    setError('')
    try {
      const detail = await getReagent(token, id)
      setMovements(detail.movements.map(mapMovement))
      setCertificates(detail.certificates)
      setReagents((current) => current.map((item) => (item.id === id ? mapReagent(detail) : item)))
      return detail
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reagents.detailFailed'))
      return null
    } finally {
      setDetailLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    void loadReagents()
  }, [loadReagents])

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
  }, [loadDetail, selectedId])

  const kpis = useMemo(() => {
    const active = reagents.filter((r) => ['approved', 'opened', 'in_use', 'expiring'].includes(r.status)).length
    const expiring = reagents.filter((r) => daysToExpiry(r) <= 30 && daysToExpiry(r) > 0 && !['depleted', 'disposed'].includes(r.status)).length
    const expired = reagents.filter((r) => ['expired', 'blocked'].includes(r.status) || daysToExpiry(r) <= 0).length
    const quarantine = reagents.filter((r) => ['quarantine', 'received'].includes(r.status)).length
    return { active, expiring, expired, quarantine }
  }, [reagents])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return reagents.filter((r) => {
      const matchesSearch =
        !q ||
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.batchNumber.toLowerCase().includes(q) ||
        r.internalBatchNumber.toLowerCase().includes(q)
      return (
        matchesSearch &&
        (filterType === 'all' || r.type === filterType) &&
        (filterStatus === 'all' || r.status === filterStatus) &&
        (!filterOpenedOnly || r.openedDate !== null)
      )
    })
  }, [filterOpenedOnly, filterStatus, filterType, reagents, searchQuery])

  async function recordUsage(payload: { quantity: number; report: string; batch: string; reason: string; password: string }) {
    if (!selected) return
    setError('')
    setSuccess('')
    try {
      const detail = await useReagent(token, selected.id, {
        username: user.username,
        password: payload.password,
        meaning: t('reagents.useMeaning'),
        reason: payload.reason,
        quantity: payload.quantity,
        analytical_sheet: payload.report,
        material_batch: payload.batch,
      })
      setReagents((current) => current.map((r) => (r.id === selected.id ? mapReagent(detail) : r)))
      setMovements(detail.movements.map(mapMovement))
      setCertificates(detail.certificates)
      setShowUsageModal(false)
      setSuccess(t('reagents.useOk'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reagents.useFailed'))
    }
  }

  async function addDraft(form: Partial<Reagent>) {
    setError('')
    setSuccess('')
    try {
      const detail = await createReagent(token, toCreatePayload(form, user))
      const item = mapReagent(detail)
      setReagents((current) => [item, ...current.filter((row) => row.id !== item.id)])
      setMovements(detail.movements.map(mapMovement))
      setCertificates(detail.certificates)
      setSelectedId(item.id)
      setShowAddModal(false)
      setSuccess(t('reagents.addOk'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reagents.addFailed'))
    }
  }

  async function uploadCertificate(file: File) {
    if (!selected) return
    setError('')
    setSuccess('')
    try {
      await uploadReagentCertificate(token, selected.id, file, { note: t('reagents.coaNote') })
      const detail = await loadDetail(selected.id)
      if (detail) {
        setReagents((current) => current.map((r) => (r.id === selected.id ? mapReagent(detail) : r)))
      }
      setSuccess(t('reagents.certOk'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reagents.certFailed'))
    }
  }

  async function downloadCertificate(certificateId: string) {
    setError('')
    try {
      const blob = await downloadReagentCertificate(token, certificateId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reagents.certDownloadFailed'))
    }
  }

  async function printCard() {
    if (!selected) return
    setError('')
    try {
      const blob = await downloadReagentCardPdf(token, selected.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reagents.pdfFailed'))
    }
  }

  async function showAudit() {
    if (!selected) return
    setError('')
    try {
      const response = await getReagentAudit(token, selected.id)
      setAuditEvents(response.events)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reagents.auditFailed'))
    }
  }

  async function changeStatus(payload: { status: ReagentStatus; reason: string; password: string }) {
    if (!selected) return
    setError('')
    setSuccess('')
    try {
      const detail = await changeReagentStatus(token, selected.id, {
        username: user.username,
        password: payload.password,
        meaning: t('reagents.statusMeaning', { status: statusLabel(payload.status, t) }),
        reason: payload.reason,
        status: payload.status,
      })
      setReagents((current) => current.map((r) => (r.id === selected.id ? mapReagent(detail) : r)))
      setMovements(detail.movements.map(mapMovement))
      setCertificates(detail.certificates)
      setShowStatusModal(false)
      setSuccess(t('reagents.statusOk'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reagents.statusFailed'))
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('reagents.eyebrow')}</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-slate-950">
            {t('reagents.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('reagents.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus size={16} />
          {t('reagents.addItem')}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard tone="emerald" icon={CheckCircle2} value={kpis.active} label={t('reagents.kpiActive')} />
        <KpiCard tone="orange" icon={Calendar} value={kpis.expiring} label={t('reagents.kpiExpiring')} />
        <KpiCard tone="rose" icon={XCircle} value={kpis.expired} label={t('reagents.kpiExpired')} />
        <KpiCard tone="amber" icon={AlertTriangle} value={kpis.quarantine} label={t('reagents.kpiQuarantine')} />
      </div>

      <div className="flex min-h-[640px] overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className={`${selected ? 'flex-1' : 'w-full'} min-w-0 border-r border-slate-200`}>
          <div className="border-b border-slate-200 p-4">
            <div className="mb-3 flex gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('reagents.searchPlaceholder')}
                  className="h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm text-slate-700 hover:bg-slate-50">
                <Filter size={16} />
                {t('reagents.filters')}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select value={filterType} onChange={(e) => setFilterType(e.target.value as ReagentType | 'all')} className="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                <option value="all">{t('reagents.allTypes')}</option>
                {REAGENT_TYPE_VALUES.map((value) => <option key={value} value={value}>{typeLabel(value, t)}</option>)}
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as ReagentStatus | 'all')} className="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                <option value="all">{t('reagents.allStatuses')}</option>
                {REAGENT_STATUS_VALUES.map((value) => <option key={value} value={value}>{statusLabel(value, t)}</option>)}
              </select>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={filterOpenedOnly} onChange={(e) => setFilterOpenedOnly(e.target.checked)} className="h-4 w-4 accent-slate-900" />
                {t('reagents.openedOnly')}
              </label>
              <span className="ml-auto text-sm text-slate-500">
                {loading ? t('reagents.loading') : t('reagents.recordsCount', { n: filtered.length })}
              </span>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-3 py-3">{t('reagents.colCode')}</th>
                  <th className="px-3 py-3">{t('reagents.colName')}</th>
                  <th className="px-3 py-3">{t('reagents.colType')}</th>
                  <th className="px-3 py-3">{t('reagents.colBatch')}</th>
                  <th className="px-3 py-3">{t('reagents.colStatus')}</th>
                  <th className="px-3 py-3 text-right">{t('reagents.colQty')}</th>
                  <th className="px-3 py-3">{t('reagents.colExpiry')}</th>
                  <th className="px-3 py-3">{t('reagents.colStorage')}</th>
                  <th className="px-3 py-3">{t('reagents.colResponsible')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((reagent) => (
                  <tr
                    key={reagent.id}
                    onClick={() => setSelectedId(reagent.id)}
                    className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${selected?.id === reagent.id ? 'bg-blue-50/70' : ''}`}
                  >
                    <td className="px-3 py-3 font-mono text-xs font-semibold text-blue-700">{reagent.code}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-900">{reagent.name}</div>
                      <div className="text-xs text-slate-500">{reagent.grade}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">{typeLabel(reagent.type, t)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600">{reagent.internalBatchNumber}</td>
                    <td className="px-3 py-3"><StatusBadge status={reagent.status} /></td>
                    <td className="px-3 py-3 text-right">
                      <div className="font-semibold text-slate-900">{reagent.quantity.toLocaleString('ru-RU')}</div>
                      <div className="text-xs text-slate-500">{reagent.unit}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-mono text-xs text-slate-700">{effectiveExpiry(reagent).toLocaleDateString('ru-RU')}</div>
                      <ExpiryWarning reagent={reagent} />
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600">{reagent.storageLocation}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">{reagent.responsible}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-sm text-slate-500">
                      {t('reagents.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selected && (
          <DetailPanel
            reagent={selected}
            movements={movements.filter((m) => m.reagentId === selected.id)}
            certificates={certificates}
            loading={detailLoading}
            onClose={() => setSelectedId('')}
            onUsage={() => setShowUsageModal(true)}
            onUploadCertificate={uploadCertificate}
            onDownloadCertificate={downloadCertificate}
            onAudit={showAudit}
            onStatus={() => setShowStatusModal(true)}
            onPrintCard={printCard}
          />
        )}
      </div>

      {showUsageModal && selected && (
        <UsageModal reagent={selected} onClose={() => setShowUsageModal(false)} onSubmit={recordUsage} />
      )}
      {showStatusModal && selected && (
        <StatusModal reagent={selected} onClose={() => setShowStatusModal(false)} onSubmit={changeStatus} />
      )}
      {showAddModal && <AddModal onClose={() => setShowAddModal(false)} onSubmit={addDraft} />}
      {auditEvents && <AuditModal events={auditEvents} onClose={() => setAuditEvents(null)} />}
    </section>
  )
}

function KpiCard({ tone, icon: Icon, value, label }: { tone: 'emerald' | 'orange' | 'rose' | 'amber'; icon: typeof Beaker; value: number; label: string }) {
  const cls = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    orange: 'border-orange-200 bg-orange-50 text-orange-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
  }[tone]
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs font-medium">{label}</div>
        </div>
        <Icon size={30} />
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ReagentStatus }) {
  const { t } = useI18n()
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${statusClass[status]}`}>{statusLabel(status, t)}</span>
}

function ExpiryWarning({ reagent }: { reagent: Reagent }) {
  const { t } = useI18n()
  if (['depleted', 'disposed'].includes(reagent.status)) return null
  const days = daysToExpiry(reagent)
  if (days <= 0) return <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-rose-600"><XCircle size={12} /> {t('reagents.expiredShort')}</span>
  if (days <= 30) return <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-orange-600"><AlertTriangle size={12} /> {t('reagents.daysShort', { n: days })}</span>
  return null
}

function DetailPanel({
  reagent,
  movements,
  certificates,
  loading,
  onClose,
  onUsage,
  onUploadCertificate,
  onDownloadCertificate,
  onAudit,
  onStatus,
  onPrintCard,
}: {
  reagent: Reagent
  movements: Movement[]
  certificates: ReagentCertificateItem[]
  loading: boolean
  onClose: () => void
  onUsage: () => void
  onUploadCertificate: (file: File) => void
  onDownloadCertificate: (certificateId: string) => void
  onAudit: () => void
  onStatus: () => void
  onPrintCard: () => void
}) {
  const { t, locale } = useI18n()
  const blocked = !canUse(reagent)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  return (
    <aside className="w-[480px] shrink-0 overflow-auto bg-white">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="font-semibold text-slate-900">{t('reagents.cardTitle')}</h2>
          <p className="font-mono text-xs text-slate-500">{reagent.code}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X size={18} />
        </button>
      </div>
      <div className="space-y-4 p-4">
        {loading && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">{t('reagents.refreshing')}</p>}
        <PanelCard icon={FileText} title={t('reagents.passport')}>
          <Info label={t('reagents.colName')} value={reagent.name} />
          <Info label={t('reagents.colType')} value={typeLabel(reagent.type, t)} />
          <Info label={t('reagents.grade')} value={reagent.grade} />
          <Info label={t('reagents.manufacturer')} value={reagent.manufacturer} />
          <Info label={t('reagents.supplier')} value={reagent.supplier} />
          <Info label={t('reagents.mfrBatch')} value={reagent.batchNumber} mono />
          <Info label={t('reagents.internalBatch')} value={reagent.internalBatchNumber} mono />
        </PanelCard>

        <PanelCard icon={Calendar} title={t('reagents.statusDates')}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">{t('reagents.currentStatus')}</span>
            <StatusBadge status={reagent.status} />
          </div>
          <Info label={t('reagents.received')} value={new Date(reagent.receivedDate).toLocaleDateString(locale)} />
          <Info label={t('reagents.opened')} value={reagent.openedDate ? new Date(reagent.openedDate).toLocaleDateString(locale) : t('reagents.notOpened')} />
          <Info label={t('reagents.expiryUnopened')} value={new Date(reagent.expiryDateUnopened).toLocaleDateString(locale)} />
          <Info label={t('reagents.expiryAfterOpening')} value={t('reagents.daysValue', { n: reagent.expiryDateAfterOpening })} />
          <Info label={t('reagents.effectiveExpiry')} value={effectiveExpiry(reagent).toLocaleDateString(locale)} />
          <ExpiryWarning reagent={reagent} />
        </PanelCard>

        <PanelCard icon={Package} title={t('reagents.stockStorage')}>
          <Info label={t('reagents.currentStock')} value={`${reagent.quantity.toLocaleString(locale)} ${reagent.unit}`} strong />
          <Info label={t('reagents.storageLocation')} value={reagent.storageLocation} mono />
          <Info label={t('reagents.conditions')} value={reagent.storageConditions} />
          <Info label={t('reagents.colResponsible')} value={reagent.responsible} />
        </PanelCard>

        <PanelCard icon={FileText} title={t('reagents.documents')}>
          {certificates.length > 0 ? (
            certificates.map((certificate) => (
              <div key={certificate.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <FileText size={15} className="mr-2 inline text-slate-400" />
                  {certificate.certificate_no || t('reagents.coaShort')} · {(certificate.file_size / 1024).toFixed(1)} KB
                </span>
                <button
                  type="button"
                  onClick={() => onDownloadCertificate(certificate.id)}
                  className="rounded p-1 text-slate-600 hover:bg-slate-200"
                  title={t('reagents.downloadCert')}
                >
                  <Download size={15} />
                </button>
              </div>
            ))
          ) : (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('reagents.coaMissing')}</p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onUploadCertificate(file)
              event.currentTarget.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-300 text-sm hover:bg-slate-50"
          >
            <Upload size={15} /> {t('reagents.uploadDoc')}
          </button>
        </PanelCard>

        <PanelCard icon={ChevronRight} title={t('reagents.recentMovements')}>
          {movements.length === 0 ? (
            <p className="py-3 text-sm text-slate-500">{t('reagents.noMovements')}</p>
          ) : (
            movements.slice(0, 5).map((m) => (
              <div key={m.id} className="rounded-md bg-slate-50 px-3 py-2 text-xs">
                <div className="flex justify-between">
                  <span className="font-semibold uppercase text-slate-800">{movementLabel(m.type, t)}</span>
                  <span className="text-slate-500">{m.date}</span>
                </div>
                <div className="mt-1 text-slate-600">{m.quantityBefore} → {m.quantityAfter} {reagent.unit}</div>
                <div className="mt-1 text-slate-500">{m.analyticalSheet} · {m.materialBatch}</div>
                <div className="mt-1 text-slate-500">{m.user} · {m.signature ? 'e-sign' : t('reagents.noSignature')}</div>
              </div>
            ))
          )}
        </PanelCard>

        {reagent.notes && (
          <PanelCard icon={Eye} title={t('reagents.note')}>
            <p className="text-sm text-slate-600">{reagent.notes}</p>
          </PanelCard>
        )}

        <div className="space-y-2 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onUsage}
            disabled={blocked}
            className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold ${
              blocked ? 'cursor-not-allowed bg-slate-100 text-slate-400' : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <Beaker size={16} />
            {t('reagents.useInAnalysis')}
          </button>
          {blocked && (
            <p className="flex items-center gap-1 px-1 text-xs text-rose-600">
              <Lock size={12} />
              {t('reagents.blockedHint', { status: statusLabel(reagent.status, t) })}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onAudit}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-300 text-sm hover:bg-slate-50"
            >
              <Eye size={14} /> Audit trail
            </button>
            <button
              type="button"
              onClick={onPrintCard}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-300 text-sm hover:bg-slate-50"
            >
              <FileText size={14} /> {t('reagents.cardPdf')}
            </button>
          </div>
          <button
            type="button"
            onClick={onStatus}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-rose-300 text-sm font-medium text-rose-700 hover:bg-rose-50"
          >
            <Trash2 size={15} />
            {t('reagents.blockDispose')}
          </button>
        </div>
      </div>
    </aside>
  )
}

function PanelCard({ icon: Icon, title, children }: { icon: typeof Beaker; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-medium text-slate-900"><Icon size={16} /> {title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Info({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[145px_1fr] gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`min-w-0 break-words text-right ${strong ? 'font-semibold text-slate-950' : 'text-slate-800'} ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</span>
    </div>
  )
}

function UsageModal({ reagent, onClose, onSubmit }: { reagent: Reagent; onClose: () => void; onSubmit: (payload: { quantity: number; report: string; batch: string; reason: string; password: string }) => void }) {
  const { t } = useI18n()
  const [quantity, setQuantity] = useState('')
  const [report, setReport] = useState('')
  const [batch, setBatch] = useState('')
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const qty = Number(quantity)
  const invalid = !qty || qty <= 0 || qty > reagent.quantity || !report || !batch || !reason || !password
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-lg bg-white">
        <ModalHeader title={t('reagents.useInAnalysis')} onClose={onClose} />
        <div className="space-y-4 p-6">
          {daysToExpiry(reagent) <= 30 && (
            <div className="flex gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
              <AlertTriangle size={18} /> {t('reagents.expiryWarn')}
            </div>
          )}
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="font-semibold text-slate-900">{reagent.name}</div>
            <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-slate-600">
              <span>{t('reagents.colCode')}: <b className="font-mono">{reagent.code}</b></span>
              <span>{t('reagents.colBatch')}: <b className="font-mono">{reagent.internalBatchNumber}</b></span>
              <span>{t('reagents.colQty')}: <b>{reagent.quantity} {reagent.unit}</b></span>
              <span>{t('reagents.colStatus')}: <StatusBadge status={reagent.status} /></span>
            </div>
          </div>
          <Labeled label={t('reagents.quantityReq')}>
            <div className="flex gap-2">
              <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" className="input" />
              <span className="flex min-w-16 items-center justify-center rounded-md border border-slate-300 bg-slate-100 px-3 text-sm">{reagent.unit}</span>
            </div>
          </Labeled>
          <Labeled label={t('reagents.analSheetReq')}>
            <input value={report} onChange={(e) => setReport(e.target.value)} placeholder="F11-2026-XXXX" className="input" />
          </Labeled>
          <Labeled label={t('reagents.materialBatchReq')}>
            <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="LAC-2026-007" className="input" />
          </Labeled>
          <Labeled label={t('reagents.reasonReq')}>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="input min-h-20" />
          </Labeled>
          <Labeled label={t('reagents.passwordReq')}>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="input font-mono" />
          </Labeled>
          <div className="flex gap-3 border-t border-slate-200 pt-4">
            <button onClick={onClose} className="h-10 flex-1 rounded-lg border border-slate-300 hover:bg-slate-50">{t('common.cancel')}</button>
            <button disabled={invalid} onClick={() => onSubmit({ quantity: qty, report, batch, reason, password })} className="h-10 flex-1 rounded-lg bg-blue-600 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {t('reagents.useAndSign')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AddModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (form: Partial<Reagent>) => void }) {
  const { t } = useI18n()
  const [form, setForm] = useState<Partial<Reagent>>({ type: 'reagent', unit: 'mL', expiryDateAfterOpening: 365 })
  const patch = (p: Partial<Reagent>) => setForm((current) => ({ ...current, ...p }))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white">
        <ModalHeader title={t('reagents.addModalTitle')} onClose={onClose} />
        <div className="space-y-6 p-6">
          <FormBlock title={t('reagents.blockMain')}>
            <Labeled label={t('reagents.codeReq')}><input autoComplete="off" className="input" value={form.code || ''} onChange={(e) => patch({ code: e.target.value })} placeholder="RE-2026-XXX" /></Labeled>
            <Labeled label={t('reagents.typeReq')}>
              <select className="input" value={form.type || 'reagent'} onChange={(e) => patch({ type: e.target.value as ReagentType })}>
                {REAGENT_TYPE_VALUES.map((value) => <option key={value} value={value}>{typeLabel(value, t)}</option>)}
              </select>
            </Labeled>
            <Labeled label={t('reagents.nameReq')} wide><input autoComplete="off" className="input" value={form.name || ''} onChange={(e) => patch({ name: e.target.value })} /></Labeled>
            <Labeled label={t('reagents.gradeFull')} wide><input autoComplete="off" className="input" value={form.grade || ''} onChange={(e) => patch({ grade: e.target.value })} /></Labeled>
          </FormBlock>
          <FormBlock title={t('reagents.blockSupplier')}>
            <Labeled label={t('reagents.manufacturer')}><input autoComplete="off" className="input" value={form.manufacturer || ''} onChange={(e) => patch({ manufacturer: e.target.value })} /></Labeled>
            <Labeled label={t('reagents.supplier')}><input autoComplete="off" className="input" value={form.supplier || ''} onChange={(e) => patch({ supplier: e.target.value })} /></Labeled>
            <Labeled label={t('reagents.mfrBatch')}><input autoComplete="off" className="input" value={form.batchNumber || ''} onChange={(e) => patch({ batchNumber: e.target.value })} /></Labeled>
            <Labeled label={t('reagents.internalBatch')}><input autoComplete="off" className="input" value={form.internalBatchNumber || ''} onChange={(e) => patch({ internalBatchNumber: e.target.value })} /></Labeled>
          </FormBlock>
          <FormBlock title={t('reagents.blockDates')}>
            <Labeled label={t('reagents.receivedDate')}><input type="date" className="input" value={form.receivedDate || ''} onChange={(e) => patch({ receivedDate: e.target.value })} /></Labeled>
            <Labeled label={t('reagents.expiryUnopened')}><input type="date" className="input" value={form.expiryDateUnopened || ''} onChange={(e) => patch({ expiryDateUnopened: e.target.value })} /></Labeled>
            <Labeled label={t('reagents.expiryAfterDays')}><input type="number" className="input" value={form.expiryDateAfterOpening || ''} onChange={(e) => patch({ expiryDateAfterOpening: Number(e.target.value) })} /></Labeled>
            <Labeled label={t('reagents.quantity')}><input type="number" className="input" value={form.quantity || ''} onChange={(e) => patch({ quantity: Number(e.target.value) })} /></Labeled>
            <Labeled label={t('reagents.unit')}><input autoComplete="off" className="input" value={form.unit || ''} onChange={(e) => patch({ unit: e.target.value })} /></Labeled>
            <Labeled label={t('reagents.storageLocation')}><input autoComplete="off" className="input" value={form.storageLocation || ''} onChange={(e) => patch({ storageLocation: e.target.value })} /></Labeled>
            <Labeled label={t('reagents.storageConditions')}><input autoComplete="off" className="input" value={form.storageConditions || ''} onChange={(e) => patch({ storageConditions: e.target.value })} /></Labeled>
            <Labeled label={t('reagents.colResponsible')}><input autoComplete="off" className="input" value={form.responsible || ''} onChange={(e) => patch({ responsible: e.target.value })} /></Labeled>
            <Labeled label={t('reagents.note')} wide><textarea rows={3} className="input min-h-20" value={form.notes || ''} onChange={(e) => patch({ notes: e.target.value })} /></Labeled>
          </FormBlock>
          <div className="flex gap-3 border-t border-slate-200 pt-4">
            <button onClick={onClose} className="h-10 flex-1 rounded-lg border border-slate-300 hover:bg-slate-50">{t('common.cancel')}</button>
            <button onClick={() => onSubmit(form)} className="h-10 flex-1 rounded-lg bg-slate-900 font-semibold text-white hover:bg-slate-800">{t('reagents.saveDraft')}</button>
            <button onClick={() => onSubmit({ ...form, status: 'quarantine' })} className="h-10 flex-1 rounded-lg bg-emerald-700 font-semibold text-white hover:bg-emerald-800">{t('reagents.toApproval')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusModal({
  reagent,
  onClose,
  onSubmit,
}: {
  reagent: Reagent
  onClose: () => void
  onSubmit: (payload: { status: ReagentStatus; reason: string; password: string }) => void
}) {
  const { t } = useI18n()
  const [status, setStatus] = useState<ReagentStatus>('blocked')
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const invalid = !status || !reason || !password
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white">
        <ModalHeader title={t('reagents.statusChangeTitle')} onClose={onClose} />
        <div className="space-y-4 p-6">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="font-semibold text-slate-900">{reagent.name}</div>
            <div className="mt-1 text-xs text-slate-600">{t('reagents.currentStatusColon')} <StatusBadge status={reagent.status} /></div>
          </div>
          <Labeled label={t('reagents.newStatusReq')}>
            <select value={status} onChange={(e) => setStatus(e.target.value as ReagentStatus)} className="input">
              <option value="blocked">{statusLabel('blocked', t)}</option>
              <option value="disposed">{statusLabel('disposed', t)}</option>
              <option value="approved">{statusLabel('approved', t)}</option>
              <option value="opened">{statusLabel('opened', t)}</option>
              <option value="quarantine">{statusLabel('quarantine', t)}</option>
            </select>
          </Labeled>
          <Labeled label={t('reagents.reasonReq')}>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="input min-h-20" />
          </Labeled>
          <Labeled label={t('reagents.passwordReq')}>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="input font-mono" />
          </Labeled>
          <div className="flex gap-3 border-t border-slate-200 pt-4">
            <button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-slate-300 hover:bg-slate-50">{t('common.cancel')}</button>
            <button
              type="button"
              disabled={invalid}
              onClick={() => onSubmit({ status, reason, password })}
              className="h-10 flex-1 rounded-lg bg-rose-700 font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('reagents.sign')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AuditModal({ events, onClose }: { events: ReagentAuditEvent[]; onClose: () => void }) {
  const { t, locale } = useI18n()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-white">
        <ModalHeader title="Audit trail" onClose={onClose} />
        <div className="p-6">
          {events.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">{t('reagents.auditEmpty')}</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">{t('reagents.auditDate')}</th>
                    <th className="px-3 py-2">{t('reagents.auditAction')}</th>
                    <th className="px-3 py-2">{t('reagents.auditRole')}</th>
                    <th className="px-3 py-2">{t('reagents.auditReason')}</th>
                    <th className="px-3 py-2">{t('reagents.auditNewValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{new Date(event.created_at).toLocaleString(locale)}</td>
                      <td className="px-3 py-2 font-semibold">{event.action_type}</td>
                      <td className="px-3 py-2">{event.role_code}</td>
                      <td className="px-3 py-2">{event.reason || '—'}</td>
                      <td className="px-3 py-2">
                        <pre className="max-w-xs overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">
                          {event.new_value ? JSON.stringify(event.new_value, null, 2) : '—'}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
    </div>
  )
}

function Labeled({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'md:col-span-2' : ''}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

function FormBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 border-b border-slate-200 pb-2 font-medium text-slate-900">{title}</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </section>
  )
}

function movementLabel(type: OperationType, t: Translate) {
  return opLabel(type, t)
}
