import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { listLots } from '../../lib/api'
import type { LotItem } from '../../types/inventory'
import { DataTable } from '../../components/table/DataTable'
import { StatusBadge } from '../../components/ui/StatusBadge'

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU').format(new Date(value))
}

interface LotsBoardPageProps {
  token: string
}

export function LotsBoardPage({ token }: LotsBoardPageProps) {
  const [lots, setLots] = useState<LotItem[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      try {
        const response = await listLots(token)
        setLots(response.lots)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load lots')
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [token])

  const columns = useMemo<ColumnDef<LotItem, unknown>[]>(
    () => [
      { accessorKey: 'internal_lot', header: 'Internal series' },
      { accessorKey: 'material_code', header: 'Material' },
      { accessorKey: 'manufacturer_name', header: 'Manufacturer' },
      { accessorKey: 'supplier_lot', header: 'Supplier lot' },
      { accessorKey: 'warehouse_type', header: 'Warehouse' },
      { accessorKey: 'location_code', header: 'Location' },
      {
        id: 'quantity',
        header: 'Qty',
        cell: ({ row }) => `${row.original.quantity} ${row.original.unit}`,
      },
      {
        accessorKey: 'quality_status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.quality_status} />,
      },
      { accessorKey: 'production_year', header: 'Prod. year' },
      { accessorKey: 'expiry_date', header: 'Expiry', cell: ({ row }) => formatDate(row.original.expiry_date) },
      {
        accessorKey: 'incoming_control_notified_at',
        header: 'QC notified',
        cell: ({ row }) => formatDate(row.original.incoming_control_notified_at),
      },
      {
        accessorKey: 'qc_result_received_at',
        header: 'QC result',
        cell: ({ row }) => formatDate(row.original.qc_result_received_at),
      },
    ],
    [],
  )

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">Warehouse register</p>
          <h1 className="text-2xl font-semibold text-slate-950">Lots / Series</h1>
        </div>
        <input
          className="h-9 w-80 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-700"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search lot, material, manufacturer..."
          value={filter}
        />
      </div>
      {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <DataTable columns={columns} data={lots} emptyLabel="No lots found for your warehouse scope." globalFilter={filter} isLoading={isLoading} />
    </section>
  )
}
