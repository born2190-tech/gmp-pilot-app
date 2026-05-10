import type { CurrentUser } from '../types/auth'

export interface NavItem {
  label: string
  section: string
  permission: string
  route: string
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Warehouse Dashboard', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'warehouse-dashboard' },
  { label: 'Receipt Documents', section: 'warehouse', permission: 'CREATE_RECEIPT', route: 'receipt-documents' },
  { label: 'Lots / Series', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'lots' },
  { label: 'Inventory Movements', section: 'warehouse', permission: 'VIEW_WAREHOUSE', route: 'movements' },
  { label: 'Master Data', section: 'reference', permission: 'VIEW_MASTER_DATA', route: 'master-data' },
  { label: 'QC Tasks', section: 'qc', permission: 'VIEW_QC', route: 'qc-tasks' },
  { label: 'QA Decisions', section: 'qa', permission: 'VIEW_QA', route: 'qa-decisions' },
  { label: 'Production Orders', section: 'production', permission: 'VIEW_PRODUCTION', route: 'production-orders' },
  { label: 'BMR / ZPS', section: 'production', permission: 'EXECUTE_BMR', route: 'bmr' },
  { label: 'Audit Trail', section: 'quality', permission: 'VIEW_AUDIT', route: 'audit' },
  { label: 'Administration', section: 'admin', permission: 'MANAGE_USERS', route: 'admin' },
]

export function getVisibleNavItems(user: CurrentUser): NavItem[] {
  const permissions = new Set(user.permissions)
  return NAV_ITEMS.filter((item) => permissions.has(item.permission))
}
