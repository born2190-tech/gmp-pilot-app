import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { listQaLots, listQcLots, sampleLot, submitQaDecision, submitQcResult } from '../../lib/api'
import { DataTable } from '../../components/table/DataTable'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { LotItem } from '../../types/inventory'

interface QualityBoardPageProps {
  mode: 'qc' | 'qa'
  token: string
  user: CurrentUser
}

function formatDate(value: string | null, locale: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function QualityBoardPage({ mode, token, user }: QualityBoardPageProps) {
  const { locale, t } = useI18n()
  const [lots, setLots] = useState<LotItem[]>([])
  const [selectedLotId, setSelectedLotId] = useState('')
  const [filter, setFilter] = useState('')
  const [password, setPassword] = useState('')
  const [summary, setSummary] = useState('')
  const [reason, setReason] = useState(mode === 'qc' ? t('quality.sampleReason') : t('quality.releaseReason'))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadLots() {
    setIsLoading(true)
    try {
      const response = mode === 'qc' ? await listQcLots(token) : await listQaLots(token)
      setLots(response.lots)
      setSelectedLotId((current) => current || response.lots[0]?.id || '')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quality.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadLots()
  }, [mode, token])

  const selectedLot = lots.find((lot) => lot.id === selectedLotId)

  async function runAction(action: 'sample' | 'qc-result' | 'release' | 'reject') {
    if (!selectedLot) return
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      if (action === 'sample') {
        await sampleLot(token, selectedLot.id, { reason: reason || t('quality.sampleReason') })
        setSuccess(t('quality.sampled'))
      } else if (action === 'qc-result') {
        await submitQcResult(token, selectedLot.id, {
          username: user.username,
          password,
          meaning: t('quality.resultMeaning'),
          reason: reason || t('quality.resultReason'),
          result_summary: summary,
        })
        setSuccess(t('quality.resultSubmitted'))
      } else {
        await submitQaDecision(token, selectedLot.id, {
          username: user.username,
          password,
          meaning: t('quality.decisionMeaning'),
          reason: reason || (action === 'release' ? t('quality.releaseReason') : t('quality.rejectReason')),
          decision: action === 'release' ? 'released' : 'rejected',
        })
        setSuccess(t('quality.decisionSubmitted'))
      }
      setPassword('')
      setSummary('')
      await loadLots()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quality.actionFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const columns = useMemo<ColumnDef<LotItem, unknown>[]>(
    () => [
      {
        id: 'select',
        header: '',
        cell: ({ row }) => (
          <input
            checked={selectedLotId === row.original.id}
            onChange={() => setSelectedLotId(row.original.id)}
            type="radio"
          />
        ),
      },
      { accessorKey: 'internal_lot', header: t('lots.internalSeries') },
      { accessorKey: 'material_code', header: t('lots.material') },
      { accessorKey: 'manufacturer_name', header: t('lots.manufacturer') },
      {
        accessorKey: 'quality_status',
        header: t('common.status'),
        cell: ({ row }) => <StatusBadge status={row.original.quality_status} />,
      },
      { accessorKey: 'incoming_control_notified_at', header: t('lots.qcNotified'), cell: ({ row }) => formatDate(row.original.incoming_control_notified_at, locale) },
      { accessorKey: 'sampling_date', header: t('quality.sample'), cell: ({ row }) => formatDate(row.original.sampling_date, locale) },
      { accessorKey: 'qc_result_received_at', header: t('lots.qcResult'), cell: ({ row }) => formatDate(row.original.qc_result_received_at, locale) },
      { accessorKey: 'expiry_date', header: t('lots.expiry'), cell: ({ row }) => formatDate(row.original.expiry_date, locale) },
    ],
    [locale, selectedLotId, t],
  )

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{mode === 'qc' ? t('quality.incomingControl') : t('quality.qaReview')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{mode === 'qc' ? t('quality.qcBoard') : t('quality.qaBoard')}</h1>
        </div>
        <input className="input w-80" onChange={(event) => setFilter(event.target.value)} placeholder={t('lots.search')} value={filter} />
      </div>

      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      <DataTable columns={columns} data={lots} emptyLabel={mode === 'qc' ? t('quality.qcEmpty') : t('quality.qaEmpty')} globalFilter={filter} isLoading={isLoading} />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 xl:grid-cols-4">
        <label className="block text-sm font-medium text-slate-700 xl:col-span-2">
          {t('common.reason')}
          <input className="input mt-1" onChange={(event) => setReason(event.target.value)} value={reason} />
        </label>
        {mode === 'qc' && (
          <label className="block text-sm font-medium text-slate-700 xl:col-span-2">
            {t('quality.resultSummary')}
            <input className="input mt-1" onChange={(event) => setSummary(event.target.value)} value={summary} />
          </label>
        )}
        <label className="block text-sm font-medium text-slate-700">
          {t('quality.signaturePassword')}
          <input className="input mt-1" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label>
        <div className="flex flex-wrap items-end gap-2 xl:col-span-3">
          {mode === 'qc' ? (
            <>
              <Button disabled={isLoading || !selectedLot || selectedLot.quality_status !== 'quarantine'} onClick={() => runAction('sample')} type="button">
                {t('quality.sample')}
              </Button>
              <Button disabled={isLoading || !selectedLot || selectedLot.quality_status === 'quarantine' || !password || !summary} onClick={() => runAction('qc-result')} type="button">
                {t('quality.submitResult')}
              </Button>
            </>
          ) : (
            <>
              <Button disabled={isLoading || !selectedLot || !password} onClick={() => runAction('release')} type="button">
                {t('quality.release')}
              </Button>
              <Button disabled={isLoading || !selectedLot || !password} onClick={() => runAction('reject')} type="button" variant="secondary">
                {t('quality.reject')}
              </Button>
            </>
          )}
          <Button disabled={isLoading} onClick={() => loadLots()} type="button" variant="secondary">
            {t('common.refresh')}
          </Button>
        </div>
      </div>
    </section>
  )
}
