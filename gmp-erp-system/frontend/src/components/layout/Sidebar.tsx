import { Boxes, ClipboardList, Factory, FileClock, FlaskConical, ShieldCheck, Warehouse } from 'lucide-react'
import type { CurrentUser } from '../../types/auth'
import { getVisibleNavItems } from '../../lib/permissions'
import { useI18n } from '../../i18n/I18nProvider'

const iconBySection = {
  warehouse: Warehouse,
  reference: ClipboardList,
  qc: FlaskConical,
  qa: ShieldCheck,
  production: Factory,
  quality: FileClock,
  admin: ClipboardList,
}

interface SidebarProps {
  activeRoute: string
  onRouteChange: (route: string) => void
  user: CurrentUser
}

export function Sidebar({ activeRoute, onRouteChange, user }: SidebarProps) {
  const navItems = getVisibleNavItems(user)
  const { t } = useI18n()

  return (
    <aside className="min-h-screen w-72 border-r border-slate-800 bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mb-7 flex items-center gap-2">
        <div className="rounded-md bg-blue-700 p-2">
          <Boxes className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs uppercase text-slate-400">GMP ERP</p>
          <p className="text-sm font-semibold">{t('app.console')}</p>
        </div>
      </div>

      <nav className="space-y-1">
        {navItems.map((item) => {
          const Icon = iconBySection[item.section as keyof typeof iconBySection] ?? ClipboardList
          return (
            <button
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                activeRoute === item.route ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-900'
              }`}
              key={item.route}
              onClick={() => onRouteChange(item.route)}
              type="button"
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
