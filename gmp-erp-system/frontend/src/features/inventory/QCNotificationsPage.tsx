import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Eye,
  FileCheck2,
  Inbox,
  Printer,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useI18n } from '../../i18n/I18nProvider'
import {
  downloadQcNotificationPdf,
  downloadQcNotificationScan,
  listQcNotifications,
  listQcNotificationScans,
  uploadQcNotificationScan,
} from '../../lib/api'
import type { CurrentUser } from '../../types/auth'
import type { QCNotificationItem, QCNotificationScanItem } from '../../types/inventory'

interface QCNotificationsPageProps {
  token: string
  user: CurrentUser
}

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

type Translate = ReturnType<typeof useI18n>['t']

function warehouseLabel(type: string, t: Translate): string {
  if (type === 'SUBSTANCE_WAREHOUSE') return t('qcNotifications.warehouseSubstance')
  return type
}

export function QCNotificationsPage({ token, user }: QCNotificationsPageProps) {
  const { locale, t } = useI18n()
  const canUpload = user.permissions.includes('UPLOAD_QC_SCAN')
  const [notifications, setNotifications] = useState<QCNotificationItem[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const response = await listQcNotifications(token)
      setNotifications(response.notifications)
      // keep expansion if still in list, otherwise open the first
      setExpandedId((curr) => {
        if (curr && response.notifications.some((n) => n.id === curr)) return curr
        return response.notifications[0]?.id ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcNotifications.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const filtered = useMemo<QCNotificationItem[]>(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return notifications
    return notifications.filter((n) => {
      if (n.notification_no.toLowerCase().includes(q)) return true
      return n.lines.some(
        (l) =>
          l.material_name.toLowerCase().includes(q) ||
          l.batch_number.toLowerCase().includes(q) ||
          l.manufacturer_name.toLowerCase().includes(q),
      )
    })
  }, [notifications, filter])

  async function withPdfBlob(id: string, use: (url: string) => void) {
    try {
      const blob = await downloadQcNotificationPdf(token, id)
      const url = URL.createObjectURL(blob)
      use(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcNotifications.printFailed'))
    }
  }

  function handlePrint(id: string) {
    void withPdfBlob(id, (url) => {
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.src = url
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus()
          iframe.contentWindow?.print()
        } catch {
          /* swallow */
        }
        // Revoke the blob URL & remove iframe after the print dialog has had a chance to grab it.
        window.setTimeout(() => {
          iframe.remove()
          URL.revokeObjectURL(url)
        }, 60_000)
      }
      document.body.appendChild(iframe)
    })
  }

  function handleView(id: string) {
    void withPdfBlob(id, (url) => {
      window.open(url, '_blank', 'noopener,noreferrer')
      // Revoke after a delay so the new tab has time to read it.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    })
  }

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            {t('qcNotifications.kicker')}
          </p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">
            {t('qcNotifications.title')}
          </h1>
          <p className="text-sm text-slate-600">{t('qcNotifications.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 lg:flex">
            <ClipboardCheck size={14} />
            <span>
              {t('qcNotifications.totalCount')}:{' '}
              <span className="font-semibold tabular-nums text-slate-900">{notifications.length}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={14} />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Table card */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            <span className="font-medium">{t('qcNotifications.toolbarPending')}</span>
            <span className="tabular-nums text-slate-500">· {filtered.length}</span>
          </span>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('qcNotifications.search')}
              className="h-8 w-[420px] max-w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            />
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/40 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
              <th className="w-10 px-2 py-2" aria-hidden />
              <th className="px-4 py-2 font-medium">{t('qcNotifications.notifiedAt')}</th>
              <th className="px-4 py-2 font-medium">{t('qcNotifications.notificationNo')}</th>
              <th className="px-4 py-2 font-medium">{t('lots.warehouse')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('qcNotifications.linesCount')}</th>
              <th className="px-4 py-2 font-medium">{t('common.status')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-slate-100">
                  {[120, 180, 140, 70, 90, 110, 80].map((w, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 animate-pulse rounded bg-slate-100" style={{ width: w }} />
                    </td>
                  ))}
                </tr>
              ))}

            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <Inbox size={20} />
                    </span>
                    <p className="text-sm font-medium text-slate-900">{t('qcNotifications.empty')}</p>
                    <p className="text-xs text-slate-500">{t('qcNotifications.emptyHint')}</p>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading &&
              filtered.map((n) => {
                const open = expandedId === n.id
                return (
                  <Fragment key={n.id}>
                    <tr
                      onClick={() => setExpandedId(open ? null : n.id)}
                      className={`cursor-pointer border-b border-slate-100 transition ${
                        open ? 'bg-slate-50' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="px-2 py-3 align-middle">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition ${
                            open ? 'rotate-180 text-slate-700' : ''
                          }`}
                        >
                          <ChevronDown size={16} />
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle tabular-nums text-slate-700">
                        {formatDateTime(n.notified_at, locale)}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <span className="font-mono text-[13px] font-semibold text-slate-900">
                          {n.notification_no}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <StatusBadge status={n.warehouse_type} />
                      </td>
                      <td className="px-4 py-3 text-right align-middle tabular-nums">
                        <span className="inline-flex min-w-[28px] justify-center rounded-md bg-white px-1.5 py-0.5 text-[12px] font-semibold text-slate-900 ring-1 ring-slate-200">
                          {n.lines.length}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <StatusBadge status={n.status} />
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            title={t('qcNotifications.printDirect')}
                            onClick={() => handlePrint(n.id)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-900 bg-slate-900 px-2.5 text-xs font-medium text-white hover:bg-slate-800"
                          >
                            <Printer size={14} />
                            <span>{t('qcNotifications.printDirect')}</span>
                          </button>
                          <button
                            type="button"
                            title={t('qcNotifications.viewPdf')}
                            onClick={() => handleView(n.id)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                          >
                            <Eye size={14} />
                            <span>{t('qcNotifications.viewPdf')}</span>
                          </button>
                        </div>
                      </td>
                    </tr>

                    {open && (
                      <tr className="border-b border-slate-200 bg-slate-50/60">
                        <td colSpan={7} className="p-0">
                          <ExpandedForm
                            notification={n}
                            locale={locale}
                            t={t}
                            token={token}
                            canUpload={canUpload}
                            onPrint={() => handlePrint(n.id)}
                            onView={() => handleView(n.id)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

interface ExpandedFormProps {
  notification: QCNotificationItem
  locale: string
  t: Translate
  token: string
  canUpload: boolean
  onPrint: () => void
  onView: () => void
}

function ExpandedForm({ notification: n, locale, t, token, canUpload, onPrint, onView }: ExpandedFormProps) {
  return (
    <div className="px-5 py-5">
      <div className="relative rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-lg bg-gradient-to-r from-slate-900/0 via-slate-900/15 to-slate-900/0" />

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 pb-4 pt-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {t('qcNotifications.formCaption')}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              {t('qcNotifications.detailTitle')} <span className="font-mono">{n.notification_no}</span>
            </h2>
            <p className="mt-1 text-sm text-slate-600">{t('qcNotifications.formIntro')}</p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onPrint}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
              >
                <Printer size={15} />
                {t('qcNotifications.printDirect')}
              </button>
              <button
                type="button"
                onClick={onView}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                <Eye size={15} />
                {t('qcNotifications.viewPdf')}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">{t('qcNotifications.printHint')}</p>
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200/60 text-sm md:grid-cols-4">
          <MetaCell label={t('qcNotifications.notifiedAt')} value={formatDateTime(n.notified_at, locale)} mono />
          <MetaCell label={t('lots.warehouse')} value={warehouseLabel(n.warehouse_type, t)} />
          <MetaCell label={t('qcNotifications.linesCount')} value={String(n.lines.length)} mono />
          <MetaCell label={t('common.status')} value={<StatusBadge status={n.status} />} />
        </div>

        {/* Lines */}
        <div className="px-5 pt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-700">
              {t('qcNotifications.positionsHeading')}
            </h3>
            <span className="text-[11px] text-slate-500">
              {t('qcNotifications.totalCount')}:{' '}
              <span className="font-semibold tabular-nums text-slate-800">{n.lines.length}</span>
            </span>
          </div>
          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  <th className="w-10 px-3 py-2 text-center">№</th>
                  <th className="px-3 py-2">{t('qcNotifications.colMaterial')}</th>
                  <th className="px-3 py-2">{t('qcNotifications.batch')}</th>
                  <th className="px-3 py-2">{t('lots.expiry')}</th>
                  <th className="px-3 py-2 text-right">{t('lots.qty')}</th>
                  <th className="px-3 py-2">{t('lots.manufacturer')}</th>
                  <th className="px-3 py-2">{t('qcNotifications.colInvoice')}</th>
                </tr>
              </thead>
              <tbody>
                {n.lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                      {t('qcNotifications.noLines')}
                    </td>
                  </tr>
                ) : (
                  n.lines.map((line, idx) => (
                    <tr
                      key={line.lot_id}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40"
                    >
                      <td className="px-3 py-2.5 text-center font-mono text-[12px] tabular-nums text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-900">{line.material_name}</td>
                      <td className="px-3 py-2.5 font-mono text-[12.5px] text-slate-800">
                        {line.batch_number}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-700">
                        {formatDate(line.expiry_date, locale)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">
                        <span className="font-semibold">{line.quantity}</span>{' '}
                        <span className="text-slate-500">{line.unit}</span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{line.manufacturer_name}</td>
                      <td className="px-3 py-2.5 text-slate-500">{line.invoice_info}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <ScansSection notification={n} t={t} locale={locale} token={token} canUpload={canUpload} />

        <div className="mt-2 flex items-center justify-between border-t border-slate-200 px-5 py-3 text-[11px] text-slate-500">
          <span>{t('qcNotifications.formFootnote')}</span>
          <span className="font-mono">DOC-ID {n.id.toUpperCase()}</span>
        </div>
      </div>
    </div>
  )
}

interface MetaCellProps {
  label: string
  value: React.ReactNode
  mono?: boolean
}

function MetaCell({ label, value, mono }: MetaCellProps) {
  return (
    <div className="bg-white px-5 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-[14px] font-medium text-slate-900 ${mono ? 'font-mono tabular-nums' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

// ─── Scans section (ДКК upload + visibility for everyone with QC/QA access) ──

interface ScansSectionProps {
  notification: QCNotificationItem
  locale: string
  t: Translate
  token: string
  canUpload: boolean
}

function ScansSection({ notification, locale, t, token, canUpload }: ScansSectionProps) {
  const [scans, setScans] = useState<QCNotificationScanItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await listQcNotificationScans(token, notification.id)
      setScans(response.scans)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcNotifications.scans.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [notification.id, t, token])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleFile(file: File | null) {
    if (!file) return
    if (file.type !== 'application/pdf') {
      setError(t('qcNotifications.scans.onlyPdf'))
      return
    }
    setUploading(true)
    setError(null)
    try {
      await uploadQcNotificationScan(token, notification.id, file)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcNotifications.scans.uploadFailed'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function viewScan(scanId: string) {
    try {
      const blob = await downloadQcNotificationScan(token, scanId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcNotifications.scans.loadFailed'))
    }
  }

  const verifiedScan = scans.find((scan) => scan.status === 'verified')
  const pendingScan = scans.find((scan) => scan.status === 'pending_verification')

  return (
    <div className="border-t border-slate-200 px-5 pb-3 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileCheck2 size={16} className="text-slate-600" />
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-700">
            {t('qcNotifications.scans.title')}
          </h3>
          {verifiedScan ? (
            <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 size={12} />
              {t('qcNotifications.scans.verified')}
            </span>
          ) : pendingScan ? (
            <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              <AlertTriangle size={12} />
              {t('qcNotifications.scans.pendingVerification')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {t('qcNotifications.scans.notUploaded')}
            </span>
          )}
        </div>
        {canUpload && (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            >
              <Upload size={13} />
              {uploading ? t('qcNotifications.scans.uploading') : t('qcNotifications.scans.upload')}
            </button>
          </div>
        )}
      </div>

      {canUpload && (
        <p className="mb-2 text-[11px] text-slate-500">{t('qcNotifications.scans.uploadHint')}</p>
      )}

      {error && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12px] text-rose-800">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <p className="py-2 text-[12px] text-slate-500">{t('common.loadingRecords')}</p>
      ) : scans.length === 0 ? (
        <p className="py-2 text-[12px] text-slate-500">{t('qcNotifications.scans.empty')}</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-slate-200">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">
                <th className="w-12 px-3 py-2 text-center">v</th>
                <th className="px-3 py-2">{t('qcNotifications.scans.uploadedAt')}</th>
                <th className="px-3 py-2">{t('common.status')}</th>
                <th className="px-3 py-2">{t('qcNotifications.scans.fileSize')}</th>
                <th className="px-3 py-2">{t('qcNotifications.scans.verifiedAt')}</th>
                <th className="px-3 py-2 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 text-center font-mono tabular-nums text-slate-500">{scan.version}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{formatDateTime(scan.uploaded_at, locale)}</td>
                  <td className="px-3 py-2">
                    <ScanStatusBadge status={scan.status} t={t} />
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-slate-600">{(scan.file_size / 1024).toFixed(1)} KB</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">
                    {scan.verified_at ? formatDateTime(scan.verified_at, locale) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => viewScan(scan.id)}
                      className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Eye size={12} />
                      {t('qcNotifications.scans.view')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ScanStatusBadge({ status, t }: { status: string; t: Translate }) {
  const styles: Record<string, string> = {
    pending_verification: 'border-amber-200 bg-amber-50 text-amber-700',
    verified: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rejected: 'border-rose-200 bg-rose-50 text-rose-700',
  }
  const labels: Record<string, string> = {
    pending_verification: t('qcNotifications.scans.statusPending'),
    verified: t('qcNotifications.scans.statusVerified'),
    rejected: t('qcNotifications.scans.statusRejected'),
  }
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${styles[status] ?? styles.pending_verification}`}>
      {labels[status] ?? status}
    </span>
  )
}
