import { useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  Boxes,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardSignature,
  Clock,
  Download,
  Eye,
  FileScan,
  FileText,
  Filter,
  FlaskConical,
  Gavel,
  Inbox,
  KeyRound,
  ListChecks,
  Lock,
  MapPin,
  Package,
  Search,
  ShieldCheck,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import {
  closeOos,
  downloadLotQcReportPdf,
  downloadLotQcReportScan,
  downloadQcReportScan,
  listOos,
  listQaLots,
  listQcLots,
  listQcReports,
  listSamplingActs,
  submitQaDecision,
  updateOos,
  uploadQcReportScan,
} from '../../lib/api'
import { DataTable } from '../../components/table/DataTable'
import { ScanButton } from '../../components/ui/ScanButton'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { LotItem, OOSItem, QcReportListItem, SamplingActItem } from '../../types/inventory'
import { SamplingActPanel } from './SamplingActPanel'
import { QcAnalysisWorkspace } from './QcAnalysisWorkspace'
import { QcPackagingWorkspace } from './QcPackagingWorkspace'

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
  const [reports, setReports] = useState<QcReportListItem[]>([])
  const [reportsModalOpen, setReportsModalOpen] = useState(false)
  const [oosList, setOosList] = useState<OOSItem[]>([])
  const [oosModalOpen, setOosModalOpen] = useState(false)
  const [phaseFilter, setPhaseFilter] = useState<Phase | null>(null)
  const [collapsedPhases, setCollapsedPhases] = useState<Set<Phase>>(new Set())
  const [selectedLotId, setSelectedLotId] = useState('')
  const [filter, setFilter] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState(mode === 'qc' ? t('quality.sampleReason') : t('quality.releaseReason'))
  const [qaQueueFilter, setQaQueueFilter] = useState<'pending' | 'released' | 'rejected' | 'oos'>('pending')
  const [qaWarehouseFilter, setQaWarehouseFilter] = useState<'all' | 'SUBSTANCE_WAREHOUSE' | 'PACKAGING_WAREHOUSE' | 'FG_WAREHOUSE'>('all')
  const [qaUrgencyFilter, setQaUrgencyFilter] = useState<'all' | 'urgent'>('all')
  const [qaAction, setQaAction] = useState<'release' | 'reject' | null>(null)
  const [confirmDecision, setConfirmDecision] = useState(false)
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
        const [actsResp, reportsResp, oosResp] = await Promise.all([listSamplingActs(token), listQcReports(token), listOos(token)])
        setActs(actsResp.sampling_acts)
        setReports(reportsResp.reports)
        setOosList(oosResp.investigations)
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
    setQaAction(null)
    setConfirmDecision(false)
    setPassword('')
    window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  useEffect(() => {
    void loadLots()
  }, [mode, token])

  const selectedLot = lots.find((lot) => lot.id === selectedLotId)

  async function runAction(action: 'release' | 'reject') {
    if (!selectedLot) return
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      await submitQaDecision(token, selectedLot.id, {
        username: user.username,
        password,
        meaning: t('quality.decisionMeaning'),
        reason: reason || (action === 'release' ? t('quality.releaseReason') : t('quality.rejectReason')),
        decision: action === 'release' ? 'released' : 'rejected',
      })
      setSuccess(t('quality.decisionSubmitted'))
      setPassword('')
      setQaAction(null)
      setConfirmDecision(false)
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

  const qaKpi = useMemo(() => ({
    pending: lots.filter((lot) => lot.quality_status === 'under_test' && lot.qc_result_received_at).length,
    released: lots.filter((lot) => lot.quality_status === 'released').length,
    rejected: lots.filter((lot) => lot.quality_status === 'rejected').length,
    oos: 0,
  }), [lots])

  const qaFilteredLots = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const base = lots.filter((lot) => {
      if (qaQueueFilter === 'released') return lot.quality_status === 'released'
      if (qaQueueFilter === 'rejected') return lot.quality_status === 'rejected'
      if (qaQueueFilter === 'oos') return false
      return lot.quality_status === 'under_test' && Boolean(lot.qc_result_received_at)
    })
    return base
      .filter((lot) => {
        if (qaWarehouseFilter !== 'all' && lot.warehouse_type !== qaWarehouseFilter) return false
        if (qaUrgencyFilter === 'urgent' && (daysSince(lot.qc_result_received_at) ?? 0) <= 3) return false
        if (!q) return true
        return `${lot.internal_lot} ${lot.supplier_lot} ${lot.material_code} ${lot.material_name} ${lot.manufacturer_name}`.toLowerCase().includes(q)
      })
      .sort((a, b) => new Date(a.qc_result_received_at || 0).getTime() - new Date(b.qc_result_received_at || 0).getTime())
  }, [filter, lots, qaQueueFilter, qaUrgencyFilter, qaWarehouseFilter])

  async function openQaReportPdf(lotId: string) {
    setError(null)
    try {
      const blob = await downloadLotQcReportPdf(token, lotId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('registry.qcReportDownloadFailed'))
    }
  }

  // Скан подписанного Ф-11 — ДОК должен видеть именно верифицированный документ.
  async function openQaReportScan(lotId: string) {
    setError(null)
    try {
      const blob = await downloadLotQcReportScan(token, lotId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qaBoard.scanUnavailable'))
    }
  }

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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
          <KpiTile icon={Inbox} accent="bg-slate-100 text-slate-700" label={t('qc.kpi.newNotifications')} sub={t('qc.kpi.newNotificationsSub')} value={kpi.AWAITING_SAMPLING} active={phaseFilter === 'AWAITING_SAMPLING'} onClick={() => setPhaseFilter((p) => (p === 'AWAITING_SAMPLING' ? null : 'AWAITING_SAMPLING'))} />
          <KpiTile icon={ClipboardSignature} accent="bg-amber-50 text-amber-700" label={t('qc.kpi.awaitingSampling')} sub={t('qc.kpi.awaitingSamplingSub')} value={kpi.DRAFT} active={phaseFilter === 'DRAFT'} onClick={() => setPhaseFilter((p) => (p === 'DRAFT' ? null : 'DRAFT'))} />
          <KpiTile icon={FileScan} accent="bg-sky-50 text-sky-700" label={t('qc.kpi.scanUploaded')} sub={t('qc.kpi.scanUploadedSub')} value={kpi.SCAN_UPLOADED} active={phaseFilter === 'SCAN_UPLOADED'} onClick={() => setPhaseFilter((p) => (p === 'SCAN_UPLOADED' ? null : 'SCAN_UPLOADED'))} />
          <KpiTile icon={FlaskConical} accent="bg-violet-50 text-violet-700" label={t('qc.kpi.inAnalysis')} sub={t('qc.kpi.inAnalysisSub')} value={kpi.SAMPLING_VERIFIED} active={phaseFilter === 'SAMPLING_VERIFIED'} onClick={() => setPhaseFilter((p) => (p === 'SAMPLING_VERIFIED' ? null : 'SAMPLING_VERIFIED'))} />
          <KpiTile icon={CheckCircle2} accent="bg-emerald-50 text-emerald-700" label={t('qc.kpi.resultReady')} sub={t('qc.kpi.resultReadySub')} value={kpi.RESULT_READY} active={phaseFilter === 'RESULT_READY'} onClick={() => setPhaseFilter((p) => (p === 'RESULT_READY' ? null : 'RESULT_READY'))} />
          <KpiTile icon={FileText} accent="bg-blue-50 text-blue-700" label={t('qc.kpi.analyticalSheets')} sub={t('qc.kpi.analyticalSheetsSub')} value={reports.length} onClick={() => setReportsModalOpen(true)} />
          <KpiTile icon={AlertTriangle} accent="bg-rose-50 text-rose-700" label={t('qc.kpi.oos')} sub={t('qc.kpi.oosSub')} value={oosList.filter((o) => o.status !== 'closed').length} onClick={() => setOosModalOpen(true)} />
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
          groupedQc.map((group) => {
            const collapsed = collapsedPhases.has(group.phase)
            return (
            <div key={group.phase} className="space-y-2">
              <button
                type="button"
                onClick={() =>
                  setCollapsedPhases((prev) => {
                    const next = new Set(prev)
                    if (next.has(group.phase)) next.delete(group.phase)
                    else next.add(group.phase)
                    return next
                  })
                }
                className="flex w-full items-center gap-2 px-1 text-left"
              >
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${PHASE_DOT[group.phase]}`} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t(SECTION_KEY[group.phase] as never)}</span>
                <span className="text-[11px] font-medium text-slate-400">· {group.lots.length}</span>
                <span className="ml-auto text-[11px] font-medium text-slate-400">
                  {collapsed ? t('common.expand') : t('common.collapse')}
                </span>
              </button>
              {!collapsed && (
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
              )}
            </div>
            )
          })
        )}

        {selectedLot && (
          <div ref={panelRef}>
            <SamplingActPanel key={selectedLot.id} token={token} user={user} lot={selectedLot} onVerified={() => void loadLots()} />
          </div>
        )}

        {/* Аналитический лист — рабочее место ОКК (после подтверждения акта отбора) */}
        {selectedLot && (lotPhases.get(selectedLot.id) === 'SAMPLING_VERIFIED' || lotPhases.get(selectedLot.id) === 'RESULT_READY') && (
          selectedLot.warehouse_type === 'PACKAGING_WAREHOUSE' ? (
            <QcPackagingWorkspace
              key={selectedLot.id}
              token={token}
              user={user}
              lot={selectedLot}
              onSubmitted={() => void loadLots()}
            />
          ) : (
            <QcAnalysisWorkspace
              key={selectedLot.id}
              token={token}
              user={user}
              lot={selectedLot}
              onSubmitted={() => void loadLots()}
            />
          )
        )}

        {reportsModalOpen && (
          <QcReportsModal token={token} reports={reports} locale={locale} t={t} onReload={loadLots} onClose={() => setReportsModalOpen(false)} />
        )}

        {oosModalOpen && (
          <OosModal token={token} user={user} investigations={oosList} locale={locale} t={t} onReload={loadLots} onClose={() => setOosModalOpen(false)} />
        )}
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{t('qaBoard.eyebrow')}</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-slate-900">{t('qaBoard.title')}</h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-slate-500">
            {t('qaBoard.subtitle')}
          </p>
        </div>
      </div>

      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4 xl:col-span-3">
          <QaQueuePanel
            lots={qaFilteredLots}
            kpi={qaKpi}
            loading={isLoading}
            selectedId={selectedLotId}
            query={filter}
            queueFilter={qaQueueFilter}
            warehouseFilter={qaWarehouseFilter}
            urgencyFilter={qaUrgencyFilter}
            onQuery={setFilter}
            onQueueFilter={setQaQueueFilter}
            onWarehouseFilter={setQaWarehouseFilter}
            onUrgencyFilter={setQaUrgencyFilter}
            onSelect={selectAndScroll}
          />
        </div>
        <div className="lg:col-span-8 xl:col-span-9" ref={panelRef}>
          {isLoading ? (
            <QaDecisionSkeleton />
          ) : selectedLot ? (
            <QaDecisionCard
              lot={selectedLot}
              action={qaAction}
              reason={reason}
              password={password}
              confirmOpen={confirmDecision}
              isLoading={isLoading}
              canDecide={user.permissions.includes('QA_DECISION')}
              onAction={(action) => {
                setQaAction(action)
                setReason(action === 'release' ? t('quality.releaseReason') : t('quality.rejectReason'))
                setPassword('')
                setConfirmDecision(false)
              }}
              onCancelAction={() => {
                setQaAction(null)
                setConfirmDecision(false)
                setPassword('')
              }}
              onReason={setReason}
              onPassword={setPassword}
              onConfirmOpen={setConfirmDecision}
              onRunAction={runAction}
              onOpenReport={() => void openQaReportPdf(selectedLot.id)}
              onOpenScan={() => void openQaReportScan(selectedLot.id)}
            />
          ) : (
            <QaCard className="flex min-h-[640px] items-center justify-center">
              <QaEmptyState icon={Gavel} title={t('qaBoard.selectLot')} sub={t('qaBoard.selectLotSub')} />
            </QaCard>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── QA decisions workspace (B21 ERP design adaptation) ─────────────────────

type QaQueueFilter = 'pending' | 'released' | 'rejected' | 'oos'
type QaWarehouseFilter = 'all' | 'SUBSTANCE_WAREHOUSE' | 'PACKAGING_WAREHOUSE' | 'FG_WAREHOUSE'
type QaUrgencyFilter = 'all' | 'urgent'

function qaDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
}

function qaDateTime(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function qaQty(value: number) {
  return value === Math.trunc(value) ? String(Math.trunc(value)) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function qaWarehouseLabel(type: string, t: Translate) {
  if (type === 'FG_WAREHOUSE') return t('qaBoard.whFg')
  if (type === 'PACKAGING_WAREHOUSE') return t('qaBoard.whPackaging')
  return t('qaBoard.whSubstance')
}

function qaWarehouseShort(type: string) {
  if (type === 'FG_WAREHOUSE') return 'FG'
  if (type === 'PACKAGING_WAREHOUSE') return 'PACKAGING'
  return 'SUBSTANCE'
}

function qaStatusLabel(status: string, t: Translate) {
  if (status === 'released') return t('qaBoard.lotReleased')
  if (status === 'rejected') return t('qaBoard.lotRejected')
  if (status === 'under_test') return t('qaBoard.lotUnderTest')
  if (status === 'sampled') return t('qaBoard.lotSampled')
  return t('qaBoard.lotQuarantine')
}

function QaMetaLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500 ${className}`}>{children}</p>
}

function QaCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>{children}</section>
}

function QaPillButton({
  children,
  tone = 'neutral',
  icon: Icon,
  onClick,
  size = 'md',
  disabled,
  className = '',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'confirm' | 'danger' | 'dangerGhost'
  icon?: typeof Inbox
  onClick?: () => void
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  className?: string
}) {
  const tones = {
    neutral: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    confirm: 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-600',
    danger: 'border-rose-700 bg-rose-700 text-white hover:bg-rose-600',
    dangerGhost: 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50',
  }[tone]
  const sizes = { sm: 'h-7 px-2 text-[11.5px]', md: 'h-8 px-3 text-[12.5px]', lg: 'h-10 px-4 text-[13.5px]' }[size]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${tones} ${sizes} ${className}`}
    >
      {Icon && <Icon size={size === 'lg' ? 16 : 13} />}
      {children}
    </button>
  )
}

function QaQualityPill({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const { t } = useI18n()
  const map: Record<string, { cls: string; dot: string }> = {
    released: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' },
    rejected: { cls: 'border-rose-200 bg-rose-50 text-rose-800', dot: 'bg-rose-500' },
    under_test: { cls: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
    sampled: { cls: 'border-sky-200 bg-sky-50 text-sky-800', dot: 'bg-sky-500' },
  }
  const item = map[status] || { cls: 'border-slate-200 bg-slate-100 text-slate-600', dot: 'bg-slate-400' }
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[10.5px]' : 'px-2.5 py-0.5 text-[11.5px]'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${pad} ${item.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />
      {qaStatusLabel(status, t)}
    </span>
  )
}

function QaWarehousePill({ type, size = 'md' }: { type: string; size?: 'sm' | 'md' }) {
  const { t } = useI18n()
  const isFg = type === 'FG_WAREHOUSE'
  const isPack = type === 'PACKAGING_WAREHOUSE'
  const Icon = isFg ? Package : isPack ? Package : FlaskConical
  const cls = isFg
    ? 'border-violet-200 bg-violet-50 text-violet-700'
    : isPack
      ? 'border-sky-200 bg-sky-50 text-sky-700'
      : 'border-slate-200 bg-slate-50 text-slate-600'
  const pad = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
  return <span className={`inline-flex items-center gap-1 rounded-md border font-medium ${pad} ${cls}`}><Icon size={size === 'sm' ? 10 : 11} />{qaWarehouseLabel(type, t)}</span>
}

function QaSegmented<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`flex h-full items-center rounded px-2.5 text-[11px] font-medium transition ${
            value === option.value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function QaKpiTile({ label, value, icon: Icon, tone, active, onClick }: { label: string; value: number; icon: typeof Inbox; tone: 'amber' | 'emerald' | 'rose'; active: boolean; onClick: () => void }) {
  const tones = {
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
  }[tone]
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-2.5 rounded-lg border bg-white px-3 py-2 text-left transition ${active ? 'border-slate-900 ring-1 ring-slate-900/10' : 'border-slate-200 hover:border-slate-300'}`}>
      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${tones}`}><Icon size={15} /></span>
      <span className="min-w-0">
        <span className="block font-mono text-[17px] font-semibold leading-none tabular-nums text-slate-900">{value}</span>
        <span className="mt-0.5 block truncate text-[10.5px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      </span>
    </button>
  )
}

function QaQueuePanel({
  lots,
  kpi,
  loading,
  selectedId,
  query,
  queueFilter,
  warehouseFilter,
  urgencyFilter,
  onQuery,
  onQueueFilter,
  onWarehouseFilter,
  onUrgencyFilter,
  onSelect,
}: {
  lots: LotItem[]
  kpi: { pending: number; released: number; rejected: number; oos: number }
  loading: boolean
  selectedId: string
  query: string
  queueFilter: QaQueueFilter
  warehouseFilter: QaWarehouseFilter
  urgencyFilter: QaUrgencyFilter
  onQuery: (value: string) => void
  onQueueFilter: (value: QaQueueFilter) => void
  onWarehouseFilter: (value: QaWarehouseFilter) => void
  onUrgencyFilter: (value: QaUrgencyFilter) => void
  onSelect: (id: string) => void
}) {
  const { t } = useI18n()
  const hasFilters = Boolean(query) || warehouseFilter !== 'all' || urgencyFilter !== 'all'
  return (
    <QaCard className="flex h-[calc(100vh-188px)] min-h-[640px] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-700"><Gavel size={15} /></span>
        <div className="min-w-0 flex-1">
          <QaMetaLabel>{t('qaBoard.readyForRelease')}</QaMetaLabel>
          <h2 className="text-[14px] font-semibold tracking-tight text-slate-900">{t('qaBoard.decisionQueue')}</h2>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-slate-200 px-3 py-3">
        <QaKpiTile label={t('qaBoard.kpiPending')} value={kpi.pending} icon={Gavel} tone="amber" active={queueFilter === 'pending'} onClick={() => onQueueFilter('pending')} />
        <QaKpiTile label={t('qaBoard.kpiReleasedToday')} value={kpi.released} icon={ShieldCheck} tone="emerald" active={queueFilter === 'released'} onClick={() => onQueueFilter('released')} />
        <QaKpiTile label={t('qaBoard.kpiRejected')} value={kpi.rejected} icon={Ban} tone="rose" active={queueFilter === 'rejected'} onClick={() => onQueueFilter('rejected')} />
        <QaKpiTile label={t('qaBoard.kpiOos')} value={kpi.oos} icon={AlertTriangle} tone="rose" active={queueFilter === 'oos'} onClick={() => onQueueFilter('oos')} />
      </div>

      <div className="space-y-2.5 border-b border-slate-200 px-3 py-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t('qaBoard.searchPlaceholder')} className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-8 text-[12.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60" />
          {query && <button type="button" onClick={() => onQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={14} /></button>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"><Filter size={11} />{t('qaBoard.warehouse')}</span>
          <QaSegmented value={warehouseFilter} onChange={onWarehouseFilter} options={[
            { value: 'all', label: t('qaBoard.all') },
            { value: 'SUBSTANCE_WAREHOUSE', label: t('qaBoard.whSubstance') },
            { value: 'PACKAGING_WAREHOUSE', label: t('qaBoard.whPackaging') },
            { value: 'FG_WAREHOUSE', label: t('qaBoard.whFg') },
          ]} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"><Clock size={11} />{t('qaBoard.urgency')}</span>
          <QaSegmented value={urgencyFilter} onChange={onUrgencyFilter} options={[{ value: 'all', label: t('qaBoard.all') }, { value: 'urgent', label: t('qaBoard.urgent') }]} />
          {hasFilters && (
            <button type="button" onClick={() => { onQuery(''); onWarehouseFilter('all'); onUrgencyFilter('all') }} className="ml-auto text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">{t('qaBoard.reset')}</button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="space-y-2 px-1 py-1">{[0, 1, 2, 3].map((i) => <QaLotSkeleton key={i} />)}</div>
        ) : lots.length === 0 ? (
          <QaEmptyState icon={queueFilter === 'oos' ? AlertTriangle : Inbox} title={t('qaBoard.queueEmpty')} sub={hasFilters ? t('qaBoard.queueEmptyFiltered') : t('qaBoard.queueEmptyAll')} />
        ) : (
          <div className="space-y-1.5">
            {lots.map((lot) => <QaLotCard key={lot.id} lot={lot} selected={lot.id === selectedId} onSelect={() => onSelect(lot.id)} />)}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
        <span>{loading ? '...' : t('qaBoard.lotsCount', { n: lots.length })}</span>
        {warehouseFilter !== 'all' && <button type="button" onClick={() => onWarehouseFilter('all')} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">{qaWarehouseLabel(warehouseFilter, t)}<X size={11} /></button>}
      </div>
    </QaCard>
  )
}

function QaLotCard({ lot, selected, onSelect }: { lot: LotItem; selected: boolean; onSelect: () => void }) {
  const { t } = useI18n()
  const days = daysSince(lot.qc_result_received_at)
  const decided = lot.quality_status === 'released' || lot.quality_status === 'rejected'
  return (
    <button type="button" onClick={onSelect} className={`group block w-full rounded-lg border px-2.5 py-2.5 text-left transition ${selected ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900/10' : 'border-transparent hover:border-slate-200 hover:bg-slate-50/70'}`}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11.5px] font-semibold tabular-nums text-slate-800">{lot.internal_lot}</span>
        <span className="ml-auto"><QaQualityPill status={lot.quality_status} size="sm" /></span>
      </div>
      <p className={`mt-1 line-clamp-2 text-[13px] font-medium leading-snug ${decided ? 'text-slate-600' : 'text-slate-900'}`}>{lot.material_name}</p>
      <div className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] text-slate-400">
        <Building2 size={11} /><span className="truncate">{lot.manufacturer_name}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <QaWarehousePill type={lot.warehouse_type} size="sm" />
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"><FileText size={10} />{t('qaBoard.f11')}</span>
        <span className="ml-auto font-mono text-[10px] text-slate-400">
          {decided ? qaDate(lot.qa_decision_at) : days === 0 ? t('qaBoard.waitsToday') : t('qaBoard.waitsDays', { n: days ?? 0 })}
        </span>
      </div>
    </button>
  )
}

function QaDecisionCard({
  lot,
  action,
  reason,
  password,
  confirmOpen,
  isLoading,
  canDecide,
  onAction,
  onCancelAction,
  onReason,
  onPassword,
  onConfirmOpen,
  onRunAction,
  onOpenReport,
  onOpenScan,
}: {
  lot: LotItem
  action: 'release' | 'reject' | null
  reason: string
  password: string
  confirmOpen: boolean
  isLoading: boolean
  canDecide: boolean
  onAction: (action: 'release' | 'reject') => void
  onCancelAction: () => void
  onReason: (value: string) => void
  onPassword: (value: string) => void
  onConfirmOpen: (value: boolean) => void
  onRunAction: (action: 'release' | 'reject') => Promise<void>
  onOpenReport: () => void
  onOpenScan: () => void
}) {
  const { t } = useI18n()
  const decided = lot.quality_status === 'released' || lot.quality_status === 'rejected'
  const resultReady = Boolean(lot.qc_result_received_at)
  const canRelease = resultReady && !decided
  return (
    <div className="space-y-3">
      <QaCard className="overflow-hidden"><QaDecisionHeader lot={lot} /></QaCard>
      <QaRouteSection lot={lot} />
      <QaF11Block lot={lot} onOpenReport={onOpenReport} onOpenScan={onOpenScan} />
      {!decided && <QaGatesSection resultReady={resultReady} canRelease={canRelease} />}
      {decided ? <QaDecidedBlock lot={lot} /> : canDecide ? (
        <QaCard className="overflow-hidden">
          <QaSectionHead icon={Gavel} eyebrow={t('qaBoard.decisionCardEyebrow')} title={t('qaBoard.decisionCardTitle')} />
          {action === null ? (
            <div className="space-y-2 p-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <QaPillButton tone="confirm" icon={ShieldCheck} size="lg" disabled={!canRelease} onClick={() => onAction('release')} className="w-full">{t('qaBoard.release')}</QaPillButton>
                <QaPillButton tone="dangerGhost" icon={Ban} size="lg" onClick={() => onAction('reject')} className="w-full">{t('qaBoard.reject')}</QaPillButton>
              </div>
              {!canRelease && <p className="flex items-center gap-1.5 text-[11.5px] text-slate-500"><Lock size={12} className="text-slate-400" />{t('qaBoard.releaseBlocked')}</p>}
            </div>
          ) : (
            <div className={`border-t-2 p-4 ${action === 'release' ? 'border-emerald-500 bg-emerald-50/30' : 'border-rose-500 bg-rose-50/20'}`}>
              <div className="mb-3 flex items-center gap-2">
                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${action === 'release' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>{action === 'release' ? <ShieldCheck size={15} /> : <Ban size={15} />}</span>
                <p className="text-[13px] font-semibold text-slate-800">{action === 'release' ? t('qaBoard.release') : t('qaBoard.reject')} · {lot.internal_lot}</p>
                <button type="button" onClick={onCancelAction} className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700"><X size={15} /></button>
              </div>
              <div className="space-y-1">
                <QaMetaLabel>{action === 'release' ? t('qaBoard.releaseBasis') : t('qaBoard.rejectReasonLabel')}</QaMetaLabel>
                <textarea value={reason} onChange={(e) => onReason(e.target.value)} rows={3} placeholder={action === 'release' ? t('qaBoard.releaseReasonPh') : t('qaBoard.rejectReasonPh')} className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[12.5px] leading-relaxed text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60" />
              </div>
              <div className="mt-2.5 space-y-1">
                <QaMetaLabel>{t('qaBoard.eSignPassword')}</QaMetaLabel>
                <div className="relative">
                  <KeyRound size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="password" value={password} onChange={(e) => onPassword(e.target.value)} placeholder="••••••" className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 font-mono text-[13px] tracking-widest text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60" />
                </div>
                <p className="text-[10.5px] text-slate-400">{t('qaBoard.decisionAlcoa')}</p>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <QaPillButton tone="neutral" onClick={onCancelAction}>{t('common.cancel')}</QaPillButton>
                <QaPillButton tone={action === 'release' ? 'confirm' : 'danger'} icon={action === 'release' ? ShieldCheck : Ban} disabled={!reason.trim() || !password.trim() || isLoading} onClick={() => onConfirmOpen(true)}>
                  {t('qaBoard.sign')}
                </QaPillButton>
              </div>
            </div>
          )}
        </QaCard>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500"><Lock size={17} /></span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-700">{t('qaBoard.readOnly')}</p>
            <p className="text-[11.5px] text-slate-500">{t('qaBoard.readOnlySub')}</p>
          </div>
        </div>
      )}
      {confirmOpen && action && (
        <QaConfirmDialog
          action={action}
          lot={lot}
          onCancel={() => onConfirmOpen(false)}
          onConfirm={() => void onRunAction(action)}
        />
      )}
    </div>
  )
}

function QaDecisionHeader({ lot }: { lot: LotItem }) {
  const { t } = useI18n()
  const decided = lot.quality_status === 'released' || lot.quality_status === 'rejected'
  return (
    <div className="border-b border-slate-200 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">{lot.warehouse_type === 'FG_WAREHOUSE' ? <Package size={20} /> : <FlaskConical size={20} />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-semibold leading-tight tracking-tight text-slate-900">{lot.material_name}</h2>
            <QaQualityPill status={lot.quality_status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11.5px] text-slate-500">
            <span>{t('qaBoard.materialCode')}: <span className="text-slate-800">{lot.material_code}</span></span>
            <span>{t('qaBoard.lot')}: <span className="font-semibold text-slate-900">{lot.internal_lot}</span></span>
            {lot.supplier_lot && <span>{t('qaBoard.supplierLot')}: <span className="text-slate-700">{lot.supplier_lot}</span></span>}
          </div>
        </div>
        <QaWarehousePill type={lot.warehouse_type} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <QaField label={t('qaBoard.manufacturer')} value={lot.manufacturer_name} icon={Building2} className="col-span-2" />
        <QaField label={t('qaBoard.quantity')} value={`${qaQty(lot.quantity)} ${lot.unit}`} mono icon={Boxes} />
        <QaField label={decided ? t('qaBoard.releaseZone') : t('qaBoard.zone')} value={lot.location_code} mono icon={MapPin} />
        <QaField label={t('qaBoard.prodDate')} value={qaDate(lot.production_date)} mono icon={Calendar} />
        <QaField label={t('qaBoard.validUntil')} value={qaDate(lot.expiry_date)} mono icon={Calendar} />
        <QaField label={t('qaBoard.supplier')} value={lot.supplier_name} className="col-span-2" />
      </div>
    </div>
  )
}

function QaField({ label, value, mono, icon: Icon, className = '' }: { label: string; value: string | number | null; mono?: boolean; icon?: typeof Inbox; className?: string }) {
  return (
    <div className={`min-w-0 space-y-1 ${className}`}>
      <QaMetaLabel>{label}</QaMetaLabel>
      <p className={`flex items-center gap-1.5 text-[13px] leading-snug ${mono ? 'font-mono tabular-nums' : ''} text-slate-900`}>
        {Icon && <Icon size={13} className="shrink-0 text-slate-400" />}{value || '—'}
      </p>
    </div>
  )
}

function QaSectionHead({ icon: Icon, eyebrow, title, right }: { icon: typeof Inbox; eyebrow: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700"><Icon size={15} /></span>
      <div className="min-w-0 flex-1">
        <QaMetaLabel>{eyebrow}</QaMetaLabel>
        <h2 className="text-[14px] font-semibold tracking-tight text-slate-900">{title}</h2>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}

function QaRouteSection({ lot }: { lot: LotItem }) {
  const { t } = useI18n()
  const decided = lot.quality_status === 'released' || lot.quality_status === 'rejected'
  const steps = [
    { label: t('qaBoard.routeNotice'), sub: t('qaBoard.routeNoticeSub'), date: qaDate(lot.incoming_control_notified_at), state: 'done' },
    { label: t('qaBoard.routeSampling'), sub: t('qaBoard.routeSamplingSub'), date: qaDate(lot.sampling_date), state: 'done' },
    { label: t('qaBoard.routeF11'), sub: t('qaBoard.routeF11Sub'), date: qaDate(lot.qc_result_received_at), state: lot.qc_result_received_at ? 'done' : 'todo' },
    { label: t('qaBoard.routeDecision'), sub: decided ? t('qaBoard.routeDecisionDone') : t('qaBoard.routeDecisionWait'), date: decided ? qaDate(lot.qa_decision_at) : null, state: decided ? 'done' : 'current' },
  ]
  return (
    <QaCard className="overflow-hidden">
      <QaSectionHead icon={ArrowRightLeft} eyebrow={t('qaBoard.routeEyebrow')} title={t('qaBoard.routeTitle')} />
      <div className="flex items-stretch gap-0 px-4 py-4">
        {steps.map((step, i) => {
          const last = i === steps.length - 1
          const done = step.state === 'done'
          const current = step.state === 'current'
          return (
            <div key={step.label} className="relative flex min-w-0 flex-1 flex-col items-center">
              {!last && <span className={`absolute left-1/2 top-[18px] h-0.5 w-full ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
              <span className={`relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border-2 ${done ? 'border-emerald-500 bg-emerald-500 text-white' : current ? 'border-amber-400 bg-amber-50 text-amber-600' : 'border-slate-200 bg-white text-slate-300'}`}>
                {done ? <CheckCircle2 size={17} /> : current ? <CircleDot size={17} /> : <FileText size={15} />}
              </span>
              <div className="mt-2 px-1 text-center">
                <p className={`text-[11.5px] font-semibold leading-tight ${step.state === 'todo' ? 'text-slate-400' : 'text-slate-800'}`}>{step.label}</p>
                <p className="mt-0.5 text-[10px] leading-tight text-slate-400">{step.sub}</p>
                {step.date && <p className={`mt-1 font-mono text-[10px] tabular-nums ${current ? 'text-amber-600' : 'text-slate-500'}`}>{step.date}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </QaCard>
  )
}

function QaF11Block({ lot, onOpenReport, onOpenScan }: { lot: LotItem; onOpenReport: () => void; onOpenScan: () => void }) {
  const { t } = useI18n()
  const ready = Boolean(lot.qc_result_received_at)
  return (
    <QaCard className="overflow-hidden">
      <QaSectionHead icon={FlaskConical} eyebrow={t('qaBoard.f11Eyebrow')} title={t('qaBoard.f11Title')} right={
        <>
          <QaPillButton tone="confirm" icon={FileScan} size="sm" disabled={!ready} onClick={onOpenScan}>{t('qaBoard.openScan')}</QaPillButton>
          <QaPillButton tone="neutral" icon={Eye} size="sm" onClick={onOpenReport}>{t('qaBoard.openF11')}</QaPillButton>
        </>
      } />
      <div className={`flex items-center gap-3 px-4 py-3.5 ${ready ? 'bg-emerald-50/60' : 'bg-amber-50/60'}`}>
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${ready ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>{ready ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[18px] font-semibold leading-tight tracking-tight ${ready ? 'text-emerald-800' : 'text-amber-800'}`}>{ready ? t('qaBoard.compliant') : t('qaBoard.awaitingResult')}</p>
          <p className="mt-0.5 text-[12px] text-slate-600">{ready ? t('qaBoard.allWithinNd') : t('qaBoard.decisionBlockedUntilQc')}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-mono text-[11px] tabular-nums text-slate-500">{t('qaBoard.sheetNo')} {lot.qc_report_no || '—'}</span>
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-emerald-700">{t('qaBoard.norm')}</span>
        </div>
      </div>
    </QaCard>
  )
}

function QaGatesSection({ resultReady, canRelease }: { resultReady: boolean; canRelease: boolean }) {
  const { t } = useI18n()
  return (
    <QaCard className="overflow-hidden">
      <QaSectionHead icon={ListChecks} eyebrow={t('qaBoard.gatesEyebrow')} title={t('qaBoard.gatesTitle')} />
      <div className="space-y-2 p-4">
        <QaGateRow state={resultReady ? 'ok' : 'amber'} title={t('qaBoard.gateResult')} sub={resultReady ? t('qaBoard.gateResultOk') : t('qaBoard.gateResultWait')} />
        <QaGateRow state={resultReady ? 'ok' : 'amber'} title={t('qaBoard.gateVerified')} sub={resultReady ? t('qaBoard.gateVerifiedOk') : t('qaBoard.gateVerifiedWait')} />
        <QaGateRow state="ok" title={t('qaBoard.gateNoOos')} sub={t('qaBoard.gateNoOosSub')} />
        {!canRelease && <p className="px-1 pt-1 text-[11.5px] text-slate-500">{t('qaBoard.gatesHint')}</p>}
      </div>
    </QaCard>
  )
}

function QaGateRow({ state, title, sub }: { state: 'ok' | 'amber' | 'red'; title: string; sub: string }) {
  const meta = {
    ok: { cls: 'border-emerald-200 bg-emerald-50', icon: CheckCircle2, iconCls: 'text-emerald-600' },
    amber: { cls: 'border-amber-200 bg-amber-50', icon: AlertCircle, iconCls: 'text-amber-600' },
    red: { cls: 'border-rose-200 bg-rose-50', icon: Ban, iconCls: 'text-rose-600' },
  }[state]
  const Icon = meta.icon
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${meta.cls}`}>
      <span className={`mt-0.5 shrink-0 ${meta.iconCls}`}><Icon size={17} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium leading-snug text-slate-800">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{sub}</p>
      </div>
    </div>
  )
}

function QaDecidedBlock({ lot }: { lot: LotItem }) {
  const { t } = useI18n()
  const released = lot.quality_status === 'released'
  return (
    <QaCard className="overflow-hidden">
      <div className={`flex items-start gap-3 p-4 ${released ? 'bg-emerald-50/50' : 'bg-rose-50/40'}`}>
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${released ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>{released ? <ShieldCheck size={22} /> : <Ban size={22} />}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-[15px] font-semibold tracking-tight ${released ? 'text-emerald-800' : 'text-rose-800'}`}>{released ? t('qaBoard.lotReleasedFull') : t('qaBoard.lotRejectedFull')}</p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-[11.5px] text-slate-500"><CheckCircle2 size={12} className={released ? 'text-emerald-600' : 'text-rose-600'} />{t('qaBoard.eSigned')}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-200 p-4">
        <QaField label={t('qaBoard.decisionDate')} value={qaDateTime(lot.qa_decision_at)} mono icon={Calendar} />
        <QaField label={t('qaBoard.zone')} value={lot.location_code} mono icon={MapPin} />
      </div>
    </QaCard>
  )
}

function QaConfirmDialog({ action, lot, onCancel, onConfirm }: { action: 'release' | 'reject'; lot: LotItem; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n()
  const release = action === 'release'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 p-5">
          <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${release ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{release ? <ShieldCheck size={18} /> : <Ban size={18} />}</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">{release ? t('qaBoard.confirmReleaseTitle') : t('qaBoard.confirmRejectTitle')}</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{t('qaBoard.confirmBody')}</p>
            <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11.5px] text-slate-600">
              {lot.internal_lot} · {lot.material_name}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <QaPillButton tone="neutral" onClick={onCancel}>{t('common.cancel')}</QaPillButton>
          <QaPillButton tone={release ? 'confirm' : 'danger'} onClick={onConfirm}>{release ? t('qaBoard.release') : t('qaBoard.reject')}</QaPillButton>
        </div>
      </div>
    </div>
  )
}

function QaLotSkeleton() {
  return (
    <div className="rounded-lg border border-slate-100 px-2.5 py-2.5">
      <div className="flex items-center gap-2"><div className="h-3 w-24 rounded bg-slate-100" /><div className="ml-auto h-4 w-20 rounded-full bg-slate-100" /></div>
      <div className="mt-2 h-3.5 w-full rounded bg-slate-100" />
      <div className="mt-1.5 h-3 w-2/3 rounded bg-slate-100" />
      <div className="mt-2 flex gap-1.5"><div className="h-4 w-16 rounded bg-slate-100" /><div className="h-4 w-14 rounded bg-slate-100" /></div>
    </div>
  )
}

function QaDecisionSkeleton() {
  return (
    <div className="space-y-3">
      <QaCard className="p-4">
        <div className="flex gap-3"><div className="h-11 w-11 rounded-lg bg-slate-100" /><div className="flex-1 space-y-2"><div className="h-4 w-2/3 rounded bg-slate-100" /><div className="h-3 w-1/2 rounded bg-slate-100" /></div></div>
        <div className="mt-4 grid grid-cols-4 gap-3">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="h-9 rounded bg-slate-100" />)}</div>
      </QaCard>
      <QaCard className="p-4"><div className="h-16 rounded bg-slate-100" /></QaCard>
      <QaCard className="p-4"><div className="h-24 rounded bg-slate-100" /></QaCard>
    </div>
  )
}

function QaEmptyState({ icon: Icon, title, sub }: { icon: typeof Inbox; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Icon size={26} /></span>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-slate-700">{title}</h3>
      <p className="mt-1 max-w-xs text-[12.5px] leading-relaxed text-slate-500">{sub}</p>
    </div>
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
              {t('qaBoard.sopF10', { form: sopForm })}
            </span>
            <span className="text-[10.5px] uppercase tracking-wider text-slate-400">
              {lot.warehouse_type === 'FG_WAREHOUSE' ? t('role.scope.FG_WAREHOUSE') : lot.warehouse_type === 'PACKAGING_WAREHOUSE' ? t('role.scope.PACKAGING_WAREHOUSE') : t('role.scope.SUBSTANCE_WAREHOUSE')}
            </span>
          </div>
          <h4 className="text-[15px] font-semibold tracking-tight text-slate-950">{lot.material_name}</h4>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-slate-600">
            <span>{t('qaBoard.codeColon')} <span className="text-slate-900">{lot.material_code}</span></span>
            <span>{t('qaBoard.lotColon')} <span className="font-semibold text-slate-900">{lot.internal_lot}</span></span>
            <span>{lot.manufacturer_name}</span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500">
            {lot.quantity.toLocaleString(locale)} {lot.unit}
            {act && <span> · {t('qaBoard.actN', { no: act.act_no })}</span>}
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
                <AlertTriangle size={11} /> {t('qaBoard.slaOver')}
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

// ─── Модалка списка аналитических листов ────────────────────────────────────

function QcReportsModal({
  token,
  reports,
  locale,
  t,
  onReload,
  onClose,
}: {
  token: string
  reports: QcReportListItem[]
  locale: string
  t: Translate
  onReload: () => void
  onClose: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  async function downloadScan(r: QcReportListItem) {
    if (!r.scan_id) return
    try {
      const blob = await downloadQcReportScan(token, r.scan_id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `analytical-sheet-${r.report_no}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }

  async function upload(r: QcReportListItem, file: File) {
    setBusyId(r.id)
    setError(null)
    try {
      await uploadQcReportScan(token, r.id, file)
      onReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qc.reportsModal.uploadFailed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-blue-700" />
            <h2 className="text-base font-semibold text-slate-950">{t('qc.reportsModal.title')}</h2>
            <span className="text-[12px] font-medium text-slate-400">· {reports.length}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {error && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</div>}
          <p className="mb-3 text-[12px] text-slate-500">{t('qc.reportsModal.hint')}</p>
          {reports.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">{t('qc.reportsModal.empty')}</p>
          ) : (
            <div className="space-y-2">
              {reports.map((r) => {
                const complies = (r.overall_result || '').toLowerCase() === 'complies'
                return (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold text-slate-900">{r.report_no}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${complies ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                          {complies ? t('qc.reportsModal.complies') : t('qc.reportsModal.notComplies')}
                        </span>
                        {r.scan_id ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700">
                            <CheckCircle2 size={11} /> {t('qc.reportsModal.scanAttached')}
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-700">
                            {t('qc.reportsModal.noScan')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-slate-500">
                        <span className="text-slate-800">{r.material_name || '—'}</span>
                        <span>{t('qaBoard.lotColon')} {r.internal_lot || '—'}</span>
                        <span>{r.submitted_at ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(r.submitted_at)) : ''}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {r.scan_id && (
                        <button
                          type="button"
                          onClick={() => downloadScan(r)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50"
                        >
                          <Download size={15} /> {t('qc.reportsModal.download')}
                        </button>
                      )}
                      <ScanButton onScanned={(file) => void upload(r, file)} onError={setError} disabled={busyId === r.id} asPdf />
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => fileRefs.current[r.id]?.click()}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50"
                      >
                        <Upload size={15} /> {r.scan_id ? t('qc.reportsModal.replace') : t('qc.reportsModal.upload')}
                      </button>
                      <input
                        ref={(el) => { fileRefs.current[r.id] = el }}
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(r, f); e.target.value = '' }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Модалка расследований OOS / РНС (СОП-549) ──────────────────────────────

function OosModal({
  token,
  user,
  investigations,
  locale,
  t,
  onReload,
  onClose,
}: {
  token: string
  user: CurrentUser
  investigations: OOSItem[]
  locale: string
  t: Translate
  onReload: () => void
  onClose: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, { root_cause: string; conclusion: string; disposition: string; password: string }>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function draftOf(o: OOSItem) {
    return drafts[o.id] ?? { root_cause: o.root_cause || '', conclusion: o.conclusion || '', disposition: o.disposition || '', password: '' }
  }
  function patch(id: string, p: Partial<{ root_cause: string; conclusion: string; disposition: string; password: string }>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { root_cause: '', conclusion: '', disposition: '', password: '' }), ...p } }))
  }

  async function save(o: OOSItem) {
    const d = draftOf(o)
    setBusyId(o.id); setError(null)
    try {
      await updateOos(token, o.id, { root_cause: d.root_cause || null, conclusion: d.conclusion || null, disposition: d.disposition || null })
      onReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qc.oos.actionFailed'))
    } finally { setBusyId(null) }
  }

  async function close(o: OOSItem) {
    const d = draftOf(o)
    if (!d.conclusion.trim() || !d.disposition) { setError(t('qc.oos.errClose')); return }
    setBusyId(o.id); setError(null)
    try {
      await closeOos(token, o.id, {
        username: user.username,
        password: d.password,
        meaning: t('qc.oos.meaning'),
        reason: t('qc.oos.reason'),
        conclusion: d.conclusion,
        disposition: d.disposition,
        root_cause: d.root_cause || null,
      })
      onReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qc.oos.actionFailed'))
    } finally { setBusyId(null) }
  }

  const DISPO: Record<string, string> = {
    confirmed_reject: t('qc.oos.dispo.confirmed_reject'),
    lab_error_retest: t('qc.oos.dispo.lab_error_retest'),
    use_as_is: t('qc.oos.dispo.use_as_is'),
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-700" />
            <h2 className="text-base font-semibold text-slate-950">{t('qc.oos.title')}</h2>
            <span className="text-[12px] font-medium text-slate-400">· {investigations.length}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {error && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</div>}
          <p className="mb-3 text-[12px] text-slate-500">{t('qc.oos.hint')}</p>
          {investigations.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">{t('qc.oos.empty')}</p>
          ) : (
            <div className="space-y-3">
              {investigations.map((o) => {
                const closed = o.status === 'closed'
                const d = draftOf(o)
                return (
                  <div key={o.id} className={`rounded-lg border px-3 py-3 ${closed ? 'border-slate-200 bg-slate-50/40' : 'border-rose-200 bg-rose-50/30'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-slate-900">{o.number}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${closed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {closed ? t('qc.oos.closed') : t('qc.oos.open')}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">{o.material_name || '—'} · {o.internal_lot || '—'} · {o.report_no || ''}</span>
                      <span className="ml-auto text-[11px] text-slate-400">{new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(o.opened_at))}</span>
                    </div>
                    {o.failed_summary && <p className="mt-1.5 text-[12px] text-rose-800">{o.failed_summary}</p>}

                    {closed ? (
                      <div className="mt-2 space-y-1 text-[12.5px] text-slate-700">
                        <p><span className="text-slate-500">{t('qc.oos.rootCause')}:</span> {o.root_cause || '—'}</p>
                        <p><span className="text-slate-500">{t('qc.oos.conclusion')}:</span> {o.conclusion || '—'}</p>
                        <p><span className="text-slate-500">{t('qc.oos.disposition')}:</span> <span className="font-medium">{o.disposition ? DISPO[o.disposition] : '—'}</span></p>
                      </div>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <textarea value={d.root_cause} onChange={(e) => patch(o.id, { root_cause: e.target.value })} placeholder={t('qc.oos.rootCause')} rows={2}
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-slate-400" />
                        <textarea value={d.conclusion} onChange={(e) => patch(o.id, { conclusion: e.target.value })} placeholder={t('qc.oos.conclusion')} rows={2}
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-slate-400" />
                        <div className="flex flex-wrap items-center gap-2">
                          <select value={d.disposition} onChange={(e) => patch(o.id, { disposition: e.target.value })}
                            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[12.5px] outline-none focus:border-slate-400">
                            <option value="">{t('qc.oos.dispoPlaceholder')}</option>
                            <option value="confirmed_reject">{DISPO.confirmed_reject}</option>
                            <option value="lab_error_retest">{DISPO.lab_error_retest}</option>
                            <option value="use_as_is">{DISPO.use_as_is}</option>
                          </select>
                          <input type="password" value={d.password} onChange={(e) => patch(o.id, { password: e.target.value })} placeholder={t('quality.signaturePassword')}
                            className="h-9 w-40 rounded-md border border-slate-200 bg-white px-2 font-mono text-[12.5px] outline-none focus:border-slate-400" />
                          <button type="button" disabled={busyId === o.id} onClick={() => void save(o)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[12.5px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50">
                            {t('common.save')}
                          </button>
                          <button type="button" disabled={busyId === o.id || !d.password} onClick={() => void close(o)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-700 px-3 text-[12.5px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                            <CheckCircle2 size={14} /> {t('qc.oos.close')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
