import type { CurrentUser } from '../types/auth'
import type { TranslationKey } from '../i18n/translations'

export interface NavItem {
  labelKey: TranslationKey
  section: string
  permission: string
  route: string
  warehouseScopes?: string[]
}

const NAV_ITEMS: NavItem[] = [
  { labelKey: 'nav.receiptDocuments', section: 'warehouse', permission: 'CREATE_RECEIPT', route: 'receipt-documents' },
  { labelKey: 'nav.lots', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'lots' },
  { labelKey: 'nav.warehouseOperations', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'warehouse-operations' },
  { labelKey: 'nav.requisitionsIncoming', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'requisitions', warehouseScopes: ['SUBSTANCE_WAREHOUSE', 'PACKAGING_WAREHOUSE'] },
  { labelKey: 'nav.inventoryCounts', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'inventory-counts' },
  { labelKey: 'nav.qcNotifications', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'qc-notifications', warehouseScopes: ['SUBSTANCE_WAREHOUSE', 'PACKAGING_WAREHOUSE'] },
  { labelKey: 'nav.fgShipments', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'fg-shipments', warehouseScopes: ['FG_WAREHOUSE'] },
  { labelKey: 'nav.masterData', section: 'reference', permission: 'VIEW_MASTER_DATA', route: 'master-data' },
  { labelKey: 'nav.qcTasks', section: 'qc', permission: 'VIEW_QC', route: 'qc-tasks' },
  { labelKey: 'nav.qcNotifications', section: 'qc', permission: 'VIEW_QC', route: 'qc-notifications' },
  { labelKey: 'nav.qaDecisions', section: 'qa', permission: 'VIEW_QA', route: 'qa-decisions' },
  { labelKey: 'nav.qaScanVerification', section: 'qa', permission: 'VERIFY_QC_SCAN', route: 'qa-scan-verification' },
  { labelKey: 'nav.productionOrders', section: 'production', permission: 'VIEW_PRODUCTION', route: 'production-orders' },
  { labelKey: 'nav.requisitions', section: 'production', permission: 'VIEW_PRODUCTION', route: 'requisitions' },
  { labelKey: 'nav.bmr', section: 'production', permission: 'EXECUTE_BMR', route: 'bmr' },
  { labelKey: 'nav.audit', section: 'quality', permission: 'VIEW_AUDIT', route: 'audit' },
  { labelKey: 'nav.warehouseCenter', section: 'admin', permission: 'MANAGE_USERS', route: 'warehouse-center' },
  { labelKey: 'nav.admin', section: 'admin', permission: 'MANAGE_USERS', route: 'admin' },
]

export function getVisibleNavItems(user: CurrentUser): NavItem[] {
  const permissions = new Set(user.permissions)
  return NAV_ITEMS.filter((item) => permissions.has(item.permission) && (!item.warehouseScopes || !user.warehouse_scope || item.warehouseScopes.includes(user.warehouse_scope)))
}
