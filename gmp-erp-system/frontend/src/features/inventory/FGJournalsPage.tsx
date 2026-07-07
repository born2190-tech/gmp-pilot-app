import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { getFgJournals } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import type { FGJournalRow, FGJournalsResponse } from '../../types/inventory'

interface FGJournalsPageProps {
  token: string
}

type JournalTab = 'incoming' | 'outgoing' | 'notices'

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function FGJournalsPage({ token }: FGJournalsPageProps) {
  const { locale, t } = useI18n()
  const [tab, setTab] = useState<JournalTab>('incoming')
  const [data, setData] = useState<FGJournalsResponse>({ incoming: [], outgoing: [], notices: [] })
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      setData(await getFgJournals(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgJournals.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const columns = useMemo<ColumnDef<FGJournalRow>[]>(
    () => [
      { accessorKey: 'date', header: t('fgJournals.date'), cell: ({ row }) => formatDateTime(row.original.date, locale) },
      { accessorKey: 'document', header: t('fgJournals.document'), cell: ({ row }) => row.original.document ?? '—' },
      { accessorKey: 'series', header: t('fgJournals.series') },
      { accessorKey: 'product', header: t('fgJournals.product') },
      { accessorKey: 'quantity', header: t('fgJournals.quantity'), cell: ({ row }) => `${row.original.quantity} ${row.original.unit}` },
      { accessorKey: 'counterparty', header: t('fgJournals.counterparty'), cell: ({ row }) => row.original.counterparty ?? '—' },
      { accessorKey: 'note', header: t('fgJournals.note'), cell: ({ row }) => row.original.note ?? '—' },
    ],
    [locale, t],
  )

  const rows = data[tab]
  const tabs: { key: JournalTab; label: string; sub: string }[] = [
    { key: 'incoming', label: t('fgJournals.tabIncoming'), sub: 'Ф-9' },
    { key: 'outgoing', label: t('fgJournals.tabOutgoing'), sub: 'Ф-6' },
    { key: 'notices', label: t('fgJournals.tabNotices'), sub: 'Ф-5' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('fgJournals.trace')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('fgJournals.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('fgJournals.subtitle')}</p>
        </div>
        <button className="btn-secondary" onClick={loadData} type="button">
          {t('common.refresh')}
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.key}
              type="button"
              onClick={() => setTab(tabItem.key)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-medium transition ${
                tab === tabItem.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tabItem.label}
              <span className={`rounded px-1 text-[10px] font-bold ${tab === tabItem.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{tabItem.sub}</span>
            </button>
          ))}
        </div>
        <input autoComplete="off" className="input w-80" onChange={(event) => setFilter(event.target.value)} placeholder={t('movements.search')} value={filter} />
      </div>

      <DataTable columns={columns} data={rows} emptyLabel={t('fgJournals.empty')} globalFilter={filter} isLoading={isLoading} />
    </div>
  )
}
