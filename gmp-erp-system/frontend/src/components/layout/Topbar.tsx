import { LogOut } from 'lucide-react'
import type { CurrentUser } from '../../types/auth'
import { Button } from '../ui/button'
import { useI18n } from '../../i18n/I18nProvider'
import { LanguageSwitcher } from './LanguageSwitcher'

interface TopbarProps {
  user: CurrentUser
  onLogout: () => void
}

export function Topbar({ user, onLogout }: TopbarProps) {
  const { t } = useI18n()

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5">
      <div>
        <p className="text-xs uppercase text-slate-500">{t('topbar.currentAccess')}</p>
        <p className="text-sm font-medium text-slate-900">
          {user.role} · {user.department ?? t('topbar.noDepartment')} · {user.warehouse_scope ?? t('topbar.allScopes')}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        <div className="text-right">
          <p className="text-sm font-medium text-slate-900">{user.full_name}</p>
          <p className="text-xs text-slate-500">{user.workstation_id}</p>
        </div>
        <Button onClick={onLogout} variant="secondary">
          <LogOut className="mr-2 h-4 w-4" />
          {t('topbar.logout')}
        </Button>
      </div>
    </header>
  )
}
