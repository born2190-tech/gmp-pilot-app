import { useMemo, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { StatusBadge } from './ui'
import type { LotItem } from '../lib/types'

interface LotsTableProps {
  lots: LotItem[]
  isLoading: boolean
  formatDate: (value: string | null) => string
}

const columnHelper = createColumnHelper<LotItem>()

export function LotsTable({ lots, isLoading, formatDate }: LotsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('internal_lot', {
        header: 'Lot',
        cell: (info) => <span className="font-mono text-xs text-zinc-700">{info.getValue()}</span>,
      }),
      columnHelper.display({
        id: 'material',
        header: 'Material',
        cell: (info) => (
          <div>
            <p className="font-medium text-zinc-900">{info.row.original.material_code}</p>
            <p className="text-xs text-zinc-500">{info.row.original.material_name}</p>
          </div>
        ),
      }),
      columnHelper.accessor('quality_status', {
        header: 'Status',
        cell: (info) => <StatusBadge status={info.getValue()} />,
      }),
      columnHelper.display({
        id: 'qc_dates',
        header: 'QC dates',
        cell: (info) => (
          <div className="text-xs text-zinc-600">
            <p>notified: {formatDate(info.row.original.incoming_control_notified_at)}</p>
            <p>received: {formatDate(info.row.original.qc_result_received_at)}</p>
          </div>
        ),
      }),
    ],
    [formatDate],
  )

  const table = useReactTable({
    data: lots,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-[0.06em] text-zinc-500">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th className="px-3 py-2 text-left" key={header.id}>
                  {header.isPlaceholder ? null : (
                    <button
                      className="inline-flex items-center gap-1"
                      onClick={header.column.getToggleSortingHandler()}
                      type="button"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' ? '↑' : header.column.getIsSorted() === 'desc' ? '↓' : ''}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr className="border-t border-zinc-100" key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td className="px-3 py-2" key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!isLoading && lots.length === 0 && <p className="px-4 py-8 text-center text-sm text-zinc-500">Нет данных по партиям для выбранного scope.</p>}
    </div>
  )
}
