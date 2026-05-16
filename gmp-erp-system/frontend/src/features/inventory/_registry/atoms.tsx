// Helper hooks, sorting, and small atoms shared by WarehouseRegistryPage.
import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  ArrowUpDown,
  CalendarRange,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

export type SortDir = 'asc' | 'desc'
export interface SortState {
  key: string
  dir: SortDir
}

// Russian-aware string comparator. Treats empty values as "last" so they sink
// regardless of direction (TanStack `sortUndefined: 'last'` parity).
const ruCollator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true })

export function ruCompare(a: unknown, b: unknown): number {
  const av = (a ?? '').toString().trim()
  const bv = (b ?? '').toString().trim()
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  return ruCollator.compare(av, bv)
}

export function dateCompare(a: string | null | undefined, b: string | null | undefined): number {
  const av = a ?? ''
  const bv = b ?? ''
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  return av < bv ? -1 : av > bv ? 1 : 0
}

export function numCompare(a: number, b: number): number {
  return a - b
}

export function useSort(initial: SortState): {
  sort: SortState
  setSort: Dispatch<SetStateAction<SortState>>
  onSort: (key: string) => void
} {
  const [sort, setSort] = useState<SortState>(initial)
  const onSort = useCallback((key: string) => {
    setSort((current) => (current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }, [])
  return { sort, setSort, onSort }
}

export function useEscape(handler: () => void): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') handler()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handler])
}

export function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

export function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function formatShortDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null
  const target = new Date(iso)
  const now = new Date()
  const ms = target.getTime() - new Date(now.toDateString()).getTime()
  return Math.round(ms / 86_400_000)
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface SortHeaderProps {
  label: string
  sortKey: string
  sort: SortState
  onSort: (key: string) => void
  align?: 'left' | 'right'
}

export function SortHeader({ label, sortKey, sort, onSort, align = 'left' }: SortHeaderProps) {
  const active = sort.key === sortKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider ${
        active ? 'text-slate-900' : 'text-slate-500'
      } ${align === 'right' ? 'justify-end' : ''}`}
    >
      {label}
      {active ? (
        sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
      ) : (
        <ArrowUpDown size={12} className="opacity-40" />
      )}
    </button>
  )
}

interface ChipProps {
  active?: boolean
  onClick?: () => void
  children: ReactNode
}

export function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  )
}

interface SegmentOption<V extends string> {
  value: V
  label: string
  icon?: typeof CalendarRange
}

interface SegmentedControlProps<V extends string> {
  options: SegmentOption<V>[]
  value: V
  onChange: (value: V) => void
}

export function SegmentedControl<V extends string>({ options, value, onChange }: SegmentedControlProps<V>) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-slate-100/60 p-0.5">
      {options.map((option) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition ${
              active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {Icon && <Icon size={13} />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

interface KpiTileProps {
  icon: typeof CalendarRange
  label: string
  value: ReactNode
  sub?: string
  accent: string
  active?: boolean
  onClick?: () => void
}

export function KpiTile({ icon: IconComponent, label, value, sub, accent, active, onClick }: KpiTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-[180px] items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${
        active
          ? 'border-slate-900 bg-slate-50'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/40'
      }`}
    >
      <span className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md ${accent}`}>
        <IconComponent size={14} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
        <p className="font-mono text-[20px] font-semibold leading-tight tabular-nums text-slate-950">{value}</p>
        {sub && <p className="truncate text-[11px] text-slate-500">{sub}</p>}
      </div>
    </button>
  )
}

interface MovementBadgeProps {
  rawType: string
  label: string
}

export const MOVEMENT_TYPE_STYLES: Record<string, { icon: string; bg: string; text: string; border: string }> = {
  RECEIPT:           { icon: '↓', bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  SHIPMENT:          { icon: '↑', bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200'   },
  TRANSFER:          { icon: '⇆', bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200'  },
  ADJUSTMENT:        { icon: '△', bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  ISSUE_PRODUCTION:  { icon: '↑', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200'},
  INVENTORY_COUNT:   { icon: '≡', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200'},
  RETURN:            { icon: '↩', bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200'},
}

export function MovementTypeBadge({ rawType, label }: MovementBadgeProps) {
  const style = MOVEMENT_TYPE_STYLES[rawType.toUpperCase()] ?? {
    icon: '•',
    bg: 'bg-gray-50',
    text: 'text-gray-600',
    border: 'border-gray-200',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text} ${style.border}`}
    >
      <span className="text-sm leading-none">{style.icon}</span>
      {label}
    </span>
  )
}
