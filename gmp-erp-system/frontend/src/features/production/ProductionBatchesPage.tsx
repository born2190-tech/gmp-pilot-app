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
import { Ban, Package } from 'lucide-react'
import {
  assignProductionBatch,
  cancelProductionBatch,
  checkProductionBatchNumber,
  completeProductionBatch,
  createProduct,
  createProductionBatch,
  issueProductionBmr,
  listProductionBatches,
  listProducts,
  previewProductionBatch,
  startProductionBatch,
  updateProduct,
  updateProductionBatchChecklist,
} from '../../lib/api'
import type { CurrentUser } from '../../types/auth'
import type { ProductionBatchItem, ProductItem } from '../../types/inventory'

interface ProductionBatchesPageProps {
  token: string
  user: CurrentUser
}

type CheckKey = 'room_ready' | 'equipment_ready' | 'scales_checked' | 'materials_ready' | 'qa_line_clearance'

const CHECKS: { key: CheckKey; label: string; sop: string }[] = [
  { key: 'room_ready', label: 'Помещение подготовлено, уборка подтверждена', sop: 'СОП-436 п.6.5, СОП-442' },
  { key: 'equipment_ready', label: 'Оборудование готово к работе', sop: 'СОП-436 п.6.2.8, 6.6' },
  { key: 'scales_checked', label: 'Весы проверены / калибровка внесена', sop: 'СОП-436 п.6.3.2-6.3.4' },
  { key: 'materials_ready', label: 'Сырьё и вспомогательные материалы готовы к выдаче', sop: 'СОП-436 п.6.3, 6.8.1.1' },
  { key: 'qa_line_clearance', label: 'Контролёр ДОК подтвердил line clearance', sop: 'СОП-436 п.6.2.9, СОП-442 п.6.4' },
]

const STATUS_STYLE: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-100 text-slate-600',
  assigned: 'border-amber-200 bg-amber-50 text-amber-700',
  number_checked: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  bmr_issued: 'border-blue-200 bg-blue-50 text-blue-700',
  ready_to_start: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  in_production: 'border-slate-300 bg-slate-900 text-white',
  completed: 'border-violet-200 bg-violet-50 text-violet-700',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-700',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  assigned: 'Серия присвоена',
  number_checked: 'Номер проверен',
  bmr_issued: 'ЗПС выдана',
  ready_to_start: 'Готово к старту',
  in_production: 'В производстве',
  completed: 'Завершена',
  cancelled: 'Отменена',
}

const STATUS_FILTERS = ['', 'draft', 'assigned', 'number_checked', 'bmr_issued', 'ready_to_start', 'in_production', 'completed', 'cancelled']

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value))
}

function makeInitialForm() {
  return {
    product_id: '',
    product_code: '',
    product_name: '',
    dosage_form: '',
    batch_size: '10000',
    batch_size_unit: 'упак',
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
  const canCreate = user.permissions.includes('MANAGE_PRODUCTION')
  const canCheckNumber = user.permissions.includes('ENTER_QC_RESULT') || user.permissions.includes('QA_DECISION') || user.role === 'SYS_ADMIN'
  const canIssueBmr = user.permissions.includes('QA_DECISION') || user.role === 'SYS_ADMIN'
  const canExecute = user.permissions.includes('EXECUTE_BMR') || user.permissions.includes('MANAGE_PRODUCTION')

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
  const [form, setForm] = useState(makeInitialForm)
  const [preview, setPreview] = useState<{ batch_no: string; expiry_date: string; serial_no: number } | null>(null)
  const [checkPassword, setCheckPassword] = useState('')
  const [bmrPassword, setBmrPassword] = useState('')
  const [bmrNo, setBmrNo] = useState('')
  const [startPassword, setStartPassword] = useState('')
  const [startReason, setStartReason] = useState('Начало выпуска серии после проверки готовности')
  const [completePassword, setCompletePassword] = useState('')
  const [completeReason, setCompleteReason] = useState('Производство серии завершено')
  const [cancelPassword, setCancelPassword] = useState('')
  const [cancelReason, setCancelReason] = useState('')

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
      setError(err instanceof Error ? err.message : 'Не удалось загрузить серии')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

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
      setError(err instanceof Error ? err.message : 'Операция не выполнена')
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
      setForm(makeInitialForm())
    }, asDraft ? 'Черновик серии сохранён' : 'Серия присвоена по СОП-409')
  }

  async function handleAssign(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await assignProductionBatch(token, batch.id)
      setSelectedId(updated.id)
    }, 'Серия присвоена (номер зарегистрирован)')
  }

  async function handleCancel(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await cancelProductionBatch(token, batch.id, {
        username: user.username,
        password: cancelPassword,
        meaning: 'Отмена производственной серии',
        reason: cancelReason,
      })
      setSelectedId(updated.id)
      setCancelPassword('')
      setCancelReason('')
    }, 'Серия отменена')
  }

  async function handleSaveProduct(input: Parameters<typeof createProduct>[1], id: string | null) {
    await runAction(async () => {
      if (id) await updateProduct(token, id, input)
      else await createProduct(token, input)
    }, id ? 'Продукт обновлён' : 'Продукт добавлен в справочник')
  }

  async function handleCheckNumber(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await checkProductionBatchNumber(token, batch.id, {
        username: user.username,
        password: checkPassword,
        meaning: 'Проверка корректности номера серии по СОП-409',
        reason: 'Номер серии проверен перед выдачей ЗПС/BMR',
      })
      setSelectedId(updated.id)
      setCheckPassword('')
    }, 'Номер серии проверен')
  }

  async function patchChecklist(batch: ProductionBatchItem, key: CheckKey, value: boolean) {
    await runAction(async () => {
      const updated = await updateProductionBatchChecklist(token, batch.id, {
        room_ready: key === 'room_ready' ? value : batch.room_ready,
        equipment_ready: key === 'equipment_ready' ? value : batch.equipment_ready,
        scales_checked: key === 'scales_checked' ? value : batch.scales_checked,
        materials_ready: key === 'materials_ready' ? value : batch.materials_ready,
        qa_line_clearance: key === 'qa_line_clearance' ? value : batch.qa_line_clearance,
      })
      setSelectedId(updated.id)
    }, 'Чеклист готовности обновлён')
  }

  async function handleIssueBmr(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await issueProductionBmr(token, batch.id, {
        username: user.username,
        password: bmrPassword,
        meaning: 'Выдача ЗПС/BMR на производство серии',
        reason: 'ЗПС выдана ДОК перед началом производства',
        bmr_no: bmrNo || null,
      })
      setSelectedId(updated.id)
      setBmrPassword('')
    }, 'ЗПС/BMR выдана')
  }

  async function handleStart(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await startProductionBatch(token, batch.id, {
        username: user.username,
        password: startPassword,
        meaning: 'Начало выпуска производственной серии',
        reason: startReason,
      })
      setSelectedId(updated.id)
      setStartPassword('')
    }, 'Выпуск серии начат')
  }

  async function handleComplete(batch: ProductionBatchItem) {
    await runAction(async () => {
      const updated = await completeProductionBatch(token, batch.id, {
        username: user.username,
        password: completePassword,
        meaning: 'Завершение выпуска производственной серии',
        reason: completeReason,
      })
      setSelectedId(updated.id)
      setCompletePassword('')
    }, 'Выпуск серии завершён')
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
  const kpiReady = batches.filter((batch) => batch.status === 'ready_to_start').length
  const kpiActive = batches.filter((batch) => batch.status === 'in_production').length
  const kpiCompleted = batches.filter((batch) => batch.status === 'completed').length
  const kpiCancelled = batches.filter((batch) => batch.status === 'cancelled').length

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">СОП-409 / ЗПС / BMR</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-slate-950">Реестр производственных серий</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Журнал серий по ЛС: номер, дата производства, срок годности, проверка ДКК/ДОК, ЗПС и начало выпуска.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={15} />
            Обновить
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => setShowProducts(true)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Package size={16} />
              Справочник ЛС
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => { setForm(makeInitialForm()); setShowCreate(true) }}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Plus size={16} />
              Новая серия
            </button>
          )}
        </div>
      </div>

      {error && <Notice tone="error" text={error} />}
      {success && <Notice tone="success" text={success} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Черновики" value={kpiDraft} />
        <KpiCard label="Ожидают проверки номера" value={kpiAssigned} />
        <KpiCard label="Готовы к старту" value={kpiReady} />
        <KpiCard label="В производстве" value={kpiActive} />
        <KpiCard label="Завершены" value={kpiCompleted} />
        <KpiCard label="Отменены" value={kpiCancelled} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[260px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по серии, ЛС, коду продукта или ЗПС..."
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
                {status ? STATUS_LABEL[status] : 'Все'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1240px] w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Номер серии</th>
                <th className="px-4 py-3">ЛС</th>
                <th className="px-4 py-3">Размер</th>
                <th className="px-4 py-3">Дата произв.</th>
                <th className="px-4 py-3">Срок годности</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">ЗПС/BMR</th>
                <th className="px-4 py-3">Начало</th>
                <th className="px-4 py-3">Окончание</th>
              </tr>
            </thead>
            <tbody>
              {filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500">
                    {isLoading ? 'Загрузка...' : 'Серии не найдены.'}
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
                      <div className="text-xs text-slate-500">код {batch.product_code} · № {String(batch.serial_no).padStart(3, '0')}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{batch.product_name}</div>
                      <div className="text-xs text-slate-500">{batch.dosage_form || '-'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{batch.batch_size} {batch.batch_size_unit}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{formatDate(batch.production_date)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{formatDate(batch.expiry_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={batch.status} /></td>
                    <td className="px-4 py-3 font-mono text-slate-700">{batch.bmr_no || '-'}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{formatDate(batch.started_at)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{formatDate(batch.completed_at)}</td>
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
          canCheckNumber={canCheckNumber}
          canExecute={canExecute}
          canIssueBmr={canIssueBmr}
          canManage={canCreate}
          cancelPassword={cancelPassword}
          cancelReason={cancelReason}
          onCancelPassword={setCancelPassword}
          onCancelReason={setCancelReason}
          onCancel={() => void handleCancel(selected)}
          onAssign={() => void handleAssign(selected)}
          checkPassword={checkPassword}
          bmrNo={bmrNo}
          bmrPassword={bmrPassword}
          startPassword={startPassword}
          startReason={startReason}
          completePassword={completePassword}
          completeReason={completeReason}
          onCheckPassword={setCheckPassword}
          onBmrNo={setBmrNo}
          onBmrPassword={setBmrPassword}
          onStartPassword={setStartPassword}
          onStartReason={setStartReason}
          onCompletePassword={setCompletePassword}
          onCompleteReason={setCompleteReason}
          onCheckNumber={() => void handleCheckNumber(selected)}
          onChecklist={(key, value) => void patchChecklist(selected, key, value)}
          onIssueBmr={() => void handleIssueBmr(selected)}
          onStart={() => void handleStart(selected)}
          onComplete={() => void handleComplete(selected)}
          isLoading={isLoading}
        />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
          Выберите серию из реестра или создайте новую.
        </div>
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
    </section>
  )
}

function BatchDetail({
  batch,
  canCheckNumber,
  canExecute,
  canIssueBmr,
  canManage,
  cancelPassword,
  cancelReason,
  onCancelPassword,
  onCancelReason,
  onCancel,
  onAssign,
  checkPassword,
  bmrNo,
  bmrPassword,
  startPassword,
  startReason,
  completePassword,
  completeReason,
  onCheckPassword,
  onBmrNo,
  onBmrPassword,
  onStartPassword,
  onStartReason,
  onCompletePassword,
  onCompleteReason,
  onCheckNumber,
  onChecklist,
  onIssueBmr,
  onStart,
  onComplete,
  isLoading,
}: {
  batch: ProductionBatchItem
  canCheckNumber: boolean
  canExecute: boolean
  canIssueBmr: boolean
  canManage: boolean
  cancelPassword: string
  cancelReason: string
  onCancelPassword: (value: string) => void
  onCancelReason: (value: string) => void
  onCancel: () => void
  onAssign: () => void
  checkPassword: string
  bmrNo: string
  bmrPassword: string
  startPassword: string
  startReason: string
  completePassword: string
  completeReason: string
  onCheckPassword: (value: string) => void
  onBmrNo: (value: string) => void
  onBmrPassword: (value: string) => void
  onStartPassword: (value: string) => void
  onStartReason: (value: string) => void
  onCompletePassword: (value: string) => void
  onCompleteReason: (value: string) => void
  onCheckNumber: () => void
  onChecklist: (key: CheckKey, value: boolean) => void
  onIssueBmr: () => void
  onStart: () => void
  onComplete: () => void
  isLoading: boolean
}) {
  const allChecks = CHECKS.every((check) => batch[check.key])
  const canStart = canExecute && batch.bmr_issued_at && allChecks && !['in_production', 'completed', 'cancelled'].includes(batch.status)
  const canComplete = canExecute && batch.status === 'in_production' && !batch.completed_at
  const isTerminal = ['in_production', 'completed', 'cancelled'].includes(batch.status)
  const canCancel = canManage && !isTerminal
  return (
    <div className="space-y-4">
      {batch.status === 'draft' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-300 bg-slate-50 p-4">
          <div className="text-sm text-slate-700">
            <span className="font-semibold">Черновик серии.</span> Номер ещё не зарегистрирован официально. Присвойте серию или отмените черновик.
          </div>
          {canManage && (
            <button
              type="button"
              disabled={isLoading}
              onClick={onAssign}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <ShieldCheck size={16} />
              Присвоить серию
            </button>
          )}
        </div>
      )}
      {batch.status === 'cancelled' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <span className="font-semibold">Серия отменена.</span> {formatDate(batch.cancelled_at)}{batch.cancel_reason ? ` · ${batch.cancel_reason}` : ''}. Запись остаётся в журнале серий.
        </div>
      )}
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
            <Info label="Размер" value={`${batch.batch_size} ${batch.batch_size_unit}`} />
            <Info label="Дата произв." value={formatDate(batch.production_date)} />
            <Info label="Годен до" value={formatDate(batch.expiry_date)} />
            <Info label="ЗПС" value={batch.bmr_no || '-'} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <SectionTitle icon={ShieldCheck} title="Проверка номера серии" sub="Контроль по СОП-409" />
          {batch.number_checked_at ? (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Номер проверен: {formatDate(batch.number_checked_at)}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-slate-600">ДКК/ДОК подтверждает, что номер серии присвоен корректно перед выдачей ЗПС.</p>
              <Field label="Пароль электронной подписи">
                <input type="password" className="input" value={checkPassword} onChange={(event) => onCheckPassword(event.target.value)} disabled={!canCheckNumber} />
              </Field>
              <button
                type="button"
                disabled={!canCheckNumber || !checkPassword || isLoading}
                onClick={onCheckNumber}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck size={16} />
                Проверить номер
              </button>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <SectionTitle icon={FileSignature} title="Выдача ЗПС / BMR" sub="СОП-436 п.6.2.10" />
          {batch.bmr_issued_at ? (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              ЗПС выдана: <span className="font-mono">{batch.bmr_no}</span> · {formatDate(batch.bmr_issued_at)}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {!batch.number_checked_at && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Сначала нужна проверка номера серии.
                </p>
              )}
              <Field label="Номер ЗПС/BMR">
                <input className="input font-mono" value={bmrNo || `BMR-${batch.batch_no}`} onChange={(e) => onBmrNo(e.target.value)} disabled={!canIssueBmr || !batch.number_checked_at} />
              </Field>
              <Field label="Пароль электронной подписи ДОК">
                <input type="password" className="input" value={bmrPassword} onChange={(e) => onBmrPassword(e.target.value)} disabled={!canIssueBmr || !batch.number_checked_at} />
              </Field>
              <button
                type="button"
                disabled={!canIssueBmr || !batch.number_checked_at || !bmrPassword || isLoading}
                onClick={onIssueBmr}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileSignature size={16} />
                Выдать ЗПС
              </button>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <SectionTitle icon={ClipboardCheck} title="Готовность к старту" sub="СОП-436 / СОП-442" />
          <div className="mt-4 space-y-2">
            {CHECKS.map((check) => (
              <label key={check.key} className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={batch[check.key]}
                  disabled={!canExecute || batch.status === 'in_production' || batch.status === 'completed'}
                  onChange={(e) => onChecklist(check.key, e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{check.label}</span>
                  <span className="block text-xs text-slate-500">{check.sop}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <SectionTitle icon={Play} title="Начать выпуск серии" sub="Старт блокируется без ЗПС и полного чеклиста" />
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <Field label="Пароль электронной подписи">
            <input type="password" className="input" value={startPassword} onChange={(e) => onStartPassword(e.target.value)} disabled={!canStart} />
          </Field>
          <Field label="Основание">
            <input className="input" value={startReason} onChange={(e) => onStartReason(e.target.value)} disabled={!canStart} />
          </Field>
          <button
            type="button"
            disabled={!canStart || !startPassword || isLoading}
            onClick={onStart}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={16} />
            Начать выпуск
          </button>
        </div>
        {!canStart && batch.status !== 'in_production' && (
          <p className="mt-3 text-xs text-amber-700">
            Нужно: проверенный номер серии, выданная ЗПС/BMR и все пункты готовности.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <SectionTitle icon={CheckCircle2} title="Завершить выпуск серии" sub="Серия остаётся в реестре как постоянная запись" />
        {batch.completed_at ? (
          <div className="mt-4 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
            Производство завершено: {formatDate(batch.completed_at)}. Запись остаётся в журнале серий.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <Field label="Пароль электронной подписи">
              <input type="password" className="input" value={completePassword} onChange={(e) => onCompletePassword(e.target.value)} disabled={!canComplete} />
            </Field>
            <Field label="Основание">
              <input className="input" value={completeReason} onChange={(e) => onCompleteReason(e.target.value)} disabled={!canComplete} />
            </Field>
            <button
              type="button"
              disabled={!canComplete || !completePassword || isLoading}
              onClick={onComplete}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 size={16} />
              Завершить
            </button>
          </div>
        )}
        {!canComplete && !batch.completed_at && (
          <p className="mt-3 text-xs text-slate-500">
            Завершить можно только серию со статусом “В производстве”.
          </p>
        )}
      </div>

      {canCancel && (
        <div className="rounded-lg border border-rose-200 bg-white p-5 shadow-sm">
          <SectionTitle icon={Ban} title="Отменить серию" sub="До начала производства · с электронной подписью" />
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <Field label="Причина отмены">
              <input className="input" value={cancelReason} onChange={(e) => onCancelReason(e.target.value)} placeholder="Напр.: ошибка планирования, отмена заказа" />
            </Field>
            <Field label="Пароль электронной подписи">
              <input type="password" className="input" value={cancelPassword} onChange={(e) => onCancelPassword(e.target.value)} />
            </Field>
            <button
              type="button"
              disabled={!cancelReason.trim() || !cancelPassword || isLoading}
              onClick={onCancel}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-rose-600 px-5 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Ban size={16} />
              Отменить серию
            </button>
          </div>
        </div>
      )}
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
            <h2 className="text-[18px] font-semibold text-slate-950">Новая производственная серия</h2>
            <p className="text-xs text-slate-500">Выберите ЛС из справочника — код и следующий номер подставятся автоматически.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {products.length === 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              В справочнике пока нет ЛС. Сначала добавьте продукт через «Справочник ЛС».
            </div>
          )}
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Лекарственное средство (ЛС)">
              <select className="input" value={form.product_id} onChange={(e) => selectProduct(e.target.value)}>
                <option value="">— выберите ЛС —</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} · {p.name}{p.dosage_form ? ` · ${p.dosage_form}` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Код продукта">
              <input className="input font-mono bg-slate-50" value={form.product_code} readOnly />
            </Field>
          </div>
          <Field label="Наименование ЛС (можно править)">
            <input className="input" value={form.product_name} onChange={(e) => onChange({ ...form, product_name: e.target.value })} />
          </Field>
          <Field label="Лекарственная форма / дозировка">
            <input className="input" value={form.dosage_form} onChange={(e) => onChange({ ...form, dosage_form: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Дата производства">
              <input type="date" className="input" value={form.production_date} onChange={(e) => onChange({ ...form, production_date: e.target.value })} />
            </Field>
            <Field label="Срок годности, мес.">
              <input type="number" min={1} className="input" value={form.shelf_life_months} onChange={(e) => onChange({ ...form, shelf_life_months: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Размер серии">
              <input type="number" min={0} className="input" value={form.batch_size} onChange={(e) => onChange({ ...form, batch_size: e.target.value })} />
            </Field>
            <Field label="Ед.">
              <input className="input" value={form.batch_size_unit} onChange={(e) => onChange({ ...form, batch_size_unit: e.target.value })} />
            </Field>
          </div>
          <Field label="Примечание">
            <textarea rows={2} className="input min-h-[70px] py-2" value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} />
          </Field>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Последняя серия по этому ЛС</div>
              <div className="mt-1 font-mono text-lg font-semibold text-slate-950">{lastForProduct?.batch_no ?? '-'}</div>
              <div className="mt-1 text-xs text-slate-500">
                {lastForProduct ? `${lastForProduct.product_name} · № ${String(lastForProduct.serial_no).padStart(3, '0')}` : 'В базе пока нет серий по этому ЛС'}
              </div>
            </div>
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-blue-600">Предлагаемый номер</div>
              <div className="mt-1 font-mono text-lg font-semibold text-blue-950">{preview?.batch_no ?? '-'}</div>
              <div className="mt-1 text-xs text-blue-700">Годен до: {formatDate(preview?.expiry_date ?? null)}</div>
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
              Править номер серии вручную (СОП-409 — с указанием причины)
            </label>
            {form.manual_number && (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Номер серии (вручную)">
                  <input className="input font-mono" value={form.batch_no_override} onChange={(e) => onChange({ ...form, batch_no_override: e.target.value })} />
                </Field>
                <Field label="Причина корректировки (обязательно)">
                  <input className="input" value={form.override_reason} onChange={(e) => onChange({ ...form, override_reason: e.target.value })} placeholder="Напр.: коррекция по журналу регистрации серий" />
                </Field>
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
          <p className="text-xs text-slate-500">Черновик можно сохранить без присвоения. Номер берётся из журнала серий (СОП-409); ручная правка — только с причиной и фиксируется в аудите.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Отмена
            </button>
            <button
              type="button"
              disabled={createInvalid || isLoading}
              onClick={() => onCreate(true)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Сохранить черновик
            </button>
            <button
              type="button"
              disabled={createInvalid || isLoading}
              onClick={() => onCreate(false)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck size={16} />
              Присвоить серию
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
  onSave: (input: { code?: string; name: string; dosage_form: string | null; default_shelf_life_months: number; batch_format: string | null; is_active: boolean; notes: string | null }, id: string | null) => void
  onClose: () => void
}) {
  const [editId, setEditId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [dosageForm, setDosageForm] = useState('')
  const [shelfLife, setShelfLife] = useState('24')
  const [isActive, setIsActive] = useState(true)

  function reset() {
    setEditId(null); setCode(''); setName(''); setDosageForm(''); setShelfLife('24'); setIsActive(true)
  }
  function startEdit(p: ProductItem) {
    setEditId(p.id); setCode(p.code); setName(p.name); setDosageForm(p.dosage_form ?? '')
    setShelfLife(String(p.default_shelf_life_months)); setIsActive(p.is_active)
  }
  function submit() {
    onSave({
      code: editId ? undefined : code.trim(),
      name: name.trim(),
      dosage_form: dosageForm.trim() || null,
      default_shelf_life_months: Number(shelfLife) || 24,
      batch_format: null,
      is_active: isActive,
      notes: null,
    }, editId)
    reset()
  }
  const invalid = (!editId && !/^\d{2,8}$/.test(code.trim())) || !name.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-[18px] font-semibold text-slate-950">Справочник продуктов (ЛС)</h2>
            <p className="text-xs text-slate-500">Код по СОП-409 (2 знака). Нумерация серий ведётся отдельно по каждому ЛС.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[110px_1fr_140px]">
            <Field label="Код">
              <input className="input font-mono disabled:bg-slate-100" maxLength={8} value={code} disabled={!!editId} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </Field>
            <Field label="Наименование ЛС">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Срок хр., мес.">
              <input type="number" min={1} className="input" value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} />
            </Field>
            <Field label="Лекарственная форма / дозировка">
              <input className="input" value={dosageForm} onChange={(e) => setDosageForm(e.target.value)} />
            </Field>
            <Field label="Активен">
              <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                в работе
              </label>
            </Field>
            <div className="flex items-end gap-2">
              {editId && (
                <button type="button" onClick={reset} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Сброс
                </button>
              )}
              <button type="button" disabled={invalid || isLoading} onClick={submit} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                <Plus size={16} />
                {editId ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Код</th>
                  <th className="px-3 py-2">Наименование</th>
                  <th className="px-3 py-2">Форма</th>
                  <th className="px-3 py-2">Срок хр.</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Справочник пуст.</td></tr>
                ) : (
                  products.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono font-semibold text-slate-900">{p.code}</td>
                      <td className="px-3 py-2 text-slate-800">{p.name}</td>
                      <td className="px-3 py-2 text-slate-600">{p.dosage_form || '-'}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{p.default_shelf_life_months} мес.</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${p.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>
                          {p.is_active ? 'Активен' : 'Архив'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => startEdit(p)} className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                          Изменить
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

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold text-slate-950">{value}</div>
    </div>
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
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.assigned}`}>
      {STATUS_LABEL[status] ?? status}
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
