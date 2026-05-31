import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronRight, ClipboardCheck, Clock,
  DoorOpen, Droplet, Eye, FileDown, Gauge, Layers, Loader2, Lock, Map, Pen, Save, ShieldCheck,
  Thermometer, Users, Wifi, X,
} from 'lucide-react'
import { BmrAssignDialog } from './BmrAssignDialog'
import {
  getBmrInstance, listProductionBatches, getBatchBmrInstance, saveBmrEntries, signBmrField,
  completeBmrInstance, reviewBmrInstance, downloadBmrInstancePdf,
} from '../../lib/api'
import type { CurrentUser } from '../../types/auth'
import type { BmrInstanceItem, BmrEntryItem, BmrSectionItem, BmrParticipantItem, BmrRouteStageItem } from '../../types/inventory'

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
type SignRole = 'dp' | 'dok' | 'wh'
const key = (sid: string, fi: number) => `${sid}:${fi}`

const SIGN_MEANING: Record<SignRole, string> = { dp: 'Выполнено ДП', dok: 'Проверено ДОК', wh: 'Выдано (Склад)' }

function sectionKind(section: BmrSectionItem): string {
  return section.config?.kind || section.section_type
}

function stageCodeOf(section: BmrSectionItem): string {
  return section.config?.stage || section.config?.room || String(section.id)
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

function isProcessEndField(section: BmrSectionItem, field: { label?: string; type?: string }): boolean {
  const kind = sectionKind(section)
  const label = String(field.label || '').toLowerCase()
  return kind === 'process_header' && field.type === 'datetime' && label.includes('оконч')
}

function orderedFieldKeys(sections: BmrSectionItem[]): { sectionId: string; fieldIndex: number }[] {
  const normal: { sectionId: string; fieldIndex: number }[] = []
  const final: { sectionId: string; fieldIndex: number }[] = []
  sections.forEach((section) => {
    const fields = section.config?.fields || []
    fields.forEach((field, fieldIndex) => {
      const item = { sectionId: String(section.id), fieldIndex }
      if (isProcessEndField(section, field)) final.push(item)
      else normal.push(item)
    })
  })
  return [...normal, ...final]
}

function processEndFields(sections: BmrSectionItem[]): { section: BmrSectionItem; fieldIndex: number; field: { label?: string; type?: string } }[] {
  return sections.flatMap((section) => {
    const fields = section.config?.fields || []
    return fields
      .map((field, fieldIndex) => ({ section, fieldIndex, field }))
      .filter((item) => isProcessEndField(item.section, item.field))
  })
}

function fieldUnlocked(sections: BmrSectionItem[], entries: EntryMap, draft: Record<string, string>, sectionId: string, fieldIndex: number): boolean {
  const ordered = orderedFieldKeys(sections)
  const pos = ordered.findIndex((item) => item.sectionId === sectionId && item.fieldIndex === fieldIndex)
  if (pos <= 0) return pos === 0
  return ordered.slice(0, pos).every((item) => fieldDone(entries[key(item.sectionId, item.fieldIndex)], draft[key(item.sectionId, item.fieldIndex)]))
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
export function FillView({ token, user, instanceId, onBack, readOnly = false, backLabel = 'Наряды' }: { token: string; user: CurrentUser | null; instanceId: string; onBack: () => void; readOnly?: boolean; backLabel?: string }) {
  const [inst, setInst] = useState<BmrInstanceItem | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dock, setDock] = useState<{ sectionId: string; fieldIndex: number; role: SignRole; label: string } | null>(null)
  const [action, setAction] = useState<null | 'complete' | 'review'>(null)
  const [pwd, setPwd] = useState('')
  // Подписант вводит СВОИ креды на каждую подпись (общий планшет; не запоминаем сессию).
  const [signer, setSigner] = useState('')
  const [assignOpen, setAssignOpen] = useState(false)
  const [overview, setOverview] = useState(readOnly)

  const perms = user?.permissions || []
  const isSupervisor = perms.includes('MANAGE_PRODUCTION') || perms.includes('QA_DECISION')
  const canDp = perms.includes('EXECUTE_BMR') || perms.includes('MANAGE_PRODUCTION')
  const canComplete = perms.includes('MANAGE_PRODUCTION')
  const canDok = perms.includes('QA_DECISION')
  const canWh = perms.includes('POST_RECEIPT')

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

  const closed = readOnly || inst?.status === 'completed' || inst?.status === 'reviewed'
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
    if (!inst || !dock || !signer.trim() || !pwd) return
    setBusy(true); setError(null)
    try {
      const updated = await signBmrField(token, inst.id, {
        section_id: dock.sectionId, field_index: dock.fieldIndex,
        username: signer.trim(), password: pwd,
        meaning: SIGN_MEANING[dock.role], reason: dock.label,
      })
      setInst(updated); setDock(null); setPwd(''); setSigner('')
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
  const finalEndFields = processEndFields(visibleSections)
  const progressTotal = visibleSections.reduce((acc, s) => {
    const p = sectionProgress(s, entries, draft)
    return { done: acc.done + p.done, total: acc.total + p.total }
  }, { done: 0, total: 0 })

  const route = inst.route || []
  const currentStageCode = (() => {
    if (!isSupervisor && myRoom) {
      const mine = route.find((r) => r.room === myRoom)
      if (mine) return mine.stage
    }
    const active = route.find((r) => r.status === 'in_progress' || r.status === 'completed')
    if (active) return active.stage
    const next = route.find((r) => r.status === 'issued')
    return next ? next.stage : (route[route.length - 1]?.stage ?? null)
  })()
  const openStage = (code: string) => {
    setOverview(false)
    const sec = inst.sections.find((s) => stageCodeOf(s) === code)
    if (sec) window.setTimeout(() => document.getElementById(`bmr-section-${sec.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  return (
    <div className="min-h-screen bg-[#eef1f5] pb-28">
      {/* OS strip */}
      <div className="flex items-center justify-between bg-slate-900 px-4 py-1 text-[11px] text-slate-300">
        <span className="inline-flex items-center gap-1.5 rounded bg-white/10 px-1.5 py-0.5 font-semibold text-white"><DoorOpen size={12} /> {myRoom || 'Рабочее место'}</span>
        <span className="inline-flex items-center gap-1.5 text-emerald-300"><Wifi size={13} /> онлайн</span>
      </div>
      {/* batch bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <button onClick={onBack} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"><ArrowRight size={14} className="rotate-180" /> {backLabel}</button>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-[10px] font-bold text-white">B21</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-slate-900">{inst.title}</span>
            <span className="mono rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">Серия {inst.batch_no}</span>
          </div>
          <div className="mono text-[10.5px] text-slate-400">BMR · v{inst.template_version} · СОП-11</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isSupervisor && (
            <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
              <button onClick={() => setOverview(false)} className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${!overview ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Моя стадия</button>
              <button onClick={() => setOverview(true)} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold ${overview ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><Map size={13} /> Обзор серии</button>
            </div>
          )}
          {isSupervisor && !closed && (inst.stages?.length || 0) > 0 && (
            <button onClick={() => setAssignOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-2.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-100"><Users size={14} /> Операторы по этапам</button>
          )}
          <StatusChip status={inst.status} />
          {savedAt && <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10.5px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Сохранено {savedAt}</span>}
        </div>
      </div>
      {assignOpen && <BmrAssignDialog token={token} instance={inst} onClose={() => setAssignOpen(false)} onSaved={(u) => setInst(u)} />}

      {!isSupervisor && (
        <div className="flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2 text-[12px] text-blue-700">
          <Eye size={14} /> Показаны только секции рабочего места {myRoom || user?.workstation_id || 'не определено'}; остальные стадии скрыты GMP-scope доступом.
        </div>
      )}

      {!overview && route.length > 0 && <HandoffRibbon route={route} currentStage={currentStageCode} />}

      {overview ? (
        <SeriesOverview route={route} initialStage={currentStageCode} onOpenStage={openStage} />
      ) : (
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
          <main className="min-w-0 space-y-3">
            {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div>}
            <ParticipantsJournal participants={inst.participants || []} />
            {visibleSections.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-[13px] text-amber-800">
                Для рабочего места {myRoom || user?.workstation_id || 'не определено'} в этой серии нет назначенной стадии.
              </div>
            ) : visibleSections.map((s) => (
              <SectionBlock key={s.id} section={s} allSections={visibleSections} entries={entries} draft={draft} closed={!!closed}
                canDp={canDp} canDok={canDok} canWh={canWh} onSetVal={setVal}
                onSign={(fi, role, label) => { setSigner(''); setPwd(''); setDock({ sectionId: String(s.id), fieldIndex: fi, role, label }) }} />
            ))}
            {finalEndFields.length > 0 && (
              <ProcessClosureBlock fields={finalEndFields} allSections={visibleSections} entries={entries} draft={draft} closed={!!closed} onSetVal={setVal} />
            )}
          </main>
        </div>
      )}

      {/* footer action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] items-center gap-2">
          {!closed && <button disabled={busy} onClick={() => void saveAll()} className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Save size={16} /> Сохранить</button>}
          {!closed && canComplete && (inst.status === 'in_progress' || inst.status === 'issued') && <button disabled={busy} onClick={() => { setAction('complete'); setPwd('') }} className="inline-flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Check size={16} /> Завершить (ДП)</button>}
          {!readOnly && inst.status === 'completed' && canDok && <button disabled={busy} onClick={() => { setAction('review'); setPwd('') }} className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><ShieldCheck size={16} /> Проверить (ДОК)</button>}
          <button onClick={() => void openPdf()} className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-50"><FileDown size={16} /> PDF</button>
          <span className="ml-auto text-[11px] text-slate-400">{readOnly ? 'Только просмотр (надзор) — заполнение и подписи на планшетах операторов' : closed ? 'BMR закрыт — только просмотр' : 'черновик автосохраняется по «Сохранить»'}</span>
        </div>
      </div>

      {/* sign dock (slide-up): подписант вводит СВОИ логин+PIN на каждую подпись */}
      {dock && (
        <SignDock role={dock.role} label={dock.label} pwd={pwd} setPwd={setPwd} busy={busy}
          signerName={signer} setSignerName={setSigner}
          who={dock.role === 'dok' ? 'подписывает любой контролёр (ДОК)' : dock.role === 'wh' ? 'подписывает кладовщик (Склад)' : 'подписывает назначенный оператор (ДП)'}
          onCancel={() => { setDock(null); setPwd(''); setSigner('') }} onConfirm={() => void confirmSign()} />
      )}
      {action && (
        <SignDock role={action === 'review' ? 'dok' : 'dp'} label={action === 'review' ? 'Проверка и закрытие BMR (ДОК)' : 'Завершение заполнения BMR (ДП)'}
          pwd={pwd} setPwd={setPwd} busy={busy} who={user?.full_name || user?.username || ''}
          onCancel={() => { setAction(null); setPwd('') }} onConfirm={() => void confirmAction()} />
      )}
    </div>
  )
}

/* ---- HandoffRibbon (task #17): маршрут серии между комнатами ---- */
function HandoffRibbon({ route, currentStage }: { route: BmrRouteStageItem[]; currentStage: string | null }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
      <span className="mr-1 flex-none text-[10px] font-semibold uppercase tracking-wider text-slate-400">Маршрут серии</span>
      {route.map((r, i) => {
        const me = r.stage === currentStage
        return (
          <div key={r.stage} className="flex flex-none items-center gap-2">
            {i > 0 && <ArrowRight size={16} className="flex-none text-slate-300" />}
            <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${me ? 'border-blue-300 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white'}`}>
              <span className={`mono inline-flex h-8 w-8 flex-none items-center justify-center rounded-md text-[12px] font-bold ${me ? 'bg-blue-600 text-white' : r.status === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                {String(r.ordinal).padStart(2, '0')}
              </span>
              <div className="leading-tight">
                <div className={`max-w-[160px] truncate text-[12.5px] font-semibold ${me ? 'text-blue-900' : 'text-slate-700'}`}>{r.title}</div>
                <div className="mono text-[10px] text-slate-400">{r.room || '—'}{me ? ' · ВЫ' : ''}</div>
              </div>
              <StatusChip status={r.status} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ---- Series overview / Каркас B (task #17): все стадии, прогресс, read-only детали ---- */
function OverviewMini({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11.5px]">
        <span className="text-slate-600">{label}</span>
        <span className="mono text-slate-400">{done}/{total}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function OverviewCounter({ label, n, tone }: { label: string; n: number; tone: 'blue' | 'slate' | 'emerald' }) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 ring-blue-200',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  }
  return (
    <div className={`rounded-lg px-2.5 py-1.5 text-center ring-1 ring-inset ${tones[tone]}`}>
      <div className="mono text-[16px] font-bold leading-none">{n}</div>
      <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide opacity-70">{label}</div>
    </div>
  )
}

function SeriesOverview({ route, initialStage, onOpenStage }: { route: BmrRouteStageItem[]; initialStage: string | null; onOpenStage: (code: string) => void }) {
  const [selected, setSelected] = useState<string | null>(initialStage)
  const totalStages = route.length
  const reviewed = route.filter((r) => r.status === 'reviewed').length
  const inProgress = route.filter((r) => r.status === 'in_progress' || r.status === 'completed').length
  const pctReviewed = totalStages > 0 ? Math.round((reviewed / totalStages) * 100) : 0
  const pctActive = totalStages > 0 ? Math.round((inProgress / totalStages) * 100) : 0
  const dpLeft = route.reduce((a, r) => a + Math.max(0, r.dp_total - r.dp_done), 0)
  const dokLeft = route.reduce((a, r) => a + Math.max(0, r.dok_total - r.dok_done), 0)
  const sel = route.find((r) => r.stage === selected) || route[0]

  if (totalStages === 0) {
    return <div className="mx-auto max-w-[1680px] p-6 text-[13px] text-slate-400">У этой серии нет этапов для обзора.</div>
  }

  return (
    <div className="mx-auto max-w-[1680px]">
      {/* progress strip */}
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex-1 min-w-[240px]">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-600">Прогресс BMR · {reviewed} из {totalStages} стадий закрыто ДОК</span>
            <span className="mono text-slate-400">{pctReviewed}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
            <div className="flex h-full">
              <div className="bg-emerald-500" style={{ width: `${pctReviewed}%` }} />
              <div className="bg-blue-400" style={{ width: `${pctActive}%` }} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <OverviewCounter label="осталось ДП" n={dpLeft} tone="blue" />
          <OverviewCounter label="осталось ДОК" n={dokLeft} tone="slate" />
          <OverviewCounter label="закрыто" n={reviewed} tone="emerald" />
        </div>
      </div>
      {/* split: stage list + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto border-r border-slate-200 bg-white">
          {route.map((s) => {
            const active = s.stage === sel?.stage
            return (
              <button key={s.stage} onClick={() => setSelected(s.stage)}
                className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left ${active ? 'bg-blue-50/60' : 'bg-white hover:bg-slate-50'}`}>
                <span className={`mono inline-flex h-7 w-7 flex-none items-center justify-center rounded-md text-[12px] font-bold ${active ? 'bg-blue-600 text-white' : s.status === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{String(s.ordinal).padStart(2, '0')}</span>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[13px] font-semibold ${active ? 'text-blue-900' : 'text-slate-800'}`}>{s.title}</div>
                  <div className="mono text-[10.5px] text-slate-400">{s.room || '—'}{s.who ? ` · ${s.who}` : ''}</div>
                </div>
                <span className="mono flex-none text-[11px] text-slate-400">{s.done}/{s.total}</span>
                <StatusChip status={s.status} />
                <ChevronRight size={15} className="flex-none text-slate-300" />
              </button>
            )
          })}
        </div>
        {/* detail of selected stage (read-only) */}
        <div className="bg-slate-50/40 p-4">
          {sel && (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Выбранная стадия</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="mono inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-[13px] font-bold text-white">{String(sel.ordinal).padStart(2, '0')}</span>
                <div className="text-[14px] font-bold text-slate-900">{sel.title}</div>
              </div>
              <div className="mono mt-1 text-[11px] text-slate-400">{sel.room || '—'}{sel.who ? ` · ${sel.who}` : ''}</div>
              <div className="mt-3"><StatusChip status={sel.status} /></div>
              <div className="mt-4 space-y-2">
                <OverviewMini label="Заполнено полей" done={sel.done} total={sel.total} />
                <OverviewMini label="Подписи ДП" done={sel.dp_done} total={sel.dp_total} />
                <OverviewMini label="Подписи ДОК" done={sel.dok_done} total={sel.dok_total} />
              </div>
              <button type="button" onClick={() => onOpenStage(sel.stage)}
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white text-[13px] font-medium text-slate-600 hover:bg-slate-50"><Eye size={15} /> Открыть (только просмотр)</button>
              <p className="mt-2 text-[10.5px] leading-relaxed text-slate-400">Из обзора стадия открывается в режиме «Моя стадия». Редактировать можно только с планшета той комнаты, где идёт стадия.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---- Журнал участников серии (task #13): роли/назначенные операторы этапов ---- */
function dutyChipClass(duty: string): string {
  if (duty === 'ДОК') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (duty === 'ДП') return 'bg-blue-50 text-blue-700 ring-blue-200'
  return 'bg-slate-100 text-slate-600 ring-slate-200'
}

function ParticipantsJournal({ participants }: { participants: BmrParticipantItem[] }) {
  const [open, setOpen] = useState(false)
  const count = participants.length
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white"><Users size={15} /></span>
        <div>
          <div className="text-[14px] font-semibold text-slate-900">Журнал участников серии</div>
          <div className="text-[11px] text-slate-500">Роли и назначенные операторы этапов (СОП-11 · ALCOA+)</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-2">
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{count}</span>
          <ChevronRight size={16} className={`text-slate-400 transition ${open ? 'rotate-90' : ''}`} />
        </span>
      </button>
      {open && (
        count === 0 ? (
          <div className="px-3 py-6 text-center text-[12.5px] text-slate-400">
            Участники появятся после назначения операторов начальником цеха и первых e-подписей.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead>
                <tr className="border-b border-slate-200 bg-white text-left text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Ф.И.О.</th>
                  <th className="px-3 py-2">Должность</th>
                  <th className="px-3 py-2">Роль</th>
                  <th className="px-3 py-2">Этапы</th>
                  <th className="px-3 py-2">Участие</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p, i) => (
                  <tr key={i} className="border-b border-slate-100 align-top text-[12.5px] text-slate-700">
                    <td className="px-3 py-2 font-medium text-slate-900">{p.full_name || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{p.role || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {(p.duties.length ? p.duties : ['—']).map((d) => (
                          <span key={d} className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${dutyChipClass(d)}`}>{d}</span>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{p.stages.length ? p.stages.join(', ') : '—'}</td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {p.assigned && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10.5px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200">назначен</span>}
                        {p.signed && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">подписал</span>}
                        {!p.assigned && !p.signed && <span className="text-slate-400">—</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
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
function SignDock({ role, label, pwd, setPwd, busy, who, onCancel, onConfirm, signerName, setSignerName }: { role: SignRole; label: string; pwd: string; setPwd: (v: string) => void; busy: boolean; who: string; onCancel: () => void; onConfirm: () => void; signerName?: string; setSignerName?: (v: string) => void }) {
  const dok = role === 'dok'
  const wh = role === 'wh'
  const needsSigner = !!setSignerName
  const ready = pwd.length > 0 && (!needsSigner || (signerName || '').trim().length > 0)
  const accentBorder = dok ? '#0f172a' : wh ? '#b45309' : '#2563eb'
  const accentBg = dok ? 'bg-slate-900' : wh ? 'bg-amber-600' : 'bg-blue-600'
  const title = dok ? 'ДОК «Проверил»' : wh ? 'Склад «Выдал»' : 'ДП «Выполнил»'
  const act = dok ? 'проверку' : wh ? 'выдачу сырья' : 'выполнение'
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border bg-white shadow-2xl ring-1" style={{ borderColor: accentBorder }}>
        <div className={`flex items-center gap-2 px-4 py-2 text-white ${accentBg}`}>
          <Pen size={15} /><span className="text-[12.5px] font-semibold">Подпись {title} · {label}</span>
          <span className="ml-auto mono text-[11px] opacity-80">{who}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-[180px] text-[12px] text-slate-600">Подписант подтверждает {act} лично своими данными (ALCOA+).</div>
          {needsSigner && (
            <input autoFocus value={signerName || ''} onChange={(e) => setSignerName!(e.target.value)} placeholder="Логин подписанта" autoComplete="off"
              className="h-11 w-44 rounded-lg border border-slate-300 px-3 text-[14px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          )}
          <input type="password" autoFocus={!needsSigner} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Пароль / PIN" autoComplete="off"
            onKeyDown={(e) => { if (e.key === 'Enter' && ready) onConfirm() }}
            className="h-11 w-44 rounded-lg border border-slate-300 px-3 text-[14px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          <button disabled={busy || !ready} onClick={onConfirm} className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold text-white disabled:opacity-50 ${accentBg}`}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Подтвердить</button>
          <button onClick={onCancel} className="inline-flex h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-600"><X size={15} /></button>
        </div>
      </div>
    </div>
  )
}

/* ---- Signature cell ---- */
const SIGN_LABEL: Record<SignRole, string> = { dp: 'ДП', dok: 'ДОК', wh: 'Склад' }
function SignCell({ role, state, who, at, onSign }: { role: SignRole; state: 'locked' | 'ready' | 'signed'; who?: string; at?: string; onSign?: () => void }) {
  const dok = role === 'dok'
  const wh = role === 'wh'
  const signedTone = dok ? 'border-emerald-200 bg-emerald-50' : wh ? 'border-amber-200 bg-amber-50' : 'border-indigo-200 bg-indigo-50'
  const signedDot = dok ? 'bg-emerald-600' : wh ? 'bg-amber-600' : 'bg-indigo-600'
  const signedName = dok ? 'text-emerald-900' : wh ? 'text-amber-900' : 'text-indigo-900'
  const signedMeta = dok ? 'text-emerald-700/80' : wh ? 'text-amber-700/80' : 'text-indigo-700/80'
  const btnTone = dok ? 'bg-slate-900 hover:bg-slate-800' : wh ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
  if (state === 'signed') return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 ${signedTone}`}>
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-white ${signedDot}`}><Check size={12} /></span>
      <div className="leading-tight"><div className={`text-[12px] font-semibold ${signedName}`}>{who}</div><div className={`mono text-[10px] ${signedMeta}`}>{SIGN_LABEL[role]} · {at}</div></div>
    </div>
  )
  if (state === 'locked') return <div className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 text-[11px] font-medium text-slate-400"><Lock size={13} /> {dok ? 'после ДП' : 'ожидает'}</div>
  return <button onClick={onSign} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-white shadow-sm active:scale-[0.98] ${btnTone}`}><Pen size={13} /> Подписать · {SIGN_LABEL[role]}</button>
}

function numVal(s?: string): number | null {
  const v = parseFloat(String(s ?? '').replace(',', '.'))
  return Number.isFinite(v) ? v : null
}
function outOfLimit(v: number | null, lo?: number, hi?: number): boolean {
  if (v == null) return false
  if (lo != null && v < lo) return true
  if (hi != null && v > hi) return true
  return false
}

function fmtTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function sigState(e: BmrEntryItem | undefined, dpSigned: boolean, role: SignRole, unlocked = true): 'locked' | 'ready' | 'signed' {
  if (e?.value && e.value.signed_by) return 'signed'
  if (!unlocked) return 'locked'
  if (role === 'dok' && !dpSigned) return 'locked'
  return 'ready'
}

function ProcessClosureBlock({
  fields,
  allSections,
  entries,
  draft,
  closed,
  onSetVal,
}: {
  fields: { section: BmrSectionItem; fieldIndex: number; field: { label?: string; type?: string } }[]
  allSections: BmrSectionItem[]
  entries: EntryMap
  draft: Record<string, string>
  closed: boolean
  onSetVal: (sid: string, fi: number, v: string) => void
}) {
  const first = fields[0]
  const unlocked = first ? fieldUnlocked(allSections, entries, draft, String(first.section.id), first.fieldIndex) : false
  return (
    <section className="scroll-mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-400">Финальное закрытие процесса</div>
          <div className="text-[14px] font-semibold text-slate-900">Окончание стадии</div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${unlocked ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
          {unlocked ? 'Доступно' : 'После подписей ДОК'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
        {fields.map(({ section, fieldIndex, field }) => {
          const sid = String(section.id)
          const itemUnlocked = fieldUnlocked(allSections, entries, draft, sid, fieldIndex)
          const value = draft[key(sid, fieldIndex)] ?? ''
          const inputType = field.type === 'datetime' ? 'datetime-local' : field.type === 'date' ? 'date' : 'text'
          return (
            <div key={`${sid}:${fieldIndex}`} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{field.label || 'Дата-время окончания'}</div>
              <input
                disabled={closed || !itemUnlocked}
                type={inputType}
                value={value}
                onChange={(event) => onSetVal(sid, fieldIndex, event.target.value)}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"
              />
              <div className="mt-2 text-[11.5px] text-slate-500">
                Заполняется только после завершения предыдущих пунктов и подписей контролера ДОК.
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ============================ SECTION BLOCKS ============================ */
function SectionBlock({ section, allSections, entries, draft, closed, canDp, canDok, canWh, onSetVal, onSign }: {
  section: BmrSectionItem; allSections: BmrSectionItem[]; entries: EntryMap; draft: Record<string, string>; closed: boolean
  canDp: boolean; canDok: boolean; canWh: boolean; onSetVal: (sid: string, fi: number, v: string) => void
  onSign: (fi: number, role: SignRole, label: string) => void
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
    const unlocked = fieldUnlocked(allSections, entries, draft, sid, fi)
    return (
      <div className="inline-flex items-center gap-1.5">
        <input disabled={closed || !unlocked} type={itype} value={v} onChange={(e) => onSetVal(sid, fi, e.target.value)}
          className="h-10 w-full min-w-[7rem] rounded-md border border-slate-300 bg-white px-2.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500" />
        {unit && <span className="text-[10px] text-slate-400">{unit}</span>}
      </div>
    )
  }

  /* ---- process_header ---- */
  if (kind === 'process_header') {
    const fields = section.config?.fields || []
    const regularFields = fields.map((f, fi) => ({ f, fi })).filter((item) => !isProcessEndField(section, item.f))
    return wrap(
      <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2">
        <Meta label="Процесс" value={section.config?.process || section.title} />
        <Meta label="Комната / №" value={`${section.config?.room || '—'}${section.config?.room_no ? ` / ${section.config.room_no}` : ''}`} />
        {regularFields.map(({ f, fi }) => (
          <div key={fi}>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{f.label}</div>
            {inputFor(fi, f.type)}
            {String(f.label || '').toLowerCase().includes('предыдущ') && (
              <div className="mt-1 text-[11px] text-slate-400">Подставляется из истории комнаты, можно исправить вручную.</div>
            )}
          </div>
        ))}
        {regularFields.length !== fields.length && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] text-blue-700 sm:col-span-2">
            Дата-время окончания заполняется в финальном блоке после выполнения и проверки всех предыдущих этапов.
          </div>
        )}
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
            const dpUnlocked = fieldUnlocked(allSections, entries, draft, sid, 2 * i)
            const dokUnlocked = fieldUnlocked(allSections, entries, draft, sid, 2 * i + 1)
            return (
              <tr key={i} className="border-b border-slate-100 align-middle">
                <td className="px-3 py-2 text-center mono text-[12px] font-semibold text-slate-400">{st.no || i + 1}</td>
                <td className="px-3 py-2 text-[13px] text-slate-800">{st.text}</td>
                <td className="px-3 py-2"><SignCell role="dp" state={sigState(dpE, dpSigned, 'dp', dpUnlocked)} who={dpE?.value?.signed_by} at={fmtTime(dpE?.value?.signed_at)} onSign={canDp && !closed && dpUnlocked ? () => onSign(2 * i, 'dp', `этап ${st.no || i + 1}`) : undefined} /></td>
                <td className="px-3 py-2"><SignCell role="dok" state={sigState(dokE, dpSigned, 'dok', dokUnlocked)} who={dokE?.value?.signed_by} at={fmtTime(dokE?.value?.signed_at)} onSign={canDok && !closed && dpSigned && dokUnlocked ? () => onSign(2 * i + 1, 'dok', `этап ${st.no || i + 1}`) : undefined} /></td>
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
              const dokCell = (fi: number, dpSigned: boolean) => { const e = entries[key(sid, fi)]; const unlocked = fieldUnlocked(allSections, entries, draft, sid, fi); return <SignCell role="dok" state={sigState(e, dpSigned, 'dok', unlocked)} who={e?.value?.signed_by} at={fmtTime(e?.value?.signed_at)} onSign={canDok && !closed && dpSigned && unlocked ? () => onSign(fi, 'dok', p.name) : undefined} /> }
              const dpCell = (fi: number) => { const e = entries[key(sid, fi)]; const unlocked = fieldUnlocked(allSections, entries, draft, sid, fi); return <SignCell role="dp" state={sigState(e, false, 'dp', unlocked)} who={e?.value?.signed_by} at={fmtTime(e?.value?.signed_at)} onSign={canDp && !closed && unlocked ? () => onSign(fi, 'dp', p.name) : undefined} /> }
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

  /* ---- production_formula (справочный состав серии, read-only) ---- */
  if (kind === 'production_formula') {
    const rows = section.config?.rows || []
    return wrap(
      <div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Состав</th><th className="px-3 py-2">Спецификация</th><th className="px-3 py-2">На таблетку</th><th className="px-3 py-2">На серию</th>
            </tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-100 text-[12.5px] text-slate-700">
                <td className="px-3 py-2">{r.name}</td><td className="mono px-3 py-2 text-slate-500">{r.spec || '—'}</td>
                <td className="mono px-3 py-2 text-slate-600">{r.per_tab || '—'}</td><td className="mono px-3 py-2 text-slate-600">{r.per_series || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {section.config?.note && <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">{section.config.note}</div>}
      </div>
    )
  }

  /* ---- yield (выход / материальный баланс: план + факт → авто % выхода/потерь) ---- */
  if (kind === 'yield') {
    const cfg = section.config || {}
    const unit = cfg.unit || ''
    const planned = numVal(draft[key(sid, 0)])
    const actual = numVal(draft[key(sid, 1)])
    const yieldPct = planned != null && planned > 0 && actual != null ? (actual / planned) * 100 : null
    const lossPct = yieldPct != null ? Math.max(0, 100 - yieldPct) : null
    const dpE = entries[key(sid, 2)]; const dokE = entries[key(sid, 3)]
    const dpSigned = !!(dpE?.value && dpE.value.signed_by)
    const uDp = fieldUnlocked(allSections, entries, draft, sid, 2)
    const uDok = fieldUnlocked(allSections, entries, draft, sid, 3)
    return wrap(
      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{cfg.planned_label || 'По плану'}</div>
          {inputFor(0, 'number', unit)}
        </div>
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{cfg.actual_label || 'Фактически'}</div>
          {inputFor(1, 'number', unit)}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:col-span-2">
          <div className="flex flex-wrap items-center gap-4">
            <div><div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Выход</div><div className="mono text-[17px] font-bold text-slate-900">{yieldPct != null ? `${yieldPct.toFixed(2)} %` : '—'}</div></div>
            <div><div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Потери</div><div className={`mono text-[17px] font-bold ${lossPct != null && lossPct > 5 ? 'text-rose-600' : 'text-slate-900'}`}>{lossPct != null ? `${lossPct.toFixed(2)} %` : '—'}</div></div>
            <span className="ml-auto text-[11px] text-slate-400">Авто-расчёт: факт ÷ план × 100</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Рассчитал · ДП</span>
          <SignCell role="dp" state={sigState(dpE, false, 'dp', uDp)} who={dpE?.value?.signed_by} at={fmtTime(dpE?.value?.signed_at)} onSign={canDp && !closed && uDp ? () => onSign(2, 'dp', section.title) : undefined} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Проверил · ДОК</span>
          <SignCell role="dok" state={sigState(dokE, dpSigned, 'dok', uDok)} who={dokE?.value?.signed_by} at={fmtTime(dokE?.value?.signed_at)} onSign={canDok && !closed && dpSigned && uDok ? () => onSign(3, 'dok', section.title) : undefined} />
        </div>
      </div>
    )
  }

  /* ---- in_process_control (ВПК: параметр × пробы, авто-среднее, подсветка вне предела) ---- */
  if (kind === 'in_process_control') {
    const params = section.config?.params || []
    const phases = section.config?.phases || []
    const perPhase = params.reduce((a, p) => a + (p.samples || 1), 0) + 2
    return wrap(
      <div className="space-y-4 p-3">
        {phases.map((ph, pi) => {
          const phaseBase = pi * perPhase
          let cursor = phaseBase
          const paramRows = params.map((p, ppi) => {
            const n = p.samples || 1
            const start = cursor
            cursor += n
            const vals = Array.from({ length: n }, (_, s) => numVal(draft[key(sid, start + s)]))
            const filled = vals.filter((v): v is number => v != null)
            const avg = filled.length ? filled.reduce((a, b) => a + b, 0) / filled.length : null
            const avgOut = outOfLimit(avg, p.lo, p.hi)
            return (
              <tr key={ppi} className="border-b border-slate-100 align-top">
                <td className="px-2 py-2 text-[12.5px] font-medium text-slate-800">{p.name}{p.limit && <div className="mono text-[10px] text-slate-400">предел: {p.limit}</div>}</td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: n }, (_, s) => {
                      const fi = start + s
                      const v = numVal(draft[key(sid, fi)])
                      const bad = outOfLimit(v, p.lo, p.hi)
                      const unlocked = fieldUnlocked(allSections, entries, draft, sid, fi)
                      return (
                        <input key={s} disabled={closed || !unlocked} type="number" value={draft[key(sid, fi)] ?? ''} onChange={(e) => onSetVal(sid, fi, e.target.value)}
                          className={`h-9 w-16 rounded-md border bg-white px-2 text-[12.5px] outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 ${bad ? 'border-rose-400 text-rose-700 focus:ring-rose-100' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'}`} />
                      )
                    })}
                  </div>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className={`mono rounded-md px-2 py-1 text-[12px] font-semibold ring-1 ring-inset ${avg == null ? 'bg-slate-100 text-slate-400 ring-slate-200' : avgOut ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
                    {avg == null ? 'ср. —' : `ср. ${avg.toFixed(2)}`}{p.unit ? ` ${p.unit}` : ''}
                  </span>
                </td>
              </tr>
            )
          })
          const dpFi = phaseBase + params.reduce((a, p) => a + (p.samples || 1), 0)
          const dokFi = dpFi + 1
          const dpE = entries[key(sid, dpFi)]; const dokE = entries[key(sid, dokFi)]
          const dpSigned = !!(dpE?.value && dpE.value.signed_by)
          const uDp = fieldUnlocked(allSections, entries, draft, sid, dpFi)
          const uDok = fieldUnlocked(allSections, entries, draft, sid, dokFi)
          return (
            <div key={ph.key} className="overflow-hidden rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                <span className="text-[12.5px] font-semibold text-slate-800">В процессе · {ph.title}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead><tr className="border-b border-slate-200 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-2 py-1.5">Параметр</th><th className="px-2 py-1.5">Пробы</th><th className="px-2 py-1.5">Среднее</th>
                  </tr></thead>
                  <tbody>{paramRows}</tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-white px-3 py-2">
                <div className="flex items-center gap-2"><span className="text-[11px] text-slate-500">Испытал · ДП</span>
                  <SignCell role="dp" state={sigState(dpE, false, 'dp', uDp)} who={dpE?.value?.signed_by} at={fmtTime(dpE?.value?.signed_at)} onSign={canDp && !closed && uDp ? () => onSign(dpFi, 'dp', `ВПК ${ph.title}`) : undefined} />
                </div>
                <div className="flex items-center gap-2"><span className="text-[11px] text-slate-500">Утвердил · ДОК</span>
                  <SignCell role="dok" state={sigState(dokE, dpSigned, 'dok', uDok)} who={dokE?.value?.signed_by} at={fmtTime(dokE?.value?.signed_at)} onSign={canDok && !closed && dpSigned && uDok ? () => onSign(dokFi, 'dok', `ВПК ${ph.title}`) : undefined} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  /* ---- distribution_list (лист распределения сырья: вес нетто + Склад/ДП/ДОК) ---- */
  if (kind === 'distribution_list') {
    const groups = section.config?.groups || []
    const rows: React.ReactNode[] = []
    let base = 0
    groups.forEach((g, gi) => {
      rows.push(
        <tr key={`g-${gi}`} className="border-b border-slate-200 bg-slate-100/70">
          <td colSpan={6} className="px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-slate-600">{g.title}</td>
        </tr>
      )
      g.items.forEach((it, ii) => {
        const b = base
        base += 4
        const whE = entries[key(sid, b + 1)]; const dpE = entries[key(sid, b + 2)]; const dokE = entries[key(sid, b + 3)]
        const whSigned = !!(whE?.value && whE.value.signed_by)
        const dpSigned = !!(dpE?.value && dpE.value.signed_by)
        const uWh = fieldUnlocked(allSections, entries, draft, sid, b + 1)
        const uDp = fieldUnlocked(allSections, entries, draft, sid, b + 2)
        const uDok = fieldUnlocked(allSections, entries, draft, sid, b + 3)
        rows.push(
          <tr key={`i-${gi}-${ii}`} className="border-b border-slate-100 align-middle">
            <td className="px-3 py-2 text-[13px] text-slate-800">{it.name}{it.spec ? <span className="mono ml-1 text-[10.5px] text-slate-400">{it.spec}</span> : null}</td>
            <td className="mono px-3 py-2 text-[12px] text-slate-500">{it.qty || '—'}</td>
            <td className="px-3 py-2">{inputFor(b + 0, 'number', 'кг')}</td>
            <td className="px-3 py-2"><SignCell role="wh" state={sigState(whE, false, 'wh', uWh)} who={whE?.value?.signed_by} at={fmtTime(whE?.value?.signed_at)} onSign={(canWh || canDp) && !closed && uWh ? () => onSign(b + 1, 'wh', `${it.name} · выдача`) : undefined} /></td>
            <td className="px-3 py-2"><SignCell role="dp" state={sigState(dpE, false, 'dp', uDp)} who={dpE?.value?.signed_by} at={fmtTime(dpE?.value?.signed_at)} onSign={canDp && !closed && whSigned && uDp ? () => onSign(b + 2, 'dp', `${it.name} · проверка ДП`) : undefined} /></td>
            <td className="px-3 py-2"><SignCell role="dok" state={sigState(dokE, dpSigned, 'dok', uDok)} who={dokE?.value?.signed_by} at={fmtTime(dokE?.value?.signed_at)} onSign={canDok && !closed && dpSigned && uDok ? () => onSign(b + 3, 'dok', `${it.name} · проверка ДОК`) : undefined} /></td>
          </tr>
        )
      })
    })
    return wrap(
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Наименование ингредиента</th>
              <th className="w-[120px] px-3 py-2">Кол-во на серию, кг</th>
              <th className="w-[150px] px-3 py-2">Вес нетто</th>
              <th className="w-[160px] px-3 py-2">Выдал · Склад</th>
              <th className="w-[160px] px-3 py-2">Проверил · ДП</th>
              <th className="w-[160px] px-3 py-2">Проверил · ДОК</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
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
