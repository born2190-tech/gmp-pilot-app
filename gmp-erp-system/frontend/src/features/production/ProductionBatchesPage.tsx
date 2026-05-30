import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileSignature, Play, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  createProductionBatch,
  issueProductionBmr,
  listProductionBatches,
  previewProductionBatch,
  startProductionBatch,
  updateProductionBatchChecklist,
} from '../../lib/api'
import type { CurrentUser } from '../../types/auth'
import type { ProductionBatchItem } from '../../types/inventory'

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
  assigned: 'border-amber-200 bg-amber-50 text-amber-700',
  bmr_issued: 'border-blue-200 bg-blue-50 text-blue-700',
  ready_to_start: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  in_production: 'border-slate-300 bg-slate-900 text-white',
}

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Серия присвоена',
  bmr_issued: 'ЗПС выдана',
  ready_to_start: 'Готово к старту',
  in_production: 'В производстве',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value))
}

export function ProductionBatchesPage({ token, user }: ProductionBatchesPageProps) {
  const canCreate = user.permissions.includes('MANAGE_PRODUCTION')
  const canIssueBmr = user.permissions.includes('QA_DECISION') || user.role === 'SYS_ADMIN'
  const canExecute = user.permissions.includes('EXECUTE_BMR') || user.permissions.includes('MANAGE_PRODUCTION')

  const [batches, setBatches] = useState<ProductionBatchItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [form, setForm] = useState({
    product_code: '12',
    product_name: 'Тигралис 5 мг',
    dosage_form: 'таблетки, покрытые оболочкой',
    batch_size: '10000',
    batch_size_unit: 'упак',
    production_date: todayIso(),
    shelf_life_months: '24',
    notes: '',
  })
  const [preview, setPreview] = useState<{ batch_no: string; expiry_date: string } | null>(null)
  const [bmrPassword, setBmrPassword] = useState('')
  const [bmrNo, setBmrNo] = useState('')
  const [startPassword, setStartPassword] = useState('')
  const [startReason, setStartReason] = useState('Начало выпуска серии после проверки готовности')

  const selected = useMemo(
    () => batches.find((batch) => batch.id === selectedId) ?? batches[0] ?? null,
    [batches, selectedId],
  )

  async function load() {
    setIsLoading(true)
    setError(null)
    try {
      const response = await listProductionBatches(token)
      setBatches(response.batches)
      if (!selectedId && response.batches[0]) setSelectedId(response.batches[0].id)
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
      if (!/^\d{2}$/.test(form.product_code) || !form.production_date || Number(form.shelf_life_months) < 1) {
        setPreview(null)
        return
      }
      try {
        const response = await previewProductionBatch(token, {
          product_code: form.product_code,
          production_date: form.production_date,
          shelf_life_months: Number(form.shelf_life_months),
        })
        if (!ignore) setPreview({ batch_no: response.batch_no, expiry_date: response.expiry_date })
      } catch {
        if (!ignore) setPreview(null)
      }
    }
    const timer = window.setTimeout(() => void runPreview(), 250)
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [form.product_code, form.production_date, form.shelf_life_months, token])

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

  async function handleCreate() {
    await runAction(async () => {
      const created = await createProductionBatch(token, {
        product_code: form.product_code,
        product_name: form.product_name,
        dosage_form: form.dosage_form || null,
        batch_size: Number(form.batch_size),
        batch_size_unit: form.batch_size_unit,
        production_date: form.production_date,
        shelf_life_months: Number(form.shelf_life_months),
        notes: form.notes || null,
      })
      setSelectedId(created.id)
    }, 'Серия присвоена по СОП-409')
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

  const createInvalid =
    !canCreate ||
    !/^\d{2}$/.test(form.product_code) ||
    !form.product_name.trim() ||
    Number(form.batch_size) <= 0 ||
    Number(form.shelf_life_months) <= 0

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">СОП-409 / ЗПС / BMR</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-slate-950">Запуск производственной серии</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Номер серии присваивается до начала производства, ЗПС выдаёт ДОК, старт блокируется до готовности помещения,
            оборудования, весов, материалов и line clearance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={15} />
          Обновить
        </button>
      </div>

      {error && <Notice tone="error" text={error} />}
      {success && <Notice tone="success" text={success} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_1fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold text-slate-950">Новая серия</h2>
                <p className="mt-0.5 text-xs text-slate-500">Формат СОП-409: XXNYYMMZZZ</p>
              </div>
              <Plus size={18} className="text-slate-400" />
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-[88px_1fr] gap-2">
                <Field label="Код продукта">
                  <input className="input font-mono" maxLength={2} value={form.product_code} onChange={(e) => setForm({ ...form, product_code: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                </Field>
                <Field label="Наименование">
                  <input className="input" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} />
                </Field>
              </div>
              <Field label="Лекарственная форма / дозировка">
                <input className="input" value={form.dosage_form} onChange={(e) => setForm({ ...form, dosage_form: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Дата производства">
                  <input type="date" className="input" value={form.production_date} onChange={(e) => setForm({ ...form, production_date: e.target.value })} />
                </Field>
                <Field label="Срок годности, мес.">
                  <input type="number" min={1} className="input" value={form.shelf_life_months} onChange={(e) => setForm({ ...form, shelf_life_months: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-[1fr_92px] gap-2">
                <Field label="Размер серии">
                  <input type="number" min={0} className="input" value={form.batch_size} onChange={(e) => setForm({ ...form, batch_size: e.target.value })} />
                </Field>
                <Field label="Ед.">
                  <input className="input" value={form.batch_size_unit} onChange={(e) => setForm({ ...form, batch_size_unit: e.target.value })} />
                </Field>
              </div>
              <Field label="Примечание">
                <textarea rows={2} className="input min-h-[70px] py-2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Предпросмотр</div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="font-mono text-lg font-semibold text-slate-950">{preview?.batch_no ?? '—'}</span>
                  <span className="text-xs text-slate-500">Годен до: {formatDate(preview?.expiry_date ?? null)}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={createInvalid || isLoading}
                onClick={() => void handleCreate()}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck size={16} />
                Присвоить серию
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Журнал серий</div>
            <div className="max-h-[520px] overflow-auto p-2">
              {batches.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">{isLoading ? 'Загрузка...' : 'Серии пока не зарегистрированы'}</div>
              ) : (
                batches.map((batch) => (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => setSelectedId(batch.id)}
                    className={`mb-2 w-full rounded-md border p-3 text-left transition ${
                      selected?.id === batch.id ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-950">{batch.batch_no}</span>
                      <StatusBadge status={batch.status} />
                    </div>
                    <div className="mt-1 truncate text-sm text-slate-700">{batch.product_name}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatDate(batch.production_date)} → {formatDate(batch.expiry_date)}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {selected ? (
          <BatchDetail
            batch={selected}
            canExecute={canExecute}
            canIssueBmr={canIssueBmr}
            bmrNo={bmrNo}
            bmrPassword={bmrPassword}
            startPassword={startPassword}
            startReason={startReason}
            onBmrNo={setBmrNo}
            onBmrPassword={setBmrPassword}
            onStartPassword={setStartPassword}
            onStartReason={setStartReason}
            onChecklist={(key, value) => void patchChecklist(selected, key, value)}
            onIssueBmr={() => void handleIssueBmr(selected)}
            onStart={() => void handleStart(selected)}
            isLoading={isLoading}
          />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500 shadow-sm">
            Выберите или создайте серию.
          </div>
        )}
      </div>
    </section>
  )
}

function BatchDetail({
  batch,
  canExecute,
  canIssueBmr,
  bmrNo,
  bmrPassword,
  startPassword,
  startReason,
  onBmrNo,
  onBmrPassword,
  onStartPassword,
  onStartReason,
  onChecklist,
  onIssueBmr,
  onStart,
  isLoading,
}: {
  batch: ProductionBatchItem
  canExecute: boolean
  canIssueBmr: boolean
  bmrNo: string
  bmrPassword: string
  startPassword: string
  startReason: string
  onBmrNo: (value: string) => void
  onBmrPassword: (value: string) => void
  onStartPassword: (value: string) => void
  onStartReason: (value: string) => void
  onChecklist: (key: CheckKey, value: boolean) => void
  onIssueBmr: () => void
  onStart: () => void
  isLoading: boolean
}) {
  const allChecks = CHECKS.every((check) => batch[check.key])
  const canStart = canExecute && batch.bmr_issued_at && allChecks && batch.status !== 'in_production'
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-[24px] font-semibold tracking-tight text-slate-950">{batch.batch_no}</h2>
              <StatusBadge status={batch.status} />
            </div>
            <p className="mt-1 text-sm text-slate-600">{batch.product_name}{batch.dosage_form ? ` · ${batch.dosage_form}` : ''}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-right text-xs">
            <Info label="Размер" value={`${batch.batch_size} ${batch.batch_size_unit}`} />
            <Info label="Дата произв." value={formatDate(batch.production_date)} />
            <Info label="Годен до" value={formatDate(batch.expiry_date)} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <SectionTitle icon={FileSignature} title="Выдача ЗПС / BMR" sub="СОП-436 п.6.2.10" />
          {batch.bmr_issued_at ? (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              ЗПС выдана: <span className="font-mono">{batch.bmr_no}</span> · {formatDate(batch.bmr_issued_at)}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <Field label="Номер ЗПС/BMR">
                <input className="input font-mono" value={bmrNo || `BMR-${batch.batch_no}`} onChange={(e) => onBmrNo(e.target.value)} disabled={!canIssueBmr} />
              </Field>
              <Field label="Пароль электронной подписи ДОК">
                <input type="password" className="input" value={bmrPassword} onChange={(e) => onBmrPassword(e.target.value)} disabled={!canIssueBmr} />
              </Field>
              <button
                type="button"
                disabled={!canIssueBmr || !bmrPassword || isLoading}
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
                  disabled={!canExecute || batch.status === 'in_production'}
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
            Нужно: ЗПС/BMR от ДОК и все пункты готовности. Это защита от запуска серии без контролируемого допуска.
          </p>
        )}
      </div>
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
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.assigned}`}>
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
