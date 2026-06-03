import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, Info, Plus, Save, Search, Wrench, X, XCircle } from 'lucide-react'
import {
  addEquipmentCalibration,
  createEquipment,
  getEquipment,
  listEquipment,
  updateEquipment,
} from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
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
type Translate = ReturnType<typeof useI18n>['t']

function statusLabel(status: CalibrationStatus, t: Translate): string {
  return t(`equip.status.${status}` as Parameters<Translate>[0])
}

const STATUS_CONFIG: Record<CalibrationStatus, { icon: typeof CheckCircle2; cls: string; accent: string }> = {
  ok: {
    icon: CheckCircle2,
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    accent: 'hover:border-emerald-300 data-[active=true]:border-emerald-400',
  },
  expiring: {
    icon: Clock,
    cls: 'border-amber-200 bg-amber-50 text-amber-700',
    accent: 'hover:border-amber-300 data-[active=true]:border-amber-400',
  },
  expired: {
    icon: XCircle,
    cls: 'border-rose-200 bg-rose-50 text-rose-700',
    accent: 'hover:border-rose-300 data-[active=true]:border-rose-400',
  },
  missing: {
    icon: AlertCircle,
    cls: 'border-slate-300 bg-slate-100 text-slate-700',
    accent: 'hover:border-slate-400 data-[active=true]:border-slate-500',
  },
}

export function EquipmentAdminPage({ token, user }: Props) {
  const { t } = useI18n()
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
      setError(err instanceof Error ? err.message : t('equip.loadFailed'))
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
      setError(err instanceof Error ? err.message : t('equip.openFailed'))
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
      setError(t('equip.errCodeName'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (isNew) {
        const created = await createEquipment(token, cleanedCreate(form))
        setSuccess(t('equip.created', { code: created.code }))
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
        setSuccess(t('equip.saved'))
        setEditMode(false)
        await reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('equip.saveFailed'))
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
      setError(err instanceof Error ? err.message : t('equip.statusChangeFailed'))
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
      setError(t('equip.calPeriodRequired'))
      return
    }
    if (new Date(calForm.valid_until) <= new Date(calForm.valid_from)) {
      setError(t('equip.calDateOrder'))
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
      setSuccess(t('equip.calAdded'))
      setCalibrationDialogOpen(false)
      setCalForm(emptyCalibration())
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('equip.calAddFailed'))
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
            {t('equip.eyebrow')}
          </div>
          <h1 className="mb-1 text-2xl font-semibold text-slate-950">{t('nav.qcEquipment')}</h1>
          <p className="text-sm text-slate-600">
            {t('equip.subtitle')}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard count={stats.ok} label={t('equip.statOk')} status="ok" active={statusFilter === 'ok'} onClick={() => setStatusFilter(statusFilter === 'ok' ? 'all' : 'ok')} />
          <StatCard count={stats.expiring} label={t('equip.statExpiring')} status="expiring" active={statusFilter === 'expiring'} onClick={() => setStatusFilter(statusFilter === 'expiring' ? 'all' : 'expiring')} />
          <StatCard count={stats.expired} label={t('equip.statExpired')} status="expired" active={statusFilter === 'expired'} onClick={() => setStatusFilter(statusFilter === 'expired' ? 'all' : 'expired')} />
          <StatCard count={stats.missing} label={t('equip.statMissing')} status="missing" active={statusFilter === 'missing'} onClick={() => setStatusFilter(statusFilter === 'missing' ? 'all' : 'missing')} />
        </div>

        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[280px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={t('equip.searchPlaceholder')}
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
                  {category === 'all' ? t('equip.allCategories') : category}
                </option>
              ))}
            </select>
            <select
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
              className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-slate-400"
            >
              <option value="all">{t('equip.allEquipment')}</option>
              <option value="active">{t('equip.inService')}</option>
              <option value="inactive">{t('equip.retired')}</option>
            </select>
            {canManage && (
              <button
                type="button"
                onClick={startNew}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                {t('equip.addEquipment')}
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
  const { t } = useI18n()
  if (equipment.length === 0) {
    return (
      <div className="flex w-[45%] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center">
        <Wrench className="mb-3 h-12 w-12 text-slate-300" />
        <div className="mb-2 text-slate-400">{t('equip.notFound')}</div>
        <p className="text-sm text-slate-500">{t('equip.notFoundHint')}</p>
      </div>
    )
  }

  return (
    <div className="flex w-[45%] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-slate-500">{t('equip.foundCount', { n: equipment.length })}</div>
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
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{t('equip.retiredShort')}</span>
                    )}
                  </div>
                  <div className="truncate text-sm text-slate-700">{item.name}</div>
                  {item.category && <div className="mt-0.5 text-xs text-slate-500">{item.category}</div>}
                </div>
                <CalibrationBadge status={item.calibration_status} validUntil={item.calibration_valid_until} size="sm" />
              </div>
              {item.calibration_valid_until && (
                <div className="mt-1 text-xs text-slate-500">
                  {t('equip.calUntil', { date: formatDate(item.calibration_valid_until) })}
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
  const { t } = useI18n()
  if (!equipment) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center">
        <Info className="mx-auto mb-3 h-12 w-12 text-slate-400" />
        <div className="mb-2 text-slate-400">{t('equip.selectEquipment')}</div>
        <p className="text-sm text-slate-500">{t('equip.selectEquipmentHint')}</p>
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
              {!equipment.is_active && <span className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700">{t('equip.retiredFull')}</span>}
            </div>
            <h2 className="mb-2 text-base font-medium text-slate-900">{equipment.name}</h2>
            <CalibrationBadge status={equipment.calibration_status} validUntil={equipment.calibration_valid_until} />
          </div>
          {canManage && (
            <div className="flex gap-2">
              <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={onEdit} type="button">
                {t('equip.edit')}
              </button>
              <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={onToggleActive} type="button">
                {equipment.is_active ? t('equip.retire') : t('equip.restore')}
              </button>
            </div>
          )}
        </div>

        {isUnavailable && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <div className="mb-1 font-medium">{t('equip.unavailableTitle')}</div>
            <div className="text-xs text-rose-700">
              {!equipment.is_active && `${t('equip.unavailableRetired')} `}
              {equipment.calibration_status === 'expired' && `${t('equip.unavailableExpired')} `}
              {equipment.calibration_status === 'missing' && `${t('equip.unavailableMissing')} `}
              {t('equip.unavailableNeed')}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-5">
        <div className="mb-6">
          <h3 className="mb-3 text-xs uppercase tracking-wide text-slate-500">{t('equip.passport')}</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <DetailValue label={t('equip.fieldCategory')} value={equipment.category} />
            <DetailValue label={t('equip.fieldManufacturer')} value={equipment.manufacturer} />
            <DetailValue label={t('equip.fieldModel')} value={equipment.model} mono />
            <DetailValue label={t('equip.fieldSerial')} value={equipment.serial_no} mono />
            <DetailValue className="col-span-2" label={t('equip.fieldLocation')} value={equipment.location} />
            <DetailValue className="col-span-2" label={t('equip.fieldNotes')} value={equipment.notes} />
          </div>
        </div>

        <div className="my-6 h-px bg-slate-200" />

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-slate-500">{t('equip.calHistory', { n: equipment.calibrations.length })}</h3>
            {canManage && (
              <button className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800" onClick={onAddCalibration} type="button">
                <Plus className="h-3.5 w-3.5" />
                {t('equip.addCalibration')}
              </button>
            )}
          </div>

          {equipment.calibrations.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 py-8 text-center">
              <Clock className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <div className="text-sm text-slate-500">{t('equip.noCalibrations')}</div>
              <div className="mt-1 text-xs text-slate-400">{t('equip.noCalibrationsHint')}</div>
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
                      {isLatest && isActive && <span className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white">{t('equip.current')}</span>}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div><span className="text-slate-500">{t('equip.validFrom')}</span> <span className="font-medium text-slate-900">{formatDate(calibration.valid_from)}</span></div>
                      <div><span className="text-slate-500">{t('equip.validTo')}</span> <span className="font-medium text-slate-900">{formatDate(calibration.valid_until)}</span></div>
                    </div>
                    {calibration.notes && <div className="mt-2 rounded bg-white/50 p-2 text-xs text-slate-600">{calibration.notes}</div>}
                    <div className="mt-2 text-xs text-slate-400">{t('equip.recordedBy')}: {calibration.recorded_by || '—'} · {formatDateTime(calibration.recorded_at)}</div>
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
  const { t } = useI18n()
  return (
    <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{isNew ? t('equip.formNew') : t('equip.formEdit')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('equip.formSubtitle')}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InputField disabled={!canManage || !isNew} label={t('equip.fieldCode')} mono onChange={(value) => onChange({ ...form, code: value })} value={form.code} placeholder="HPLC-01" />
        <InputField disabled={!canManage} label={t('equip.fieldName')} onChange={(value) => onChange({ ...form, name: value })} value={form.name} placeholder={t('equip.namePlaceholder')} />
        <InputField disabled={!canManage} label={t('equip.fieldCategory')} onChange={(value) => onChange({ ...form, category: value })} value={form.category || ''} placeholder={t('equip.categoryPlaceholder')} />
        <InputField disabled={!canManage} label={t('equip.fieldManufacturer')} onChange={(value) => onChange({ ...form, manufacturer: value })} value={form.manufacturer || ''} placeholder="Agilent" />
        <InputField disabled={!canManage} label={t('equip.fieldModel')} mono onChange={(value) => onChange({ ...form, model: value })} value={form.model || ''} placeholder="1260 Infinity II" />
        <InputField disabled={!canManage} label={t('equip.fieldSerial')} mono onChange={(value) => onChange({ ...form, serial_no: value })} value={form.serial_no || ''} />
        <InputField disabled={!canManage} label={t('equip.fieldLocation')} onChange={(value) => onChange({ ...form, location: value })} value={form.location || ''} placeholder={t('equip.locationPlaceholder')} />
        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-sm text-slate-600">{t('equip.fieldNotes')}</span>
          <textarea className="min-h-[90px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:opacity-60" disabled={!canManage} onChange={(event) => onChange({ ...form, notes: event.target.value })} value={form.notes || ''} />
        </label>
      </div>
      {canManage && (
        <div className="mt-5 flex gap-2 border-t border-slate-200 pt-4">
          <button className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50" disabled={busy} onClick={onSave} type="button">
            <Save className="h-4 w-4" />
            {t('common.save')}
          </button>
          <button className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 hover:bg-slate-50" onClick={onCancel} type="button">
            <X className="h-4 w-4" />
            {t('common.cancel')}
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
  const { t } = useI18n()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-950">{t('equip.addCalibration')}</h2>
          <p className="mt-1 text-sm text-slate-600">
            <code className="font-mono text-slate-700">{equipment.code}</code> · {equipment.name}
          </p>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-4">
            <InputField label={t('equip.certNo')} mono onChange={(value) => onChange({ ...form, certificate_no: value })} value={form.certificate_no || ''} placeholder="KAL-2024-001" />
            <InputField label={t('equip.performedBy')} onChange={(value) => onChange({ ...form, performed_by: value })} value={form.performed_by || ''} placeholder={t('equip.performedByPlaceholder')} />
            <InputField label={t('equip.validFromReq')} onChange={(value) => onChange({ ...form, valid_from: value })} type="date" value={form.valid_from} />
            <InputField label={t('equip.validToReq')} onChange={(value) => onChange({ ...form, valid_until: value })} type="date" value={form.valid_until} />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm text-slate-600">{t('equip.fieldNotes')}</span>
            <textarea className="min-h-[90px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400" onChange={(event) => onChange({ ...form, notes: event.target.value })} value={form.notes || ''} placeholder={t('equip.calNotesPlaceholder')} />
          </label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <strong>GMP Annex 15:</strong> {t('equip.annexNote')}
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={onClose} type="button">{t('common.cancel')}</button>
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50" disabled={busy} onClick={onSubmit} type="button">{t('equip.addCalibration')}</button>
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
  const { t } = useI18n()
  const config = STATUS_CONFIG[status]
  const Icon = config.icon
  const isSmall = size === 'sm'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border ${config.cls} ${isSmall ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'}`}>
      <Icon className={isSmall ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      <span>{statusLabel(status, t)}</span>
      {validUntil && status !== 'missing' && <span className="text-xs opacity-75">{t('equip.badgeUntil')} {formatShortDate(validUntil)}</span>}
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
