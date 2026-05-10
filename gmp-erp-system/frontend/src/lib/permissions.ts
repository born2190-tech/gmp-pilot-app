import type { CurrentUser } from '../types/auth'
import type { TranslationKey } from '../i18n/translations'

export interface NavItem {
  labelKey: TranslationKey
  section: string
  permission: string
  route: string
}

const NAV_ITEMS: NavItem[] = [
  { labelKey: 'nav.warehouseDashboard', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'warehouse-dashboard' },
  { labelKey: 'nav.receiptDocuments', section: 'warehouse', permission: 'CREATE_RECEIPT', route: 'receipt-documents' },
  { labelKey: 'nav.lots', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'lots' },
  { labelKey: 'nav.movements', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'movements' },
  { labelKey: 'nav.warehouseOperations', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'warehouse-operations' },
  { labelKey: 'nav.masterData', section: 'reference', permission: 'VIEW_MASTER_DATA', route: 'master-data' },
  { labelKey: 'nav.qcTasks', section: 'qc', permission: 'VIEW_QC', route: 'qc-tasks' },
  { labelKey: 'nav.qaDecisions', section: 'qa', permission: 'VIEW_QA', route: 'qa-decisions' },
  { labelKey: 'nav.productionOrders', section: 'production', permission: 'VIEW_PRODUCTION', route: 'production-orders' },
  { labelKey: 'nav.bmr', section: 'production', permission: 'EXECUTE_BMR', route: 'bmr' },
  { labelKey: 'nav.audit', section: 'quality', permission: 'VIEW_AUDIT', route: 'audit' },
  { labelKey: 'nav.admin', section: 'admin', permission: 'MANAGE_USERS', route: 'admin' },
]

export function getVisibleNavItems(user: CurrentUser): NavItem[] {
  const permissions = new Set(user.permissions)
  return NAV_ITEMS.filter((item) => permissions.has(item.permission))
}
