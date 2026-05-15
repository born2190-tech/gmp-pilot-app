import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './features/auth/LoginPage'
import { WarehouseDashboard } from './features/dashboard/WarehouseDashboard'
import { WarehouseCenterPage } from './features/inventory/WarehouseCenterPage'
import { WarehouseRegistryPage } from './features/inventory/WarehouseRegistryPage'
import { FGShipmentsPage } from './features/inventory/FGShipmentsPage'
import { InventoryCountPage } from './features/inventory/InventoryCountPage'
import { MovementsPage } from './features/inventory/MovementsPage'
import { QCNotificationsPage } from './features/inventory/QCNotificationsPage'
import { ReceiptDocumentPage } from './features/inventory/ReceiptDocumentPage'
import { WarehouseOperationsPage } from './features/inventory/WarehouseOperationsPage'
import { RequisitionsPage } from './features/inventory/RequisitionsPage'
import { MasterDataPage } from './features/master-data/MasterDataPage'
import { QualityBoardPage } from './features/quality/QualityBoardPage'
import { QCScanVerificationPage } from './features/quality/QCScanVerificationPage'
import { clearStoredToken, getStoredToken, storeToken } from './lib/auth'
import { login, logout, me } from './lib/api'
import { getVisibleNavItems } from './lib/permissions'
import type { CurrentUser, LoginRequest } from './types/auth'
import { useI18n } from './i18n/I18nProvider'

export function App() {
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(getStoredToken)
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [activeRoute, setActiveRoute] = useState('lots')

  useEffect(() => {
    let ignore = false
    async function loadUser() {
      if (!token) return
      setIsLoading(true)
      try {
        const currentUser = await me(token)
        if (!ignore) setUser(currentUser)
      } catch (err) {
        clearStoredToken()
        if (!ignore) {
          setToken(null)
          setUser(null)
          setError(err instanceof Error ? err.message : 'Session expired')
        }
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void loadUser()
    return () => {
      ignore = true
    }
  }, [token])

  async function handleLogin(payload: LoginRequest) {
    setIsLoading(true)
    setError(null)
    try {
      const response = await login(payload)
      storeToken(response.access_token)
      setToken(response.access_token)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleLogout() {
    if (token) {
      try {
        await logout(token)
      } catch {
        // Local logout still clears the browser session.
      }
    }
    clearStoredToken()
    setToken(null)
    setUser(null)
  }

  if (!token || !user) {
    return <LoginPage error={error} isLoading={isLoading} onLogin={handleLogin} />
  }

  const visibleNav = getVisibleNavItems(user)
  const route = visibleNav.some((item) => item.route === activeRoute) ? activeRoute : visibleNav[0]?.route
  const content =
    route === 'warehouse-center' ? (
      <WarehouseCenterPage token={token} />
    ) : route === 'lots' ? (
      <WarehouseRegistryPage token={token} />
    ) : route === 'movements' ? (
      <MovementsPage token={token} />
    ) : route === 'warehouse-operations' ? (
      <WarehouseOperationsPage token={token} user={user} />
    ) : route === 'requisitions' ? (
      <RequisitionsPage token={token} user={user} />
    ) : route === 'fg-shipments' ? (
      <FGShipmentsPage token={token} user={user} />
    ) : route === 'inventory-counts' ? (
      <InventoryCountPage token={token} user={user} />
    ) : route === 'qc-notifications' ? (
      <QCNotificationsPage token={token} user={user} />
    ) : route === 'receipt-documents' ? (
      <ReceiptDocumentPage token={token} user={user} username={user.username} />
    ) : route === 'master-data' ? (
      <MasterDataPage token={token} user={user} />
    ) : route === 'qc-tasks' ? (
      <QualityBoardPage mode="qc" token={token} user={user} />
    ) : route === 'qa-decisions' ? (
      <QualityBoardPage mode="qa" token={token} user={user} />
    ) : route === 'qa-scan-verification' ? (
      <QCScanVerificationPage token={token} user={user} />
    ) : (
      <WarehouseDashboard user={user} />
    )

  return (
    <AppShell activeRoute={route ?? 'lots'} onLogout={handleLogout} onRouteChange={setActiveRoute} user={user}>
      {content}
    </AppShell>
  )
}
