import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, Info, Plus, Save, Search, Wrench, X, XCircle } from 'lucide-react'
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

type ActiveFilter = 'all' | 'active' | 'inactive'

const STATUS_CONFIG: Record<CalibrationStatus, { icon: typeof CheckCircle2; label: string; cls: string; accent: string }> = {
  ok: {
    icon: CheckCircle2,
    label: 'Действует',
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    accent: 'hover:border-emerald-300 data-[active=true]:border-emerald-400',
  },
  expiring: {
    icon: Clock,
    label: 'Истекает',
    cls: 'border-amber-200 bg-amber-50 text-amber-700',
    accent: 'hover:border-amber-300 data-[active=true]:border-amber-400',
  },
  expired: {
    icon: XCircle,
    label: 'Просрочена',
    cls: 'border-rose-200 bg-rose-50 text-rose-700',
    accent: 'hover:border-rose-300 data-[active=true]:border-rose-400',
  },
  missing: {
    icon: AlertCircle,
    label: 'Нет калибровки',
    cls: 'border-slate-300 bg-slate-100 text-slate-700',
    accent: 'hover:border-slate-400 data-[active=true]:border-slate-500',
  },
}

export function EquipmentAdminPage({ token, user }: Props) {
  const canManage = user.permissions.includes('EQUIPMENT_MANAGE')
  const [equipment, setEquipment] = useState<EquipmentItem[]>([])
  const [detail, setDetail] = useState<EquipmentDetail | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState<EquipmentCreate>(emptyForm())
  const [calForm, setCalForm] = useState<EquipmentCalibrationCreate>(emptyCalibration())
  const [calibrationDialogOpen, setCalibrationDialogOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<CalibrationStatus | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function reload(selectFirst = false) {
    try {
      const response = await listEquipment(token)
      setEquipment(response.equipment)
      if (selectFirst && response.equipment[0]) {
        await selectEquipment(response.equipment[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить реестр КИП')
    }
  }

  useEffect(() => {
    void reload(true)
  }, [token])

  async function selectEquipment(id: string) {
    setError(null)
    setSuccess(null)
    setIsNew(false)
    setEditMode(false)
    try {
      const item = await getEquipment(token, id)
      setDetail(item)
      setForm(fromDetail(item))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть карточку прибора')
    }
  }

  function startNew() {
    setError(null)
    setSuccess(null)
    setDetail(null)
    setIsNew(true)
    setEditMode(true)
    setForm(emptyForm())
  }

  function startEdit() {
    if (!detail) return
    setError(null)
    setSuccess(null)
    setForm(fromDetail(detail))
    setIsNew(false)
    setEditMode(true)
  }

  function cancelEdit() {
    setError(null)
    setIsNew(false)
    setEditMode(false)
    if (detail) {
      setForm(fromDetail(detail))
    } else {
      setForm(emptyForm())
    }
  }

  async function saveEquipment() {
    if (!canManage) return
    if (!form.code.trim() || !form.name.trim()) {
      setError('Укажите код и наименование прибора')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (isNew) {
        const created = await createEquipment(token, cleanedCreate(form))
        setSuccess(`Прибор ${created.code} создан`)
        setIsNew(false)
        setEditMode(false)
        await reload()
        await selectEquipment(created.id)
      } else if (detail) {
        const payload: EquipmentUpdate = {
          name: cleanText(form.name),
          category: cleanNullable(form.category),
          manufacturer: cleanNullable(form.manufacturer),
          model: cleanNullable(form.model),
          serial_no: cleanNullable(form.serial_no),
          location: cleanNullable(form.location),
          notes: cleanNullable(form.notes),
        }
        const updated = await updateEquipment(token, detail.id, payload)
        setDetail(updated)
        setSuccess('Карточка прибора сохранена')
        setEditMode(false)
        await reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить прибор')
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive() {
    if (!detail || !canManage) return
    setBusy(true)
    setError(null)
    try {
      const updated = await updateEquipment(token, detail.id, { is_active: !detail.is_active })
      setDetail(updated)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить статус прибора')
    } finally {
      setBusy(false)
    }
  }

  function openCalibrationDialog() {
    setCalForm(emptyCalibration())
    setCalibrationDialogOpen(true)
    setError(null)
  }

  async function submitCalibration() {
    if (!detail || !canManage) return
    if (!calForm.valid_from || !calForm.valid_until) {
      setError('Укажите период действия калибровки')
      return
    }
    if (new Date(calForm.valid_until) <= new Date(calForm.valid_from)) {
      setError('Дата окончания должна быть позже даты начала')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await addEquipmentCalibration(token, detail.id, {
        certificate_no: cleanNullable(calForm.certificate_no),
        performed_by: cleanNullable(calForm.performed_by),
        valid_from: calForm.valid_from,
        valid_until: calForm.valid_until,
        notes: cleanNullable(calForm.notes),
      })
      setDetail(updated)
      setSuccess('Калибровка добавлена')
      setCalibrationDialogOpen(false)
      setCalForm(emptyCalibration())
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить калибровку')
    } finally {
      setBusy(false)
    }
  }

  const stats = useMemo(
    () => ({
      ok: equipment.filter((item) => item.calibration_status === 'ok' && item.is_active).length,
      expiring: equipment.filter((item) => item.calibration_status === 'expiring' && item.is_active).length,
      expired: equipment.filter((item) => item.calibration_status === 'expired' && item.is_active).length,
      missing: equipment.filter((item) => item.calibration_status === 'missing' && item.is_active).length,
    }),
    [equipment],
  )

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(equipment.map((item) => item.category).filter(Boolean) as string[]))],
    [equipment],
  )

  const filteredEquipment = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return equipment.filter((item) => {
      const matchesSearch =
        !query ||
        item.code.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        (item.manufacturer || '').toLowerCase().includes(query) ||
        (item.serial_no || '').toLowerCase().includes(query)
      const matchesStatus = statusFilter === 'all' || item.calibration_status === statusFilter
      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter
      const matchesActive =
        activeFilter === 'all' ||
        (activeFilter === 'active' && item.is_active) ||
        (activeFilter === 'inactive' && !item.is_active)
      return matchesSearch && matchesStatus && matchesCategory && matchesActive
    })
  }, [activeFilter, categoryFilter, equipment, searchTerm, statusFilter])

  const selectedId = detail?.id ?? null

  return (
    <div className="min-h-[calc(100vh-120px)] bg-slate-50">
      <div className="mx-auto max-w-[1800px] p-6">
        <div className="mb-6">
          <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">
            ДКК / Реестр оборудования
          </div>
          <h1 className="mb-1 text-2xl font-semibold text-slate-950">Реестр КИП</h1>
          <p className="text-sm text-slate-600">
            Контрольно-измерительные приборы и оборудование лаборатории с историей калибровок
          </p>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard count={stats.ok} label="Действуют" status="ok" active={statusFilter === 'ok'} onClick={() => setStatusFilter(statusFilter === 'ok' ? 'all' : 'ok')} />
          <StatCard count={stats.expiring} label="Истекают" status="expiring" active={statusFilter === 'expiring'} onClick={() => setStatusFilter(statusFilter === 'expiring' ? 'all' : 'expiring')} />
          <StatCard count={stats.expired} label="Просрочены" status="expired" active={statusFilter === 'expired'} onClick={() => setStatusFilter(statusFilter === 'expired' ? 'all' : 'expired')} />
          <StatCard count={stats.missing} label="Нет калибровки" status="missing" active={statusFilter === 'missing'} onClick={() => setStatusFilter(statusFilter === 'missing' ? 'all' : 'missing')} />
        </div>

        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[280px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Поиск по коду или наименованию..."
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-slate-400"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-slate-400"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category === 'all' ? 'Все категории' : category}
                </option>
              ))}
            </select>
            <select
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
              className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-slate-400"
            >
              <option value="all">Все приборы</option>
              <option value="active">В эксплуатации</option>
              <option value="inactive">Выведены</option>
            </select>
            {canManage && (
              <button
                type="button"
                onClick={startNew}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Добавить прибор
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {success}
          </div>
        )}

        <div className="flex gap-4" style={{ height: 'calc(100vh - 480px)', minHeight: 500 }}>
          <EquipmentList
            equipment={filteredEquipment}
            selectedId={selectedId}
            onSelect={(id) => void selectEquipment(id)}
          />
          {isNew || editMode ? (
            <EquipmentForm
              busy={busy}
              canManage={canManage}
              form={form}
              isNew={isNew}
              onCancel={cancelEdit}
              onChange={setForm}
              onSave={() => void saveEquipment()}
            />
          ) : (
            <EquipmentDetailPanel
              canManage={canManage}
              equipment={detail}
              onAddCalibration={openCalibrationDialog}
              onEdit={startEdit}
              onToggleActive={() => void toggleActive()}
            />
          )}
        </div>
      </div>

      {detail && (
        <AddCalibrationDialog
          busy={busy}
          equipment={detail}
          form={calForm}
          onChange={setCalForm}
          onClose={() => setCalibrationDialogOpen(false)}
          onSubmit={() => void submitCalibration()}
          open={calibrationDialogOpen}
        />
      )}
    </div>
  )
}

function EquipmentList({
  equipment,
  onSelect,
  selectedId,
}: {
  equipment: EquipmentItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (equipment.length === 0) {
    return (
      <div className="flex w-[45%] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center">
        <Wrench className="mb-3 h-12 w-12 text-slate-300" />
        <div className="mb-2 text-slate-400">Приборы не найдены</div>
        <p className="text-sm text-slate-500">Попробуйте изменить фильтры или добавьте первый прибор</p>
      </div>
    )
  }

  return (
    <div className="flex w-[45%] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-slate-500">Найдено приборов: {equipment.length}</div>
      </div>
      <div className="flex-1 overflow-auto">
        {equipment.map((item) => {
          const isSelected = item.id === selectedId
          const isUnavailable = !item.is_active || item.calibration_status === 'expired' || item.calibration_status === 'missing'
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              type="button"
              className={`w-full border-b border-l-4 border-slate-100 px-4 py-3 text-left transition-colors ${
                isSelected ? 'border-l-slate-900 bg-slate-100' : 'border-l-transparent hover:bg-slate-50'
              } ${isUnavailable ? 'opacity-60' : ''}`}
            >
              <div className="mb-1.5 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <code className="font-mono text-sm text-slate-950">{item.code}</code>
                    {!item.is_active && (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">Выведен</span>
                    )}
                  </div>
                  <div className="truncate text-sm text-slate-700">{item.name}</div>
                  {item.category && <div className="mt-0.5 text-xs text-slate-500">{item.category}</div>}
                </div>
                <CalibrationBadge status={item.calibration_status} validUntil={item.calibration_valid_until} size="sm" />
              </div>
              {item.calibration_valid_until && (
                <div className="mt-1 text-xs text-slate-500">
                  Калибровка до {formatDate(item.calibration_valid_until)}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function EquipmentDetailPanel({
  canManage,
  equipment,
  onAddCalibration,
  onEdit,
  onToggleActive,
}: {
  canManage: boolean
  equipment: EquipmentDetail | null
  onAddCalibration: () => void
  onEdit: () => void
  onToggleActive: () => void
}) {
  if (!equipment) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center">
        <Info className="mx-auto mb-3 h-12 w-12 text-slate-400" />
        <div className="mb-2 text-slate-400">Выберите прибор</div>
        <p className="text-sm text-slate-500">Выберите прибор из списка слева для просмотра деталей</p>
      </div>
    )
  }

  const isUnavailable = !equipment.is_active || equipment.calibration_status === 'expired' || equipment.calibration_status === 'missing'

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <code className="font-mono text-lg text-slate-950">{equipment.code}</code>
              {!equipment.is_active && <span className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700">Выведен из эксплуатации</span>}
            </div>
            <h2 className="mb-2 text-base font-medium text-slate-900">{equipment.name}</h2>
            <CalibrationBadge status={equipment.calibration_status} validUntil={equipment.calibration_valid_until} />
          </div>
          {canManage && (
            <div className="flex gap-2">
              <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={onEdit} type="button">
                Редактировать
              </button>
              <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={onToggleActive} type="button">
                {equipment.is_active ? 'Вывести' : 'Вернуть'}
              </button>
            </div>
          )}
        </div>

        {isUnavailable && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <div className="mb-1 font-medium">Прибор недоступен для выбора в Ф-11</div>
            <div className="text-xs text-rose-700">
              {!equipment.is_active && 'Прибор выведен из эксплуатации. '}
              {equipment.calibration_status === 'expired' && 'Калибровка просрочена. '}
              {equipment.calibration_status === 'missing' && 'Отсутствует запись о калибровке. '}
              Для использования в аналитических листах требуется действующая калибровка.
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-5">
        <div className="mb-6">
          <h3 className="mb-3 text-xs uppercase tracking-wide text-slate-500">Паспортные данные</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <DetailValue label="Категория" value={equipment.category} />
            <DetailValue label="Производитель" value={equipment.manufacturer} />
            <DetailValue label="Модель" value={equipment.model} mono />
            <DetailValue label="Серийный номер" value={equipment.serial_no} mono />
            <DetailValue className="col-span-2" label="Место установки" value={equipment.location} />
            <DetailValue className="col-span-2" label="Примечания" value={equipment.notes} />
          </div>
        </div>

        <div className="my-6 h-px bg-slate-200" />

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-slate-500">История калибровок ({equipment.calibrations.length})</h3>
            {canManage && (
              <button className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800" onClick={onAddCalibration} type="button">
                <Plus className="h-3.5 w-3.5" />
                Добавить калибровку
              </button>
            )}
          </div>

          {equipment.calibrations.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 py-8 text-center">
              <Clock className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <div className="text-sm text-slate-500">Нет записей о калибровках</div>
              <div className="mt-1 text-xs text-slate-400">Добавьте первую калибровку для активации прибора</div>
            </div>
          ) : (
            <div className="space-y-3">
              {equipment.calibrations.map((calibration, index) => {
                const isLatest = index === 0
                const isActive = new Date(calibration.valid_from) <= new Date() && new Date() <= new Date(calibration.valid_until)
                return (
                  <div
                    key={calibration.id}
                    className={`rounded-lg border p-4 ${
                      isLatest && isActive ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex-1">
                        {calibration.certificate_no && <div className="mb-1 font-mono text-sm text-slate-950">{calibration.certificate_no}</div>}
                        {calibration.performed_by && <div className="text-sm text-slate-700">{calibration.performed_by}</div>}
                      </div>
                      {isLatest && isActive && <span className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white">Текущая</span>}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div><span className="text-slate-500">Действует с:</span> <span className="font-medium text-slate-900">{formatDate(calibration.valid_from)}</span></div>
                      <div><span className="text-slate-500">Действует по:</span> <span className="font-medium text-slate-900">{formatDate(calibration.valid_until)}</span></div>
                    </div>
                    {calibration.notes && <div className="mt-2 rounded bg-white/50 p-2 text-xs text-slate-600">{calibration.notes}</div>}
                    <div className="mt-2 text-xs text-slate-400">Внесено: {calibration.recorded_by || '—'} · {formatDateTime(calibration.recorded_at)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EquipmentForm({
  busy,
  canManage,
  form,
  isNew,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean
  canManage: boolean
  form: EquipmentCreate
  isNew: boolean
  onCancel: () => void
  onChange: (form: EquipmentCreate) => void
  onSave: () => void
}) {
  return (
    <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{isNew ? 'Новый прибор' : 'Редактирование прибора'}</h2>
          <p className="mt-1 text-sm text-slate-500">Паспортные данные КИП для использования в аналитических листах Ф-11.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InputField disabled={!canManage || !isNew} label="Код" mono onChange={(value) => onChange({ ...form, code: value })} value={form.code} placeholder="HPLC-01" />
        <InputField disabled={!canManage} label="Наименование" onChange={(value) => onChange({ ...form, name: value })} value={form.name} placeholder="Жидкостной хроматограф Agilent 1260" />
        <InputField disabled={!canManage} label="Категория" onChange={(value) => onChange({ ...form, category: value })} value={form.category || ''} placeholder="ВЭЖХ" />
        <InputField disabled={!canManage} label="Производитель" onChange={(value) => onChange({ ...form, manufacturer: value })} value={form.manufacturer || ''} placeholder="Agilent" />
        <InputField disabled={!canManage} label="Модель" mono onChange={(value) => onChange({ ...form, model: value })} value={form.model || ''} placeholder="1260 Infinity II" />
        <InputField disabled={!canManage} label="Серийный номер" mono onChange={(value) => onChange({ ...form, serial_no: value })} value={form.serial_no || ''} />
        <InputField disabled={!canManage} label="Место установки" onChange={(value) => onChange({ ...form, location: value })} value={form.location || ''} placeholder="Лаборатория ДКК, помещение 203" />
        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-sm text-slate-600">Примечания</span>
          <textarea className="min-h-[90px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:opacity-60" disabled={!canManage} onChange={(event) => onChange({ ...form, notes: event.target.value })} value={form.notes || ''} />
        </label>
      </div>
      {canManage && (
        <div className="mt-5 flex gap-2 border-t border-slate-200 pt-4">
          <button className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50" disabled={busy} onClick={onSave} type="button">
            <Save className="h-4 w-4" />
            Сохранить
          </button>
          <button className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 hover:bg-slate-50" onClick={onCancel} type="button">
            <X className="h-4 w-4" />
            Отмена
          </button>
        </div>
      )}
    </div>
  )
}

function AddCalibrationDialog({
  busy,
  equipment,
  form,
  onChange,
  onClose,
  onSubmit,
  open,
}: {
  busy: boolean
  equipment: EquipmentDetail
  form: EquipmentCalibrationCreate
  onChange: (form: EquipmentCalibrationCreate) => void
  onClose: () => void
  onSubmit: () => void
  open: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-950">Добавить калибровку</h2>
          <p className="mt-1 text-sm text-slate-600">
            <code className="font-mono text-slate-700">{equipment.code}</code> · {equipment.name}
          </p>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-4">
            <InputField label="№ сертификата / протокола" mono onChange={(value) => onChange({ ...form, certificate_no: value })} value={form.certificate_no || ''} placeholder="KAL-2024-001" />
            <InputField label="Кем выполнена" onChange={(value) => onChange({ ...form, performed_by: value })} value={form.performed_by || ''} placeholder="ООО «Узметрология»" />
            <InputField label="Действует с *" onChange={(value) => onChange({ ...form, valid_from: value })} type="date" value={form.valid_from} />
            <InputField label="Действует по *" onChange={(value) => onChange({ ...form, valid_until: value })} type="date" value={form.valid_until} />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm text-slate-600">Примечания</span>
            <textarea className="min-h-[90px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400" onChange={(event) => onChange({ ...form, notes: event.target.value })} value={form.notes || ''} placeholder="Дополнительная информация о калибровке" />
          </label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <strong>GMP Annex 15:</strong> запись о калибровке фиксируется с указанием текущего пользователя и времени внесения.
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={onClose} type="button">Отмена</button>
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50" disabled={busy} onClick={onSubmit} type="button">Добавить калибровку</button>
        </div>
      </div>
    </div>
  )
}

export function CalibrationBadge({
  size = 'md',
  status,
  validUntil,
}: {
  status: CalibrationStatus
  validUntil?: string | null
  size?: 'sm' | 'md'
}) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon
  const isSmall = size === 'sm'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border ${config.cls} ${isSmall ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'}`}>
      <Icon className={isSmall ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      <span>{config.label}</span>
      {validUntil && status !== 'missing' && <span className="text-xs opacity-75">до {formatShortDate(validUntil)}</span>}
    </span>
  )
}

function StatCard({ active, count, label, onClick, status }: { active: boolean; count: number; label: string; onClick: () => void; status: CalibrationStatus }) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon
  return (
    <button
      className={`rounded-xl border bg-white p-4 text-left transition-all ${config.accent} ${active ? 'shadow-sm' : 'border-slate-200'}`}
      data-active={active}
      onClick={onClick}
      type="button"
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${status === 'ok' ? 'text-emerald-600' : status === 'expiring' ? 'text-amber-600' : status === 'expired' ? 'text-rose-600' : 'text-slate-600'}`} />
        <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <div className="text-2xl font-medium text-slate-950">{count}</div>
    </button>
  )
}

function DetailValue({ className = '', label, mono = false, value }: { className?: string; label: string; mono?: boolean; value?: string | null }) {
  if (!value) return null
  return (
    <div className={className}>
      <div className="mb-1 text-xs text-slate-500">{label}</div>
      <div className={`${mono ? 'font-mono text-xs' : 'text-sm'} text-slate-900`}>{value}</div>
    </div>
  )
}

function InputField({
  disabled,
  label,
  mono = false,
  onChange,
  placeholder,
  type = 'text',
  value,
}: {
  disabled?: boolean
  label: string
  mono?: boolean
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  value: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-slate-600">{label}</span>
      <input
        className={`h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-slate-400 disabled:opacity-60 ${mono ? 'font-mono' : ''}`}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
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

function fromDetail(detail: EquipmentDetail): EquipmentCreate {
  return {
    code: detail.code,
    name: detail.name,
    category: detail.category,
    manufacturer: detail.manufacturer,
    model: detail.model,
    serial_no: detail.serial_no,
    location: detail.location,
    notes: detail.notes,
  }
}

function cleanedCreate(form: EquipmentCreate): EquipmentCreate {
  return {
    code: cleanText(form.code),
    name: cleanText(form.name),
    category: cleanNullable(form.category),
    manufacturer: cleanNullable(form.manufacturer),
    model: cleanNullable(form.model),
    serial_no: cleanNullable(form.serial_no),
    location: cleanNullable(form.location),
    notes: cleanNullable(form.notes),
  }
}

function cleanText(value: string) {
  return value.trim()
}

function cleanNullable(value: string | null | undefined) {
  const normalized = (value || '').trim()
  return normalized || null
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value))
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(value))
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value))
}
