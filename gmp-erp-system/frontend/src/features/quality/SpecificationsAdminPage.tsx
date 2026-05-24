import { useEffect, useMemo, useState } from 'react'
import { BookMarked, Beaker, FlaskConical, Microscope, Plus, Save, Trash2, X } from 'lucide-react'
import {
  createSpecification,
  deleteSpecification,
  getSpecification,
  listSpecifications,
  updateSpecification,
} from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type {
  MaterialSpecificationInput,
  MaterialSpecificationItem,
  MaterialSpecificationListItem,
  QCParamCategory,
} from '../../types/inventory'

type Translate = ReturnType<typeof useI18n>['t']

interface ParamRow {
  key: string
  category: QCParamCategory
  parameter_name: string
  specification: string
  method_reference: string
  unit: string
}

let seq = 0
const key = () => `sp${++seq}`

function emptyDraft(): MaterialSpecificationInput {
  return {
    nd_code: '',
    revision: null,
    material_name: '',
    material_id: null,
    match_keywords: '',
    sop_form: '533',
    micro_required: true,
    micro_method_ref: 'ГФ РУз, ЕР-11 2.6.12, 2.6.13, 5.1.4',
    is_active: true,
    effective_date: null,
    notes: null,
    parameters: [],
  }
}

interface Props {
  token: string
  user: CurrentUser
}

export function SpecificationsAdminPage({ token, user }: Props) {
  const { t } = useI18n()
  const canManage = user.permissions.includes('MANAGE_SPECIFICATIONS')

  const [list, setList] = useState<MaterialSpecificationListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  // Поля шапки
  const [ndCode, setNdCode] = useState('')
  const [revision, setRevision] = useState('')
  const [materialName, setMaterialName] = useState('')
  const [matchKeywords, setMatchKeywords] = useState('')
  const [sopForm, setSopForm] = useState('533')
  const [microRequired, setMicroRequired] = useState(true)
  const [microMethodRef, setMicroMethodRef] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [notes, setNotes] = useState('')
  const [params, setParams] = useState<ParamRow[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function reload() {
    try {
      const resp = await listSpecifications(token)
      setList(resp.specifications)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    }
  }

  useEffect(() => {
    void reload()
  }, [token])

  function fillForm(spec: MaterialSpecificationItem) {
    setNdCode(spec.nd_code)
    setRevision(spec.revision || '')
    setMaterialName(spec.material_name)
    setMatchKeywords(spec.match_keywords || '')
    setSopForm(spec.sop_form)
    setMicroRequired(spec.micro_required)
    setMicroMethodRef(spec.micro_method_ref || '')
    setIsActive(spec.is_active)
    setNotes(spec.notes || '')
    setParams(spec.parameters.map((p) => ({
      key: key(), category: p.category, parameter_name: p.parameter_name,
      specification: p.specification, method_reference: p.method_reference || '', unit: p.unit || '',
    })))
  }

  async function select(id: string) {
    setError(null)
    setSuccess(null)
    setIsNew(false)
    setSelectedId(id)
    try {
      const spec = await getSpecification(token, id)
      fillForm(spec)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    }
  }

  function startNew() {
    setError(null)
    setSuccess(null)
    setIsNew(true)
    setSelectedId(null)
    const d = emptyDraft()
    setNdCode(d.nd_code)
    setRevision('')
    setMaterialName('')
    setMatchKeywords('')
    setSopForm('533')
    setMicroRequired(true)
    setMicroMethodRef(d.micro_method_ref || '')
    setIsActive(true)
    setNotes('')
    setParams([])
  }

  function buildPayload(): MaterialSpecificationInput {
    return {
      nd_code: ndCode.trim(),
      revision: revision.trim() || null,
      material_name: materialName.trim(),
      material_id: null,
      match_keywords: matchKeywords.trim() || null,
      sop_form: sopForm,
      micro_required: microRequired,
      micro_method_ref: microMethodRef.trim() || null,
      is_active: isActive,
      effective_date: null,
      notes: notes.trim() || null,
      parameters: params
        .filter((p) => p.parameter_name.trim() && p.specification.trim())
        .map((p) => ({
          category: p.category,
          parameter_name: p.parameter_name,
          specification: p.specification,
          method_reference: p.method_reference || null,
          unit: p.unit || null,
        })),
    }
  }

  async function save() {
    setError(null)
    setSuccess(null)
    const payload = buildPayload()
    if (!payload.nd_code || !payload.material_name) {
      setError(t('specs.errRequired'))
      return
    }
    if (payload.parameters.length === 0) {
      setError(t('specs.errNoParams'))
      return
    }
    setBusy(true)
    try {
      if (isNew) {
        const created = await createSpecification(token, payload)
        await reload()
        setIsNew(false)
        setSelectedId(created.id)
      } else if (selectedId) {
        await updateSpecification(token, selectedId, payload)
        await reload()
      }
      setSuccess(t('specs.saved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selectedId) return
    if (!window.confirm(t('specs.confirmDelete'))) return
    setBusy(true)
    setError(null)
    try {
      await deleteSpecification(token, selectedId)
      setSelectedId(null)
      await reload()
      setSuccess(t('specs.deleted'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    } finally {
      setBusy(false)
    }
  }

  function patch(k: string, p: Partial<ParamRow>) {
    setParams((prev) => prev.map((row) => (row.key === k ? { ...row, ...p } : row)))
  }
  function addRow(category: QCParamCategory) {
    setParams((prev) => [...prev, { key: key(), category, parameter_name: '', specification: '', method_reference: '', unit: category === 'microbiological' ? '—' : '' }])
  }

  const editing = isNew || selectedId !== null
  const pcRows = useMemo(() => params.filter((p) => p.category === 'physicochemical'), [params])
  const microRows = useMemo(() => params.filter((p) => p.category === 'microbiological'), [params])

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t('specs.eyebrow')}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">{t('specs.title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t('specs.subtitle')}</p>
        </div>
        {canManage && (
          <button type="button" onClick={startNew}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-[13px] font-medium text-white hover:bg-slate-800">
            <Plus size={15} /> {t('specs.new')}
          </button>
        )}
      </div>

      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      <div className="grid grid-cols-12 gap-4">
        {/* Список */}
        <aside className="col-span-12 lg:col-span-4 xl:col-span-3">
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {t('specs.registry')} · {list.length}
            </div>
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {list.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => void select(s.id)}
                    className={`flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition hover:bg-slate-50 ${selectedId === s.id ? 'bg-slate-50' : ''}`}>
                    <span className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium text-slate-900">{s.material_name}</span>
                      {!s.is_active && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{t('specs.inactive')}</span>}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">{s.nd_code}</span>
                    <span className="text-[11px] text-slate-400">{s.parameters_count} {t('specs.paramsShort')} · СОП-{s.sop_form}</span>
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-400">{t('specs.empty')}</li>}
            </ul>
          </div>
        </aside>

        {/* Редактор / просмотр */}
        <div className="col-span-12 lg:col-span-8 xl:col-span-9">
          {!editing ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-20 text-center">
              <BookMarked size={28} className="text-slate-300" />
              <p className="text-sm font-medium text-slate-700">{t('specs.selectHint')}</p>
            </div>
          ) : (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              {/* Шапка */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Labeled label={t('specs.material')}>
                  <input value={materialName} disabled={!canManage} onChange={(e) => setMaterialName(e.target.value)} className="inp" placeholder="Гликлазид" />
                </Labeled>
                <Labeled label={t('specs.ndCode')}>
                  <input value={ndCode} disabled={!canManage} onChange={(e) => setNdCode(e.target.value)} className="inp font-mono" placeholder="НД-SPC/СУБ/000/00" />
                </Labeled>
                <Labeled label={t('specs.revision')}>
                  <input value={revision} disabled={!canManage} onChange={(e) => setRevision(e.target.value)} className="inp" placeholder="—" />
                </Labeled>
                <Labeled label={t('specs.keywords')} hint={t('specs.keywordsHint')}>
                  <input value={matchKeywords} disabled={!canManage} onChange={(e) => setMatchKeywords(e.target.value)} className="inp" placeholder="гликлазид gliclazid" />
                </Labeled>
                <Labeled label={t('specs.sopForm')}>
                  <select value={sopForm} disabled={!canManage} onChange={(e) => setSopForm(e.target.value)} className="inp">
                    <option value="533">СОП-533 (субстанция/упак.)</option>
                    <option value="548">СОП-548 (ГП)</option>
                  </select>
                </Labeled>
                <Labeled label={t('specs.microMethod')}>
                  <input value={microMethodRef} disabled={!canManage} onChange={(e) => setMicroMethodRef(e.target.value)} className="inp" />
                </Labeled>
                <div className="flex items-center gap-4 md:col-span-3">
                  <label className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-700">
                    <input type="checkbox" checked={microRequired} disabled={!canManage} onChange={(e) => setMicroRequired(e.target.checked)} className="h-4 w-4 accent-slate-900" />
                    {t('specs.microRequired')}
                  </label>
                  <label className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-700">
                    <input type="checkbox" checked={isActive} disabled={!canManage} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-slate-900" />
                    {t('specs.active')}
                  </label>
                </div>
              </div>

              {/* ФХ параметры */}
              <ParamTable
                title={t('specs.pcSection')} icon={FlaskConical} rows={pcRows} canManage={canManage}
                onPatch={patch} onRemove={(k) => setParams((prev) => prev.filter((r) => r.key !== k))}
                onAdd={() => addRow('physicochemical')} t={t} withUnitMethod
              />
              {/* Микро параметры */}
              <ParamTable
                title={t('specs.microSection')} icon={Microscope} rows={microRows} canManage={canManage}
                onPatch={patch} onRemove={(k) => setParams((prev) => prev.filter((r) => r.key !== k))}
                onAdd={() => addRow('microbiological')} t={t} withUnitMethod={false}
              />

              {/* Действия */}
              {canManage && (
                <div className="flex items-center gap-2 border-t border-slate-200 pt-4">
                  <button type="button" disabled={busy} onClick={() => void save()}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md bg-emerald-700 px-4 text-[13px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                    <Save size={15} /> {t('common.save')}
                  </button>
                  {!isNew && selectedId && (
                    <button type="button" disabled={busy} onClick={() => void remove()}
                      className="inline-flex h-10 items-center gap-1.5 rounded-md border border-rose-200 bg-white px-4 text-[13px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                      <Trash2 size={15} /> {t('common.delete')}
                    </button>
                  )}
                  <button type="button" onClick={() => { setSelectedId(null); setIsNew(false) }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
                    <X size={15} /> {t('common.cancel')}
                  </button>
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

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10.5px] text-slate-400">{hint}</span>}
    </label>
  )
}

function ParamTable({
  title, icon: Icon, rows, canManage, onPatch, onRemove, onAdd, t, withUnitMethod,
}: {
  title: string
  icon: typeof Beaker
  rows: ParamRow[]
  canManage: boolean
  onPatch: (k: string, p: Partial<ParamRow>) => void
  onRemove: (k: string) => void
  onAdd: () => void
  t: Translate
  withUnitMethod: boolean
}) {
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-3 py-2">
        <Icon size={15} className="text-slate-500" />
        <span className="text-[12px] font-semibold text-slate-800">{title}</span>
        <span className="text-[11px] text-slate-400">· {rows.length}</span>
        {canManage && (
          <button type="button" onClick={onAdd} className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50">
            <Plus size={12} /> {t('specs.addParam')}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead className="bg-slate-50/40 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-8 px-2 py-1.5 text-center">№</th>
              <th className="px-2 py-1.5">{t('specs.colName')}</th>
              <th className="px-2 py-1.5">{t('specs.colNorm')}</th>
              {withUnitMethod && <th className="px-2 py-1.5">{t('specs.colMethod')}</th>}
              {withUnitMethod && <th className="w-20 px-2 py-1.5">{t('specs.colUnit')}</th>}
              {canManage && <th className="w-8 px-2 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.key} className="border-t border-slate-100 align-top">
                <td className="px-2 py-1.5 text-center font-mono text-[11px] text-slate-400">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <input value={p.parameter_name} disabled={!canManage} onChange={(e) => onPatch(p.key, { parameter_name: e.target.value })} className="w-full rounded border border-slate-200 px-1.5 py-1 outline-none focus:border-slate-400 disabled:bg-slate-50" />
                </td>
                <td className="px-2 py-1.5">
                  <input value={p.specification} disabled={!canManage} onChange={(e) => onPatch(p.key, { specification: e.target.value })} className="w-full rounded border border-slate-200 px-1.5 py-1 outline-none focus:border-slate-400 disabled:bg-slate-50" />
                </td>
                {withUnitMethod && (
                  <td className="px-2 py-1.5">
                    <input value={p.method_reference} disabled={!canManage} onChange={(e) => onPatch(p.key, { method_reference: e.target.value })} className="w-full rounded border border-slate-200 px-1.5 py-1 outline-none focus:border-slate-400 disabled:bg-slate-50" />
                  </td>
                )}
                {withUnitMethod && (
                  <td className="px-2 py-1.5">
                    <input value={p.unit} disabled={!canManage} onChange={(e) => onPatch(p.key, { unit: e.target.value })} className="w-full rounded border border-slate-200 px-1.5 py-1 font-mono outline-none focus:border-slate-400 disabled:bg-slate-50" />
                  </td>
                )}
                {canManage && (
                  <td className="px-2 py-1.5">
                    <button type="button" onClick={() => onRemove(p.key)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={withUnitMethod ? 6 : 4} className="px-2 py-4 text-center text-[12px] text-slate-400">{t('specs.noRows')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
