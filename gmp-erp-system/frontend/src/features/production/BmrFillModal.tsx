import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, FileText, PenLine, Save, ShieldCheck, X } from 'lucide-react'
import {
  completeBmrInstance,
  getBmrInstance,
  reviewBmrInstance,
  saveBmrEntries,
  signBmrField,
} from '../../lib/api'
import type { BmrInstanceItem } from '../../types/inventory'

interface Props {
  token: string
  user: { username: string; permissions: string[]; role?: string }
  instanceId: string
  onClose: () => void
  onChanged?: () => void
}

const SECTION_LABEL: Record<string, string> = {
  product_header: 'Шапка / реквизиты', production_formula: 'Производственная формула',
  distribution_list: 'Лист распределения', stage: 'Технологическая стадия', environment: 'Условия среды',
  equipment: 'Оборудование', checklist: 'Контрольный список', process_steps: 'Шаги процесса',
  in_process_control: 'Межоперационный контроль', yield: 'Расчёт выхода', materials_used: 'Использованные материалы',
  attachments: 'Прикрепляемые документы', free_text: 'Текст',
}
const ST: Record<string, { label: string; cls: string }> = {
  issued: { label: 'Ожидает заполнения', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  in_progress: { label: 'Заполняется', cls: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  completed: { label: 'Заполнен', cls: 'border-blue-200 bg-blue-50 text-blue-700' },
  reviewed: { label: 'Проверен ДОК', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
}

function fkey(sid: string, fi: number) { return `${sid}:${fi}` }

export function BmrFillModal({ token, user, instanceId, onClose, onChanged }: Props) {
  const canFill = user.permissions.includes('EXECUTE_BMR') || user.permissions.includes('MANAGE_PRODUCTION') || user.role === 'SYS_ADMIN'
  const canQa = user.permissions.includes('QA_DECISION') || user.role === 'SYS_ADMIN'

  const [inst, setInst] = useState<BmrInstanceItem | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signing, setSigning] = useState<{ sid: string; fi: number } | null>(null)
  const [pwd, setPwd] = useState('')
  const [action, setAction] = useState<'complete' | 'review' | null>(null)

  const load = useCallback(async (data?: BmrInstanceItem) => {
    const i = data ?? await getBmrInstance(token, instanceId)
    setInst(i)
    const map: Record<string, string> = {}
    for (const e of i.entries) {
      if (e.value && 'v' in e.value && e.value.v != null && typeof e.value.v !== 'object') map[fkey(e.section_id, e.field_index)] = String(e.value.v)
    }
    setValues(map)
  }, [token, instanceId])

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'load failed')) }, [load])

  const readOnly = !inst || inst.status === 'completed' || inst.status === 'reviewed' || !canFill

  function signedEntry(sid: string, fi: number) {
    const e = inst?.entries.find((x) => x.section_id === sid && x.field_index === fi)
    return e?.value && 'signed_by' in e.value ? e.value : null
  }

  async function saveAll() {
    if (!inst) return
    setBusy(true); setError(null)
    try {
      const entries: { section_id: string; field_index: number; value: unknown }[] = []
      for (const s of inst.sections) {
        const fields = s.config?.fields ?? []
        fields.forEach((f, fi) => {
          if (f.type === 'signature_operator' || f.type === 'signature_qa') return
          const k = fkey(s.id!, fi)
          if (k in values) entries.push({ section_id: s.id!, field_index: fi, value: f.type === 'number' ? Number(values[k]) : values[k] })
        })
      }
      await load(await saveBmrEntries(token, inst.id, entries))
      onChanged?.()
    } catch (e) { setError(e instanceof Error ? e.message : 'save failed') } finally { setBusy(false) }
  }

  async function doSign() {
    if (!inst || !signing) return
    setBusy(true); setError(null)
    try {
      const updated = await signBmrField(token, inst.id, { section_id: signing.sid, field_index: signing.fi, username: user.username, password: pwd, meaning: 'Подпись в электронном BMR (СОП-11)', reason: 'Заполнение/проверка шага BMR' })
      await load(updated); setSigning(null); setPwd(''); onChanged?.()
    } catch (e) { setError(e instanceof Error ? e.message : 'sign failed') } finally { setBusy(false) }
  }

  async function doAction() {
    if (!inst || !action) return
    setBusy(true); setError(null)
    try {
      const payload = { username: user.username, password: pwd, meaning: action === 'complete' ? 'Завершение заполнения BMR' : 'Рассмотрение BMR ДОК', reason: action === 'complete' ? 'BMR заполнен' : 'BMR рассмотрен' }
      const updated = action === 'complete' ? await completeBmrInstance(token, inst.id, payload) : await reviewBmrInstance(token, inst.id, payload)
      await load(updated); setAction(null); setPwd(''); onChanged?.()
    } catch (e) { setError(e instanceof Error ? e.message : 'failed') } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-white"><FileText size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Электронный BMR · СОП-11</p>
          <h2 className="truncate text-[16px] font-semibold text-slate-950">{inst?.batch_no} · {inst?.title}</h2>
        </div>
        {inst && <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${ST[inst.status]?.cls ?? ''}`}>{ST[inst.status]?.label ?? inst.status}</span>}
        <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><X size={20} /></button>
      </div>

      {error && <div className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-sm text-rose-800">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {inst?.sections.map((s) => {
            const fields = s.config?.fields ?? []
            return (
              <div key={s.id} className="rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-slate-200 font-mono text-[11px] font-semibold text-slate-700">{s.ordinal}</span>
                  <span className="text-[14px] font-semibold text-slate-900">{s.title}</span>
                  <span className="ml-auto text-[11px] text-slate-400">{SECTION_LABEL[s.section_type] ?? s.section_type}</span>
                </div>
                <div className="space-y-3 p-4">
                  {fields.length === 0 && <p className="text-sm text-slate-400">Полей нет.</p>}
                  {fields.map((f, fi) => {
                    const sig = f.type === 'signature_operator' || f.type === 'signature_qa'
                    const signed = sig ? signedEntry(s.id!, fi) : null
                    const k = fkey(s.id!, fi)
                    return (
                      <div key={fi} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[260px_1fr] sm:items-center">
                        <label className="text-[13px] font-medium text-slate-700">{f.label}{f.required ? ' *' : ''}{f.unit ? `, ${f.unit}` : ''}</label>
                        {sig ? (
                          signed ? (
                            <div className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 size={16} />{signed.signed_by} · {signed.signed_at ? new Date(signed.signed_at).toLocaleString('ru-RU') : ''}</div>
                          ) : (
                            <button type="button" disabled={readOnly && f.type === 'signature_operator' ? false : (f.type === 'signature_qa' ? !canQa : !canFill)} onClick={() => { setSigning({ sid: s.id!, fi }); setPwd('') }}
                              className={`inline-flex h-11 w-fit items-center gap-2 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-40 ${f.type === 'signature_qa' ? 'bg-slate-900 hover:bg-slate-800' : 'bg-blue-600 hover:bg-blue-700'}`}>
                              <PenLine size={16} />Подписать {f.type === 'signature_qa' ? '(ДОК)' : '(ДП)'}
                            </button>
                          )
                        ) : f.type === 'checkbox' ? (
                          <input type="checkbox" disabled={readOnly} checked={values[k] === 'true'} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.checked ? 'true' : 'false' }))} className="h-6 w-6 rounded border-slate-300" />
                        ) : (
                          <input type={f.type === 'number' || f.type === 'calc' ? 'number' : f.type === 'datetime' ? 'date' : 'text'} disabled={readOnly}
                            value={values[k] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                            className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-[15px] outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60 disabled:bg-slate-50" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-5 py-3">
        {!readOnly && <button type="button" disabled={busy} onClick={() => void saveAll()} className="inline-flex h-11 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"><Save size={16} />Сохранить</button>}
        {inst && inst.status !== 'completed' && inst.status !== 'reviewed' && canFill && <button type="button" disabled={busy} onClick={() => { setAction('complete'); setPwd('') }} className="inline-flex h-11 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><CheckCircle2 size={16} />Завершить заполнение</button>}
        {inst && inst.status === 'completed' && canQa && <button type="button" disabled={busy} onClick={() => { setAction('review'); setPwd('') }} className="inline-flex h-11 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><ShieldCheck size={16} />Проверить (ДОК)</button>}
        <button type="button" onClick={onClose} className="ml-auto inline-flex h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Закрыть</button>
      </div>

      {(signing || action) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-[15px] font-semibold text-slate-900">{action === 'complete' ? 'Завершить заполнение BMR' : action === 'review' ? 'Рассмотрение BMR (ДОК)' : 'Электронная подпись'}</h3>
            <p className="mt-1 text-[12.5px] text-slate-600">Введите пароль электронной подписи.</p>
            <input type="password" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" className="mt-3 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setSigning(null); setAction(null); setPwd('') }} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Отмена</button>
              <button type="button" disabled={!pwd || busy} onClick={() => (action ? void doAction() : void doSign())} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><PenLine size={15} />Подтвердить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
