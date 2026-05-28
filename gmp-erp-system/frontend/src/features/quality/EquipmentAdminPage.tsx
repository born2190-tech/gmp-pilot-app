import { useEffect, useState } from 'react'
import { Activity, Calendar, Plus, Save, Wrench, X } from 'lucide-react'
import {
  addEquipmentCalibration,
  createEquipment,
  getEquipment,
  listEquipment,
  updateEquipment,
} from '../../lib/api'
import type { CurrentUser } from '../../types/auth'
import type {
  CalibrationStatus,
  EquipmentCalibrationCreate,
  EquipmentCreate,
  EquipmentDetail,
  EquipmentItem,
  EquipmentUpdate,
} from '../../types/inventory'

interface Props {
  token: string
  user: CurrentUser
}

const STATUS_LABELS: Record<CalibrationStatus, { text: string; cls: string }> = {
  ok: { text: 'Калибровка ОК', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  expiring: { text: 'Истекает', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  expired: { text: 'Просрочена', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  missing: { text: 'Нет калибровки', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
}

export function CalibrationBadge({ status, validUntil }: { status: CalibrationStatus; validUntil?: string | null }) {
  const cfg = STATUS_LABELS[status]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${cfg.cls}`}
      title={validUntil ? `действует до ${validUntil}` : undefined}
    >
      <Activity size={11} />
      {cfg.text}
      {validUntil && <span className="ml-1 font-mono text-[10px] opacity-70">{validUntil}</span>}
    </span>
  )
}

export function EquipmentAdminPage({ token, user }: Props) {
  const canManage = user.permissions.includes('EQUIPMENT_MANAGE')

  const [list, setList] = useState<EquipmentItem[]>([])
  const [detail, setDetail] = useState<EquipmentDetail | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<EquipmentCreate>(emptyForm())
  const [calForm, setCalForm] = useState<EquipmentCalibrationCreate>(emptyCalibration())
  const [showCalForm, setShowCalForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function reload() {
    try {
      const resp = await listEquipment(token)
      setList(resp.equipment)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    }
  }

  useEffect(() => {
    void reload()
  }, [token])

  async function select(id: string) {
    setError(null)
    setSuccess(null)
    setIsNew(false)
    try {
      const eq = await getEquipment(token, id)
      setDetail(eq)
      setForm({
        code: eq.code,
        name: eq.name,
        category: eq.category,
        manufacturer: eq.manufacturer,
        model: eq.model,
        serial_no: eq.serial_no,
        location: eq.location,
        notes: eq.notes,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    }
  }

  function startNew() {
    setError(null)
    setSuccess(null)
    setIsNew(true)
    setDetail(null)
    setForm(emptyForm())
    setShowCalForm(false)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (isNew) {
        const created = await createEquipment(token, form)
        setSuccess(`Прибор ${created.code} создан`)
        setIsNew(false)
        await reload()
        await select(created.id)
      } else if (detail) {
        const payload: EquipmentUpdate = {
          name: form.name,
          category: form.category,
          manufacturer: form.manufacturer,
          model: form.model,
          serial_no: form.serial_no,
          location: form.location,
          notes: form.notes,
        }
        const updated = await updateEquipment(token, detail.id, payload)
        setSuccess('Сохранено')
        setDetail(updated)
        await reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive() {
    if (!detail) return
    setBusy(true)
    setError(null)
    try {
      const updated = await updateEquipment(token, detail.id, { is_active: !detail.is_active })
      setDetail(updated)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  async function submitCalibration() {
    if (!detail) return
    if (!calForm.valid_from || !calForm.valid_until) {
      setError('Укажите период действия калибровки')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await addEquipmentCalibration(token, detail.id, calForm)
      setDetail(updated)
      setSuccess('Калибровка добавлена')
      setShowCalForm(false)
      setCalForm(emptyCalibration())
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const editing = isNew || detail !== null

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Реестр КИП · GMP Annex 15
          </p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">
            Контрольно-измерительные приборы
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Справочник приборов лаборатории ОКК с историей калибровок. Аналитик ОКК выбирает
            прибор при заполнении аналитического листа Ф-11; просроченная калибровка блокирует
            сохранение протокола.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={startNew}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-[13px] font-medium text-white hover:bg-slate-800"
          >
            <Plus size={15} /> Новый прибор
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}
      {success && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </p>
      )}

      <div className="grid grid-cols-12 gap-4">
        <aside className="col-span-12 lg:col-span-4 xl:col-span-3">
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Приборы · {list.length}
            </div>
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {list.map((eq) => (
                <li key={eq.id}>
                  <button
                    type="button"
                    onClick={() => void select(eq.id)}
                    className={`flex w-full flex-col items-start gap-1 px-4 py-2.5 text-left transition hover:bg-slate-50 ${
                      detail?.id === eq.id ? 'bg-slate-50' : ''
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium text-slate-900">{eq.name}</span>
                      {!eq.is_active && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          неактивен
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">{eq.code}</span>
                    <span className="flex items-center gap-2 text-[11px] text-slate-400">
                      {eq.category || '—'}
                      <CalibrationBadge
                        status={eq.calibration_status}
                        validUntil={eq.calibration_valid_until}
                      />
                    </span>
                  </button>
                </li>
              ))}
              {list.length === 0 && (
                <li className="px-4 py-10 text-center text-sm text-slate-400">Список пуст</li>
              )}
            </ul>
          </div>
        </aside>

        <div className="col-span-12 lg:col-span-8 xl:col-span-9">
          {!editing ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-20 text-center">
              <Wrench size={28} className="text-slate-300" />
              <p className="text-sm font-medium text-slate-700">Выберите прибор слева или создайте новый</p>
            </div>
          ) : (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Labeled label="Код">
                  <input
                    value={form.code}
                    disabled={!canManage || !isNew}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="inp font-mono"
                    placeholder="HPLC-01"
                  />
                </Labeled>
                <Labeled label="Наименование" className="md:col-span-2">
                  <input
                    value={form.name}
                    disabled={!canManage}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="inp"
                    placeholder="Жидкостной хроматограф Agilent 1260"
                  />
                </Labeled>
                <Labeled label="Категория">
                  <input
                    value={form.category || ''}
                    disabled={!canManage}
                    onChange={(e) => setForm({ ...form, category: e.target.value || null })}
                    className="inp"
                    placeholder="ВЭЖХ"
                  />
                </Labeled>
                <Labeled label="Производитель">
                  <input
                    value={form.manufacturer || ''}
                    disabled={!canManage}
                    onChange={(e) => setForm({ ...form, manufacturer: e.target.value || null })}
                    className="inp"
                    placeholder="Agilent"
                  />
                </Labeled>
                <Labeled label="Модель">
                  <input
                    value={form.model || ''}
                    disabled={!canManage}
                    onChange={(e) => setForm({ ...form, model: e.target.value || null })}
                    className="inp"
                    placeholder="1260 Infinity II"
                  />
                </Labeled>
                <Labeled label="Серийный номер">
                  <input
                    value={form.serial_no || ''}
                    disabled={!canManage}
                    onChange={(e) => setForm({ ...form, serial_no: e.target.value || null })}
                    className="inp font-mono"
                  />
                </Labeled>
                <Labeled label="Расположение">
                  <input
                    value={form.location || ''}
                    disabled={!canManage}
                    onChange={(e) => setForm({ ...form, location: e.target.value || null })}
                    className="inp"
                    placeholder="Лаб. ФХ, к. 207"
                  />
                </Labeled>
                <Labeled label="Примечания" className="md:col-span-3">
                  <textarea
                    value={form.notes || ''}
                    disabled={!canManage}
                    rows={2}
                    onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
                    className="inp h-auto py-1.5"
                  />
                </Labeled>
              </div>

              {canManage && (
                <div className="flex items-center gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save()}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md bg-emerald-700 px-4 text-[13px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    <Save size={15} /> Сохранить
                  </button>
                  {detail && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleActive()}
                      className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {detail.is_active ? 'Деактивировать' : 'Активировать'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDetail(null)
                      setIsNew(false)
                    }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <X size={15} /> Отмена
                  </button>
                </div>
              )}

              {detail && (
                <div className="space-y-3 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-3 py-2">
                    <Calendar size={15} className="text-slate-500" />
                    <span className="text-[12px] font-semibold text-slate-800">История калибровок</span>
                    <span className="text-[11px] text-slate-400">· {detail.calibrations.length}</span>
                    <span className="ml-2">
                      <CalibrationBadge
                        status={detail.calibration_status}
                        validUntil={detail.calibration_valid_until}
                      />
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => setShowCalForm(true)}
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Plus size={12} /> Добавить
                      </button>
                    )}
                  </div>

                  {showCalForm && (
                    <div className="grid grid-cols-1 gap-3 px-3 pb-3 md:grid-cols-5">
                      <Labeled label="Действует с">
                        <input
                          type="date"
                          value={calForm.valid_from}
                          onChange={(e) => setCalForm({ ...calForm, valid_from: e.target.value })}
                          className="inp"
                        />
                      </Labeled>
                      <Labeled label="Действует до">
                        <input
                          type="date"
                          value={calForm.valid_until}
                          onChange={(e) => setCalForm({ ...calForm, valid_until: e.target.value })}
                          className="inp"
                        />
                      </Labeled>
                      <Labeled label="Сертификат №">
                        <input
                          value={calForm.certificate_no || ''}
                          onChange={(e) =>
                            setCalForm({ ...calForm, certificate_no: e.target.value || null })
                          }
                          className="inp font-mono"
                        />
                      </Labeled>
                      <Labeled label="Кем выполнено" className="md:col-span-2">
                        <input
                          value={calForm.performed_by || ''}
                          onChange={(e) =>
                            setCalForm({ ...calForm, performed_by: e.target.value || null })
                          }
                          className="inp"
                          placeholder="ГП «Узстандарт»"
                        />
                      </Labeled>
                      <Labeled label="Примечания" className="md:col-span-5">
                        <input
                          value={calForm.notes || ''}
                          onChange={(e) => setCalForm({ ...calForm, notes: e.target.value || null })}
                          className="inp"
                        />
                      </Labeled>
                      <div className="md:col-span-5 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void submitCalibration()}
                          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-700 px-3 text-[12.5px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                        >
                          <Save size={14} /> Записать
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowCalForm(false)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
                        >
                          <X size={14} /> Отмена
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-[12.5px]">
                      <thead className="bg-slate-50/40 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-2 py-1.5">Действует с</th>
                          <th className="px-2 py-1.5">Действует до</th>
                          <th className="px-2 py-1.5">Сертификат №</th>
                          <th className="px-2 py-1.5">Кем выполнено</th>
                          <th className="px-2 py-1.5">Записал</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.calibrations.map((c) => (
                          <tr key={c.id} className="border-t border-slate-100">
                            <td className="px-2 py-1.5 font-mono">{c.valid_from}</td>
                            <td className="px-2 py-1.5 font-mono">{c.valid_until}</td>
                            <td className="px-2 py-1.5 font-mono">{c.certificate_no || '—'}</td>
                            <td className="px-2 py-1.5">{c.performed_by || '—'}</td>
                            <td className="px-2 py-1.5 text-slate-500">
                              {new Date(c.recorded_at).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                        {detail.calibrations.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-2 py-4 text-center text-[12px] text-slate-400">
                              Калибровок ещё нет
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`.inp{height:2.5rem;width:100%;border-radius:0.375rem;border:1px solid rgb(226 232 240);background:#fff;padding:0 0.625rem;font-size:13px;outline:none}.inp:focus{border-color:rgb(148 163 184)}.inp:disabled{background:rgb(248 250 252);opacity:.8}`}</style>
    </section>
  )
}

function emptyForm(): EquipmentCreate {
  return {
    code: '',
    name: '',
    category: null,
    manufacturer: null,
    model: null,
    serial_no: null,
    location: null,
    notes: null,
  }
}

function emptyCalibration(): EquipmentCalibrationCreate {
  return {
    certificate_no: null,
    performed_by: null,
    valid_from: '',
    valid_until: '',
    notes: null,
  }
}

function Labeled({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className || ''}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      {children}
    </label>
  )
}
