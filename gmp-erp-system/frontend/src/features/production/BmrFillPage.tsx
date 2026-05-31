import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronRight, ClipboardCheck, Clock,
  DoorOpen, Droplet, Eye, FileDown, Gauge, Layers, Loader2, Lock, Pen, Save, ShieldCheck,
  Thermometer, Wifi, X,
} from 'lucide-react'
import {
  getBmrInstance, listProductionBatches, getBatchBmrInstance, saveBmrEntries, signBmrField,
  completeBmrInstance, reviewBmrInstance, downloadBmrInstancePdf,
} from '../../lib/api'
import type { CurrentUser } from '../../types/auth'
import type { BmrInstanceItem, BmrEntryItem, BmrSectionItem } from '../../types/inventory'

interface Props { token: string; user: CurrentUser | null }

/* ---- status system (from design direction) ---- */
const STAGE_STATUS: Record<string, { label: string; dot: string; chip: string }> = {
  issued:      { label: 'Выдан', dot: 'bg-slate-300', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  in_progress: { label: 'В работе', dot: 'bg-cyan-500', chip: 'bg-cyan-50 text-cyan-700 ring-cyan-200' },
  completed:   { label: 'Заполнен ДП', dot: 'bg-indigo-500', chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  reviewed:    { label: 'Проверен ДОК', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
}
function StatusChip({ status }: { status: string }) {
  const v = STAGE_STATUS[status] || STAGE_STATUS.issued
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${v.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />{v.label}
    </span>
  )
}

function roomFromWorkstation(ws?: string): string | null {
  if (!ws) return null
  const m = ws.match(/(\d{2,3})$/)
  return m ? `Комн. ${m[1]}` : null
}

type EntryMap = Record<string, BmrEntryItem>
const key = (sid: string, fi: number) => `${sid}:${fi}`

function sectionKind(section: BmrSectionItem): string {
  return section.config?.kind || section.section_type
}

function fieldDone(entry: BmrEntryItem | undefined, draftValue: string | undefined): boolean {
  if (entry?.value?.signed_by) return true
  if (entry?.value && 'v' in entry.value && entry.value.v !== null && entry.value.v !== '') return true
  return draftValue !== undefined && draftValue !== ''
}

function sectionProgress(section: BmrSectionItem, entries: EntryMap, draft: Record<string, string>): { done: number; total: number } {
  const sid = String(section.id)
  const fields = section.config?.fields || []
  const total = fields.length
  if (!total) return { done: 0, total: 0 }
  let done = 0
  for (let i = 0; i < fields.length; i += 1) {
    if (fieldDone(entries[key(sid, i)], draft[key(sid, i)])) done += 1
  }
  return { done, total }
}

function sectionIcon(kind: string) {
  if (kind === 'environment') return <Thermometer size={15} />
  if (kind === 'equipment') return <Gauge size={15} />
  if (kind === 'checklist') return <ClipboardCheck size={15} />
  return <Layers size={15} />
}

function sectionSpanClass(section: BmrSectionItem): string {
  const kind = sectionKind(section)
  return kind === 'process_header' || kind === 'equipment' ? '' : '2xl:col-span-2'
}

/* ============================ PAGE ============================ */
export function BmrFillPage({ token, user }: Props) {
  const [list, setList] = useState<{ batchId: string; instanceId: string; batchNo: string | null; title: string; status: string; room: string | null }[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    setLoadingList(true); setError(null)
    try {
      const res = await listProductionBatches(token)
      const candidates = res.batches.filter((b) => b.status !== 'draft' && b.status !== 'assigned' && b.status !== 'cancelled')
      const out: typeof list = []
      for (const b of candidates) {
        try {
          const r = await getBatchBmrInstance(token, b.id)
          if (r.instance) {
            const room = r.instance.sections.map((s) => s.config?.room).find(Boolean) || null
            out.push({ batchId: b.id, instanceId: r.instance.id, batchNo: r.instance.batch_no, title: r.instance.title, status: r.instance.status, room })
          }
        } catch { /* skip */ }
      }
      setList(out)
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoadingList(false) }
  }, [token])

  useEffect(() => { void loadList() }, [loadList])

  const myRoom = roomFromWorkstation(user?.workstation_id)
  const isSupervisor = (user?.permissions || []).some((p) => p === 'MANAGE_PRODUCTION' || p === 'QA_DECISION')
  useEffect(() => {
    if (!isSupervisor && !openId && list.length === 1) {
      setOpenId(list[0].instanceId)
    }
  }, [isSupervisor, list, openId])

  if (openId) return <FillView token={token} user={user} instanceId={openId} onBack={() => { setOpenId(null); void loadList() }} />

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><ClipboardCheck size={20} /></span>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Заполнение BMR / ЗПС</h1>
          <p className="text-[13px] text-slate-500">Рабочее место цеха · электронный журнал записи производства серии (СОП-11){myRoom ? ` · ${myRoom}` : ''}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${isSupervisor ? 'bg-slate-100 text-slate-700 ring-slate-200' : 'bg-blue-50 text-blue-700 ring-blue-200'}`}>
          {isSupervisor ? 'Надзор: все стадии' : 'Оператор: только своя комната'}
        </span>
        <button onClick={() => void loadList()} className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-600 hover:bg-slate-50">Обновить</button>
      </div>
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div>}
      {loadingList ? (
        <div className="flex items-center gap-2 py-16 text-slate-400"><Loader2 size={18} className="animate-spin" /> загрузка нарядов…</div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">Нет выданных BMR. ЗПС появится здесь после выдачи серии (ДОК).</div>
      ) : (
        <div className="space-y-2">
          {list.map((it) => (
            <button key={it.instanceId} onClick={() => setOpenId(it.instanceId)}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/40">
              <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-slate-900 text-white"><Layers size={18} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-slate-900">{it.title}</span>
                  <span className="mono rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">Серия {it.batchNo}</span>
                </div>
                <div className="mono text-[11px] text-slate-400">{it.room || '—'} · BMR / ЗПС</div>
              </div>
              <StatusChip status={it.status} />
              <ChevronRight size={16} className="text-slate-300" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ============================ FILL VIEW (Каркас C) ============================ */
function FillView({ token, user, instanceId, onBack }: { token: string; user: CurrentUser | null; instanceId: string; onBack: () => void }) {
  const [inst, setInst] = useState<BmrInstanceItem | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dock, setDock] = useState<{ sectionId: string; fieldIndex: number; role: 'dp' | 'dok'; label: string } | null>(null)
  const [action, setAction] = useState<null | 'complete' | 'review'>(null)
  const [pwd, setPwd] = useState('')

  const perms = user?.permissions || []
  const isSupervisor = perms.includes('MANAGE_PRODUCTION') || perms.includes('QA_DECISION')
  const canDp = perms.includes('EXECUTE_BMR') || perms.includes('MANAGE_PRODUCTION')
  const canComplete = perms.includes('MANAGE_PRODUCTION')
  const canDok = perms.includes('QA_DECISION')

  const load = useCallback(async () => {
    try {
      const data = await getBmrInstance(token, instanceId)
      setInst(data)
      const d: Record<string, string> = {}
      for (const e of data.entries) {
        if (e.value && 'v' in e.value && e.value.v != null) d[key(e.section_id, e.field_index)] = String(e.value.v)
      }
      setDraft(d)
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
  }, [token, instanceId])
  useEffect(() => { void load() }, [load])

  const entries: EntryMap = useMemo(() => {
    const m: EntryMap = {}
    for (const e of inst?.entries || []) m[key(e.section_id, e.field_index)] = e
    return m
  }, [inst])

  const closed = inst?.status === 'completed' || inst?.status === 'reviewed'
  const setVal = (sid: string, fi: number, v: string) => setDraft((p) => ({ ...p, [key(sid, fi)]: v }))

  async function saveAll() {
    if (!inst) return
    setBusy(true); setError(null)
    try {
      const payload: { section_id: string; field_index: number; value: unknown }[] = []
      for (const [k, v] of Object.entries(draft)) {
        const [sid, fi] = k.split(':')
        payload.push({ section_id: sid, field_index: Number(fi), value: v })
      }
      const updated = await saveBmrEntries(token, inst.id, payload)
      setInst(updated); setSavedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить') }
    finally { setBusy(false) }
  }

  async function confirmSign() {
    if (!inst || !dock || !user) return
    setBusy(true); setError(null)
    try {
      const updated = await signBmrField(token, inst.id, {
        section_id: dock.sectionId, field_index: dock.fieldIndex,
        username: user.username, password: pwd,
        meaning: dock.role === 'dok' ? 'Проверено ДОК' : 'Выполнено ДП', reason: dock.label,
      })
      setInst(updated); setDock(null); setPwd('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Подпись не принята') }
    finally { setBusy(false) }
  }

  async function confirmAction() {
    if (!inst || !action || !user) return
    setBusy(true); setError(null)
    try {
      const body = { username: user.username, password: pwd, meaning: action === 'review' ? 'Проверка BMR ДОК' : 'Завершение заполнения BMR', reason: action }
      const updated = action === 'review' ? await reviewBmrInstance(token, inst.id, body) : await completeBmrInstance(token, inst.id, body)
      setInst(updated); setAction(null); setPwd('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Действие не выполнено') }
    finally { setBusy(false) }
  }

  async function openPdf() {
    if (!inst) return
    try {
      const blob = await downloadBmrInstancePdf(token, inst.id)
      const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) { setError(e instanceof Error ? e.message : 'PDF не сформирован') }
  }

  if (!inst) return <div className="flex items-center gap-2 p-10 text-slate-400"><Loader2 size={18} className="animate-spin" /> загрузка BMR…</div>

  const myRoom = roomFromWorkstation(user?.workstation_id)
  const visibleSections = inst.sections
  const progressTotal = visibleSections.reduce((acc, s) => {
    const p = sectionProgress(s, entries, draft)
    return { done: acc.done + p.done, total: acc.total + p.total }
  }, { done: 0, total: 0 })

  return (
    <div className="min-h-screen bg-[#eef1f5] pb-28">
      {/* OS strip */}
      <div className="flex items-center justify-between bg-slate-900 px-4 py-1 text-[11px] text-slate-300">
        <span className="inline-flex items-center gap-1.5 rounded bg-white/10 px-1.5 py-0.5 font-semibold text-white"><DoorOpen size={12} /> {myRoom || 'Рабочее место'}</span>
        <span className="inline-flex items-center gap-1.5 text-emerald-300"><Wifi size={13} /> онлайн</span>
      </div>
      {/* batch bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <button onClick={onBack} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"><ArrowRight size={14} className="rotate-180" /> Наряды</button>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-[10px] font-bold text-white">B21</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-slate-900">{inst.title}</span>
            <span className="mono rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">Серия {inst.batch_no}</span>
          </div>
          <div className="mono text-[10.5px] text-slate-400">BMR · v{inst.template_version} · СОП-11</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusChip status={inst.status} />
          {savedAt && <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10.5px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Сохранено {savedAt}</span>}
        </div>
      </div>

      {!isSupervisor && (
        <div className="flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2 text-[12px] text-blue-700">
          <Eye size={14} /> Показаны только секции рабочего места {myRoom || user?.workstation_id || 'не определено'}; остальные стадии скрыты GMP-scope доступом.
        </div>
      )}

      <div className="mx-auto grid max-w-[1680px] grid-cols-1 gap-3 p-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <StageRail
          sections={visibleSections}
          entries={entries}
          draft={draft}
          myRoom={myRoom}
          isSupervisor={isSupervisor}
          progress={progressTotal}
          status={inst.status}
        />
        <main className="grid min-w-0 auto-rows-min grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700 2xl:col-span-2">{error}</div>}
          {visibleSections.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-[13px] text-amber-800 2xl:col-span-2">
              Для рабочего места {myRoom || user?.workstation_id || 'не определено'} в этой серии нет назначенной стадии.
            </div>
          ) : visibleSections.map((s) => (
            <div key={s.id} className={sectionSpanClass(s)}>
              <SectionBlock section={s} entries={entries} draft={draft} closed={!!closed}
                canDp={canDp} canDok={canDok} onSetVal={setVal}
                onSign={(fi, role, label) => setDock({ sectionId: String(s.id), fieldIndex: fi, role, label })} />
            </div>
          ))}
        </main>
      </div>

      {/* footer action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] items-center gap-2">
          {!closed && <button disabled={busy} onClick={() => void saveAll()} className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Save size={16} /> Сохранить</button>}
          {!closed && canComplete && (inst.status === 'in_progress' || inst.status === 'issued') && <button disabled={busy} onClick={() => { setAction('complete'); setPwd('') }} className="inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Check size={16} /> Завершить (ДП)</button>}
          {inst.status === 'completed' && canDok && <button disabled={busy} onClick={() => { setAction('review'); setPwd('') }} className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><ShieldCheck size={16} /> Проверить (ДОК)</button>}
          <button onClick={() => void openPdf()} className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-50"><FileDown size={16} /> PDF</button>
          <span className="ml-auto text-[11px] text-slate-400">{closed ? 'BMR закрыт — только просмотр' : 'черновик автосохраняется по «Сохранить»'}</span>
        </div>
      </div>

      {/* sign dock (slide-up, password e-signature) */}
      {dock && (
        <SignDock role={dock.role} label={dock.label} pwd={pwd} setPwd={setPwd} busy={busy}
          who={user?.full_name || user?.username || ''} onCancel={() => { setDock(null); setPwd('') }} onConfirm={() => void confirmSign()} />
      )}
      {action && (
        <SignDock role={action === 'review' ? 'dok' : 'dp'} label={action === 'review' ? 'Проверка и закрытие BMR (ДОК)' : 'Завершение заполнения BMR (ДП)'}
          pwd={pwd} setPwd={setPwd} busy={busy} who={user?.full_name || user?.username || ''}
          onCancel={() => { setAction(null); setPwd('') }} onConfirm={() => void confirmAction()} />
      )}
    </div>
  )
}

function StageRail({
  sections,
  entries,
  draft,
  myRoom,
  isSupervisor,
  progress,
  status,
}: {
  sections: BmrSectionItem[]
  entries: EntryMap
  draft: Record<string, string>
  myRoom: string | null
  isSupervisor: boolean
  progress: { done: number; total: number }
  status: string
}) {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <aside className="self-start rounded-lg border border-slate-200 bg-white shadow-sm xl:sticky xl:top-3">
      <div className="border-b border-slate-200 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Маршрут серии</div>
            <div className="mt-1 text-[14px] font-semibold text-slate-900">{isSupervisor ? 'Обзор всех стадий' : myRoom || 'Комната не определена'}</div>
          </div>
          <StatusChip status={status} />
        </div>
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
            <span>Заполнено</span>
            <span className="mono">{progress.done}/{progress.total || 0}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>
      <nav className="max-h-[calc(100vh-190px)] space-y-1 overflow-y-auto p-2">
        {sections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[12px] text-slate-400">Нет доступных стадий</div>
        ) : sections.map((section) => {
          const p = sectionProgress(section, entries, draft)
          const done = p.total > 0 && p.done >= p.total
          const active = p.done > 0 && !done
          const kind = sectionKind(section)
          return (
            <a
              key={section.id}
              href={`#bmr-section-${section.id}`}
              className={`flex gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${done ? 'border-emerald-200 bg-emerald-50/70' : active ? 'border-blue-200 bg-blue-50/70' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`}
            >
              <span className={`mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-md text-white ${done ? 'bg-emerald-600' : active ? 'bg-blue-600' : 'bg-slate-300'}`}>
                {done ? <Check size={15} /> : sectionIcon(kind)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-slate-900">{section.ordinal}. {section.title}</span>
                <span className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span className="truncate">{section.config?.room || 'Общая секция'}</span>
                  <span className="mono flex-none">{p.done}/{p.total || 0}</span>
                </span>
              </span>
            </a>
          )
        })}
      </nav>
    </aside>
  )
}

/* ---- Sign dock ---- */
function SignDock({ role, label, pwd, setPwd, busy, who, onCancel, onConfirm }: { role: 'dp' | 'dok'; label: string; pwd: string; setPwd: (v: string) => void; busy: boolean; who: string; onCancel: () => void; onConfirm: () => void }) {
  const dok = role === 'dok'
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border bg-white shadow-2xl ring-1" style={{ borderColor: dok ? '#0f172a' : '#2563eb' }}>
        <div className={`flex items-center gap-2 px-4 py-2 text-white ${dok ? 'bg-slate-900' : 'bg-blue-600'}`}>
          <Pen size={15} /><span className="text-[12.5px] font-semibold">Подпись {dok ? 'ДОК «Проверил»' : 'ДП «Выполнил»'} · {label}</span>
          <span className="ml-auto mono text-[11px] opacity-80">{who}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-[200px] text-[12px] text-slate-600">Подтверждаю {dok ? 'проверку' : 'выполнение'} лично и достоверность записи (ALCOA+).</div>
          <input type="password" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Пароль / PIN"
            onKeyDown={(e) => { if (e.key === 'Enter' && pwd) onConfirm() }}
            className="h-11 w-44 rounded-lg border border-slate-300 px-3 text-[14px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          <button disabled={busy || !pwd} onClick={onConfirm} className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold text-white disabled:opacity-50 ${dok ? 'bg-slate-900' : 'bg-blue-600'}`}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Подтвердить</button>
          <button onClick={onCancel} className="inline-flex h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-600"><X size={15} /></button>
        </div>
      </div>
    </div>
  )
}

/* ---- Signature cell ---- */
function SignCell({ role, state, who, at, onSign }: { role: 'dp' | 'dok'; state: 'locked' | 'ready' | 'signed'; who?: string; at?: string; onSign?: () => void }) {
  const dok = role === 'dok'
  if (state === 'signed') return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 ${dok ? 'border-emerald-200 bg-emerald-50' : 'border-indigo-200 bg-indigo-50'}`}>
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-white ${dok ? 'bg-emerald-600' : 'bg-indigo-600'}`}><Check size={12} /></span>
      <div className="leading-tight"><div className={`text-[12px] font-semibold ${dok ? 'text-emerald-900' : 'text-indigo-900'}`}>{who}</div><div className={`mono text-[10px] ${dok ? 'text-emerald-700/80' : 'text-indigo-700/80'}`}>{dok ? 'ДОК' : 'ДП'} · {at}</div></div>
    </div>
  )
  if (state === 'locked') return <div className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 text-[11px] font-medium text-slate-400"><Lock size={13} /> после ДП</div>
  return <button onClick={onSign} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-white shadow-sm active:scale-[0.98] ${dok ? 'bg-slate-900 hover:bg-slate-800' : 'bg-blue-600 hover:bg-blue-700'}`}><Pen size={13} /> Подписать · {dok ? 'ДОК' : 'ДП'}</button>
}

function fmtTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function sigState(e: BmrEntryItem | undefined, dpSigned: boolean, role: 'dp' | 'dok'): 'locked' | 'ready' | 'signed' {
  if (e?.value && e.value.signed_by) return 'signed'
  if (role === 'dok' && !dpSigned) return 'locked'
  return 'ready'
}

/* ============================ SECTION BLOCKS ============================ */
function SectionBlock({ section, entries, draft, closed, canDp, canDok, onSetVal, onSign }: {
  section: BmrSectionItem; entries: EntryMap; draft: Record<string, string>; closed: boolean
  canDp: boolean; canDok: boolean; onSetVal: (sid: string, fi: number, v: string) => void
  onSign: (fi: number, role: 'dp' | 'dok', label: string) => void
}) {
  const sid = String(section.id)
  const kind = sectionKind(section)
  const Head = (
    <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-white">{sectionIcon(kind)}</span>
      <h3 className="text-[14px] font-semibold text-slate-900">{section.ordinal}. {section.title}</h3>
      {section.config?.room && <span className="mono ml-auto text-[11px] text-slate-400">{section.config.room}{section.config.sop ? ` · ${section.config.sop}` : ''}</span>}
    </div>
  )
  const wrap = (body: React.ReactNode) => <section id={`bmr-section-${section.id}`} className="scroll-mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">{Head}{body}</section>

  const inputFor = (fi: number, type: string, unit?: string) => {
    const v = draft[key(sid, fi)] ?? ''
    const itype = type === 'number' ? 'number' : type === 'datetime' ? 'datetime-local' : type === 'date' ? 'date' : 'text'
    return (
      <div className="inline-flex items-center gap-1.5">
        <input disabled={closed} type={itype} value={v} onChange={(e) => onSetVal(sid, fi, e.target.value)}
          className="h-10 w-full min-w-[7rem] rounded-md border border-slate-300 bg-white px-2.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500" />
        {unit && <span className="text-[10px] text-slate-400">{unit}</span>}
      </div>
    )
  }

  /* ---- process_header ---- */
  if (kind === 'process_header') {
    const fields = section.config?.fields || []
    return wrap(
      <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2">
        <Meta label="Процесс" value={section.config?.process || section.title} />
        <Meta label="Комната / №" value={`${section.config?.room || '—'}${section.config?.room_no ? ` / ${section.config.room_no}` : ''}`} />
        {fields.map((f, fi) => (
          <div key={fi}><div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{f.label}</div>{inputFor(fi, f.type)}</div>
        ))}
      </div>
    )
  }

  /* ---- checklist ---- */
  if (kind === 'checklist') {
    const steps = section.config?.steps || []
    return wrap(
      <table className="w-full">
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
          <th className="w-10 px-3 py-2 text-center">№</th><th className="px-3 py-2">Технологический этап</th>
          <th className="w-[170px] px-3 py-2">Выполнено · ДП</th><th className="w-[170px] px-3 py-2">Проверено · ДОК</th>
        </tr></thead>
        <tbody>
          {steps.map((st, i) => {
            const dpE = entries[key(sid, 2 * i)]; const dokE = entries[key(sid, 2 * i + 1)]
            const dpSigned = !!(dpE?.value && dpE.value.signed_by)
            return (
              <tr key={i} className="border-b border-slate-100 align-middle">
                <td className="px-3 py-2 text-center mono text-[12px] font-semibold text-slate-400">{st.no || i + 1}</td>
                <td className="px-3 py-2 text-[13px] text-slate-800">{st.text}</td>
                <td className="px-3 py-2"><SignCell role="dp" state={sigState(dpE, dpSigned, 'dp')} who={dpE?.value?.signed_by} at={fmtTime(dpE?.value?.signed_at)} onSign={canDp && !closed ? () => onSign(2 * i, 'dp', `этап ${st.no || i + 1}`) : undefined} /></td>
                <td className="px-3 py-2"><SignCell role="dok" state={sigState(dokE, dpSigned, 'dok')} who={dokE?.value?.signed_by} at={fmtTime(dokE?.value?.signed_at)} onSign={canDok && !closed && dpSigned ? () => onSign(2 * i + 1, 'dok', `этап ${st.no || i + 1}`) : undefined} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  /* ---- environment ---- */
  if (kind === 'environment') {
    const params = section.config?.params || []
    const icon = (i: number) => i === 0 ? <Thermometer size={14} className="text-slate-400" /> : i === 1 ? <Droplet size={14} className="text-slate-400" /> : <Gauge size={14} className="text-slate-400" />
    return wrap(
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
              <th rowSpan={2} className="w-[220px] border-r border-slate-200 px-3 py-2 text-left align-bottom">Параметр</th>
              <th colSpan={3} className="border-b border-r border-slate-200 px-3 py-1.5 text-center text-blue-700">Начало стадии</th>
              <th colSpan={3} className="border-b border-slate-200 px-3 py-1.5 text-center text-slate-600">Окончание стадии</th>
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-medium uppercase tracking-wide text-slate-400">
              <th className="px-3 py-1.5 text-left">Наблюдение</th><th className="px-3 py-1.5">ДП</th><th className="border-r border-slate-200 px-3 py-1.5">ДОК</th>
              <th className="px-3 py-1.5 text-left">Наблюдение</th><th className="px-3 py-1.5">ДП</th><th className="px-3 py-1.5">ДОК</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p, i) => {
              const b = 6 * i
              const startDpE = entries[key(sid, b + 1)]; const endDpE = entries[key(sid, b + 4)]
              const startDpSigned = !!(startDpE?.value && startDpE.value.signed_by)
              const endDpSigned = !!(endDpE?.value && endDpE.value.signed_by)
              const dokCell = (fi: number, dpSigned: boolean) => { const e = entries[key(sid, fi)]; return <SignCell role="dok" state={sigState(e, dpSigned, 'dok')} who={e?.value?.signed_by} at={fmtTime(e?.value?.signed_at)} onSign={canDok && !closed && dpSigned ? () => onSign(fi, 'dok', p.name) : undefined} /> }
              const dpCell = (fi: number) => { const e = entries[key(sid, fi)]; return <SignCell role="dp" state={sigState(e, false, 'dp')} who={e?.value?.signed_by} at={fmtTime(e?.value?.signed_at)} onSign={canDp && !closed ? () => onSign(fi, 'dp', p.name) : undefined} /> }
              return (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-3 py-2.5"><div className="flex items-center gap-2 text-[13px] font-medium text-slate-800">{icon(i)}{p.name}</div>{p.limit && <div className="mono mt-0.5 text-[10.5px] text-slate-400">предел: {p.limit}</div>}</td>
                  <td className="px-3 py-2.5">{inputFor(b + 0, 'number', p.unit)}</td>
                  <td className="px-3 py-2.5">{dpCell(b + 1)}</td>
                  <td className="border-r border-slate-200 px-3 py-2.5">{dokCell(b + 2, startDpSigned)}</td>
                  <td className="px-3 py-2.5">{inputFor(b + 3, 'number', p.unit)}</td>
                  <td className="px-3 py-2.5">{dpCell(b + 4)}</td>
                  <td className="px-3 py-2.5">{dokCell(b + 5, endDpSigned)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  /* ---- equipment (read-only) ---- */
  if (kind === 'equipment') {
    const rows = section.config?.rows || []
    return wrap(
      <table className="w-full">
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
          <th className="px-3 py-2">Название</th><th className="px-3 py-2">Модель</th><th className="px-3 py-2">№ серии</th><th className="px-3 py-2">СОП</th><th className="px-3 py-2">Поверка</th>
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-100 text-[12.5px] text-slate-700">
            <td className="px-3 py-2">{r.name}</td><td className="mono px-3 py-2 text-slate-500">{r.model || '—'}</td>
            <td className="mono px-3 py-2 text-slate-500">{r.serial || '—'}</td><td className="mono px-3 py-2 text-slate-500">{r.sop || '—'}</td>
            <td className="px-3 py-2 text-slate-500">{r.calib || '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    )
  }

  /* ---- fallback ---- */
  return wrap(<div className="p-4 text-[13px] text-slate-400">Блок «{section.section_type}» — рендер в разработке.</div>)
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold text-slate-800">{value}</div>
    </div>
  )
}
