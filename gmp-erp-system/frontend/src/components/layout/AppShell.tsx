import type { PropsWithChildren } from 'react'
import type { CurrentUser } from '../../types/auth'
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
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar activeRoute={activeRoute} badges={badges} onRouteChange={onRouteChange} user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onLogout={onLogout} user={user} />
        <main className="flex-1 p-5">{children}</main>
      </div>
    </div>
  )
}
