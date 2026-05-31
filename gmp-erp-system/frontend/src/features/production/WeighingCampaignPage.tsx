import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, Check, ChevronRight, Loader2, Lock, Pen, Plus, Scale, ShieldCheck, Trash2, X,
} from 'lucide-react'
import {
  listWeighingCampaigns, createWeighingCampaign, getWeighingCampaign, addWeighingSeries,
  removeWeighingSeries, setWeighingLot, saveWeighingNet, signWeighingCell, setWeighingStatus,
  listProductionBatches,
} from '../../lib/api'
import type { CurrentUser } from '../../types/auth'
import type {
  WeighingCampaignItem, WeighingCampaignListItem, WeighingCampaignCell,
} from '../../types/inventory'

interface Props { token: string; user: CurrentUser | null }

type SignRole = 'warehouse' | 'dp' | 'qa'
const ROLE_LABEL: Record<SignRole, string> = { warehouse: 'Склад', dp: 'ДП', qa: 'ДОК' }
const ROLE_TONE: Record<SignRole, string> = {
  warehouse: 'bg-amber-600 hover:bg-amber-700',
  dp: 'bg-blue-600 hover:bg-blue-700',
  qa: 'bg-slate-900 hover:bg-slate-800',
}
const STATUS_LABEL: Record<string, string> = { draft: 'Черновик', active: 'В работе', completed: 'Закрыта' }

function fmtTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function WeighingCampaignPage({ token, user }: Props) {
  const [list, setList] = useState<WeighingCampaignListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setList((await listWeighingCampaigns(token)).campaigns) }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }, [token])
  useEffect(() => { void load() }, [load])

  if (openId) return <CampaignDetail token={token} user={user} id={openId} onBack={() => { setOpenId(null); void load() }} />

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600 text-white"><Scale size={20} /></span>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Кампания взвешивания</h1>
          <p className="text-[13px] text-slate-500">Межсерийная развеска дня (СОП-497): сводная ведомость материалов по сериям, одна партия субстанции на несколько серий</p>
        </div>
        <button onClick={() => setCreating(true)} className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg bg-amber-600 px-3 text-[13px] font-semibold text-white hover:bg-amber-700"><Plus size={16} /> Новая кампания</button>
      </div>
      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div>}
      {loading ? (
        <div className="flex items-center gap-2 py-16 text-slate-400"><Loader2 size={18} className="animate-spin" /> загрузка…</div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">Кампаний нет. Создайте кампанию и добавьте серии дня.</div>
      ) : (
        <div className="space-y-2">
          {list.map((c) => (
            <button key={c.id} onClick={() => setOpenId(c.id)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-amber-300 hover:bg-amber-50/40">
              <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-slate-900 text-white"><Scale size={18} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-slate-900">{c.title}</span>
                  <span className="mono rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{c.code}</span>
                </div>
                <div className="mono text-[11px] text-slate-400">{c.campaign_date} · {c.room || '—'} · серий: {c.series_count}</div>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{STATUS_LABEL[c.status] || c.status}</span>
              <ChevronRight size={16} className="text-slate-300" />
            </button>
          ))}
        </div>
      )}
      {creating && <CreateDialog token={token} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id) }} />}
    </div>
  )
}

function CreateDialog({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [room, setRoom] = useState('Комн. 39')
  const [batches, setBatches] = useState<{ id: string; batch_no: string; product_name: string }[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listProductionBatches(token).then((r) => {
      setBatches(r.batches.filter((b) => b.status !== 'draft' && b.status !== 'cancelled').map((b) => ({ id: b.id, batch_no: b.batch_no, product_name: b.product_name })))
    }).catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
  }, [token])

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function submit() {
    setBusy(true); setError(null)
    try {
      const c = await createWeighingCampaign(token, { campaign_date: date, room, batch_ids: Array.from(picked) })
      onCreated(c.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось создать') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <Scale size={18} className="text-amber-600" />
          <div className="text-[15px] font-bold text-slate-900">Новая кампания взвешивания</div>
          <button onClick={onClose} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div>}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <label className="text-[12px] text-slate-500">Дата кампании
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2.5 text-[13px]" />
            </label>
            <label className="text-[12px] text-slate-500">Комната
              <input value={room} onChange={(e) => setRoom(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-2.5 text-[13px]" />
            </label>
          </div>
          <div className="mb-1 text-[12px] font-semibold text-slate-600">Серии дня ({picked.size} выбрано)</div>
          <div className="space-y-1.5">
            {batches.map((b) => {
              const on = picked.has(b.id)
              return (
                <button key={b.id} onClick={() => toggle(b.id)} className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${on ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  {on ? <Check size={15} className="text-amber-600" /> : <span className="h-3.5 w-3.5 rounded-full border border-slate-300" />}
                  <span className="mono font-semibold text-slate-800">{b.batch_no}</span>
                  <span className="truncate text-slate-500">{b.product_name}</span>
                </button>
              )
            })}
            {batches.length === 0 && <div className="text-[12px] text-slate-400">Нет доступных серий.</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} className="ml-auto inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-[13px] font-medium text-slate-600">Отмена</button>
          <button disabled={busy} onClick={() => void submit()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-600 px-4 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Создать</button>
        </div>
      </div>
    </div>
  )
}

function CampaignDetail({ token, user, id, onBack }: { token: string; user: CurrentUser | null; id: string; onBack: () => void }) {
  const [camp, setCamp] = useState<WeighingCampaignItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sign, setSign] = useState<{ ingredient_key: string; batch_id: string; role: SignRole; label: string } | null>(null)

  const load = useCallback(async () => {
    try { setCamp(await getWeighingCampaign(token, id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
  }, [token, id])
  useEffect(() => { void load() }, [load])

  const perms = user?.permissions || []
  const canManage = perms.includes('MANAGE_PRODUCTION')
  const closed = camp?.status === 'completed'

  const batchOrder = useMemo(() => camp?.batches.map((b) => b.batch_id) || [], [camp])

  if (!camp) return <div className="flex items-center gap-2 p-10 text-slate-400"><Loader2 size={18} className="animate-spin" /> загрузка…</div>

  const setNet = async (ingredient_key: string, batch_id: string, net: number | null) => {
    setBusy(true); setError(null)
    try { setCamp(await saveWeighingNet(token, id, { ingredient_key, batch_id, net })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить вес') }
    finally { setBusy(false) }
  }
  const setLot = async (ingredient_key: string, lot_no: string) => {
    setBusy(true); setError(null)
    try { setCamp(await setWeighingLot(token, id, ingredient_key, lot_no || null)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить лот') }
    finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-[1600px] p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"><ArrowRight size={14} className="rotate-180" /> Кампании</button>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 text-white"><Scale size={18} /></span>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-slate-900">{camp.title}</span>
            <span className="mono rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{camp.code}</span>
          </div>
          <div className="mono text-[11px] text-slate-400">{camp.campaign_date} · {camp.room || '—'} · серий: {camp.batches.length}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{STATUS_LABEL[camp.status] || camp.status}</span>
          {canManage && !closed && (
            <button disabled={busy} onClick={async () => { setBusy(true); try { setCamp(await setWeighingStatus(token, id, 'completed')) } finally { setBusy(false) } }} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><ShieldCheck size={15} /> Закрыть кампанию</button>
          )}
        </div>
      </div>
      {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div>}

      {/* series chips */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {camp.batches.map((b) => (
          <span key={b.batch_id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px]">
            <span className="mono font-semibold text-slate-800">{b.batch_no}</span>
            <span className="text-slate-400">{b.product_code}</span>
            {!b.bmr_instance_id && <span className="rounded bg-rose-50 px-1 text-[9px] text-rose-600">без BMR</span>}
            {canManage && !closed && (
              <button onClick={async () => { setBusy(true); try { setCamp(await removeWeighingSeries(token, id, b.batch_id)) } finally { setBusy(false) } }} className="text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
            )}
          </span>
        ))}
      </div>

      {/* consolidated ledger by series */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Ингредиент</th>
              <th className="px-3 py-2">Партия (FEFO)</th>
              {camp.batches.map((b) => <th key={b.batch_id} className="px-3 py-2 text-center">Серия {b.batch_no}</th>)}
            </tr>
          </thead>
          <tbody>
            {camp.ledger.length === 0 && (
              <tr><td colSpan={2 + camp.batches.length} className="px-3 py-8 text-center text-[12.5px] text-slate-400">Нет позиций — добавьте серии с многостадийным BMR (лист распределения).</td></tr>
            )}
            {camp.ledger.map((row) => (
              <tr key={row.key} className="border-b border-slate-100 align-top">
                <td className="px-3 py-2.5 text-[13px] font-medium text-slate-800">{row.ingredient}</td>
                <td className="px-3 py-2.5">
                  <input defaultValue={row.lot_no || ''} disabled={closed} onBlur={(e) => { if ((e.target.value || '') !== (row.lot_no || '')) void setLot(row.key, e.target.value) }}
                    placeholder="№ партии" className="h-9 w-32 rounded-md border border-slate-300 px-2 text-[12.5px] outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 disabled:bg-slate-50" />
                </td>
                {batchOrder.map((bid) => {
                  const cell = row.cells[bid]
                  if (!cell) return <td key={bid} className="px-3 py-2.5 text-center text-[11px] text-slate-300">—</td>
                  return (
                    <td key={bid} className="px-3 py-2.5">
                      <Cell cell={cell} closed={!!closed} canManage={canManage}
                        planned={cell.planned}
                        onNet={(v) => void setNet(row.key, bid, v)}
                        onSign={(role) => setSign({ ingredient_key: row.key, batch_id: bid, role, label: `${row.ingredient}` })} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sign && (
        <SignDialog role={sign.role} label={sign.label} busy={busy}
          onCancel={() => setSign(null)}
          onConfirm={async (username, password) => {
            setBusy(true); setError(null)
            try {
              const updated = await signWeighingCell(token, id, { ingredient_key: sign.ingredient_key, batch_id: sign.batch_id, role: sign.role, username, password, meaning: `Развеска: ${ROLE_LABEL[sign.role]}`, reason: sign.label })
              setCamp(updated); setSign(null)
            } catch (e) { setError(e instanceof Error ? e.message : 'Подпись не принята') }
            finally { setBusy(false) }
          }} />
      )}
    </div>
  )
}

function Cell({ cell, closed, canManage, planned, onNet, onSign }: {
  cell: WeighingCampaignCell; closed: boolean; canManage: boolean; planned?: string | null
  onNet: (v: number | null) => void; onSign: (role: SignRole) => void
}) {
  const whSigned = !!cell.wh
  const dpSigned = !!cell.dp
  const qaSigned = !!cell.qa
  const sigChip = (role: SignRole, sig: { by: string; at: string } | null | undefined, enabled: boolean) => {
    if (sig) return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"><Check size={10} /> {ROLE_LABEL[role]}: {sig.by.split(' ')[0]}</span>
    )
    if (!enabled) return <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-400"><Lock size={10} /> {ROLE_LABEL[role]}</span>
    return <button onClick={() => onSign(role)} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white ${ROLE_TONE[role]}`}><Pen size={10} /> {ROLE_LABEL[role]}</button>
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      {planned && <span className="mono text-[10px] text-slate-400">план: {planned} кг</span>}
      <input type="number" defaultValue={cell.net ?? ''} disabled={closed || whSigned || !canManage}
        onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (cell.net ?? null)) onNet(v) }}
        placeholder="вес нетто" className="h-9 w-24 rounded-md border border-slate-300 px-2 text-center text-[12.5px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500" />
      <div className="flex flex-wrap justify-center gap-1">
        {sigChip('warehouse', cell.wh, !closed && cell.net != null)}
        {sigChip('dp', cell.dp, !closed && whSigned)}
        {sigChip('qa', cell.qa, !closed && dpSigned)}
      </div>
      {qaSigned && <span className="mono text-[9px] text-slate-400">{fmtTime(cell.qa?.at)}</span>}
    </div>
  )
}

function SignDialog({ role, label, busy, onCancel, onConfirm }: { role: SignRole; label: string; busy: boolean; onCancel: () => void; onConfirm: (username: string, password: string) => void }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const ready = u.trim().length > 0 && p.length > 0
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border bg-white shadow-2xl">
        <div className={`flex items-center gap-2 px-4 py-2 text-white ${ROLE_TONE[role].split(' ')[0]}`}>
          <Pen size={15} /><span className="text-[12.5px] font-semibold">Подпись {ROLE_LABEL[role]} · {label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-[160px] text-[12px] text-slate-600">Подписант подтверждает действие лично своими данными (ALCOA+).</div>
          <input autoFocus value={u} onChange={(e) => setU(e.target.value)} placeholder="Логин подписанта" autoComplete="off" className="h-11 w-44 rounded-lg border border-slate-300 px-3 text-[14px] outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" />
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="Пароль / PIN" autoComplete="off" onKeyDown={(e) => { if (e.key === 'Enter' && ready) onConfirm(u.trim(), p) }} className="h-11 w-44 rounded-lg border border-slate-300 px-3 text-[14px] outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" />
          <button disabled={busy || !ready} onClick={() => onConfirm(u.trim(), p)} className="inline-flex h-11 items-center gap-2 rounded-lg bg-amber-600 px-4 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Подтвердить</button>
          <button onClick={onCancel} className="inline-flex h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-600"><X size={15} /></button>
        </div>
      </div>
    </div>
  )
}
