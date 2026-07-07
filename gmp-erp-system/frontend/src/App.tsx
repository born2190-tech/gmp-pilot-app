import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './features/auth/LoginPage'
import { WarehouseDashboard } from './features/dashboard/WarehouseDashboard'
import { WarehouseCenterPage } from './features/inventory/WarehouseCenterPage'
import { WarehouseRegistryPage } from './features/inventory/WarehouseRegistryPage'
import { WarehouseAccountsPage } from './features/inventory/WarehouseAccountsPage'
import { InventoryAccountsAdminPage } from './features/inventory/InventoryAccountsAdminPage'
import { FGShipmentsPage } from './features/inventory/FGShipmentsPage'
import { FGTransferNotesPage } from './features/inventory/FGTransferNotesPage'
import { FGRegistryPage } from './features/inventory/FGRegistryPage'
import { FGQuarantinePage } from './features/inventory/FGQuarantinePage'
import { FGJournalsPage } from './features/inventory/FGJournalsPage'
import { InventoryCountPage } from './features/inventory/InventoryCountPage'
import { MovementsPage } from './features/inventory/MovementsPage'
import { QCNotificationsPage } from './features/inventory/QCNotificationsPage'
import { ReceiptDocumentPage } from './features/inventory/ReceiptDocumentPage'
import { WarehouseOperationsPage } from './features/inventory/WarehouseOperationsPage'
import { RequisitionsPage } from './features/inventory/RequisitionsPage'
import { MasterDataPage } from './features/master-data/MasterDataPage'
import { QualityBoardPage } from './features/quality/QualityBoardPage'
import { BmrIssuancePage } from './features/quality/BmrIssuancePage'
import { QCScanVerificationPage } from './features/quality/QCScanVerificationPage'
import { SpecificationsAdminPage } from './features/quality/SpecificationsAdminPage'
import { EquipmentAdminPage } from './features/quality/EquipmentAdminPage'
import { ReagentsRegistryPage } from './features/quality/ReagentsRegistryPage'
import { ProductionBatchesPage } from './features/production/ProductionBatchesPage'
import { BmrTemplatesPage } from './features/production/BmrTemplatesPage'
import { BmrFillPage } from './features/production/BmrFillPage'
import { WeighingCampaignPage } from './features/production/WeighingCampaignPage'
import { clearStoredToken, getStoredToken, storeToken } from './lib/auth'
import { login, logout, me, listFgTransferNotes } from './lib/api'
import { getVisibleNavItems } from './lib/permissions'
import type { CurrentUser, LoginRequest } from './types/auth'
import { useI18n } from './i18n/I18nProvider'
import { LogOut } from 'lucide-react'

export function App() {
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(getStoredToken)
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [activeRoute, setActiveRoute] = useState('lots')
  const [navBadges, setNavBadges] = useState<Record<string, number>>({})

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

  // Бейдж «ожидают приёмки»: число непринятых накладных ГП (СОП-414 Ф-5) для
  // склада. Обновляется при смене раздела — уведомление, что пришла накладная.
  useEffect(() => {
    let ignore = false
    async function loadBadges() {
      if (!token || !user || !user.permissions.includes('RECEIVE_FINISHED_GOODS')) return
      try {
        const res = await listFgTransferNotes(token)
        const pending = res.notes.filter((note) => note.status === 'issued').length
        if (!ignore) setNavBadges((current) => ({ ...current, 'fg-transfer-receive': pending }))
      } catch {
        // Бейдж — вспомогательный индикатор, ошибку загрузки игнорируем.
      }
    }
    void loadBadges()
    return () => {
      ignore = true
    }
  }, [token, user, activeRoute])

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

  if (user.role === 'PRODUCTION_OPERATOR') {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="rounded-full bg-blue-50 px-3 py-1 text-[12px] font-semibold text-blue-700">
            {t('role.productionOperator')} · {user.workstation_id}
          </div>
          <div className="ml-auto text-right">
            <div className="text-[13px] font-semibold text-slate-900">{user.full_name}</div>
            <div className="text-[11px] text-slate-500">{t('app.operatorOnlyBmr')}</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <LogOut size={15} />
            {t('topbar.logout')}
          </button>
        </div>
        <BmrFillPage token={token} user={user} />
      </div>
    )
  }

  const visibleNav = getVisibleNavItems(user)
  const route = visibleNav.some((item) => item.route === activeRoute) ? activeRoute : visibleNav[0]?.route
  const content =
    route === 'warehouse-center' ? (
      <WarehouseCenterPage token={token} />
    ) : route === 'lots' ? (
      <WarehouseRegistryPage token={token} />
    ) : route === 'warehouse-accounts' ? (
      <WarehouseAccountsPage token={token} />
    ) : route === 'movements' ? (
      <MovementsPage token={token} />
    ) : route === 'warehouse-operations' ? (
      <WarehouseOperationsPage token={token} user={user} />
    ) : route === 'production-orders' ? (
      <ProductionBatchesPage token={token} user={user} />
    ) : route === 'bmr-templates' ? (
      <BmrTemplatesPage token={token} user={user} />
    ) : route === 'bmr' ? (
      <BmrFillPage token={token} user={user} />
    ) : route === 'weighing-campaigns' ? (
      <WeighingCampaignPage token={token} user={user} />
    ) : route === 'requisitions' ? (
      <RequisitionsPage token={token} user={user} />
    ) : route === 'fg-shipments' ? (
      <FGShipmentsPage token={token} user={user} />
    ) : route === 'fg-transfer-notes' || route === 'fg-transfer-receive' ? (
      <FGTransferNotesPage token={token} user={user} />
    ) : route === 'fg-registry' ? (
      <FGRegistryPage token={token} user={user} />
    ) : route === 'fg-quarantine-qa' ? (
      <FGQuarantinePage token={token} user={user} />
    ) : route === 'fg-journals' ? (
      <FGJournalsPage token={token} />
    ) : route === 'inventory-counts' ? (
      <InventoryCountPage token={token} user={user} />
    ) : route === 'qc-notifications' ? (
      <QCNotificationsPage token={token} user={user} />
    ) : route === 'receipt-documents' ? (
      <ReceiptDocumentPage token={token} user={user} username={user.username} />
    ) : route === 'master-data' ? (
      <MasterDataPage token={token} user={user} />
    ) : route === 'inventory-accounts' ? (
      <InventoryAccountsAdminPage token={token} user={user} />
    ) : route === 'qc-tasks' ? (
      <QualityBoardPage mode="qc" token={token} user={user} />
    ) : route === 'qc-specifications' ? (
      <SpecificationsAdminPage token={token} user={user} />
    ) : route === 'qc-equipment' ? (
      <EquipmentAdminPage token={token} user={user} />
    ) : route === 'qc-reagents' ? (
      <ReagentsRegistryPage token={token} user={user} />
    ) : route === 'qa-decisions' ? (
      <QualityBoardPage mode="qa" token={token} user={user} />
    ) : route === 'qa-bmr-issue' ? (
      <BmrIssuancePage token={token} user={user} />
    ) : route === 'qa-scan-verification' ? (
      <QCScanVerificationPage token={token} user={user} />
    ) : (
      <WarehouseDashboard user={user} />
    )

  return (
    <AppShell activeRoute={route ?? 'lots'} badges={navBadges} onLogout={handleLogout} onRouteChange={setActiveRoute} user={user}>
      {content}
    </AppShell>
  )
}
