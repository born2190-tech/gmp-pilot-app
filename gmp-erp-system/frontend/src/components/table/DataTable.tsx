import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  emptyLabel: string
  isLoading?: boolean
  globalFilter?: string
}

export function DataTable<T>({ columns, data, emptyLabel, globalFilter = '', isLoading = false }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const { t } = useI18n()
  const stableData = useMemo(() => data, [data])

  const table = useReactTable({
    data: stableData,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="max-h-[620px] overflow-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-500">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th className="h-9 whitespace-nowrap border-b border-slate-200 px-3 text-left font-semibold" key={header.id}>
                    {header.isPlaceholder ? null : (
                      <button className="inline-flex items-center gap-1" onClick={header.column.getToggleSortingHandler()} type="button">
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
              <tr className="h-10 border-b border-slate-100 hover:bg-slate-50" key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td className="whitespace-nowrap px-3 py-2 text-slate-800" key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isLoading && table.getRowModel().rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">{emptyLabel}</p>}
      {isLoading && <p className="px-4 py-10 text-center text-sm text-slate-500">{t('common.loadingRecords')}</p>}
    </div>
  )
}
