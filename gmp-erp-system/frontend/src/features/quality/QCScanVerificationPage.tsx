import { useCallback, useEffect, useState } from 'react'
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
  listPendingQcScans,
  rejectQcScan,
  verifyQcScan,
} from '../../lib/api'
import type { CurrentUser } from '../../types/auth'
import type { QCPendingScanItem } from '../../types/inventory'

interface QCScanVerificationPageProps {
  token: string
  user: CurrentUser
}

type Translate = ReturnType<typeof useI18n>['t']

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

interface VerifyDraft {
  warehouseOk: boolean
  qcOk: boolean
  managerOk: boolean
  remarks: string
  password: string
}

const emptyDraft = (): VerifyDraft => ({
  warehouseOk: false,
  qcOk: false,
  managerOk: false,
  remarks: '',
  password: '',
})

export function QCScanVerificationPage({ token, user }: QCScanVerificationPageProps) {
  const { locale, t } = useI18n()
  const [items, setItems] = useState<QCPendingScanItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [active, setActive] = useState<QCPendingScanItem | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [draft, setDraft] = useState<VerifyDraft>(emptyDraft())
  const [rejecting, setRejecting] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await listPendingQcScans(token)
      setItems(response.scans)
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

  async function openScan(item: QCPendingScanItem) {
    setError(null)
    setSuccess(null)
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    setPdfUrl(null)
    setActive(item)
    setDraft(emptyDraft())
    setRejecting(false)
    try {
      const blob = await downloadQcNotificationScan(token, item.scan_id)
      setPdfUrl(URL.createObjectURL(blob))
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
    if (!draft.warehouseOk || !draft.qcOk || !draft.managerOk) {
      setError(t('qcVerification.allSignaturesRequired'))
      return
    }
    if (!draft.password) {
      setError(t('qcVerification.passwordRequired'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await verifyQcScan(token, active.scan_id, {
        signature_warehouse_ok: draft.warehouseOk,
        signature_qc_ok: draft.qcOk,
        signature_manager_ok: draft.managerOk,
        remarks: draft.remarks.trim() || null,
        username: user.username,
        password: draft.password,
        meaning: t('qcVerification.signatureMeaning'),
        reason: draft.remarks.trim() || t('qcVerification.signatureReasonDefault'),
      })
      setSuccess(t('qcVerification.verifiedSuccess', { no: active.notification_no }))
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
    try {
      await rejectQcScan(token, active.scan_id, {
        remarks: draft.remarks.trim(),
        username: user.username,
        password: draft.password,
        meaning: t('qcVerification.rejectMeaning'),
        reason: draft.remarks.trim(),
      })
      setSuccess(t('qcVerification.rejectedSuccess', { no: active.notification_no }))
      closeModal()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcVerification.rejectFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{t('qcVerification.kicker')}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">{t('qcVerification.title')}</h1>
          <p className="max-w-2xl text-sm text-slate-600">{t('qcVerification.subtitle')}</p>
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span className="font-medium">{t('qcVerification.queueLabel')}</span>
            <span className="tabular-nums text-slate-500">· {items.length}</span>
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/40 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2 font-medium">{t('qcVerification.uploadedAt')}</th>
              <th className="px-4 py-2 font-medium">{t('qcNotifications.notificationNo')}</th>
              <th className="px-4 py-2 font-medium">{t('qcVerification.uploadedBy')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('qcNotifications.linesCount')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">{t('common.loadingRecords')}</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-16">
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
            {!loading && items.map((item) => (
              <tr key={item.scan_id} className="border-b border-slate-100 hover:bg-slate-50/70">
                <td className="px-4 py-3 tabular-nums text-slate-700">{formatDateTime(item.uploaded_at, locale)}</td>
                <td className="px-4 py-3 font-mono text-[13px] font-semibold text-slate-900">{item.notification_no}</td>
                <td className="px-4 py-3 text-slate-700">{item.uploaded_by_name ?? item.uploaded_by.slice(0, 8)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{item.lines_count}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => void openScan(item)}
                    disabled={item.uploaded_by_name === user.username}
                    title={item.uploaded_by_name === user.username ? t('qcVerification.cannotSelfVerify') : ''}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {item.uploaded_by_name === user.username ? <Lock size={13} /> : <ShieldCheck size={13} />}
                    {t('qcVerification.open')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && (
        <VerifyModal
          item={active}
          pdfUrl={pdfUrl}
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
  item,
  pdfUrl,
  draft,
  onDraft,
  onClose,
  onVerify,
  onReject,
  submitting,
  rejectMode,
  setRejectMode,
  t,
  locale,
}: {
  item: QCPendingScanItem
  pdfUrl: string | null
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
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/40 p-4">
      <div className="flex w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{t('qcVerification.modalKicker')}</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              {t('qcNotifications.detailTitle')} <span className="font-mono">{item.notification_no}</span>
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {t('qcVerification.uploadedBy')}: {item.uploaded_by_name ?? '—'} · {formatDateTime(item.uploaded_at, locale)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="close">
            <X size={18} />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[1.5fr_1fr]">
          <div className="border-r border-slate-200 bg-slate-100">
            {pdfUrl ? (
              <iframe title="QC scan" src={pdfUrl} className="h-full min-h-[480px] w-full" />
            ) : (
              <div className="flex h-full min-h-[480px] items-center justify-center text-sm text-slate-500">
                <FileText className="mr-2" size={16} />
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
              <CheckboxRow
                label={t('qcVerification.sigWarehouse')}
                checked={draft.warehouseOk}
                onChange={(v) => onDraft({ ...draft, warehouseOk: v })}
                disabled={rejectMode}
              />
              <CheckboxRow
                label={t('qcVerification.sigQc')}
                checked={draft.qcOk}
                onChange={(v) => onDraft({ ...draft, qcOk: v })}
                disabled={rejectMode}
              />
              <CheckboxRow
                label={t('qcVerification.sigManager')}
                checked={draft.managerOk}
                onChange={(v) => onDraft({ ...draft, managerOk: v })}
                disabled={rejectMode}
              />
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
