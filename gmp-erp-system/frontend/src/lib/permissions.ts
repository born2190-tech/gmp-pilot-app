import type { CurrentUser } from '../types/auth'

export interface NavItem {
  label: string
  section: string
  permission: string
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Warehouse Dashboard', section: 'warehouse', permission: 'VIEW_WAREHOUSE' },
  { label: 'Receipt Documents', section: 'warehouse', permission: 'CREATE_RECEIPT' },
  { label: 'Lots / Series', section: 'warehouse', permission: 'VIEW_WAREHOUSE' },
  { label: 'Inventory Movements', section: 'warehouse', permission: 'VIEW_WAREHOUSE' },
  { label: 'QC Tasks', section: 'qc', permission: 'VIEW_QC' },
  { label: 'QA Decisions', section: 'qa', permission: 'VIEW_QA' },
  { label: 'Production Orders', section: 'production', permission: 'VIEW_PRODUCTION' },
  { label: 'BMR / ZPS', section: 'production', permission: 'EXECUTE_BMR' },
  { label: 'Audit Trail', section: 'quality', permission: 'VIEW_AUDIT' },
  { label: 'Administration', section: 'admin', permission: 'MANAGE_USERS' },
]

export function getVisibleNavItems(user: CurrentUser): NavItem[] {
  const permissions = new Set(user.permissions)
  return NAV_ITEMS.filter((item) => permissions.has(item.permission))
}
