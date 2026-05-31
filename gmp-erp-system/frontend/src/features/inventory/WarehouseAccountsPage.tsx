import { useEffect, useMemo, useState } from 'react'
import { Coins, FileDown, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { downloadAccountLedgerXlsx, getAccountLedger } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import type { AccountLedgerItem } from '../../types/inventory'

interface Props {
  token: string
}

const WAREHOUSE_LABEL: Record<string, string> = {
  SUBSTANCE_WAREHOUSE: 'role.scope.SUBSTANCE_WAREHOUSE',
  PACKAGING_WAREHOUSE: 'role.scope.PACKAGING_WAREHOUSE',
  FG_WAREHOUSE: 'role.scope.FG_WAREHOUSE',
}

export function WarehouseAccountsPage({ token }: Props) {
  const { locale, t } = useI18n()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [accounts, setAccounts] = useState<AccountLedgerItem[]>([])
  const [total, setTotal] = useState(0)
  const [currency, setCurrency] = useState('UZS')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const resp = await getAccountLedger(token, {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
      setAccounts(resp.accounts)
      setTotal(resp.total_balance)
      setCurrency(resp.currency)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function exportXlsx() {
    try {
      const blob = await downloadAccountLedgerXlsx(token, { date_from: dateFrom || undefined, date_to: dateTo || undefined })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'оборотная-ведомость.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'export failed')
    }
  }

  const fmt = (v: number) => v.toLocaleString(locale, { maximumFractionDigits: 2 })
  const periodActive = Boolean(dateFrom || dateTo)
  const totalsByGroup = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of accounts) m[a.account_group || 'OTHER'] = (m[a.account_group || 'OTHER'] || 0) + a.balance_value
    return m
  }, [accounts])

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t('accounts.eyebrow')}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">{t('accounts.title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t('accounts.subtitle')}</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-[11px] font-medium text-slate-600">
            {t('accounts.from')}
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 block h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400" />
          </label>
          <label className="text-[11px] font-medium text-slate-600">
            {t('accounts.to')}
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 block h-9 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400" />
          </label>
          <button type="button" onClick={() => void load()} disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[13px] font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('accounts.refresh')}
          </button>
          <button type="button" onClick={() => void exportXlsx()} disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
            <FileDown size={14} /> {t('accounts.export')}
          </button>
        </div>
      </div>

      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* Сводка */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['SUBSTANCE_API', 'EXCIPIENT', 'PACKAGING'] as const).map((g) => (
          <div key={g} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t(`accounts.group.${g}` as never)}</div>
            <div className="mt-1.5 font-mono text-[20px] font-semibold tabular-nums text-slate-900">{fmt(totalsByGroup[g] || 0)}</div>
          </div>
        ))}
        <div className="rounded-xl border border-slate-900 bg-slate-900 p-4 text-white">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-300"><Coins size={14} /> {t('accounts.totalBalance')}</div>
          <div className="mt-1.5 font-mono text-[22px] font-semibold tabular-nums">{fmt(total)} <span className="text-[13px] font-normal text-slate-400">{currency}</span></div>
        </div>
      </div>

      {/* Оборотная ведомость */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-100/95 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2.5">{t('accounts.code')}</th>
              <th className="px-3 py-2.5">{t('accounts.name')}</th>
              <th className="px-3 py-2.5 text-right">{t('accounts.lots')}</th>
              <th className="px-3 py-2.5 text-right">{periodActive ? t('accounts.inValue') : ''}</th>
              <th className="px-3 py-2.5 text-right">{periodActive ? t('accounts.outValue') : ''}</th>
              <th className="px-3 py-2.5 text-right">{t('accounts.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.account_code} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2.5"><span className="font-mono text-[12.5px] font-semibold text-slate-900">{a.account_code}</span></td>
                <td className="px-3 py-2.5">
                  <div className="text-slate-800">{a.account_name}</div>
                  {a.by_warehouse.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
                      {a.by_warehouse.map((w) => (
                        <span key={w.warehouse_type}>{WAREHOUSE_LABEL[w.warehouse_type] ? t(WAREHOUSE_LABEL[w.warehouse_type] as never) : w.warehouse_type}: {fmt(w.value)}</span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600">{a.lots_count || '—'}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {periodActive && a.in_value > 0 ? <span className="inline-flex items-center gap-1 text-emerald-700"><TrendingUp size={12} />{fmt(a.in_value)}</span> : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {periodActive && a.out_value > 0 ? <span className="inline-flex items-center gap-1 text-rose-700"><TrendingDown size={12} />{fmt(a.out_value)}</span> : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">{fmt(a.balance_value)}</td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-400">{t('accounts.empty')}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className="px-3 py-2.5" colSpan={5}>{t('accounts.totalBalance')}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900">{fmt(total)} {currency}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11.5px] text-slate-400">{t('accounts.hint')}</p>
    </section>
  )
}
