import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { listMovements } from '../../lib/api'
import type { MovementItem } from '../../types/inventory'

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function MovementsPage({ token }: { token: string }) {
  const [movements, setMovements] = useState<MovementItem[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      try {
        const response = await listMovements(token)
        setMovements(response.movements)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load movements')
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [token])

  const columns = useMemo<ColumnDef<MovementItem, unknown>[]>(
    () => [
      { accessorKey: 'created_at', header: 'Time', cell: ({ row }) => formatDateTime(row.original.created_at) },
      { accessorKey: 'movement_type', header: 'Type' },
      { accessorKey: 'document_type', header: 'Document' },
      { accessorKey: 'internal_lot', header: 'Lot / series' },
      { accessorKey: 'material_code', header: 'Material' },
      {
        id: 'delta',
        header: 'Delta',
        cell: ({ row }) => `${row.original.quantity_delta > 0 ? '+' : ''}${row.original.quantity_delta} ${row.original.unit}`,
      },
      {
        id: 'after',
        header: 'Qty after',
        cell: ({ row }) => `${row.original.quantity_after} ${row.original.unit}`,
      },
      { accessorKey: 'workstation_id', header: 'Workstation' },
      { accessorKey: 'reason', header: 'Reason' },
    ],
    [],
  )

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">Immutable register</p>
          <h1 className="text-2xl font-semibold text-slate-950">Warehouse Movements</h1>
        </div>
        <input
          className="h-9 w-80 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-700"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search movement, lot, material..."
          value={filter}
        />
      </div>
      {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <DataTable columns={columns} data={movements} emptyLabel="No movements found for your warehouse scope." globalFilter={filter} isLoading={isLoading} />
    </section>
  )
}
