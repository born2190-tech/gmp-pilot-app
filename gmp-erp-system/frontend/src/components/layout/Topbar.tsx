import {
  Factory,
  HardHat,
  LogOut,
  Microscope,
  Settings,
  ShieldCheck,
  UserCog,
  Warehouse,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { CurrentUser } from '../../types/auth'
import { useI18n } from '../../i18n/I18nProvider'
import { LanguageSwitcher } from './LanguageSwitcher'

interface TopbarProps {
  user: CurrentUser
  onLogout: () => void
}

type RoleVisual = {
  Icon: ComponentType<{ size?: number; className?: string }>
  key: string
}

/**
 * Отображаемое название роли. Берём напрямую `user.role` (код от бэкенда),
 * чтобы не путать «Заведующего складом» с «Помощником» — у них одинаковые
 * права кроме VIEW_AUDIT, но это разные должности по штату Novugen.
 *
 * Согласно решению пилота: оперативный доступ в B21 имеют только зав.
 * склада, его помощник и сотрудники ОКК/ОКА/админа. Рядовые кладовщики
 * физически работают на складе, в систему не заходят.
 */
const ROLE_VISUAL: Record<string, RoleVisual> = {
  WAREHOUSE_MANAGER:   { Icon: Warehouse,   key: 'role.warehouseManager'    },
  WAREHOUSE_OPERATOR:  { Icon: HardHat,     key: 'role.warehouseDeputy'     }, // помощник зав. склада
  QC_ANALYST:          { Icon: Microscope,  key: 'role.qcAnalyst'           },
  HEAD_QC:             { Icon: Microscope,  key: 'role.headQc'              },
  QA_MANAGER:          { Icon: ShieldCheck, key: 'role.qaManager'           },
  HEAD_QA:             { Icon: ShieldCheck, key: 'role.headQa'              },
  PRODUCTION_OPERATOR: { Icon: Factory,     key: 'role.productionOperator'  },
  SHIFT_MASTER:        { Icon: Factory,     key: 'role.shiftMaster'         },
  HEAD_PRODUCTION:     { Icon: Factory,     key: 'role.headProduction'      },
  WORKSHOP_HEAD:       { Icon: Factory,     key: 'role.workshopHead'        },
  TECHNOLOGIST:        { Icon: Factory,     key: 'role.technologist'        },
  CHIEF_TECHNOLOGIST:  { Icon: Factory,     key: 'role.chiefTechnologist'   },
  SYS_ADMIN:           { Icon: Settings,    key: 'role.sysAdmin'            },
}

function pickRoleIcon(user: CurrentUser): RoleVisual {
  return ROLE_VISUAL[user.role] ?? { Icon: UserCog, key: 'role.unknown' }
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
          {t(roleKey as never)} <span className="text-slate-400">·</span> {scopeLabel}
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
