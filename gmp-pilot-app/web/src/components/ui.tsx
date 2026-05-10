import type { PropsWithChildren } from 'react'
import { cn } from '../lib/cn'

export function Card({ className, children }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm', className)}>{children}</div>
}

export function Badge({ className, children }: PropsWithChildren<{ className?: string }>) {
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', className)}>{children}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    received: 'bg-zinc-600 text-white',
    quarantine: 'bg-amber-700 text-white',
    sampled: 'bg-violet-700 text-white',
    under_test: 'bg-blue-700 text-white',
    released: 'bg-emerald-700 text-white',
    blocked: 'bg-slate-700 text-white',
    rejected: 'bg-red-700 text-white',
    expired: 'bg-orange-700 text-white',
  }

  return <Badge className={cn(map[status] ?? 'bg-zinc-500 text-white')}>{status}</Badge>
}
