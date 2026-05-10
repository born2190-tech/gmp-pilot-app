import type { PropsWithChildren } from 'react'
import type { CurrentUser } from '../../types/auth'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

interface AppShellProps {
  activeRoute: string
  onRouteChange: (route: string) => void
  user: CurrentUser
  onLogout: () => void
}

export function AppShell({ activeRoute, children, onLogout, onRouteChange, user }: PropsWithChildren<AppShellProps>) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar activeRoute={activeRoute} onRouteChange={onRouteChange} user={user} />
      <div className="min-w-0 flex-1">
        <Topbar onLogout={onLogout} user={user} />
        <main className="p-5">{children}</main>
      </div>
    </div>
  )
}
