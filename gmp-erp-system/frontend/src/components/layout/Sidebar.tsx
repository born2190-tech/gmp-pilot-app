import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { CurrentUser } from '../../types/auth'
import { getVisibleNavItems, groupNavBySections, SECTION_LABEL_KEYS } from '../../lib/permissions'
import { useI18n } from '../../i18n/I18nProvider'

interface SidebarProps {
  activeRoute: string
  onRouteChange: (route: string) => void
  user: CurrentUser
  badges?: Record<string, number>
}

export function Sidebar({ activeRoute, badges, onRouteChange, user }: SidebarProps) {
  const { t } = useI18n()
  // На планшетах (узкий экран) меню стартует свёрнутым: на 1280px развёрнутая
  // панель съедает 248px, из-за чего таблицы BMR не помещаются и уходят в
  // горизонтальный скролл. Пользователь может развернуть вручную.
  const [isCollapsed, setIsCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1536,
  )

  const navItems = getVisibleNavItems(user)
  const sections = groupNavBySections(navItems)

  return (
    <aside
      className={`${
        isCollapsed ? 'w-[88px]' : 'w-[248px]'
      } sticky top-0 flex h-screen flex-col overflow-x-hidden bg-[#0B1220] transition-all duration-300`}
    >
      {/* ── Brand block ─────────────────────────────────────── */}
      <div className="flex h-16 items-center border-b border-[#1e293b] px-4">
        {!isCollapsed ? (
          <div className="flex items-center gap-3">
            <B21LogoMark />
            <div>
              <div className="text-xl font-bold leading-none tracking-tight text-[#f8fafc]">B21</div>
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-[#94a3b8]">
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
                {idx > 0 && <div className="mb-3 h-px bg-[#1e293b]" />}
                <div className="mb-2 px-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#f8fafc]0">
                    {t(SECTION_LABEL_KEYS[group.section])}
                  </span>
                </div>
              </>
            )}
            {isCollapsed && idx > 0 && <div className="mx-2 my-3 h-px bg-[#1e293b]" />}

            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = activeRoute === item.route
                const badge = badges?.[item.route] ?? 0
                return (
                  <button
                    key={`${item.section}-${item.route}-${item.labelKey}`}
                    type="button"
                    onClick={() => onRouteChange(item.route)}
                    title={isCollapsed ? t(item.labelKey) : undefined}
                    className={`relative flex w-full rounded-lg text-left transition-colors ${
                      active
                        ? 'bg-[#334155] text-white'
                        : // Высокий контраст: на планшете экран бликует, и слабые
                          // серые тона на тёмном фоне становятся нечитаемыми.
                          'text-[#f1f5f9] hover:bg-[#1e293b]/60 hover:text-white'
                    } ${
                      // Свёрнутый режим (планшет): иконка + короткая подпись
                      // столбиком — видно, куда тапаешь, но узко.
                      isCollapsed
                        ? 'flex-col items-center gap-1 px-1 py-2'
                        : 'items-center gap-3 px-3 py-2.5'
                    }`}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-7 w-0.5 -translate-y-1/2 rounded-r bg-[#22d3ee]"
                      />
                    )}
                    <span className="relative flex-shrink-0">
                      <Icon size={isCollapsed ? 22 : 18} strokeWidth={isCollapsed ? 2.1 : 1.6} />
                      {isCollapsed && badge > 0 && (
                        <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#fbbf24] ring-2 ring-[#0B1220]" />
                      )}
                    </span>
                    {isCollapsed ? (
                      <span className={`line-clamp-2 w-full px-0.5 text-center text-[11px] font-semibold leading-[1.2] ${active ? 'text-white' : 'text-[#f1f5f9]'}`}>
                        {t(item.labelKey)}
                      </span>
                    ) : (
                      <span className="truncate text-[13.5px] font-medium leading-tight">
                        {t(item.labelKey)}
                      </span>
                    )}
                    {!isCollapsed && badge > 0 && (
                      <span className="ml-auto flex-shrink-0 rounded-full bg-[#fbbf24] px-2 py-0.5 text-[11px] font-bold leading-none text-[#0f172a]">
                        {badge}
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
      <div className="border-t border-[#1e293b] p-3">
        {!isCollapsed && (
          <div className="mb-2 text-center text-[10.5px] tracking-wide text-[#94a3b8]">
            B21 · v0.4 · pilot
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsCollapsed((c) => !c)}
          className="flex w-full items-center justify-center rounded-md p-1.5 text-[#f8fafc]0 transition-colors hover:bg-[#1e293b] hover:text-[#f1f5f9]"
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
