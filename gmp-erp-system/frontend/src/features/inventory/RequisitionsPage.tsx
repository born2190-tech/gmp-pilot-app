import { useEffect, useState } from 'react'
import {
  allocateRequisition,
  createRequisition,
  issueRequisition,
  listLots,
  listMaterials,
  listRequisitions,
  updateRequisitionAllocation,
} from '../../lib/api'
import { Button } from '../../components/ui/button'
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

type View = 'list' | 'create' | 'detail'

interface CreateLine {
  id: string
  material_id: string
  requested_quantity: string
  unit: string
}

function makeId() {
  return Math.random().toString(36).slice(2)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-blue-100 text-blue-700',
  processing: 'bg-amber-100 text-amber-700',
  partially_issued: 'bg-orange-100 text-orange-700',
  issued: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

function StatusChip({ status, label }: { status: string; label: string }) {
  const cls = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value))
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function RequisitionsPage({ token, user }: RequisitionsPageProps) {
  const { t } = useI18n()

  const [view, setView] = useState<View>('list')
  const [requisitions, setRequisitions] = useState<RequisitionItem[]>([])
  const [selectedReq, setSelectedReq] = useState<RequisitionItem | null>(null)
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [lots, setLots] = useState<LotItem[]>([])
  const [statusFilter, setStatusFilter] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Create form
  const [createForm, setCreateForm] = useState({
    product_name: '',
    product_series: '',
    production_date: today(),
    production_order_no: '',
  })
  const [createLines, setCreateLines] = useState<CreateLine[]>([
    { id: makeId(), material_id: '', requested_quantity: '', unit: '' },
  ])

  // Allocation edits (alloc line id → qty string)
  const [allocEdits, setAllocEdits] = useState<Record<string, string>>({})
  // Add-lot inline form: { lineId, lotId, qty }
  const [addLot, setAddLot] = useState<{ lineId: string; lotId: string; qty: string } | null>(null)

  // Issue form
  const [issuePassword, setIssuePassword] = useState('')
  const [issueReason, setIssueReason] = useState('')

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const canReadWarehouse = user.permissions.includes('VIEW_WAREHOUSE')
      const [reqRes, matRes, lotsRes] = await Promise.all([
        listRequisitions(token, statusFilter || undefined),
        listMaterials(token),
        canReadWarehouse ? listLots(token) : Promise.resolve({ lots: [] }),
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

  function statusLabel(status: string) {
    const key = `requisitions.status${status.charAt(0).toUpperCase() + status.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}` as Parameters<typeof t>[0]
    try {
      return t(key)
    } catch {
      return status
    }
  }

  // ── List view helpers ────────────────────────────────────────────────────
  function openDetail(req: RequisitionItem) {
    setSelectedReq(req)
    setAllocEdits({})
    setAddLot(null)
    setIssuePassword('')
    setIssueReason('')
    clearMessages()
    setView('detail')
  }

  function backToList() {
    setView('list')
    setSelectedReq(null)
    clearMessages()
  }

  // ── Create form ───────────────────────────────────────────────────────────
  function addCreateLine() {
    setCreateLines((prev) => [...prev, { id: makeId(), material_id: '', requested_quantity: '', unit: '' }])
  }

  function removeCreateLine(id: string) {
    setCreateLines((prev) => prev.filter((l) => l.id !== id))
  }

  function updateCreateLine(id: string, field: keyof Omit<CreateLine, 'id'>, value: string) {
    setCreateLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l
        const updated = { ...l, [field]: value }
        if (field === 'material_id') {
          const mat = materials.find((m) => m.id === value)
          if (mat) updated.unit = mat.default_unit
        }
        return updated
      }),
    )
  }

  async function handleCreate() {
    await runOp(async () => {
      const payload = {
        product_name: createForm.product_name,
        product_series: createForm.product_series || null,
        production_date: createForm.production_date,
        production_order_no: createForm.production_order_no || null,
        lines: createLines
          .filter((l) => l.material_id && l.requested_quantity)
          .map((l) => ({
            material_id: l.material_id,
            requested_quantity: parseFloat(l.requested_quantity),
            unit: l.unit,
          })),
      }
      const created = await createRequisition(token, payload)
      setSuccess(`${created.requisition_no} создано, серии предложены по FEFO`)
      setCreateForm({ product_name: '', product_series: '', production_date: today(), production_order_no: '' })
      setCreateLines([{ id: makeId(), material_id: '', requested_quantity: '', unit: '' }])
      setSelectedReq(created)
      setView('detail')
      await loadData()
    })
  }

  // ── Detail / allocation actions ───────────────────────────────────────────
  async function handleAllocate() {
    if (!selectedReq) return
    await runOp(async () => {
      const updated = await allocateRequisition(token, selectedReq.id)
      setSelectedReq(updated)
      setAllocEdits({})
      setSuccess(t('requisitions.allocateDone'))
    })
  }

  async function handleSaveAllocEdits() {
    if (!selectedReq) return
    await runOp(async () => {
      const updates = Object.entries(allocEdits)
        .filter(([, qty]) => qty !== '')
        .map(([id, qty]) => ({ id, allocated_quantity: parseFloat(qty) }))
      if (updates.length === 0) return
      const updated = await updateRequisitionAllocation(token, selectedReq.id, { updates })
      setSelectedReq(updated)
      setAllocEdits({})
    })
  }

  async function handleRemoveAllocLine(allocLineId: string) {
    if (!selectedReq) return
    await runOp(async () => {
      const updated = await updateRequisitionAllocation(token, selectedReq.id, { removals: [allocLineId] })
      setSelectedReq(updated)
    })
  }

  async function handleAddLot() {
    if (!selectedReq || !addLot) return
    await runOp(async () => {
      const updated = await updateRequisitionAllocation(token, selectedReq.id, {
        additions: [{
          requisition_line_id: addLot.lineId,
          lot_id: addLot.lotId,
          allocated_quantity: parseFloat(addLot.qty),
        }],
      })
      setSelectedReq(updated)
      setAddLot(null)
    })
  }

  async function handleIssue() {
    if (!selectedReq) return
    await runOp(async () => {
      const updated = await issueRequisition(token, selectedReq.id, {
        username: user.username,
        password: issuePassword,
        meaning: t('requisitions.signatureMeaning'),
        reason: issueReason || undefined,
      })
      setSelectedReq(updated)
      setIssuePassword('')
      setIssueReason('')
      setSuccess(t('requisitions.issueDone'))
      // refresh list in background
      void listRequisitions(token).then((r) => setRequisitions(r.requisitions))
    })
  }

  // ── Available lots for "add lot" selector (released, same warehouse) ──────
  const availableLots = lots.filter(
    (lot) =>
      lot.quality_status === 'released' &&
      lot.quantity > 0 &&
      (!user.warehouse_scope || lot.warehouse_type === user.warehouse_scope),
  )

  const canEdit =
    selectedReq !== null &&
    !['issued', 'cancelled'].includes(selectedReq.status)

  const canIssue =
    selectedReq !== null &&
    user.permissions.includes('POST_RECEIPT') &&
    ['submitted', 'processing', 'partially_issued'].includes(selectedReq.status)

  const canCreate = user.permissions.includes('VIEW_PRODUCTION')

  const STATUS_FILTERS = ['', 'draft', 'submitted', 'processing', 'partially_issued', 'issued', 'cancelled']

  // ── Render ─────────────────────────────────────────────────────────────────
  if (view === 'create' && canCreate) {
    return (
      <div className="space-y-6 pb-12">
        <div className="flex items-center gap-3">
          <button
            className="text-sm text-blue-600 hover:underline"
            onClick={() => { setView('list'); clearMessages() }}
          >
            ← {t('requisitions.back')}
          </button>
          <h2 className="text-xl font-semibold text-gray-900">{t('requisitions.newRequisition')}</h2>
        </div>

        {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {/* Header fields */}
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('requisitions.productName')} *</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={createForm.product_name}
              onChange={(e) => setCreateForm((f) => ({ ...f, product_name: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('requisitions.productSeries')}</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={createForm.product_series}
              onChange={(e) => setCreateForm((f) => ({ ...f, product_series: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('requisitions.productionDate')} *</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={createForm.production_date}
              onChange={(e) => setCreateForm((f) => ({ ...f, production_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('requisitions.productionOrderNo')}</label>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={createForm.production_order_no}
              onChange={(e) => setCreateForm((f) => ({ ...f, production_order_no: e.target.value }))}
            />
          </div>
        </div>

        {/* Lines */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('requisitions.lines')}</h3>
          <div className="space-y-2">
            {createLines.map((line) => (
              <div key={line.id} className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-500">{t('requisitions.material')}</label>
                  <select
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={line.material_id}
                    onChange={(e) => updateCreateLine(line.id, 'material_id', e.target.value)}
                  >
                    <option value="">—</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} — {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-32">
                  <label className="mb-1 block text-xs text-gray-500">{t('requisitions.requestedQty')}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={line.requested_quantity}
                    onChange={(e) => updateCreateLine(line.id, 'requested_quantity', e.target.value)}
                  />
                </div>
                <div className="w-20">
                  <label className="mb-1 block text-xs text-gray-500">{t('requisitions.unit')}</label>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={line.unit}
                    onChange={(e) => updateCreateLine(line.id, 'unit', e.target.value)}
                  />
                </div>
                <button
                  className="mb-0.5 rounded-lg px-2 py-2 text-xs text-red-500 hover:bg-red-50"
                  onClick={() => removeCreateLine(line.id)}
                  disabled={createLines.length === 1}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            className="mt-3 text-sm text-blue-600 hover:underline"
            onClick={addCreateLine}
          >
            + {t('requisitions.addLine')}
          </button>
        </div>

        <div className="flex gap-3">
          <Button
            disabled={isLoading || !createForm.product_name || !createForm.production_date || createLines.every((l) => !l.material_id)}
            onClick={() => void handleCreate()}
          >
            {t('requisitions.submitRequisition')}
          </Button>
          <Button variant="secondary" onClick={() => { setView('list'); clearMessages() }}>
            {t('requisitions.close')}
          </Button>
        </div>
      </div>
    )
  }

  if (view === 'detail' && selectedReq) {
    return (
      <div className="space-y-6 pb-12">
        {/* Header bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button className="text-sm text-blue-600 hover:underline" onClick={backToList}>
              ← {t('requisitions.back')}
            </button>
            <h2 className="text-xl font-semibold text-gray-900">{selectedReq.requisition_no}</h2>
            <StatusChip status={selectedReq.status} label={statusLabel(selectedReq.status)} />
          </div>
          <div className="flex gap-2">
            {canEdit && (
              <Button variant="secondary" disabled={isLoading} onClick={() => void handleAllocate()}>
                ⚡ {t('requisitions.allocate')}
              </Button>
            )}
          </div>
        </div>

        {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</div>}

        {/* Meta */}
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-xs sm:grid-cols-4">
          <div>
            <div className="text-xs text-gray-500">{t('requisitions.productName')}</div>
            <div className="mt-0.5 text-sm font-medium text-gray-900">{selectedReq.product_name}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t('requisitions.productSeries')}</div>
            <div className="mt-0.5 text-sm font-medium text-gray-900">{selectedReq.product_series ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t('requisitions.productionDate')}</div>
            <div className="mt-0.5 text-sm font-medium text-gray-900">{formatDate(selectedReq.production_date)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t('requisitions.productionOrderNo')}</div>
            <div className="mt-0.5 text-sm font-medium text-gray-900">{selectedReq.production_order_no ?? '—'}</div>
          </div>
        </div>

        {/* Lines */}
        <div className="space-y-4">
          {selectedReq.lines.map((line) => (
            <RequisitionLineCard
              key={line.id}
              line={line}
              canEdit={canEdit}
              allocEdits={allocEdits}
              addLot={addLot}
              availableLots={availableLots}
              isLoading={isLoading}
              t={t}
              onAllocQtyChange={(allocId, qty) => setAllocEdits((e) => ({ ...e, [allocId]: qty }))}
              onRemoveAlloc={(allocId) => void handleRemoveAllocLine(allocId)}
              onSetAddLot={(lineId) => setAddLot({ lineId, lotId: availableLots[0]?.id ?? '', qty: '' })}
              onAddLotLotChange={(lotId) => setAddLot((a) => a ? { ...a, lotId } : a)}
              onAddLotQtyChange={(qty) => setAddLot((a) => a ? { ...a, qty } : a)}
              onAddLotSubmit={() => void handleAddLot()}
              onAddLotCancel={() => setAddLot(null)}
            />
          ))}
        </div>

        {/* Save allocation edits */}
        {canEdit && Object.keys(allocEdits).length > 0 && (
          <Button disabled={isLoading} onClick={() => void handleSaveAllocEdits()}>
            Сохранить изменения разбивки
          </Button>
        )}

        {/* Issue section */}
        {canIssue && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('requisitions.issue')}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  {t('requisitions.signaturePassword')} *
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={issuePassword}
                  onChange={(e) => setIssuePassword(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  {t('requisitions.signatureReason')}
                </label>
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={issueReason}
                  onChange={(e) => setIssueReason(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button disabled={isLoading || !issuePassword} onClick={() => void handleIssue()}>
                ✍️ {t('requisitions.issue')}
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            {t('requisitions.title')}
          </p>
          <h1 className="text-2xl font-bold text-gray-900">{t('requisitions.title')}</h1>
          <p className="mt-0.5 text-sm text-gray-500">{t('requisitions.subtitle')}</p>
        </div>
        {canCreate && (
          <Button onClick={() => { clearMessages(); setView('create') }}>
            + {t('requisitions.newRequisition')}
          </Button>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</div>}

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === '' ? 'Все' : statusLabel(s)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Загрузка…</div>
        ) : requisitions.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">{t('requisitions.empty')}</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-100">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('requisitions.reqNo')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('requisitions.status')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('requisitions.productName')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('requisitions.productSeries')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('requisitions.productionDate')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('requisitions.lines')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('requisitions.createdAt')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requisitions.map((req) => (
                <tr
                  key={req.id}
                  className="cursor-pointer hover:bg-blue-50 transition-colors"
                  onClick={() => openDetail(req)}
                >
                  <td className="px-4 py-3 text-sm font-mono font-medium text-blue-700">{req.requisition_no}</td>
                  <td className="px-4 py-3">
                    <StatusChip status={req.status} label={statusLabel(req.status)} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">{req.product_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{req.product_series ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(req.production_date)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{req.lines.length}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">{formatDateTime(req.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Sub-component: one requisition line with its allocations ─────────────────

interface RequisitionLineCardProps {
  line: RequisitionLineItem
  canEdit: boolean
  allocEdits: Record<string, string>
  addLot: { lineId: string; lotId: string; qty: string } | null
  availableLots: LotItem[]
  isLoading: boolean
  t: (key: Parameters<ReturnType<typeof useI18n>['t']>[0]) => string
  onAllocQtyChange: (allocId: string, qty: string) => void
  onRemoveAlloc: (allocId: string) => void
  onSetAddLot: (lineId: string) => void
  onAddLotLotChange: (lotId: string) => void
  onAddLotQtyChange: (qty: string) => void
  onAddLotSubmit: () => void
  onAddLotCancel: () => void
}

function RequisitionLineCard({
  line,
  canEdit,
  allocEdits,
  addLot,
  availableLots,
  isLoading,
  t,
  onAllocQtyChange,
  onRemoveAlloc,
  onSetAddLot,
  onAddLotLotChange,
  onAddLotQtyChange,
  onAddLotSubmit,
  onAddLotCancel,
}: RequisitionLineCardProps) {
  const totalAllocated = line.allocation_lines.reduce((s, a) => s + a.allocated_quantity, 0)
  const isFulfilled = totalAllocated >= line.requested_quantity
  const isAddingForThisLine = addLot?.lineId === line.id

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-xs">
      {/* Line header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-800">
            {line.material_code} — {line.material_name}
          </span>
          <span className="text-xs text-gray-500">
            {line.requested_quantity} {line.unit}
          </span>
          <span
            className={`text-xs font-medium ${isFulfilled ? 'text-green-600' : 'text-amber-600'}`}
          >
            → {totalAllocated.toFixed(3)} {line.unit}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs ${line.warehouse_type === 'SUBSTANCE_WAREHOUSE' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}`}>
            {line.warehouse_type === 'SUBSTANCE_WAREHOUSE' ? 'Субстанции' : 'Упаковка'}
          </span>
        </div>
      </div>

      {/* Allocation lines */}
      <div className="p-4">
        {line.allocation_lines.length === 0 ? (
          <p className="text-xs text-gray-400">Нет разбивки — нажмите «FEFO-авторазбивка»</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-400">
                <th className="pb-2 pr-4">{t('requisitions.lot')}</th>
                <th className="pb-2 pr-4">{t('requisitions.expiry')}</th>
                <th className="pb-2 pr-4">{t('requisitions.location')}</th>
                <th className="pb-2 pr-4">{t('requisitions.available')}</th>
                <th className="pb-2 pr-4">{t('requisitions.allocatedQty')}</th>
                {canEdit && <th className="pb-2"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {line.allocation_lines.map((alloc: RequisitionAllocationLineItem) => (
                <tr key={alloc.id}>
                  <td className="py-1.5 pr-4 font-mono text-xs text-gray-700">{alloc.lot_internal_lot}</td>
                  <td className="py-1.5 pr-4 text-xs text-gray-600">
                    {new Intl.DateTimeFormat('ru-RU').format(new Date(alloc.lot_expiry_date))}
                  </td>
                  <td className="py-1.5 pr-4 text-xs text-gray-500">{alloc.lot_location_code}</td>
                  <td className="py-1.5 pr-4 text-xs text-gray-500">{alloc.lot_available}</td>
                  <td className="py-1.5 pr-4">
                    {canEdit ? (
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        className="w-24 rounded border border-gray-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={allocEdits[alloc.id] ?? alloc.allocated_quantity}
                        onChange={(e) => onAllocQtyChange(alloc.id, e.target.value)}
                      />
                    ) : (
                      <span className="text-xs text-gray-800">{alloc.allocated_quantity}</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="py-1.5">
                      <button
                        className="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
                        disabled={isLoading}
                        onClick={() => onRemoveAlloc(alloc.id)}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add lot row */}
        {canEdit && (
          <div className="mt-3">
            {isAddingForThisLine ? (
              <div className="flex items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">{t('requisitions.lot')}</label>
                  <select
                    className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={addLot?.lotId ?? ''}
                    onChange={(e) => onAddLotLotChange(e.target.value)}
                  >
                    {availableLots.map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {lot.internal_lot} | exp:{new Intl.DateTimeFormat('ru-RU').format(new Date(lot.expiry_date))} | {lot.quantity} {lot.unit}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">{t('requisitions.allocatedQty')}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={addLot?.qty ?? ''}
                    onChange={(e) => onAddLotQtyChange(e.target.value)}
                  />
                </div>
                <button
                  className="rounded-lg bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={isLoading || !addLot?.qty}
                  onClick={onAddLotSubmit}
                >
                  {t('requisitions.addLot')}
                </button>
                <button
                  className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  onClick={onAddLotCancel}
                >
                  {t('requisitions.close')}
                </button>
              </div>
            ) : (
              <button
                className="text-xs text-blue-600 hover:underline"
                onClick={() => onSetAddLot(line.id)}
              >
                + {t('requisitions.addLot')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
