import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Inbox,
  Lock,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import {
  downloadQcNotificationScan,
  downloadQcReportScanFile,
  downloadSamplingScanFile,
  listVerificationQueue,
  rejectQcReportScan,
  rejectQcScan,
  rejectSamplingScan,
  verifyQcReportScan,
  verifyQcScan,
  verifySamplingScan,
} from '../../lib/api'
import type { CurrentUser } from '../../types/auth'
import type { VerificationDocType, VerificationQueueItem } from '../../types/inventory'

interface QCScanVerificationPageProps {
  token: string
  user: CurrentUser
}

type Translate = ReturnType<typeof useI18n>['t']
type DocFilter = 'all' | VerificationDocType

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

interface VerifyDraft {
  sig1: boolean
  sig2: boolean
  sig3: boolean
  remarks: string
  password: string
}

const emptyDraft = (): VerifyDraft => ({ sig1: false, sig2: false, sig3: false, remarks: '', password: '' })

function docLabel(t: Translate, docType: VerificationDocType): string {
  if (docType === 'qc_notification') return t('qcVerification.docF14')
  if (docType === 'sampling_act') return t('qcVerification.docF10')
  return t('qcVerification.docF11')
}

function docBadgeClass(docType: VerificationDocType): string {
  if (docType === 'qc_notification') return 'border-sky-200 bg-sky-50 text-sky-700'
  if (docType === 'sampling_act') return 'border-violet-200 bg-violet-50 text-violet-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

type SigSlot = 1 | 2 | 3
interface SigRow { slot: SigSlot; label: string }

// Список подписей зависит от формы. Для Ф-11 (аналит. лист) подпись
// микробиолога (слот 2) показывается только если в протоколе есть микробиология.
function sigRows(t: Translate, item: VerificationQueueItem): SigRow[] {
  if (item.doc_type === 'qc_notification') {
    return [
      { slot: 1, label: t('qcVerification.sigWarehouse') },
      { slot: 2, label: t('qcVerification.sigQc') },
      { slot: 3, label: t('qcVerification.sigManager') },
    ]
  }
  if (item.doc_type === 'sampling_act') {
    // Комиссия Ф-10: нач. ДКК, член от склада (533 — помощник зав. склада,
    // 548 — зав. склада Г/П), представитель ДКК.
    const wh = item.sop_form === '548' ? t('qcVerification.sigF10WhFg') : t('qcVerification.sigF10WhSub')
    return [
      { slot: 1, label: t('qcVerification.sigF10Head') },
      { slot: 2, label: wh },
      { slot: 3, label: t('qcVerification.sigF10Rep') },
    ]
  }
  // qc_report (Ф-11): химик + микробиолог (если есть) + нач. ДКК
  const rows: SigRow[] = [{ slot: 1, label: t('qcVerification.sigChemist') }]
  if (item.micro) rows.push({ slot: 2, label: t('qcVerification.sigMicrobiologist') })
  rows.push({ slot: 3, label: t('qcVerification.sigDkkHead') })
  return rows
}

async function downloadScanBlob(token: string, item: VerificationQueueItem): Promise<Blob> {
  if (item.doc_type === 'qc_notification') return downloadQcNotificationScan(token, item.scan_id)
  if (item.doc_type === 'sampling_act') return downloadSamplingScanFile(token, item.scan_id)
  return downloadQcReportScanFile(token, item.scan_id)
}

export function QCScanVerificationPage({ token, user }: QCScanVerificationPageProps) {
  const { locale, t } = useI18n()
  const [items, setItems] = useState<VerificationQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [filter, setFilter] = useState<DocFilter>('all')
  const [active, setActive] = useState<VerificationQueueItem | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [scanMime, setScanMime] = useState<string>('application/pdf')
  const [draft, setDraft] = useState<VerifyDraft>(emptyDraft())
  const [rejecting, setRejecting] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await listVerificationQueue(token)
      setItems(response.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcVerification.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t, token])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const counts = useMemo(() => ({
    all: items.length,
    qc_notification: items.filter((i) => i.doc_type === 'qc_notification').length,
    sampling_act: items.filter((i) => i.doc_type === 'sampling_act').length,
    qc_report: items.filter((i) => i.doc_type === 'qc_report').length,
  }), [items])

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.doc_type === filter)),
    [items, filter],
  )

  async function openScan(item: VerificationQueueItem) {
    setError(null)
    setSuccess(null)
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    setPdfUrl(null)
    setActive(item)
    setDraft(emptyDraft())
    setRejecting(false)
    try {
      const blob = await downloadScanBlob(token, item)
      // Гарантируем корректный MIME (иначе object/iframe могут не отрисовать).
      const mime = blob.type || (item.doc_no?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/pdf')
      const typed = blob.type ? blob : new Blob([blob], { type: mime })
      setScanMime(mime)
      setPdfUrl(URL.createObjectURL(typed))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcVerification.fileFailed'))
    }
  }

  function closeModal() {
    setActive(null)
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    setPdfUrl(null)
    setDraft(emptyDraft())
    setRejecting(false)
  }

  async function submitVerify() {
    if (!active) return
    const rows = sigRows(t, active)
    const slots = new Set(rows.map((r) => r.slot))
    const allChecked = rows.every((r) => draft[`sig${r.slot}` as 'sig1' | 'sig2' | 'sig3'])
    if (!allChecked) {
      setError(t('qcVerification.allSignaturesRequired'))
      return
    }
    if (!draft.password) {
      setError(t('qcVerification.passwordRequired'))
      return
    }
    setSubmitting(true)
    setError(null)
    const meaning = t('qcVerification.signatureMeaning')
    const reason = draft.remarks.trim() || t('qcVerification.signatureReasonDefault')
    const remarks = draft.remarks.trim() || null
    // Скрытые слоты (напр. микробиолог при отсутствии микробиологии) — N/A → true.
    const s1 = slots.has(1) ? draft.sig1 : true
    const s2 = slots.has(2) ? draft.sig2 : true
    const s3 = slots.has(3) ? draft.sig3 : true
    try {
      if (active.doc_type === 'qc_notification') {
        await verifyQcScan(token, active.scan_id, {
          signature_warehouse_ok: s1, signature_qc_ok: s2, signature_manager_ok: s3,
          remarks, username: user.username, password: draft.password, meaning, reason,
        })
      } else {
        const payload = {
          signature_1_ok: s1, signature_2_ok: s2, signature_3_ok: s3,
          remarks, username: user.username, password: draft.password, meaning, reason,
        }
        if (active.doc_type === 'sampling_act') await verifySamplingScan(token, active.scan_id, payload)
        else await verifyQcReportScan(token, active.scan_id, payload)
      }
      setSuccess(t('qcVerification.verifiedSuccess', { no: active.doc_no }))
      closeModal()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcVerification.verifyFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function submitReject() {
    if (!active) return
    if (!draft.remarks.trim()) {
      setError(t('qcVerification.rejectReasonRequired'))
      return
    }
    if (!draft.password) {
      setError(t('qcVerification.passwordRequired'))
      return
    }
    setSubmitting(true)
    setError(null)
    const payload = {
      remarks: draft.remarks.trim(), username: user.username, password: draft.password,
      meaning: t('qcVerification.rejectMeaning'), reason: draft.remarks.trim(),
    }
    try {
      if (active.doc_type === 'qc_notification') await rejectQcScan(token, active.scan_id, payload)
      else if (active.doc_type === 'sampling_act') await rejectSamplingScan(token, active.scan_id, payload)
      else await rejectQcReportScan(token, active.scan_id, payload)
      setSuccess(t('qcVerification.rejectedSuccess', { no: active.doc_no }))
      closeModal()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcVerification.rejectFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const filterTabs: { value: DocFilter; label: string; count: number }[] = [
    { value: 'all', label: t('qcVerification.filterAll'), count: counts.all },
    { value: 'qc_notification', label: t('qcVerification.docF14'), count: counts.qc_notification },
    { value: 'sampling_act', label: t('qcVerification.docF10'), count: counts.sampling_act },
    { value: 'qc_report', label: t('qcVerification.docF11'), count: counts.qc_report },
  ]

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{t('qcVerification.kicker')}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">{t('qcVerification.title')}</h1>
          <p className="max-w-2xl text-sm text-slate-600">{t('qcVerification.subtitleAll')}</p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={14} />
          {t('common.refresh')}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>{success}</span>
          <button type="button" onClick={() => setSuccess(null)} className="ml-auto text-emerald-700 hover:text-emerald-900" aria-label="dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50/60 px-3 py-2.5">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                filter === tab.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
              <span className={`tabular-nums ${filter === tab.value ? 'text-slate-300' : 'text-slate-400'}`}>{tab.count}</span>
            </button>
          ))}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/40 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2 font-medium">{t('qcVerification.docColumn')}</th>
              <th className="px-4 py-2 font-medium">{t('qcNotifications.notificationNo')}</th>
              <th className="px-4 py-2 font-medium">{t('qcVerification.titleColumn')}</th>
              <th className="px-4 py-2 font-medium">{t('qcVerification.uploadedBy')}</th>
              <th className="px-4 py-2 font-medium">{t('qcVerification.uploadedAt')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">{t('common.loadingRecords')}</td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-16">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <Inbox size={20} />
                    </span>
                    <p className="text-sm font-medium text-slate-900">{t('qcVerification.empty')}</p>
                    <p className="text-xs text-slate-500">{t('qcVerification.emptyHint')}</p>
                  </div>
                </td>
              </tr>
            )}
            {!loading && visible.map((item) => {
              const isSelf = item.uploaded_by_name === user.username
              return (
                <tr key={item.scan_id} className="border-b border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${docBadgeClass(item.doc_type)}`}>
                      {docLabel(t, item.doc_type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] font-semibold text-slate-900">{item.doc_no}</td>
                  <td className="px-4 py-3 text-slate-700">{item.title ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{item.uploaded_by_name ?? item.uploaded_by.slice(0, 8)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{formatDateTime(item.uploaded_at, locale)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void openScan(item)}
                      disabled={isSelf}
                      title={isSelf ? t('qcVerification.cannotSelfVerify') : ''}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {isSelf ? <Lock size={13} /> : <ShieldCheck size={13} />}
                      {t('qcVerification.open')}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {active && (
        <VerifyModal
          item={active}
          pdfUrl={pdfUrl}
          scanMime={scanMime}
          draft={draft}
          onDraft={setDraft}
          onClose={closeModal}
          onVerify={submitVerify}
          onReject={submitReject}
          submitting={submitting}
          rejectMode={rejecting}
          setRejectMode={setRejecting}
          t={t}
          locale={locale}
        />
      )}
    </section>
  )
}

function VerifyModal({
  item, pdfUrl, scanMime, draft, onDraft, onClose, onVerify, onReject, submitting, rejectMode, setRejectMode, t, locale,
}: {
  item: VerificationQueueItem
  pdfUrl: string | null
  scanMime: string
  draft: VerifyDraft
  onDraft: (draft: VerifyDraft) => void
  onClose: () => void
  onVerify: () => void
  onReject: () => void
  submitting: boolean
  rejectMode: boolean
  setRejectMode: (value: boolean) => void
  t: Translate
  locale: string
}) {
  const rows = sigRows(t, item)
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/40 p-4">
      <div className="flex w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${docBadgeClass(item.doc_type)}`}>
              {docLabel(t, item.doc_type)}
            </span>
            <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-slate-950">
              <span className="font-mono">{item.doc_no}</span>
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {item.title ? `${item.title} · ` : ''}{t('qcVerification.uploadedBy')}: {item.uploaded_by_name ?? '—'} · {formatDateTime(item.uploaded_at, locale)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="close">
            <X size={18} />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[1.5fr_1fr]">
          <div className="flex flex-col border-r border-slate-200 bg-slate-100">
            {pdfUrl ? (
              <>
                <div className="flex justify-end border-b border-slate-200 bg-white px-2 py-1">
                  {/* Якорь вместо window.open(noopener): blob-URL открывается в новой вкладке надёжно. */}
                  <a href={pdfUrl} target="_blank" rel="noreferrer"
                    className="text-[12px] font-medium text-blue-600 hover:underline">{t('qcVerification.openInNewTab')}</a>
                </div>
                {scanMime.startsWith('image/') ? (
                  <div className="flex h-full min-h-[440px] items-start justify-center overflow-auto bg-slate-100 p-2">
                    <img src={pdfUrl} alt="QC scan" className="max-w-full" />
                  </div>
                ) : (
                  <object data={pdfUrl} type={scanMime} className="h-full min-h-[440px] w-full">
                    {/* Фолбэк, если встроенный просмотрщик PDF отключён в браузере */}
                    <div className="flex h-full min-h-[440px] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-slate-600">
                      <FileText size={20} className="text-slate-400" />
                      <span>{t('qcVerification.previewUnavailable')}</span>
                      <a href={pdfUrl} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">{t('qcVerification.openInNewTab')}</a>
                    </div>
                  </object>
                )}
              </>
            ) : (
              <div className="flex h-full min-h-[480px] items-center justify-center px-4 text-center text-sm text-slate-500">
                <FileText className="mr-2 flex-none" size={16} />
                {t('qcVerification.loadingPdf')}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4 overflow-y-auto p-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{t('qcVerification.checklistTitle')}</p>
              <p className="mt-1 text-xs text-slate-600">{t('qcVerification.checklistHint')}</p>
            </div>

            <div className="space-y-2">
              {rows.map((r) => {
                const key = `sig${r.slot}` as 'sig1' | 'sig2' | 'sig3'
                return (
                  <CheckboxRow
                    key={r.slot}
                    label={r.label}
                    checked={draft[key]}
                    onChange={(v) => onDraft({ ...draft, [key]: v })}
                    disabled={rejectMode}
                  />
                )
              })}
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                {rejectMode ? t('qcVerification.rejectReasonLabel') : t('qcVerification.remarksLabel')}
              </label>
              <textarea
                value={draft.remarks}
                onChange={(event) => onDraft({ ...draft, remarks: event.target.value })}
                placeholder={rejectMode ? t('qcVerification.rejectReasonPlaceholder') : t('qcVerification.remarksPlaceholder')}
                rows={3}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">{t('quality.signaturePassword')}</label>
              <input
                type="password"
                value={draft.password}
                onChange={(event) => onDraft({ ...draft, password: event.target.value })}
                placeholder="••••••••"
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              />
            </div>

            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
              {rejectMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => setRejectMode(false)}
                    disabled={submitting}
                    className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={onReject}
                    disabled={submitting}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-rose-600 px-3 text-sm font-medium text-white hover:bg-rose-700 disabled:bg-rose-300"
                  >
                    <AlertTriangle size={14} />
                    {t('qcVerification.reject')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setRejectMode(true)}
                    disabled={submitting}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50"
                  >
                    <AlertTriangle size={14} />
                    {t('qcVerification.openReject')}
                  </button>
                  <button
                    type="button"
                    onClick={onVerify}
                    disabled={submitting}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-emerald-300"
                  >
                    <ShieldCheck size={14} />
                    {t('qcVerification.verify')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CheckboxRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${checked ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300"
      />
      <span className="text-slate-800">{label}</span>
    </label>
  )
}
