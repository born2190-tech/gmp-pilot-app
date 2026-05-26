import { useEffect, useState } from 'react'
import { Coins, Plus, Save, Trash2, X } from 'lucide-react'
import {
  createInventoryAccount,
  deleteInventoryAccount,
  listInventoryAccounts,
  updateInventoryAccount,
} from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { InventoryAccountInput, InventoryAccountItem } from '../../types/inventory'

interface Props {
  token: string
  user: CurrentUser
}

const GROUPS = ['SUBSTANCE_API', 'EXCIPIENT', 'PACKAGING', 'WIP', 'OTHER']
const ZONES = ['QUARANTINE', 'RELEASED', 'REJECTED', 'WIP']

const emptyDraft = (): InventoryAccountInput => ({ code: '', name: '', account_group: null, zone: null, is_active: true })

export function InventoryAccountsAdminPage({ token, user }: Props) {
  const { t } = useI18n()
  const canManage = user.permissions.includes('MANAGE_MASTER_DATA')
  const [rows, setRows] = useState<InventoryAccountItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<InventoryAccountInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function reload() {
    try {
      const resp = await listInventoryAccounts(token)
      setRows(resp.accounts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    }
  }
  useEffect(() => { void reload() }, [token])

  function startNew() {
    setEditingId('new')
    setDraft(emptyDraft())
    setError(null); setSuccess(null)
  }
  function startEdit(a: InventoryAccountItem) {
    setEditingId(a.id)
    setDraft({ code: a.code, name: a.name, account_group: a.account_group, zone: a.zone, is_active: a.is_active })
    setError(null); setSuccess(null)
  }
  function cancel() { setEditingId(null); setDraft(null) }

  async function save() {
    if (!draft) return
    if (!draft.code.trim() || !draft.name.trim()) { setError(t('iaccounts.errRequired')); return }
    setBusy(true); setError(null)
    try {
      if (editingId === 'new') await createInventoryAccount(token, draft)
      else if (editingId) await updateInventoryAccount(token, editingId, draft)
      await reload()
      setSuccess(t('iaccounts.saved'))
      cancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed')
    } finally { setBusy(false) }
  }

  async function remove(a: InventoryAccountItem) {
    if (!window.confirm(t('iaccounts.confirmDelete'))) return
    setBusy(true); setError(null)
    try {
      await deleteInventoryAccount(token, a.id)
      await reload()
      setSuccess(t('iaccounts.deleted'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed')
    } finally { setBusy(false) }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t('iaccounts.eyebrow')}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">{t('iaccounts.title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t('iaccounts.subtitle')}</p>
        </div>
        {canManage && editingId === null && (
          <button type="button" onClick={startNew} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-[13px] font-medium text-white hover:bg-slate-800">
            <Plus size={15} /> {t('iaccounts.new')}
          </button>
        )}
      </div>

      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      {editingId !== null && draft && (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-5">
          <Labeled label={t('iaccounts.code')}><input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} className="ia-inp font-mono" placeholder="001-20" /></Labeled>
          <Labeled label={t('iaccounts.name')}><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="ia-inp" /></Labeled>
          <Labeled label={t('iaccounts.group')}>
            <select value={draft.account_group ?? ''} onChange={(e) => setDraft({ ...draft, account_group: e.target.value || null })} className="ia-inp">
              <option value="">—</option>
              {GROUPS.map((g) => <option key={g} value={g}>{t(`iaccounts.group.${g}` as never)}</option>)}
            </select>
          </Labeled>
          <Labeled label={t('iaccounts.zone')}>
            <select value={draft.zone ?? ''} onChange={(e) => setDraft({ ...draft, zone: e.target.value || null })} className="ia-inp">
              <option value="">—</option>
              {ZONES.map((z) => <option key={z} value={z}>{t(`iaccounts.zone.${z}` as never)}</option>)}
            </select>
          </Labeled>
          <div className="flex items-end gap-2">
            <label className="mb-2 inline-flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} className="h-4 w-4 accent-slate-900" />
              {t('iaccounts.active')}
            </label>
          </div>
          <div className="flex gap-2 md:col-span-5">
            <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-700 px-4 text-[13px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"><Save size={14} /> {t('common.save')}</button>
            <button type="button" onClick={cancel} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-50"><X size={14} /> {t('common.cancel')}</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-100/95 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2.5">{t('iaccounts.code')}</th>
              <th className="px-3 py-2.5">{t('iaccounts.name')}</th>
              <th className="px-3 py-2.5">{t('iaccounts.group')}</th>
              <th className="px-3 py-2.5">{t('iaccounts.zone')}</th>
              <th className="px-3 py-2.5">{t('iaccounts.active')}</th>
              {canManage && <th className="px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2.5"><span className="font-mono text-[12.5px] font-semibold text-slate-900">{a.code}</span></td>
                <td className="px-3 py-2.5 text-slate-800">{a.name}</td>
                <td className="px-3 py-2.5 text-slate-600">{a.account_group ? t(`iaccounts.group.${a.account_group}` as never) : '—'}</td>
                <td className="px-3 py-2.5 text-slate-600">{a.zone ? t(`iaccounts.zone.${a.zone}` as never) : '—'}</td>
                <td className="px-3 py-2.5">
                  {a.is_active
                    ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{t('iaccounts.active')}</span>
                    : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{t('iaccounts.inactive')}</span>}
                </td>
                {canManage && (
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => startEdit(a)} className="rounded px-2 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-50">{t('common.edit')}</button>
                      <button type="button" onClick={() => void remove(a)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-400">{t('iaccounts.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-1.5 text-[11.5px] text-slate-400"><Coins size={13} /> {t('iaccounts.hint')}</p>
      <style>{`.ia-inp{height:2.5rem;width:100%;border-radius:0.375rem;border:1px solid rgb(226 232 240);background:#fff;padding:0 0.625rem;font-size:13px;outline:none}.ia-inp:focus{border-color:rgb(148 163 184)}`}</style>
    </section>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
