import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  Beaker,
  CheckCircle2,
  Download,
  FileText,
  FlaskConical,
  Lock,
  Printer,
  ShieldCheck,
  Snowflake,
  TestTube2,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react'
import {
  cancelSamplingAct,
  createSamplingAct,
  downloadSamplingActPdf,
  getSamplingActForLot,
  postSamplingAct,
  updateSamplingAct,
  uploadSamplingScan,
} from '../../lib/api'
import { ScanButton } from '../../components/ui/ScanButton'
import { useToast } from '../../components/ui/ToastProvider'
import { printBlob } from '../../lib/print'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type {
  LotItem,
  SamplingActItem,
  SamplingLineInput,
  SamplingPurpose,
} from '../../types/inventory'

type Translate = ReturnType<typeof useI18n>['t']

interface SamplingActPanelProps {
  token: string
  user: CurrentUser
  lot: LotItem
  onVerified?: () => void
}

const PURPOSE_META: Record<SamplingPurpose, { icon: typeof Beaker; key: string }> = {
  PHYSICOCHEMICAL: { icon: Beaker, key: 'sampling.purpose.physicochemical' },
  MICROBIOLOGICAL: { icon: TestTube2, key: 'sampling.purpose.microbiological' },
  ARCHIVE: { icon: Archive, key: 'sampling.purpose.archive' },
  STABILITY: { icon: Snowflake, key: 'sampling.purpose.stability' },
}

// Стартовые строки: подставляем нормы Ф-1 из карточки материала, если они
// заданы (lot.sample_*_qty). Единица берётся из нормы материала, иначе из лота.
// Строки формы держим с количеством-СТРОКОЙ (raw input), чтобы можно было
// вводить «0» и промежуточные значения; в число конвертируем на отправке.
type ActLine = { purpose: SamplingLineInput['purpose']; quantity: string; unit: string }
const qtyStr = (v: number | null | undefined): string => (v ? String(v) : '')

function defaultLines(sopForm: '533' | '548', lot: LotItem): ActLine[] {
  const u = lot.sample_unit || lot.unit
  const base: ActLine[] = [
    { purpose: 'PHYSICOCHEMICAL', quantity: qtyStr(lot.sample_pc_qty), unit: u },
    { purpose: 'MICROBIOLOGICAL', quantity: qtyStr(lot.sample_micro_qty), unit: u },
    { purpose: 'ARCHIVE', quantity: qtyStr(lot.sample_archive_qty), unit: u },
  ]
  if (sopForm === '548') base.push({ purpose: 'STABILITY', quantity: qtyStr(lot.sample_stability_qty), unit: u })
  return base
}

export function SamplingActPanel({ token, user, lot, onVerified }: SamplingActPanelProps) {
  const { t, locale } = useI18n()
  const toast = useToast()
  const [act, setAct] = useState<SamplingActItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // editable draft fields
  const [lines, setLines] = useState<ActLine[]>([])
  const [samplingDate, setSamplingDate] = useState('')
  const [location, setLocation] = useState(t('sampling.samplerDefault'))
  const [temperature, setTemperature] = useState('')
  const [humidity, setHumidity] = useState('')
  const [specRef, setSpecRef] = useState('')
  const [password, setPassword] = useState('')

  const sopForm: '533' | '548' = lot.warehouse_type === 'FG_WAREHOUSE' ? '548' : '533'

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    setAct(null) // сбрасываем состояние предыдущей партии, чтобы не «залипало»
    try {
      const found = await getSamplingActForLot(token, lot.id)
      setAct(found)
      if (found) {
        setLines(
          found.lines.length
            ? found.lines.map((l) => ({ purpose: l.purpose, quantity: qtyStr(l.quantity), unit: l.unit }))
            : defaultLines(found.sop_form, lot),
        )
        setSamplingDate(found.sampling_date ?? new Date().toISOString().slice(0, 10))
        setLocation(found.sampling_location ?? t('sampling.samplerDefault'))
        setTemperature(found.temperature_c != null ? String(found.temperature_c) : '')
        setHumidity(found.humidity_pct != null ? String(found.humidity_pct) : '')
        setSpecRef(found.specification_ref ?? '')
      } else {
        setLines(defaultLines(sopForm, lot))
        setSamplingDate(new Date().toISOString().slice(0, 10))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sampling.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [token, lot.id, lot.unit, sopForm, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const totalSampled = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0)
  const remainder = (lot.quantity ?? 0) - totalSampled

  function buildPayload() {
    return {
      lot_id: lot.id,
      head_qc_user_id: user.username ? undefined : undefined, // resolved server-side via signature; left null
      sampling_date: samplingDate || null,
      sampling_location: location || null,
      temperature_c: temperature ? Number(temperature) : null,
      humidity_pct: humidity ? Number(humidity) : null,
      specification_ref: specRef || null,
      lines: lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ ...l, quantity: Number(l.quantity) })),
    }
  }

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const created = await createSamplingAct(token, buildPayload())
      setAct(created)
      toast.success(t('sampling.createdToast'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('sampling.createFailed')
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!act) return
    setBusy(true)
    setError(null)
    try {
      const updated = await updateSamplingAct(token, act.id, buildPayload())
      setAct(updated)
      toast.success(t('sampling.savedToast'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('sampling.saveFailed')
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleUpload(file: File) {
    if (!act) return
    setBusy(true)
    setError(null)
    try {
      const updated = await uploadSamplingScan(token, act.id, file)
      setAct(updated)
      toast.success(t('sampling.scanUploaded'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('sampling.uploadFailed')
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handlePost() {
    if (!act || !password) return
    setBusy(true)
    setError(null)
    try {
      const updated = await postSamplingAct(token, act.id, {
        username: user.username,
        password,
        meaning: t('sampling.signMeaning'),
        reason: t('sampling.signReason'),
      })
      setAct(updated)
      setPassword('')
      toast.success(t('sampling.postedToast'))
      onVerified?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('sampling.postFailed')
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (!act) return
    if (!window.confirm(t('sampling.cancelConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      await cancelSamplingAct(token, act.id)
      toast.info(t('sampling.cancelledToast'))
      onVerified?.() // перезагружаем дашборд — партия вернётся в «Новое извещение»
      await reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('sampling.cancelFailed')
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handlePreviewPdf() {
    if (!act) return
    try {
      const blob = await downloadSamplingActPdf(token, act.id)
      const url = URL.createObjectURL(blob)
      const win = window.open(url, '_blank', 'noopener,noreferrer')
      if (win) window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      else URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }

  async function handlePrintPdf() {
    if (!act) return
    try {
      const blob = await downloadSamplingActPdf(token, act.id)
      printBlob(blob)
    } catch {
      /* ignore */
    }
  }

  const status = act?.status ?? null
  const isVerified = status === 'verified'
  const notificationGateApplies = lot.warehouse_type === 'SUBSTANCE_WAREHOUSE' || lot.warehouse_type === 'PACKAGING_WAREHOUSE'
  const notificationVerified = lot.qc_notification_status === 'verified'
  const samplingPreflightBlocked = notificationGateApplies && !notificationVerified && !isVerified

  if (loading) {
    return <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">{t('common.loadingRecords')}</div>
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <span
            className={`grid h-8 w-8 place-items-center rounded-md ${
              sopForm === '548' ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            <FileText size={16} />
          </span>
          <div>
            <h3 className="text-[14px] font-semibold text-slate-900">{t('sampling.title')}</h3>
            <p className="text-[11.5px] text-slate-500">
              {t('sampling.sopForm', { form: sopForm })} · {act ? act.act_no : t('sampling.notCreated')}
            </p>
          </div>
        </div>
        {act && <StatusChip status={act.status} t={t} />}
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{error}</div>
      )}

      {samplingPreflightBlocked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          <div className="font-semibold">{t('sampling.notificationBlockedTitle')}</div>
          <div className="mt-0.5">
            {t('sampling.notificationBlockedHint', {
              no: lot.qc_notification_no || '—',
              status: lot.qc_notification_status || 'not_created',
            })}
          </div>
        </div>
      )}

      {/* Quantities table — editable in draft, read-only after */}
      <div>
        <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-slate-500">{t('sampling.quantities')}</p>
        <table className="w-full">
          <tbody>
            {lines.map((line, idx) => {
              const meta = PURPOSE_META[line.purpose]
              const Icon = meta.icon
              return (
                <tr key={line.purpose} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <Icon size={14} className="text-slate-500" />
                      <span className="text-[12.5px] text-slate-800">{t(meta.key as never)}</span>
                    </div>
                  </td>
                  <td className="py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      disabled={isVerified || busy}
                      value={line.quantity}
                      onChange={(e) => {
                        const v = e.target.value
                        setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, quantity: v } : l)))
                      }}
                      className="h-8 w-24 rounded-md border border-slate-300 bg-white px-2 text-right font-mono text-[12.5px] tabular-nums outline-none focus:border-slate-400 disabled:bg-slate-50"
                    />
                  </td>
                  <td className="w-16 py-1.5 pl-2 text-left">
                    <input
                      disabled={isVerified || busy}
                      value={line.unit}
                      onChange={(e) => {
                        const v = e.target.value
                        setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, unit: v } : l)))
                      }}
                      className="h-8 w-14 rounded-md border border-slate-300 bg-white px-2 text-[12.5px] outline-none focus:border-slate-400 disabled:bg-slate-50"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Debit summary */}
        <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-900 px-3 py-2 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-slate-400">{t('sampling.willDebit')}</div>
            <div className="font-mono text-[16px] font-semibold tabular-nums">
              {totalSampled.toLocaleString(locale)} {lot.unit}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-wider text-slate-400">{t('sampling.remainderAfter')}</div>
            <div className="font-mono text-[13px] tabular-nums text-slate-200">
              {(lot.quantity ?? 0).toLocaleString(locale)} → {remainder.toLocaleString(locale)} {lot.unit}
            </div>
          </div>
        </div>
      </div>

      {/* Conditions — only editable while not verified */}
      {!isVerified && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Labeled label={t('sampling.date')}>
            <input type="date" value={samplingDate} onChange={(e) => setSamplingDate(e.target.value)} disabled={busy}
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[12.5px] outline-none focus:border-slate-400" />
          </Labeled>
          <Labeled label={t('sampling.location')}>
            <input value={location} onChange={(e) => setLocation(e.target.value)} disabled={busy}
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[12.5px] outline-none focus:border-slate-400" />
          </Labeled>
          <Labeled label={t('sampling.temperature')}>
            <input type="number" step="any" value={temperature} onChange={(e) => setTemperature(e.target.value)} disabled={busy} placeholder="°C"
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 font-mono text-[12.5px] outline-none focus:border-slate-400" />
          </Labeled>
          <Labeled label={t('sampling.humidity')}>
            <input type="number" step="any" value={humidity} onChange={(e) => setHumidity(e.target.value)} disabled={busy} placeholder="%"
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 font-mono text-[12.5px] outline-none focus:border-slate-400" />
          </Labeled>
          <Labeled label={t('sampling.nd')} full>
            <input value={specRef} onChange={(e) => setSpecRef(e.target.value)} disabled={busy}
              placeholder={sopForm === '548' ? t('sampling.ndPlaceholder548') : t('sampling.ndPlaceholderDefault')}
              className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[12.5px] outline-none focus:border-slate-400" />
          </Labeled>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {!act && (
          <button type="button" disabled={busy || totalSampled <= 0 || samplingPreflightBlocked} onClick={handleCreate}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[13px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
            <FileText size={15} /> {t('sampling.create')}
          </button>
        )}

        {act && !isVerified && (
          <>
            <button type="button" disabled={busy || samplingPreflightBlocked} onClick={handleSave}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400">
              <Download size={15} /> {t('sampling.save')}
            </button>
            <button type="button" disabled={samplingPreflightBlocked} onClick={handlePreviewPdf}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400">
              <FileText size={15} /> {t('sampling.previewPdf')}
            </button>
            <button type="button" disabled={samplingPreflightBlocked} onClick={handlePrintPdf}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400">
              <Printer size={15} /> {t('sampling.printPdf')}
            </button>
            <ScanButton onScanned={(file) => void handleUpload(file)} onError={setError} disabled={busy || samplingPreflightBlocked} asPdf />
            <button type="button" disabled={busy || samplingPreflightBlocked} onClick={() => fileRef.current?.click()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400">
              <Upload size={15} /> {t('sampling.uploadScan')}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = '' }} />
            <button type="button" disabled={busy} onClick={handleCancel}
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 text-[13px] font-medium text-rose-700 hover:bg-rose-50">
              <Trash2 size={15} /> {t('sampling.cancel')}
            </button>
          </>
        )}
      </div>

      {/* Scan info */}
      {act && act.scans.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-[12px] text-slate-700">
          <CheckCircle2 size={14} className="text-emerald-600" />
          <span className="font-mono">
            {t('sampling.scanUploaded')} · sha256: {act.scans[0].sha256_hash.slice(0, 12)}… · {(act.scans[0].file_size / 1024).toFixed(0)} {t('common.kb')}
          </span>
        </div>
      )}

      {/* Signing block */}
      {status === 'scan_uploaded' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-700" />
            <h4 className="text-[13px] font-semibold text-emerald-900">{t('sampling.signTitle')}</h4>
          </div>
          <p className="mt-1 text-[12px] text-emerald-900/80">{t('sampling.signWarning')}</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <label className="mb-1 block text-[10.5px] font-medium uppercase tracking-wider text-slate-500">{t('sampling.signaturePassword')}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-[13px] outline-none focus:border-slate-400" />
            </div>
            <button type="button" disabled={busy || !password} onClick={handlePost}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 text-[13px] font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
              <ShieldCheck size={15} /> {t('sampling.confirmDebit')}
            </button>
          </div>
        </div>
      )}

      {/* Analysis lock / unlock banner */}
      {isVerified ? (
        <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
          <Unlock size={18} className="text-violet-700" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <FlaskConical size={15} className="text-violet-700" />
              <h4 className="text-[13px] font-semibold text-violet-900">{t('sampling.analysisUnlocked')}</h4>
            </div>
            <p className="text-[12px] text-violet-900/80">{t('sampling.analysisUnlockedHint')}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-100/70 p-3">
          <Lock size={18} className="text-slate-500" />
          <div>
            <h4 className="text-[13px] font-semibold text-slate-700">{t('sampling.analysisLocked')}</h4>
            <p className="text-[12px] text-slate-600">{t('sampling.analysisLockedHint', { form: sopForm })}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusChip({ status, t }: { status: string; t: Translate }) {
  const MAP: Record<string, { cls: string; key: string }> = {
    draft: { cls: 'bg-amber-50 text-amber-800 ring-amber-200', key: 'sampling.status.draft' },
    scan_uploaded: { cls: 'bg-sky-50 text-sky-800 ring-sky-200', key: 'sampling.status.scanUploaded' },
    verified: { cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', key: 'sampling.status.verified' },
    cancelled: { cls: 'bg-slate-100 text-slate-600 ring-slate-200', key: 'sampling.status.cancelled' },
  }
  const m = MAP[status] ?? MAP.draft
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${m.cls}`}>
      {t(m.key as never)}
    </span>
  )
}

function Labeled({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${full ? 'col-span-2 sm:col-span-4' : ''}`}>
      <span className="text-[10.5px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  )
}
