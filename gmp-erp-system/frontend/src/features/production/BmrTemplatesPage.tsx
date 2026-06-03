import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown, ArrowUp, CheckCircle2, Copy, FileText, Layers, Plus, RefreshCw, ShieldCheck, Trash2, X,
} from 'lucide-react'
import {
  approveBmrTemplate,
  createBmrTemplate,
  deleteBmrTemplate,
  duplicateBmrTemplate,
  getBmrTemplate,
  listBmrTemplates,
  listMaterials,
  listProducts,
  updateBmrTemplate,
} from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { BmrTemplateItem, BmrTemplateListItem, MaterialItem, ProductItem } from '../../types/inventory'

interface Props { token: string; user: CurrentUser }

type Translate = ReturnType<typeof useI18n>['t']

const SECTION_TYPE_VALUES = [
  'product_header', 'production_formula', 'distribution_list', 'stage', 'environment',
  'equipment', 'checklist', 'process_steps', 'in_process_control', 'yield',
  'materials_used', 'attachments', 'free_text',
]
const FIELD_TYPE_VALUES = [
  'text', 'number', 'checkbox', 'select', 'datetime', 'signature_operator', 'signature_qa', 'calc',
]
const STATUS_CLS: Record<string, string> = {
  draft: 'border-amber-200 bg-amber-50 text-amber-700',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  obsolete: 'border-slate-200 bg-slate-100 text-slate-500',
}
function sectionLabel(v: string, t: Translate): string {
  return SECTION_TYPE_VALUES.includes(v) ? t(`bmrTpl.sectionType.${v}` as Parameters<Translate>[0]) : v
}
function fieldTypeLabel(v: string, t: Translate): string {
  return FIELD_TYPE_VALUES.includes(v) ? t(`bmrTpl.fieldType.${v}` as Parameters<Translate>[0]) : v
}
function statusLabel(v: string, t: Translate): string {
  return ['draft', 'approved', 'obsolete'].includes(v) ? t(`bmrTpl.status.${v}` as Parameters<Translate>[0]) : v
}

interface FieldDef { label: string; type: string; unit?: string; required?: boolean }
interface DistRow { id: string; group: string; material_code: string; name: string; qty: string }
interface SecForm { section_type: string; title: string; room?: string; stage?: string; stage_title?: string; fields: FieldDef[]; dist?: DistRow[] }
interface TplForm { id?: string; product_id: string; title: string; status: string; version: number; sections: SecForm[] }

let _rid = 0
function rid(): string { _rid += 1; return `r${_rid}` }

function distFromConfig(config: BmrTemplateItem['sections'][number]['config']): DistRow[] {
  const rows: DistRow[] = []
  for (const g of config?.groups ?? []) {
    for (const it of g.items ?? []) {
      rows.push({ id: rid(), group: g.title || '', material_code: (it as { material_code?: string }).material_code ?? '', name: it.name ?? '', qty: it.qty ?? '' })
    }
  }
  return rows
}

function fromItem(item: BmrTemplateItem): TplForm {
  return {
    id: item.id, product_id: item.product_id, title: item.title, status: item.status, version: item.version,
    sections: item.sections.map((s) => ({
      section_type: s.section_type, title: s.title,
      room: s.config?.room ?? '', stage: s.config?.stage ?? '', stage_title: s.config?.stage_title ?? '',
      fields: (s.config?.fields ?? []).map((f) => ({ label: f.label, type: f.type, unit: f.unit ?? '', required: !!f.required })),
      dist: s.section_type === 'distribution_list' ? distFromConfig(s.config) : undefined,
    })),
  }
}

/** Строит config для distribution_list из строк-материалов: groups + 6 полей на
 * ингредиент (как backend _distribution_list): серия сырья, аналит. лист, вес,
 * Склад, ДП, ДОК. */
function distConfig(sec: SecForm): Record<string, unknown> {
  const rows = (sec.dist ?? []).filter((r) => r.name.trim() || r.material_code)
  const groupsMap = new Map<string, { name: string; material_code: string; qty: string }[]>()
  const order: string[] = []
  for (const r of rows) {
    const key = r.group.trim() || 'Материалы'
    if (!groupsMap.has(key)) { groupsMap.set(key, []); order.push(key) }
    groupsMap.get(key)!.push({ name: r.name.trim(), material_code: r.material_code || undefined as unknown as string, qty: r.qty.trim() })
  }
  const groups = order.map((title) => ({ title, items: groupsMap.get(title)! }))
  const fields: FieldDef[] = []
  for (const g of groups) {
    for (const it of g.items) {
      fields.push({ label: `${it.name} · № серии сырья`, type: 'text' })
      fields.push({ label: `${it.name} · № аналит. листа`, type: 'text' })
      fields.push({ label: `${it.name} · вес нетто`, type: 'number', unit: 'кг' })
      fields.push({ label: `${it.name} · Выдал (Склад)`, type: 'signature_warehouse' })
      fields.push({ label: `${it.name} · Проверил (ДП)`, type: 'signature_operator' })
      fields.push({ label: `${it.name} · Проверил (ДОК)`, type: 'signature_qa' })
    }
  }
  return { kind: 'distribution_list', groups, fields }
}

export function BmrTemplatesPage({ token, user }: Props) {
  const { t } = useI18n()
  const canEdit = user.permissions.includes('MANAGE_BMR_TEMPLATES') || user.role === 'SYS_ADMIN'
  const canApprove = user.permissions.includes('QA_DECISION') || user.role === 'SYS_ADMIN'

  const [list, setList] = useState<BmrTemplateListItem[]>([])
  const [products, setProducts] = useState<ProductItem[]>([])
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [form, setForm] = useState<TplForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [tpls, p, m] = await Promise.all([
        listBmrTemplates(token),
        listProducts(token).catch(() => ({ products: [] as ProductItem[] })),
        listMaterials(token).catch(() => ({ materials: [] as MaterialItem[] })),
      ])
      setList(tpls.templates)
      setProducts(p.products)
      setMaterials(m.materials)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bmrTpl.loadFailed'))
    }
  }, [token, t])

  useEffect(() => { void reload() }, [reload])

  const isDraft = form?.status === 'draft'
  const editable = canEdit && (isDraft || !form?.id)

  async function open(id: string) {
    setError(null); setSuccess(null)
    try { setForm(fromItem(await getBmrTemplate(token, id))) } catch (err) { setError(err instanceof Error ? err.message : 'load failed') }
  }

  function startNew() {
    setError(null); setSuccess(null)
    setForm({ product_id: '', title: '', status: 'draft', version: 0, sections: [] })
  }

  function buildInput() {
    return {
      product_id: form!.product_id, title: form!.title.trim(), notes: null,
      sections: form!.sections.map((s) => {
        const meta: Record<string, unknown> = {}
        if (s.room?.trim()) meta.room = s.room.trim()
        if (s.stage?.trim()) meta.stage = s.stage.trim()
        if (s.stage_title?.trim()) meta.stage_title = s.stage_title.trim()
        const config = s.section_type === 'distribution_list'
          ? { ...distConfig(s), ...meta }
          : { ...meta, fields: s.fields.map((f) => ({ label: f.label.trim(), type: f.type, unit: f.unit?.trim() || null, required: !!f.required })) }
        return { section_type: s.section_type, title: s.title.trim(), config }
      }),
    }
  }

  async function save() {
    if (!form) return
    if (!form.product_id || !form.title.trim()) { setError(t('bmrTpl.errProductTitle')); return }
    setBusy(true); setError(null)
    try {
      const saved = form.id ? await updateBmrTemplate(token, form.id, buildInput()) : await createBmrTemplate(token, buildInput())
      setForm(fromItem(saved)); await reload(); setSuccess(t('bmrTpl.savedOk'))
    } catch (err) { setError(err instanceof Error ? err.message : 'save failed') } finally { setBusy(false) }
  }

  async function doDuplicate() {
    if (!form?.id) return
    setBusy(true); setError(null)
    try { const c = await duplicateBmrTemplate(token, form.id); setForm(fromItem(c)); await reload(); setSuccess(t('bmrTpl.newVersionOk')) }
    catch (err) { setError(err instanceof Error ? err.message : 'failed') } finally { setBusy(false) }
  }

  async function doDelete() {
    if (!form?.id || form.status !== 'draft') return
    const ok = window.confirm(`Удалить ошибочный черновик v${form.version || ''}? Утверждённые версии не удаляются, они остаются для GMP-аудита.`)
    if (!ok) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      await deleteBmrTemplate(token, form.id)
      setForm(null); await reload(); setSuccess('Черновик шаблона удалён.')
    } catch (err) { setError(err instanceof Error ? err.message : 'delete failed') } finally { setBusy(false) }
  }

  async function doApprove() {
    if (!form?.id) return
    setBusy(true); setError(null)
    try { const a = await approveBmrTemplate(token, form.id, null); setForm(fromItem(a)); await reload(); setSuccess(t('bmrTpl.approvedOk')) }
    catch (err) { setError(err instanceof Error ? err.message : 'failed') } finally { setBusy(false) }
  }

  // section/field mutations
  function patchSec(i: number, p: Partial<SecForm>) { setForm((f) => f ? { ...f, sections: f.sections.map((s, x) => x === i ? { ...s, ...p } : s) } : f) }
  function addSection(type: string) { setForm((f) => f ? { ...f, sections: [...f.sections, { section_type: type, title: sectionLabel(type, t), fields: [], dist: type === 'distribution_list' ? [] : undefined }] } : f) }
  function addDistRow(i: number) { patchSec(i, { dist: [...(form!.sections[i].dist ?? []), { id: rid(), group: 'Материалы для смешивания', material_code: '', name: '', qty: '' }] }) }
  function patchDistRow(i: number, rowId: string, p: Partial<DistRow>) {
    patchSec(i, { dist: (form!.sections[i].dist ?? []).map((r) => {
      if (r.id !== rowId) return r
      const next = { ...r, ...p }
      if (p.material_code !== undefined) {
        const mat = materials.find((m) => m.code === p.material_code)
        if (mat && !next.name.trim()) next.name = mat.name
      }
      return next
    }) })
  }
  function removeDistRow(i: number, rowId: string) { patchSec(i, { dist: (form!.sections[i].dist ?? []).filter((r) => r.id !== rowId) }) }
  function removeSection(i: number) { setForm((f) => f ? { ...f, sections: f.sections.filter((_, x) => x !== i) } : f) }
  function moveSection(i: number, d: number) { setForm((f) => { if (!f) return f; const a = [...f.sections]; const j = i + d; if (j < 0 || j >= a.length) return f; [a[i], a[j]] = [a[j], a[i]]; return { ...f, sections: a } }) }
  function addField(i: number) { patchSec(i, { fields: [...form!.sections[i].fields, { label: '', type: 'text', unit: '', required: false }] }) }
  function patchField(i: number, fi: number, p: Partial<FieldDef>) { patchSec(i, { fields: form!.sections[i].fields.map((f, x) => x === fi ? { ...f, ...p } : f) }) }
  function removeField(i: number, fi: number) { patchSec(i, { fields: form!.sections[i].fields.filter((_, x) => x !== fi) }) }

  const activeProducts = useMemo(() => products.filter((p) => p.is_active || p.id === form?.product_id), [products, form?.product_id])

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t('bmrTpl.eyebrow')}</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-slate-950">{t('bmrTpl.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('bmrTpl.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void reload()} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><RefreshCw size={15} />{t('common.refresh')}</button>
          {canEdit && <button type="button" onClick={startNew} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={16} />{t('bmrTpl.newTemplate')}</button>}
        </div>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}
      {success && <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 size={16} />{success}<button type="button" className="ml-auto" onClick={() => setSuccess(null)}><X size={14} /></button></div>}

      <div className="grid grid-cols-12 gap-4">
        <aside className="col-span-12 lg:col-span-4 xl:col-span-3">
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t('bmrTpl.registry')} · {list.length}</div>
            <ul className="max-h-[72vh] divide-y divide-slate-100 overflow-y-auto">
              {list.map((tpl) => (
                <li key={tpl.id}>
                  <button type="button" onClick={() => void open(tpl.id)} className={`block w-full px-4 py-2.5 text-left hover:bg-slate-50 ${form?.id === tpl.id ? 'bg-slate-50' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-slate-500">{tpl.product_code} · {tpl.market_code}</span>
                      <span className={`ml-auto inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${STATUS_CLS[tpl.status] ?? ''}`}>{statusLabel(tpl.status, t)} v{tpl.version}</span>
                    </div>
                    <div className="mt-0.5 text-[13px] font-medium text-slate-900">{tpl.title}</div>
                    <div className="text-[11px] text-slate-500">{tpl.product_name} · {t('bmrTpl.sectionsCount', { n: tpl.sections_count })}</div>
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-400">{t('bmrTpl.emptyList')}</li>}
            </ul>
          </div>
        </aside>

        <div className="col-span-12 lg:col-span-8 xl:col-span-9">
          {!form ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-20 text-center">
              <FileText size={28} className="text-slate-300" />
              <p className="text-sm font-medium text-slate-700">{t('bmrTpl.selectOrCreate')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_CLS[form.status] ?? ''}`}>{statusLabel(form.status, t)}{form.version ? ` · v${form.version}` : ''}</span>
                  <div className="ml-auto flex gap-2">
                    {editable && <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-700 px-3 text-[13px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"><CheckCircle2 size={15} />{t('common.save')}</button>}
                    {form.id && canEdit && <button type="button" disabled={busy} onClick={() => void doDuplicate()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50"><Copy size={15} />{t('bmrTpl.newVersion')}</button>}
                    {form.id && isDraft && canEdit && <button type="button" disabled={busy} onClick={() => void doDelete()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 text-[13px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={15} />Удалить черновик</button>}
                    {form.id && isDraft && canApprove && <button type="button" disabled={busy} onClick={() => void doApprove()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><ShieldCheck size={15} />{t('bmrTpl.approve')}</button>}
                    <button type="button" onClick={() => setForm(null)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-600 hover:bg-slate-50"><X size={15} />{t('common.close')}</button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('bmrTpl.product')}</span>
                    <select className="h-9 w-full rounded-md border border-slate-300 px-2 text-sm disabled:bg-slate-50" value={form.product_id} disabled={!!form.id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                      <option value="">{t('bmrTpl.selectProduct')}</option>
                      {activeProducts.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.market_code} · {p.name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('bmrTpl.templateName')}</span>
                    <input className="h-9 w-full rounded-md border border-slate-300 px-2 text-sm disabled:bg-slate-50" value={form.title} disabled={!editable} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('bmrTpl.templateNamePlaceholder')} />
                  </label>
                </div>
              </div>

              {form.sections.map((sec, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-slate-200 font-mono text-[11px] font-semibold text-slate-700">{i + 1}</span>
                    <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">{sectionLabel(sec.section_type, t)}</span>
                    <input className="h-8 min-w-[200px] flex-1 rounded border border-slate-200 px-2 text-[13px] disabled:bg-slate-50" value={sec.title} disabled={!editable} onChange={(e) => patchSec(i, { title: e.target.value })} />
                    {editable && (
                      <div className="flex items-center gap-0.5">
                        <button type="button" disabled={i === 0} onClick={() => moveSection(i, -1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowUp size={14} /></button>
                        <button type="button" disabled={i === form.sections.length - 1} onClick={() => moveSection(i, 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowDown size={14} /></button>
                        <button type="button" onClick={() => removeSection(i)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('bmrTpl.roomScope')}</span>
                        <input className="h-8 w-full rounded border border-slate-200 px-2 text-[12.5px] disabled:bg-slate-50" value={sec.room ?? ''} disabled={!editable} onChange={(e) => patchSec(i, { room: e.target.value })} placeholder={t('bmrTpl.roomPlaceholder')} /></label>
                      <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('bmrTpl.stageCode')}</span>
                        <input className="h-8 w-full rounded border border-slate-200 px-2 text-[12.5px] disabled:bg-slate-50" value={sec.stage ?? ''} disabled={!editable} onChange={(e) => patchSec(i, { stage: e.target.value })} placeholder="weighing" /></label>
                      <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('bmrTpl.stageName')}</span>
                        <input className="h-8 w-full rounded border border-slate-200 px-2 text-[12.5px] disabled:bg-slate-50" value={sec.stage_title ?? ''} disabled={!editable} onChange={(e) => patchSec(i, { stage_title: e.target.value })} placeholder={t('bmrTpl.stagePlaceholder')} /></label>
                    </div>

                    {sec.section_type === 'distribution_list' ? (
                      <div>
                        <table className="w-full text-left text-[12.5px]">
                          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                            <tr><th className="px-2 py-1">{t('bmrTpl.colGroup')}</th><th className="px-2 py-1">{t('bmrTpl.colMaterialRef')}</th><th className="px-2 py-1">{t('bmrTpl.colNameInZps')}</th><th className="w-28 px-2 py-1">{t('bmrTpl.colQtyPerSeries')}</th>{editable && <th className="w-8" />}</tr>
                          </thead>
                          <tbody>
                            {(sec.dist ?? []).map((r) => (
                              <tr key={r.id} className="border-t border-slate-100">
                                <td className="px-2 py-1"><input className="w-full rounded border border-slate-200 px-1.5 py-1 disabled:bg-slate-50" value={r.group} disabled={!editable} onChange={(e) => patchDistRow(i, r.id, { group: e.target.value })} placeholder={t('bmrTpl.groupPlaceholder')} /></td>
                                <td className="px-2 py-1">
                                  <select className="w-full rounded border border-slate-200 px-1 py-1 disabled:bg-slate-50" value={r.material_code} disabled={!editable} onChange={(e) => patchDistRow(i, r.id, { material_code: e.target.value })}>
                                    <option value="">{t('bmrTpl.selectOption')}</option>
                                    {materials.map((m) => <option key={m.id} value={m.code}>{m.code} · {m.name}</option>)}
                                  </select>
                                </td>
                                <td className="px-2 py-1"><input className="w-full rounded border border-slate-200 px-1.5 py-1 disabled:bg-slate-50" value={r.name} disabled={!editable} onChange={(e) => patchDistRow(i, r.id, { name: e.target.value })} placeholder={t('bmrTpl.namePlaceholder')} /></td>
                                <td className="px-2 py-1"><input className="w-full rounded border border-slate-200 px-1.5 py-1 disabled:bg-slate-50" value={r.qty} disabled={!editable} onChange={(e) => patchDistRow(i, r.id, { qty: e.target.value })} placeholder="3,690" /></td>
                                {editable && <td className="px-2 py-1"><button type="button" onClick={() => removeDistRow(i, r.id)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={13} /></button></td>}
                              </tr>
                            ))}
                            {(sec.dist ?? []).length === 0 && <tr><td colSpan={5} className="px-2 py-2 text-[12px] text-slate-400">{t('bmrTpl.noMaterials')}</td></tr>}
                          </tbody>
                        </table>
                        {editable && <button type="button" onClick={() => addDistRow(i)} className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50"><Plus size={12} />{t('bmrTpl.addMaterial')}</button>}
                        <p className="mt-2 text-[11px] text-slate-400">{t('bmrTpl.distHint')}</p>
                      </div>
                    ) : (
                      <div>
                        <table className="w-full text-left text-[12.5px]">
                          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                            <tr><th className="px-2 py-1">{t('bmrTpl.colFieldColumn')}</th><th className="w-44 px-2 py-1">{t('bmrTpl.colType')}</th><th className="w-24 px-2 py-1">{t('bmrTpl.colUnit')}</th><th className="w-20 px-2 py-1 text-center">{t('bmrTpl.colRequired')}</th>{editable && <th className="w-8" />}</tr>
                          </thead>
                          <tbody>
                            {sec.fields.map((fl, fi) => (
                              <tr key={fi} className="border-t border-slate-100">
                                <td className="px-2 py-1"><input className="w-full rounded border border-slate-200 px-1.5 py-1 disabled:bg-slate-50" value={fl.label} disabled={!editable} onChange={(e) => patchField(i, fi, { label: e.target.value })} placeholder={t('bmrTpl.fieldLabelPlaceholder')} /></td>
                                <td className="px-2 py-1">
                                  <select className="w-full rounded border border-slate-200 px-1 py-1 disabled:bg-slate-50" value={fl.type} disabled={!editable} onChange={(e) => patchField(i, fi, { type: e.target.value })}>
                                    {FIELD_TYPE_VALUES.map((ft) => <option key={ft} value={ft}>{fieldTypeLabel(ft, t)}</option>)}
                                  </select>
                                </td>
                                <td className="px-2 py-1"><input className="w-full rounded border border-slate-200 px-1.5 py-1 disabled:bg-slate-50" value={fl.unit ?? ''} disabled={!editable} onChange={(e) => patchField(i, fi, { unit: e.target.value })} placeholder={t('bmrTpl.unitPlaceholder')} /></td>
                                <td className="px-2 py-1 text-center"><input type="checkbox" checked={!!fl.required} disabled={!editable} onChange={(e) => patchField(i, fi, { required: e.target.checked })} className="h-4 w-4" /></td>
                                {editable && <td className="px-2 py-1"><button type="button" onClick={() => removeField(i, fi)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={13} /></button></td>}
                              </tr>
                            ))}
                            {sec.fields.length === 0 && <tr><td colSpan={5} className="px-2 py-2 text-[12px] text-slate-400">{t('bmrTpl.noFields')}</td></tr>}
                          </tbody>
                        </table>
                        {editable && <button type="button" onClick={() => addField(i)} className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50"><Plus size={12} />{t('bmrTpl.addField')}</button>}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {editable && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Layers size={13} />{t('bmrTpl.addSection')}</span>
                  {SECTION_TYPE_VALUES.map((s) => (
                    <button key={s} type="button" onClick={() => addSection(s)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11.5px] font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700">+ {sectionLabel(s, t)}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
