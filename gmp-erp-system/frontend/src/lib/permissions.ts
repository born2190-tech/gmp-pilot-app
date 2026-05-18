import {
  ArrowLeftRight,
  BellRing,
  BookMarked,
  ClipboardList,
  ClipboardSignature,
  Database,
  Factory,
  History,
  ListChecks,
  Microscope,
  PackagePlus,
  ScanLine,
  Send,
  Settings2,
  ShieldCheck,
  Truck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import type { CurrentUser } from '../types/auth'
import type { TranslationKey } from '../i18n/translations'

export type NavSection = 'warehouse' | 'qc' | 'qa' | 'production' | 'quality' | 'admin'

export interface NavItem {
  labelKey: TranslationKey
  section: NavSection
  permission: string
  route: string
  icon: LucideIcon
  warehouseScopes?: string[]
}

/**
 * Порядок и группировка пунктов меню соответствуют дизайн-системе B21:
 * каждая вкладка получает индивидуальную иконку, секции разделены и
 * отображаются заголовками в боковой панели.
 */
const NAV_ITEMS: NavItem[] = [
  // ─── Склад ────────────────────────────────────────────────────────────
  { labelKey: 'nav.receiptDocuments',     section: 'warehouse', permission: 'CREATE_RECEIPT',  route: 'receipt-documents',    icon: PackagePlus },
  { labelKey: 'nav.lots',                 section: 'warehouse', permission: 'VIEW_WAREHOUSE',  route: 'lots',                 icon: BookMarked },
  { labelKey: 'nav.warehouseOperations',  section: 'warehouse', permission: 'VIEW_WAREHOUSE',  route: 'warehouse-operations', icon: ArrowLeftRight },
  { labelKey: 'nav.requisitionsIncoming', section: 'warehouse', permission: 'VIEW_WAREHOUSE',  route: 'requisitions',         icon: ClipboardList, warehouseScopes: ['SUBSTANCE_WAREHOUSE', 'PACKAGING_WAREHOUSE'] },
  { labelKey: 'nav.inventoryCounts',      section: 'warehouse', permission: 'VIEW_WAREHOUSE',  route: 'inventory-counts',     icon: ListChecks },
  { labelKey: 'nav.qcNotifications',      section: 'warehouse', permission: 'VIEW_WAREHOUSE',  route: 'qc-notifications',     icon: BellRing, warehouseScopes: ['SUBSTANCE_WAREHOUSE', 'PACKAGING_WAREHOUSE'] },
  { labelKey: 'nav.fgShipments',          section: 'warehouse', permission: 'VIEW_WAREHOUSE',  route: 'fg-shipments',         icon: Truck, warehouseScopes: ['FG_WAREHOUSE'] },

  // ─── ОКК ──────────────────────────────────────────────────────────────
  { labelKey: 'nav.qcTasks',              section: 'qc',         permission: 'VIEW_QC',         route: 'qc-tasks',             icon: Microscope },
  { labelKey: 'nav.qcNotifications',      section: 'qc',         permission: 'VIEW_QC',         route: 'qc-notifications',     icon: BellRing },

  // ─── ОКА ──────────────────────────────────────────────────────────────
  { labelKey: 'nav.qaDecisions',          section: 'qa',         permission: 'VIEW_QA',         route: 'qa-decisions',         icon: ShieldCheck },
  { labelKey: 'nav.qaScanVerification',   section: 'qa',         permission: 'VERIFY_QC_SCAN',  route: 'qa-scan-verification', icon: ScanLine },

  // ─── Производство ─────────────────────────────────────────────────────
  { labelKey: 'nav.productionOrders',     section: 'production', permission: 'VIEW_PRODUCTION', route: 'production-orders',    icon: Factory },
  { labelKey: 'nav.requisitions',         section: 'production', permission: 'VIEW_PRODUCTION', route: 'requisitions',         icon: Send },
  { labelKey: 'nav.bmr',                  section: 'production', permission: 'EXECUTE_BMR',     route: 'bmr',                  icon: ClipboardSignature },

  // ─── Качество (общесистемное) ─────────────────────────────────────────
  { labelKey: 'nav.audit',                section: 'quality',    permission: 'VIEW_AUDIT',      route: 'audit',                icon: History },

  // ─── Администрирование ────────────────────────────────────────────────
  { labelKey: 'nav.warehouseCenter',      section: 'admin',      permission: 'MANAGE_USERS',          route: 'warehouse-center', icon: Warehouse },
  { labelKey: 'nav.masterData',           section: 'admin',      permission: 'MANAGE_MASTER_DATA',    route: 'master-data',      icon: Database },
  { labelKey: 'nav.admin',                section: 'admin',      permission: 'MANAGE_USERS',          route: 'admin',            icon: Settings2 },
]

export const SECTION_LABEL_KEYS: Record<NavSection, TranslationKey> = {
  warehouse: 'nav.section.warehouse',
  qc:        'nav.section.qc',
  qa:        'nav.section.qa',
  production:'nav.section.production',
  quality:   'nav.section.quality',
  admin:     'nav.section.admin',
}

// Порядок секций в боковой панели.
export const SECTION_ORDER: NavSection[] = ['warehouse', 'qc', 'qa', 'production', 'quality', 'admin']

export function getVisibleNavItems(user: CurrentUser): NavItem[] {
  const permissions = new Set(user.permissions)
  return NAV_ITEMS.filter(
    (item) =>
      permissions.has(item.permission) &&
      (!item.warehouseScopes || !user.warehouse_scope || item.warehouseScopes.includes(user.warehouse_scope)),
  )
}

/**
 * Группирует видимые пункты по секциям — используется в Sidebar для
 * отрисовки заголовков. Пустые секции автоматически отсутствуют.
 */
export function groupNavBySections(items: NavItem[]): { section: NavSection; items: NavItem[] }[] {
  const map = new Map<NavSection, NavItem[]>()
  for (const item of items) {
    if (!map.has(item.section)) map.set(item.section, [])
    map.get(item.section)!.push(item)
  }
  return SECTION_ORDER.filter((s) => map.has(s)).map((s) => ({ section: s, items: map.get(s)! }))
}
