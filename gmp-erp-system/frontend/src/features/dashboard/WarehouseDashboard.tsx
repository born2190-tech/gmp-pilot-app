import type { CurrentUser } from '../../types/auth'
import { useI18n } from '../../i18n/I18nProvider'

interface WarehouseDashboardProps {
  user: CurrentUser
}

export function WarehouseDashboard({ user }: WarehouseDashboardProps) {
  const { t } = useI18n()
  const metrics = [
    t('dashboard.lotsRequiringAction'),
    t('dashboard.quarantine'),
    t('dashboard.released'),
    t('dashboard.expiredSoon'),
  ]

  return (
    <section>
      <div className="mb-5">
        <p className="text-xs uppercase text-slate-500">{t('dashboard.departmentDashboard')}</p>
        <h1 className="text-2xl font-semibold text-slate-950">{t('dashboard.warehouseOperations')}</h1>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {metrics.map((label) => (
          <article className="rounded-lg border border-slate-200 bg-white p-4" key={label}>
            <p className="text-xs uppercase text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">0</p>
          </article>
        ))}
      </div>
      <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-950">{t('dashboard.visibleScope')}</p>
        <p className="mt-1 text-sm text-slate-600">{user.warehouse_scope ?? t('dashboard.allWarehousesPermitted')}</p>
      </div>
    </section>
  )
}
