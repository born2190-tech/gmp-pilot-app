import type { CurrentUser } from '../../types/auth'

interface WarehouseDashboardProps {
  user: CurrentUser
}

export function WarehouseDashboard({ user }: WarehouseDashboardProps) {
  return (
    <section>
      <div className="mb-5">
        <p className="text-xs uppercase text-slate-500">Department dashboard</p>
        <h1 className="text-2xl font-semibold text-slate-950">Warehouse Operations</h1>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {['Lots requiring action', 'Quarantine', 'Released', 'Expired soon'].map((label) => (
          <article className="rounded-lg border border-slate-200 bg-white p-4" key={label}>
            <p className="text-xs uppercase text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">0</p>
          </article>
        ))}
      </div>
      <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-950">Visible scope</p>
        <p className="mt-1 text-sm text-slate-600">{user.warehouse_scope ?? 'All warehouses permitted by role'}</p>
      </div>
    </section>
  )
}
