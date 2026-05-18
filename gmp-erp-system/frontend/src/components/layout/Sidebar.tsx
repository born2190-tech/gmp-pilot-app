import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { CurrentUser } from '../../types/auth'
import { getVisibleNavItems, groupNavBySections, SECTION_LABEL_KEYS } from '../../lib/permissions'
import { useI18n } from '../../i18n/I18nProvider'

interface SidebarProps {
  activeRoute: string
  onRouteChange: (route: string) => void
  user: CurrentUser
}

export function Sidebar({ activeRoute, onRouteChange, user }: SidebarProps) {
  const { t } = useI18n()
  const [isCollapsed, setIsCollapsed] = useState(false)

  const navItems = getVisibleNavItems(user)
  const sections = groupNavBySections(navItems)

  return (
    <aside
      className={`${
        isCollapsed ? 'w-16' : 'w-[248px]'
      } sticky top-0 flex h-screen flex-col overflow-x-hidden bg-[#0B1220] transition-all duration-300`}
    >
      {/* ── Brand block ─────────────────────────────────────── */}
      <div className="flex h-16 items-center border-b border-slate-800 px-4">
        {!isCollapsed ? (
          <div className="flex items-center gap-3">
            <B21LogoMark />
            <div>
              <div className="text-xl font-bold leading-none tracking-tight text-slate-50">B21</div>
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400">
                {t('app.console')}
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto">
            <B21LogoMark />
          </div>
        )}
      </div>

      {/* ── Navigation ──────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        {sections.map((group, idx) => (
          <div key={group.section} className={idx > 0 ? 'mt-7' : ''}>
            {!isCollapsed && (
              <>
                {idx > 0 && <div className="mb-3 h-px bg-slate-800" />}
                <div className="mb-2 px-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t(SECTION_LABEL_KEYS[group.section])}
                  </span>
                </div>
              </>
            )}
            {isCollapsed && idx > 0 && <div className="mx-2 my-3 h-px bg-slate-800" />}

            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = activeRoute === item.route
                return (
                  <button
                    key={`${item.section}-${item.route}-${item.labelKey}`}
                    type="button"
                    onClick={() => onRouteChange(item.route)}
                    title={isCollapsed ? t(item.labelKey) : undefined}
                    className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'bg-slate-800 text-slate-50'
                        : 'text-slate-300 hover:bg-slate-800/50 hover:text-slate-50'
                    } ${isCollapsed ? 'justify-center' : ''}`}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-7 w-0.5 -translate-y-1/2 rounded-r bg-cyan-400"
                      />
                    )}
                    <Icon size={18} strokeWidth={1.6} className="flex-shrink-0" />
                    {!isCollapsed && (
                      <span className="truncate text-[13.5px] font-medium leading-tight">
                        {t(item.labelKey)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer ─────────────────────────────────────────── */}
      <div className="border-t border-slate-800 p-3">
        {!isCollapsed && (
          <div className="mb-2 text-center text-[10.5px] tracking-wide text-slate-600">
            B21 · v0.4 · pilot
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsCollapsed((c) => !c)}
          className="flex w-full items-center justify-center rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          title={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  )
}

/** Геометрическая марка B21 — изометрический ромб со «спицами» внутри. */
function B21LogoMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-shrink-0"
      aria-hidden
    >
      <path
        d="M14 2L24 8V20L14 26L4 20V8L14 2Z"
        fill="#22d3ee"
        fillOpacity="0.12"
        stroke="#22d3ee"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M14 14L24 8M14 14L4 8M14 14V26"
        stroke="#22d3ee"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
