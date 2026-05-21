import { useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardSignature,
  FileScan,
  FlaskConical,
  Inbox,
} from 'lucide-react'
import { createQcReport, listQaLots, listQcLots, listSamplingActs, submitQaDecision, submitQcReport } from '../../lib/api'
import { DataTable } from '../../components/table/DataTable'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { LotItem, QCReportItem, QCReportParameterCreate, SamplingActItem } from '../../types/inventory'
import { SamplingActPanel } from './SamplingActPanel'

type Phase = 'AWAITING_SAMPLING' | 'DRAFT' | 'SCAN_UPLOADED' | 'SAMPLING_VERIFIED' | 'RESULT_READY'

const PHASE_ORDER: Phase[] = ['AWAITING_SAMPLING', 'DRAFT', 'SCAN_UPLOADED', 'SAMPLING_VERIFIED', 'RESULT_READY']

function phaseOf(lot: LotItem, act: SamplingActItem | undefined): Phase {
  if (lot.qc_result_received_at) return 'RESULT_READY'
  if (act?.status === 'verified') return 'SAMPLING_VERIFIED'
  if (act?.status === 'scan_uploaded') return 'SCAN_UPLOADED'
  if (act?.status === 'draft') return 'DRAFT'
  return 'AWAITING_SAMPLING'
}

function daysSince(value: string | null): number | null {
  if (!value) return null
  const diff = Date.now() - new Date(value).getTime()
  return Math.floor(diff / 86_400_000)
}

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
  const [acts, setActs] = useState<SamplingActItem[]>([])
  const [phaseFilter, setPhaseFilter] = useState<Phase | null>(null)
  const [selectedLotId, setSelectedLotId] = useState('')
  const [filter, setFilter] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
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
      if (mode === 'qc') {
        const actsResp = await listSamplingActs(token)
        setActs(actsResp.sampling_acts)
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quality.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const actByLot = useMemo(() => {
    const map = new Map<string, SamplingActItem>()
    for (const a of acts) if (a.status !== 'cancelled') map.set(a.lot_id, a)
    return map
  }, [acts])

  function selectAndScroll(lotId: string) {
    setSelectedLotId(lotId)
    window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
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

  async function runAction(action: 'create-report' | 'submit-report' | 'release' | 'reject') {
    if (!selectedLot) return
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      if (action === 'create-report') {
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

  // ── QC dashboard derived data ────────────────────────────────────────────
  const lotPhases = useMemo(() => {
    const m = new Map<string, Phase>()
    for (const lot of lots) m.set(lot.id, phaseOf(lot, actByLot.get(lot.id)))
    return m
  }, [lots, actByLot])

  const kpi = useMemo(() => {
    const c = { AWAITING_SAMPLING: 0, DRAFT: 0, SCAN_UPLOADED: 0, SAMPLING_VERIFIED: 0, RESULT_READY: 0, overdue: 0 }
    for (const lot of lots) {
      const ph = lotPhases.get(lot.id)!
      c[ph] += 1
      if (ph === 'SAMPLING_VERIFIED') {
        const d = daysSince(lot.sampling_date)
        if (d !== null && d > 5) c.overdue += 1
      }
    }
    return c
  }, [lots, lotPhases])

  const filteredQcLots = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return lots.filter((lot) => {
      if (phaseFilter && lotPhases.get(lot.id) !== phaseFilter) return false
      if (!q) return true
      return (
        lot.material_name.toLowerCase().includes(q) ||
        lot.material_code.toLowerCase().includes(q) ||
        lot.internal_lot.toLowerCase().includes(q) ||
        (lot.supplier_lot || '').toLowerCase().includes(q) ||
        lot.manufacturer_name.toLowerCase().includes(q)
      )
    })
  }, [lots, filter, phaseFilter, lotPhases])

  const groupedQc = useMemo(() => {
    const groups = new Map<Phase, LotItem[]>()
    for (const lot of filteredQcLots) {
      const ph = lotPhases.get(lot.id)!
      if (!groups.has(ph)) groups.set(ph, [])
      groups.get(ph)!.push(lot)
    }
    return PHASE_ORDER.filter((p) => groups.has(p)).map((p) => ({ phase: p, lots: groups.get(p)! }))
  }, [filteredQcLots, lotPhases])

  if (mode === 'qc') {
    return (
      <section className="space-y-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{t('quality.incomingControl')}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">{t('quality.qcBoard')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t('qc.dashboardSubtitle')}</p>
        </div>

        {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiTile icon={Inbox} accent="bg-slate-100 text-slate-700" label={t('qc.kpi.newNotifications')} sub={t('qc.kpi.newNotificationsSub')} value={kpi.AWAITING_SAMPLING} active={phaseFilter === 'AWAITING_SAMPLING'} onClick={() => setPhaseFilter((p) => (p === 'AWAITING_SAMPLING' ? null : 'AWAITING_SAMPLING'))} />
          <KpiTile icon={ClipboardSignature} accent="bg-amber-50 text-amber-700" label={t('qc.kpi.awaitingSampling')} sub={t('qc.kpi.awaitingSamplingSub')} value={kpi.DRAFT} active={phaseFilter === 'DRAFT'} onClick={() => setPhaseFilter((p) => (p === 'DRAFT' ? null : 'DRAFT'))} />
          <KpiTile icon={FileScan} accent="bg-sky-50 text-sky-700" label={t('qc.kpi.scanUploaded')} sub={t('qc.kpi.scanUploadedSub')} value={kpi.SCAN_UPLOADED} active={phaseFilter === 'SCAN_UPLOADED'} onClick={() => setPhaseFilter((p) => (p === 'SCAN_UPLOADED' ? null : 'SCAN_UPLOADED'))} />
          <KpiTile icon={FlaskConical} accent="bg-violet-50 text-violet-700" label={t('qc.kpi.inAnalysis')} sub={t('qc.kpi.inAnalysisSub')} value={kpi.SAMPLING_VERIFIED} active={phaseFilter === 'SAMPLING_VERIFIED'} onClick={() => setPhaseFilter((p) => (p === 'SAMPLING_VERIFIED' ? null : 'SAMPLING_VERIFIED'))} />
          <KpiTile icon={CheckCircle2} accent="bg-emerald-50 text-emerald-700" label={t('qc.kpi.resultReady')} sub={t('qc.kpi.resultReadySub')} value={kpi.RESULT_READY} active={phaseFilter === 'RESULT_READY'} onClick={() => setPhaseFilter((p) => (p === 'RESULT_READY' ? null : 'RESULT_READY'))} />
          <KpiTile icon={AlertTriangle} accent="bg-rose-50 text-rose-700" label={t('qc.kpi.overdue')} sub={t('qc.kpi.overdueSub')} value={kpi.overdue} />
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60" onChange={(event) => setFilter(event.target.value)} placeholder={t('lots.search')} value={filter} />
          {phaseFilter && (
            <button type="button" onClick={() => setPhaseFilter(null)} className="whitespace-nowrap rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
              {t('registry.resetFilters')}
            </button>
          )}
        </div>

        {/* Task cards grouped by phase */}
        {groupedQc.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-16">
            <Inbox size={26} className="text-slate-300" />
            <p className="text-sm font-medium text-slate-700">{t('qc.emptyTasks')}</p>
          </div>
        ) : (
          groupedQc.map((group) => (
            <div key={group.phase} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className={`h-1.5 w-1.5 rounded-full ${PHASE_DOT[group.phase]}`} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t(SECTION_KEY[group.phase] as never)}</span>
                <span className="text-[11px] font-medium text-slate-400">· {group.lots.length}</span>
              </div>
              <div className="space-y-2">
                {group.lots.map((lot) => (
                  <QcTaskCard
                    key={lot.id}
                    lot={lot}
                    act={actByLot.get(lot.id)}
                    phase={lotPhases.get(lot.id)!}
                    selected={selectedLotId === lot.id}
                    locale={locale}
                    t={t}
                    onAction={() => selectAndScroll(lot.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}

        {selectedLot && (
          <div ref={panelRef}>
            <SamplingActPanel token={token} user={user} lot={selectedLot} onVerified={() => void loadLots()} />
          </div>
        )}

        {/* QC report form — доступна только после подтверждения акта отбора */}
        {selectedLot && (lotPhases.get(selectedLot.id) === 'SAMPLING_VERIFIED' || lotPhases.get(selectedLot.id) === 'RESULT_READY') && (
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:grid-cols-4">
            <div className="xl:col-span-4">
              <h3 className="text-[14px] font-semibold text-slate-900">{t('quality.createReport')} · {t('quality.parameters')}</h3>
            </div>
            <label className="block text-sm font-medium text-slate-700 xl:col-span-2">
              {t('common.reason')}
              <input className="input mt-1" onChange={(event) => setReason(event.target.value)} value={reason} />
            </label>
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
                <h4 className="text-sm font-semibold text-slate-900">{t('quality.parameters')}</h4>
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
            <label className="block text-sm font-medium text-slate-700">
              {t('quality.signaturePassword')}
              <input className="input mt-1" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
            </label>
            <div className="flex flex-wrap items-end gap-2 xl:col-span-3">
              <Button disabled={isLoading || Boolean(draftReport)} onClick={() => runAction('create-report')} type="button">
                {t('quality.createReport')}
              </Button>
              <Button disabled={isLoading || !draftReport || !password} onClick={() => runAction('submit-report')} type="button">
                {t('quality.submitReport')}
              </Button>
              <Button disabled={isLoading} onClick={() => loadLots()} type="button" variant="secondary">
                {t('common.refresh')}
              </Button>
            </div>
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('quality.qaReview')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('quality.qaBoard')}</h1>
        </div>
        <input className="input w-80" onChange={(event) => setFilter(event.target.value)} placeholder={t('lots.search')} value={filter} />
      </div>

      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      <DataTable columns={columns} data={lots} emptyLabel={t('quality.qaEmpty')} globalFilter={filter} isLoading={isLoading} />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 xl:grid-cols-4">
        <label className="block text-sm font-medium text-slate-700 xl:col-span-2">
          {t('common.reason')}
          <input className="input mt-1" onChange={(event) => setReason(event.target.value)} value={reason} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {t('quality.signaturePassword')}
          <input className="input mt-1" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label>
        <div className="flex flex-wrap items-end gap-2 xl:col-span-3">
          <Button disabled={isLoading || !selectedLot || !password} onClick={() => runAction('release')} type="button">
            {t('quality.release')}
          </Button>
          <Button disabled={isLoading || !selectedLot || !password} onClick={() => runAction('reject')} type="button" variant="secondary">
            {t('quality.reject')}
          </Button>
          <Button disabled={isLoading} onClick={() => loadLots()} type="button" variant="secondary">
            {t('common.refresh')}
          </Button>
        </div>
      </div>
    </section>
  )
}

// ─── QC dashboard helpers ────────────────────────────────────────────────────

const PHASE_DOT: Record<Phase, string> = {
  AWAITING_SAMPLING: 'bg-slate-400',
  DRAFT: 'bg-amber-500',
  SCAN_UPLOADED: 'bg-sky-500',
  SAMPLING_VERIFIED: 'bg-violet-500',
  RESULT_READY: 'bg-emerald-500',
}

const SECTION_KEY: Record<Phase, string> = {
  AWAITING_SAMPLING: 'qc.section.awaiting',
  DRAFT: 'qc.section.draft',
  SCAN_UPLOADED: 'qc.section.scan',
  SAMPLING_VERIFIED: 'qc.section.analysis',
  RESULT_READY: 'qc.section.result',
}

// Индекс текущей фазы для прогресс-полосы (4 шага: извещено→отобрано→анализ→результат)
const PHASE_PROGRESS: Record<Phase, number> = {
  AWAITING_SAMPLING: 0,
  DRAFT: 0,
  SCAN_UPLOADED: 1,
  SAMPLING_VERIFIED: 2,
  RESULT_READY: 3,
}

function KpiTile({
  icon: Icon,
  accent,
  label,
  sub,
  value,
  active,
  onClick,
}: {
  icon: typeof Inbox
  accent: string
  label: string
  sub: string
  value: number
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex flex-col items-start gap-1 rounded-xl border bg-white p-3 text-left transition ${
        active ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'
      } ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <span className={`grid h-8 w-8 place-items-center rounded-md ${accent}`}>
        <Icon size={16} />
      </span>
      <span className="mt-1 font-mono text-[22px] font-semibold tabular-nums leading-none text-slate-950">{value}</span>
      <span className="text-[12px] font-medium text-slate-800">{label}</span>
      <span className="text-[10.5px] text-slate-500">{sub}</span>
    </button>
  )
}

type Translate = ReturnType<typeof useI18n>['t']

function QcTaskCard({
  lot,
  act,
  phase,
  selected,
  locale,
  t,
  onAction,
}: {
  lot: LotItem
  act: SamplingActItem | undefined
  phase: Phase
  selected: boolean
  locale: string
  t: Translate
  onAction: () => void
}) {
  const days = daysSince(lot.incoming_control_notified_at)
  const overdue = phase === 'SAMPLING_VERIFIED' && (daysSince(lot.sampling_date) ?? 0) > 5
  const sopForm = lot.warehouse_type === 'FG_WAREHOUSE' ? '548' : '533'
  const progress = PHASE_PROGRESS[phase]
  const phaseSteps = [t('qc.phase.notified'), t('qc.phase.sampled'), t('qc.phase.analyzed'), t('qc.phase.result')]

  const CTA: Record<Phase, { label: string; cls: string; disabled?: boolean }> = {
    AWAITING_SAMPLING: { label: t('qc.card.createAct'), cls: 'bg-slate-900 text-white hover:bg-slate-800' },
    DRAFT: { label: t('qc.card.openAct'), cls: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50' },
    SCAN_UPLOADED: { label: t('qc.card.confirmAct'), cls: 'bg-emerald-700 text-white hover:bg-emerald-800' },
    SAMPLING_VERIFIED: { label: t('qc.card.enterResult'), cls: 'bg-violet-700 text-white hover:bg-violet-800' },
    RESULT_READY: { label: t('qc.card.sentToQa'), cls: 'border border-slate-200 bg-slate-50 text-slate-400 cursor-default', disabled: true },
  }
  const cta = CTA[phase]

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition ${selected ? 'border-slate-900 ring-1 ring-slate-900/10' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start gap-4">
        {/* Left: identity */}
        <div className="min-w-[220px] flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-medium ${sopForm === '548' ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-700'}`}>
              СОП-{sopForm} Ф-10
            </span>
            <span className="text-[10.5px] uppercase tracking-wider text-slate-400">
              {lot.warehouse_type === 'FG_WAREHOUSE' ? t('role.scope.FG_WAREHOUSE') : lot.warehouse_type === 'PACKAGING_WAREHOUSE' ? t('role.scope.PACKAGING_WAREHOUSE') : t('role.scope.SUBSTANCE_WAREHOUSE')}
            </span>
          </div>
          <h4 className="text-[15px] font-semibold tracking-tight text-slate-950">{lot.material_name}</h4>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-slate-600">
            <span>код: <span className="text-slate-900">{lot.material_code}</span></span>
            <span>серия: <span className="font-semibold text-slate-900">{lot.internal_lot}</span></span>
            <span>{lot.manufacturer_name}</span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500">
            {lot.quantity.toLocaleString(locale)} {lot.unit}
            {act && <span> · акт {act.act_no}</span>}
          </div>
        </div>

        {/* Middle: progress */}
        <div className="min-w-[200px] flex-1">
          <div className="flex items-center gap-1.5">
            {phaseSteps.map((step, i) => (
              <div key={step} className="flex-1">
                <div className={`h-1.5 rounded-full ${i <= progress ? (i === progress ? 'bg-cyan-500' : 'bg-emerald-500') : 'bg-slate-200'}`} />
                <div className={`mt-1 text-[9.5px] uppercase tracking-wide ${i <= progress ? 'text-slate-700' : 'text-slate-400'}`}>{step}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: meta + CTA */}
        <div className="flex flex-col items-end gap-2">
          <div className="text-right">
            {overdue ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10.5px] font-medium text-rose-700">
                <AlertTriangle size={11} /> SLA &gt; 5 дн.
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">
                {days === 0 ? t('qc.card.today') : t('qc.card.daysAgo', { n: String(days ?? 0) })}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onAction}
            disabled={cta.disabled}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium transition ${cta.cls}`}
          >
            <ClipboardSignature size={15} />
            {cta.label}
          </button>
        </div>
      </div>
    </div>
  )
}
