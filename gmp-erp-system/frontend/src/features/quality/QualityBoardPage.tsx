import { useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardSignature,
  Download,
  FileScan,
  FileText,
  FlaskConical,
  Inbox,
  Lock,
  Search,
  Upload,
  X,
} from 'lucide-react'
import {
  closeOos,
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

type Phase = 'AWAITING_SAMPLING' | 'DRAFT' | 'SCAN_UPLOADED' | 'SAMPLING_VERIFIED' | 'RESULT_READY'
type DisplayPhase = Phase | 'OVERDUE'

const PHASE_ORDER: DisplayPhase[] = ['OVERDUE', 'SCAN_UPLOADED', 'AWAITING_SAMPLING', 'DRAFT', 'SAMPLING_VERIFIED', 'RESULT_READY']

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

function isOverdueLot(lot: LotItem, phase: Phase): boolean {
  if (phase === 'RESULT_READY') return false
  const anchor = phase === 'SAMPLING_VERIFIED' ? lot.sampling_date : lot.incoming_control_notified_at
  const days = daysSince(anchor)
  return days !== null && days > 5
}

function displayPhaseOf(lot: LotItem, phase: Phase): DisplayPhase {
  return isOverdueLot(lot, phase) ? 'OVERDUE' : phase
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
  const [phaseFilter, setPhaseFilter] = useState<DisplayPhase | null>(null)
  const [collapsedPhases, setCollapsedPhases] = useState<Set<DisplayPhase>>(new Set())
  const [selectedLotId, setSelectedLotId] = useState('')
  const [filter, setFilter] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const [password, setPassword] = useState('')
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
    const c: Record<DisplayPhase, number> = { AWAITING_SAMPLING: 0, DRAFT: 0, SCAN_UPLOADED: 0, SAMPLING_VERIFIED: 0, RESULT_READY: 0, OVERDUE: 0 }
    for (const lot of lots) {
      const ph = lotPhases.get(lot.id)!
      c[ph] += 1
      if (isOverdueLot(lot, ph)) c.OVERDUE += 1
    }
    return c
  }, [lots, lotPhases])

  const filteredQcLots = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return lots.filter((lot) => {
      const ph = lotPhases.get(lot.id)!
      if (phaseFilter && displayPhaseOf(lot, ph) !== phaseFilter) return false
      if (!q) return true
      return (
        lot.material_name.toLowerCase().includes(q) ||
        lot.material_code.toLowerCase().includes(q) ||
        lot.internal_lot.toLowerCase().includes(q) ||
        (lot.supplier_lot || '').toLowerCase().includes(q) ||
        lot.manufacturer_name.toLowerCase().includes(q) ||
        lot.supplier_name.toLowerCase().includes(q)
      )
    })
  }, [lots, filter, phaseFilter, lotPhases])

  const groupedQc = useMemo(() => {
    const groups = new Map<DisplayPhase, LotItem[]>()
    for (const lot of filteredQcLots) {
      const ph = displayPhaseOf(lot, lotPhases.get(lot.id)!)
      if (!groups.has(ph)) groups.set(ph, [])
      groups.get(ph)!.push(lot)
    }
    return PHASE_ORDER.filter((p) => groups.has(p)).map((p) => ({ phase: p, lots: groups.get(p)! }))
  }, [filteredQcLots, lotPhases])

  if (mode === 'qc') {
    return (
      <section className="mx-auto max-w-7xl space-y-5">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('quality.incomingControl')}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">{t('quality.qcBoard')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">{t('qc.dashboardSubtitle')}</p>
        </div>

        {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiTile icon={Inbox} label={t('qc.kpi.newNotifications')} phase="AWAITING_SAMPLING" value={kpi.AWAITING_SAMPLING} active={phaseFilter === 'AWAITING_SAMPLING'} onClick={() => setPhaseFilter((p) => (p === 'AWAITING_SAMPLING' ? null : 'AWAITING_SAMPLING'))} />
          <KpiTile icon={ClipboardSignature} label={t('qc.kpi.awaitingSampling')} phase="DRAFT" value={kpi.DRAFT} active={phaseFilter === 'DRAFT'} onClick={() => setPhaseFilter((p) => (p === 'DRAFT' ? null : 'DRAFT'))} />
          <KpiTile icon={FileScan} label={t('qc.kpi.scanUploaded')} phase="SCAN_UPLOADED" value={kpi.SCAN_UPLOADED} active={phaseFilter === 'SCAN_UPLOADED'} onClick={() => setPhaseFilter((p) => (p === 'SCAN_UPLOADED' ? null : 'SCAN_UPLOADED'))} />
          <KpiTile icon={FlaskConical} label={t('qc.kpi.inAnalysis')} phase="SAMPLING_VERIFIED" value={kpi.SAMPLING_VERIFIED} active={phaseFilter === 'SAMPLING_VERIFIED'} onClick={() => setPhaseFilter((p) => (p === 'SAMPLING_VERIFIED' ? null : 'SAMPLING_VERIFIED'))} />
          <KpiTile icon={CheckCircle2} label={t('qc.kpi.resultReady')} phase="RESULT_READY" value={kpi.RESULT_READY} active={phaseFilter === 'RESULT_READY'} onClick={() => setPhaseFilter((p) => (p === 'RESULT_READY' ? null : 'RESULT_READY'))} />
          <KpiTile icon={AlertTriangle} label="Просрочены" phase="OVERDUE" value={kpi.OVERDUE} active={phaseFilter === 'OVERDUE'} onClick={() => setPhaseFilter((p) => (p === 'OVERDUE' ? null : 'OVERDUE'))} />
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-transparent focus:ring-2 focus:ring-cyan-400"
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Поиск: материал, серия, поставщик..."
              value={filter}
            />
          </div>
          {phaseFilter && (
            <button type="button" onClick={() => setPhaseFilter(null)} className="h-10 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50">
              {t('registry.resetFilters')}
            </button>
          )}
          <button type="button" onClick={() => setReportsModalOpen(true)} className="hidden h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:inline-flex">
            <FileText size={14} strokeWidth={1.5} />
            Листы · {reports.length}
          </button>
          <button type="button" onClick={() => setOosModalOpen(true)} className="hidden h-10 items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-medium text-rose-700 hover:bg-rose-50 lg:inline-flex">
            <AlertTriangle size={14} strokeWidth={1.5} />
            OOS · {oosList.filter((o) => o.status !== 'closed').length}
          </button>
        </div>

        {groupedQc.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-16">
            <Inbox size={26} className="text-slate-300" />
            <p className="text-sm font-medium text-slate-700">{t('qc.emptyTasks')}</p>
          </div>
        ) : (
          groupedQc.map((group) => {
            const collapsed = collapsedPhases.has(group.phase)
            return (
            <div key={group.phase}>
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
                className="group mb-2 flex w-full items-center gap-2 text-left"
              >
                <span className={`h-px w-3 flex-shrink-0 ${group.phase === 'OVERDUE' ? 'bg-rose-300' : 'bg-slate-300'}`} />
                <span className={`whitespace-nowrap text-[10px] font-semibold uppercase tracking-widest ${group.phase === 'OVERDUE' ? 'text-rose-500' : 'text-slate-500'}`}>
                  {SECTION_LABEL[group.phase]} · {group.lots.length}
                </span>
                <span className="h-px flex-1 bg-slate-200" />
                {collapsed ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronUp size={12} className="text-slate-400" />}
              </button>
              {!collapsed && (
              <div className="space-y-2">
                {group.lots.map((lot) => (
                  <QcTaskCard
                    key={lot.id}
                    lot={lot}
                    act={actByLot.get(lot.id)}
                    phase={lotPhases.get(lot.id)!}
                    displayPhase={group.phase}
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
          <QcAnalysisWorkspace
            key={selectedLot.id}
            token={token}
            user={user}
            lot={selectedLot}
            onSubmitted={() => void loadLots()}
          />
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

const SECTION_LABEL: Record<DisplayPhase, string> = {
  OVERDUE: 'ПРОСРОЧЕНЫ',
  SCAN_UPLOADED: 'ОЖИДАЮТ ПОДПИСАНИЯ',
  AWAITING_SAMPLING: 'ОЖИДАЮТ ОТБОРА',
  DRAFT: 'АКТ В РАБОТЕ',
  SAMPLING_VERIFIED: 'НА АНАЛИЗЕ',
  RESULT_READY: 'РЕЗУЛЬТАТ ГОТОВ',
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
  label,
  phase,
  value,
  active,
  onClick,
}: {
  icon: typeof Inbox
  label: string
  phase: DisplayPhase
  value: number
  active?: boolean
  onClick?: () => void
}) {
  const style: Record<DisplayPhase, { card: string; icon: string }> = {
    AWAITING_SAMPLING: { card: 'bg-slate-50 border-slate-200 text-slate-700', icon: 'text-slate-500' },
    DRAFT: { card: 'bg-amber-50 border-amber-200 text-amber-700', icon: 'text-amber-500' },
    SCAN_UPLOADED: { card: 'bg-sky-50 border-sky-200 text-sky-700', icon: 'text-sky-500' },
    SAMPLING_VERIFIED: { card: 'bg-violet-50 border-violet-200 text-violet-700', icon: 'text-violet-500' },
    RESULT_READY: { card: 'bg-emerald-50 border-emerald-200 text-emerald-700', icon: 'text-emerald-500' },
    OVERDUE: { card: 'bg-rose-50 border-rose-200 text-rose-700', icon: 'text-rose-500' },
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex flex-col items-start rounded-xl border p-4 text-left transition-all ${
        style[phase].card
      } ${active ? 'shadow-sm ring-2 ring-current ring-offset-1' : 'hover:shadow-sm'} ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <Icon size={18} strokeWidth={1.5} className={`mb-2 ${style[phase].icon}`} />
      <span className="mb-1 text-2xl font-bold leading-none tabular-nums">{value}</span>
      <span className="text-[11px] font-medium leading-tight">{label}</span>
    </button>
  )
}

type Translate = ReturnType<typeof useI18n>['t']

function QcTaskCard({
  lot,
  act,
  phase,
  displayPhase,
  selected,
  locale,
  t,
  onAction,
}: {
  lot: LotItem
  act: SamplingActItem | undefined
  phase: Phase
  displayPhase: DisplayPhase
  selected: boolean
  locale: string
  t: Translate
  onAction: () => void
}) {
  const days = daysSince(phase === 'SAMPLING_VERIFIED' ? lot.sampling_date : lot.incoming_control_notified_at)
  const overdue = displayPhase === 'OVERDUE'
  const sopForm = lot.warehouse_type === 'FG_WAREHOUSE' ? '548' : '533'
  const progress = PHASE_PROGRESS[phase]
  const phaseSteps = ['Извещено', 'Отобрано', 'Проанализировано', 'Результат']

  const CTA: Record<Phase, { label: string; cls: string; disabled?: boolean }> = {
    AWAITING_SAMPLING: { label: 'Сформировать акт отбора', cls: 'bg-slate-900 text-white hover:bg-slate-800' },
    DRAFT: { label: t('qc.card.openAct'), cls: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50' },
    SCAN_UPLOADED: { label: 'Подтвердить и списать', cls: 'bg-emerald-700 text-white hover:bg-emerald-800' },
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
            {cta.disabled ? <Lock size={15} /> : <ClipboardSignature size={15} />}
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
                        <span>серия: {r.internal_lot || '—'}</span>
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
