import { useEffect, useState } from 'react'
import { Check, Loader2, Users, X } from 'lucide-react'
import { listBmrOperators, setBmrAssignments } from '../../lib/api'
import type { BmrInstanceItem, BmrOperatorItem } from '../../types/inventory'

/* Назначение операторов по этапам (начальник цеха, до передачи BMR в цех).
   Контролёров (ДОК) не назначаем — любой ДОК подписывает (ролевой гейт). */
export function BmrAssignDialog({ token, instance, onClose, onSaved }: {
  token: string; instance: BmrInstanceItem; onClose: () => void; onSaved: (inst: BmrInstanceItem) => void
}) {
  const [operators, setOperators] = useState<BmrOperatorItem[]>([])
  const [map, setMap] = useState<Record<string, string[]>>(() => ({ ...(instance.assignments || {}) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stages = instance.stages || []
  const closed = instance.status === 'completed' || instance.status === 'reviewed'

  useEffect(() => {
    listBmrOperators(token).then((r) => setOperators(r.operators)).catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
  }, [token])

  const toggle = (stage: string, id: string) => setMap((p) => {
    const cur = new Set(p[stage] || [])
    if (cur.has(id)) cur.delete(id); else cur.add(id)
    return { ...p, [stage]: Array.from(cur) }
  })

  async function save() {
    setBusy(true); setError(null)
    try {
      const updated = await setBmrAssignments(token, instance.id, map)
      onSaved(updated); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <Users size={18} className="text-blue-600" />
          <div>
            <div className="text-[15px] font-bold text-slate-900">Назначение операторов по этапам</div>
            <div className="text-[12px] text-slate-500">Серия {instance.batch_no} · начальник цеха назначает ДП до передачи в цех</div>
          </div>
          <button onClick={onClose} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div>}
          {stages.length === 0 && <div className="text-[13px] text-slate-400">У этого BMR нет этапов.</div>}
          <div className="space-y-4">
            {stages.map((st) => (
              <div key={st.stage} className="rounded-xl border border-slate-200">
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                  <span className="text-[13px] font-semibold text-slate-800">{st.title}</span>
                  {st.room && <span className="mono text-[11px] text-slate-400">{st.room}</span>}
                  <span className="ml-auto text-[11px] text-slate-400">{(map[st.stage] || []).length} назначено</span>
                </div>
                <div className="flex flex-wrap gap-2 p-3">
                  {operators.map((op) => {
                    const on = (map[st.stage] || []).includes(op.id)
                    return (
                      <button key={op.id} disabled={closed} onClick={() => toggle(st.stage, op.id)}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50 ${on ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                        {on ? <Check size={14} /> : <span className="h-3.5 w-3.5 rounded-full border border-slate-300" />}
                        {op.full_name}
                        {!op.is_operator && <span className="rounded bg-slate-100 px-1 text-[9px] text-slate-500">мастер</span>}
                      </button>
                    )
                  })}
                  {operators.length === 0 && <span className="text-[12px] text-slate-400">нет доступных операторов</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-3">
          <span className="text-[11px] text-slate-400">Если этап без назначений — подписать ДП может любой оператор; иначе только назначенный.</span>
          <button onClick={onClose} className="ml-auto inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-[13px] font-medium text-slate-600">Отмена</button>
          <button disabled={busy || closed} onClick={() => void save()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Сохранить назначения</button>
        </div>
      </div>
    </div>
  )
}
