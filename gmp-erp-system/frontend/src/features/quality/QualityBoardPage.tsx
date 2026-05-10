import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { createQcReport, listQaLots, listQcLots, sampleLot, submitQaDecision, submitQcReport } from '../../lib/api'
import { DataTable } from '../../components/table/DataTable'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { LotItem, QCReportItem, QCReportParameterCreate } from '../../types/inventory'

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
  const [reportNo, setReportNo] = useState(`QC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-001`)
  const [methodReference, setMethodReference] = useState('')
  const [analysisStartedAt, setAnalysisStartedAt] = useState('')
  const [analysisFinishedAt, setAnalysisFinishedAt] = useState('')
  const [parameters, setParameters] = useState<QCReportParameterCreate[]>([
    { parameter_name: '', specification: '', result_value: '', unit: '', method_reference: '', complies: true },
  ])
  const [draftReport, setDraftReport] = useState<QCReportItem | null>(null)
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

  function updateParameter(index: number, patch: Partial<QCReportParameterCreate>) {
    setParameters((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)))
  }

  function addParameter() {
    setParameters((current) => [...current, { parameter_name: '', specification: '', result_value: '', unit: '', method_reference: methodReference, complies: true }])
  }

  async function runAction(action: 'sample' | 'create-report' | 'submit-report' | 'release' | 'reject') {
    if (!selectedLot) return
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      if (action === 'sample') {
        await sampleLot(token, selectedLot.id, { reason: reason || t('quality.sampleReason') })
        setSuccess(t('quality.sampled'))
      } else if (action === 'create-report') {
        const report = await createQcReport(token, {
          lot_id: selectedLot.id,
          report_no: reportNo,
          analysis_started_at: analysisStartedAt ? new Date(analysisStartedAt).toISOString() : null,
          analysis_finished_at: analysisFinishedAt ? new Date(analysisFinishedAt).toISOString() : null,
          method_reference: methodReference || null,
          parameters: parameters.map((parameter) => ({
            ...parameter,
            unit: parameter.unit || null,
            method_reference: parameter.method_reference || methodReference || null,
          })),
        })
        setDraftReport(report)
        setSuccess(t('quality.reportCreated'))
      } else if (action === 'submit-report' && draftReport) {
        await submitQcReport(token, draftReport.id, {
          username: user.username,
          password,
          meaning: t('quality.resultMeaning'),
          reason: reason || t('quality.resultReason'),
        })
        setSuccess(t('quality.reportSubmitted'))
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
      if (action === 'submit-report') setDraftReport(null)
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
          <>
            <label className="block text-sm font-medium text-slate-700">
              {t('quality.reportNo')}
              <input className="input mt-1" onChange={(event) => setReportNo(event.target.value)} value={reportNo} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              {t('quality.methodReference')}
              <input className="input mt-1" onChange={(event) => setMethodReference(event.target.value)} value={methodReference} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              {t('quality.analysisStarted')}
              <input className="input mt-1" onChange={(event) => setAnalysisStartedAt(event.target.value)} type="datetime-local" value={analysisStartedAt} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              {t('quality.analysisFinished')}
              <input className="input mt-1" onChange={(event) => setAnalysisFinishedAt(event.target.value)} type="datetime-local" value={analysisFinishedAt} />
            </label>
            <div className="xl:col-span-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">{t('quality.parameters')}</h2>
                <Button onClick={addParameter} type="button" variant="secondary">{t('quality.addParameter')}</Button>
              </div>
              <div className="space-y-2">
                {parameters.map((parameter, index) => (
                  <div className="grid gap-2 rounded-md border border-slate-200 p-3 xl:grid-cols-6" key={index}>
                    <input className="input" onChange={(event) => updateParameter(index, { parameter_name: event.target.value })} placeholder={t('quality.parameterName')} value={parameter.parameter_name} />
                    <input className="input" onChange={(event) => updateParameter(index, { specification: event.target.value })} placeholder={t('quality.specification')} value={parameter.specification} />
                    <input className="input" onChange={(event) => updateParameter(index, { result_value: event.target.value })} placeholder={t('quality.resultValue')} value={parameter.result_value} />
                    <input className="input" onChange={(event) => updateParameter(index, { unit: event.target.value })} placeholder={t('common.unit')} value={parameter.unit ?? ''} />
                    <input className="input" onChange={(event) => updateParameter(index, { method_reference: event.target.value })} placeholder={t('quality.methodReference')} value={parameter.method_reference ?? ''} />
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input checked={parameter.complies} onChange={(event) => updateParameter(index, { complies: event.target.checked })} type="checkbox" />
                      {t('quality.complies')}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </>
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
              <Button disabled={isLoading || !selectedLot || selectedLot.quality_status === 'quarantine' || Boolean(draftReport)} onClick={() => runAction('create-report')} type="button">
                {t('quality.createReport')}
              </Button>
              <Button disabled={isLoading || !selectedLot || !draftReport || !password} onClick={() => runAction('submit-report')} type="button">
                {t('quality.submitReport')}
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
