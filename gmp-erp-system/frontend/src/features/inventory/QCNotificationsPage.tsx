import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { useI18n } from '../../i18n/I18nProvider'
import { downloadQcNotificationPdf, listQcNotifications } from '../../lib/api'
import type { QCNotificationItem } from '../../types/inventory'

interface QCNotificationsPageProps {
  token: string
}

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

export function QCNotificationsPage({ token }: QCNotificationsPageProps) {
  const { locale, t } = useI18n()
  const [notifications, setNotifications] = useState<QCNotificationItem[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const response = await listQcNotifications(token)
      setNotifications(response.notifications)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcNotifications.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [token])

  const selectedNotification = notifications[0]

  async function handlePrint(notificationId: string, notificationNo: string) {
    try {
      const blob = await downloadQcNotificationPdf(token, notificationId)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `izveshchenie-${notificationNo}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcNotifications.printFailed'))
    }
  }

  const columns = useMemo<ColumnDef<QCNotificationItem>[]>(
    () => [
      { accessorKey: 'notified_at', header: t('qcNotifications.notifiedAt'), cell: ({ row }) => formatDateTime(row.original.notified_at, locale) },
      { accessorKey: 'notification_no', header: t('qcNotifications.notificationNo') },
      { accessorKey: 'warehouse_type', header: t('lots.warehouse') },
      { accessorKey: 'status', header: t('common.status') },
      {
        id: 'lines',
        header: t('qcNotifications.lines'),
        cell: ({ row }) =>
          row.original.lines
            .map((line) => `${line.material_name} / ${line.batch_number} / ${line.quantity} ${line.unit} / ${formatDate(line.expiry_date, locale)}`)
            .join('; '),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <button
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => handlePrint(row.original.id, row.original.notification_no)}
            type="button"
          >
            {t('qcNotifications.print')}
          </button>
        ),
      },
    ],
    [locale, t, token],
  )

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('qcNotifications.kicker')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('qcNotifications.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('qcNotifications.subtitle')}</p>
        </div>
        <button className="btn-secondary" onClick={loadData} type="button">{t('common.refresh')}</button>
      </div>

      {error && <p className="alert-error">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <div className="mb-3 flex justify-end">
            <input className="input w-96" onChange={(event) => setFilter(event.target.value)} placeholder={t('qcNotifications.search')} value={filter} />
          </div>
          <DataTable columns={columns} data={notifications} emptyLabel={t('qcNotifications.empty')} globalFilter={filter} isLoading={isLoading} />
        </div>

        <aside className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-950">{selectedNotification?.notification_no || t('qcNotifications.formTitle')}</h2>
            {selectedNotification && (
              <button
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => handlePrint(selectedNotification.id, selectedNotification.notification_no)}
                type="button"
              >
                {t('qcNotifications.print')}
              </button>
            )}
          </div>
          {selectedNotification ? (
            <div className="mt-4 space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-slate-500">{t('qcNotifications.notifiedAt')}</dt>
                  <dd className="font-medium text-slate-900">{formatDateTime(selectedNotification.notified_at, locale)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('lots.warehouse')}</dt>
                  <dd className="font-medium text-slate-900">{selectedNotification.warehouse_type}</dd>
                </div>
              </dl>
              <div className="space-y-3">
                {selectedNotification.lines.map((line) => (
                  <div className="rounded-md border border-slate-200 p-3" key={line.lot_id}>
                    <p className="font-semibold text-slate-950">{line.material_name}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div><dt className="text-slate-500">{t('qcNotifications.batch')}</dt><dd>{line.batch_number}</dd></div>
                      <div><dt className="text-slate-500">{t('lots.expiry')}</dt><dd>{formatDate(line.expiry_date, locale)}</dd></div>
                      <div><dt className="text-slate-500">{t('lots.qty')}</dt><dd>{line.quantity} {line.unit}</dd></div>
                      <div><dt className="text-slate-500">{t('lots.manufacturer')}</dt><dd>{line.manufacturer_name}</dd></div>
                    </dl>
                    <p className="mt-2 text-xs text-slate-600">{line.invoice_info}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{t('qcNotifications.empty')}</p>
          )}
        </aside>
      </div>
    </section>
  )
}
