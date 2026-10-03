import type { PropsWithChildren } from 'react'
import type { CurrentUser } from '../../types/auth'
import { useVirtualKeyboardOpen } from '../../lib/useVirtualKeyboard'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

interface AppShellProps {
  activeRoute: string
  onRouteChange: (route: string) => void
  user: CurrentUser
  onLogout: () => void
  badges?: Record<string, number>
}

export function AppShell({ activeRoute, badges, children, onLogout, onRouteChange, user }: PropsWithChildren<AppShellProps>) {
  // На планшете клавиатура съедает больше половины экрана — пока она открыта,
  // прячем верхнюю панель и боковое меню, отдавая всю высоту полям ввода.
  const keyboardOpen = useVirtualKeyboardOpen()
  return (
    <div className="flex min-h-screen bg-slate-50">
      {!keyboardOpen && (
        <Sidebar activeRoute={activeRoute} badges={badges} onRouteChange={onRouteChange} user={user} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {!keyboardOpen && <Topbar onLogout={onLogout} user={user} />}
        <main className={`flex-1 ${keyboardOpen ? 'p-1' : 'p-2 sm:p-3 xl:p-5'}`}>{children}</main>
      </div>
    </div>
  )
}
