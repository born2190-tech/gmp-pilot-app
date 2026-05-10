import { useI18n } from '../../i18n/I18nProvider'

const statusStyles: Record<string, string> = {
  quarantine: 'border-amber-200 bg-amber-50 text-amber-800',
  released: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rejected: 'border-red-200 bg-red-50 text-red-800',
  blocked: 'border-slate-300 bg-slate-100 text-slate-800',
  under_test: 'border-blue-200 bg-blue-50 text-blue-800',
  sampled: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  received: 'border-slate-200 bg-white text-slate-700',
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n()
  const key = `status.${status}` as Parameters<typeof t>[0]
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusStyles[status] ?? statusStyles.received}`}>{t(key)}</span>
}
