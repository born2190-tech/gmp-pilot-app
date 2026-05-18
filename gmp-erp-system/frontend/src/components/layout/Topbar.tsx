import { LogOut, Microscope, Settings, ShieldCheck, UserCog } from 'lucide-react'
import type { CurrentUser } from '../../types/auth'
import { useI18n } from '../../i18n/I18nProvider'
import { LanguageSwitcher } from './LanguageSwitcher'

interface TopbarProps {
  user: CurrentUser
  onLogout: () => void
}

/**
 * Иконка-роль в breadcrumb chip подбирается по permission-сигнатуре
 * пользователя. Не делаем enum роли на бэкенде — берём то что уже есть.
 */
function pickRoleIcon(user: CurrentUser) {
  const perms = new Set(user.permissions)
  if (perms.has('MANAGE_USERS')) return { Icon: Settings, key: 'role.admin' as const }
  if (perms.has('VIEW_QA')) return { Icon: ShieldCheck, key: 'role.qa' as const }
  if (perms.has('VIEW_QC')) return { Icon: Microscope, key: 'role.qc' as const }
  return { Icon: UserCog, key: 'role.warehouseOperator' as const }
}

function initials(fullName: string | null | undefined, username: string): string {
  const source = (fullName ?? username).trim()
  if (!source) return '??'
  const parts = source.split(/\s+/).slice(0, 2)
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || source.charAt(0).toUpperCase()
}

export function Topbar({ user, onLogout }: TopbarProps) {
  const { t } = useI18n()
  const { Icon: RoleIcon, key: roleKey } = pickRoleIcon(user)
  const scopeLabel = user.warehouse_scope
    ? t(`role.scope.${user.warehouse_scope}` as never)
    : t('topbar.allScopes')

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5">
      {/* ── Breadcrumb chip — кто я и где работаю ─────────── */}
      <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5">
        <RoleIcon size={14} className="text-slate-600" />
        <span className="text-[13px] font-medium text-slate-700">
          {t(roleKey)} <span className="text-slate-400">·</span> {scopeLabel}
        </span>
      </div>

      {/* ── Right cluster ──────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <LanguageSwitcher />

        <div className="hidden items-center gap-3 sm:flex">
          <div className="text-right">
            <div className="text-[13px] font-semibold leading-tight text-slate-900">
              {user.full_name || user.username}
            </div>
            <div className="text-[11px] leading-tight text-slate-500">{user.workstation_id}</div>
          </div>
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-[12px] font-semibold text-white"
            title={user.full_name || user.username}
          >
            {initials(user.full_name, user.username)}
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">{t('topbar.logout')}</span>
        </button>
      </div>
    </header>
  )
}
