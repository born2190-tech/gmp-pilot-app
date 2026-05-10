import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { listFgShipments, listLots, listMovements } from '../../lib/api'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useI18n } from '../../i18n/I18nProvider'
import type { FGShipmentItem, LotItem, MovementItem } from '../../types/inventory'

interface WarehouseCenterPageProps {
  token: string
}

type StockRisk = 'expired' | 'expires_soon' | 'ok'

function formatDate(value: string | null, locale: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function expiryRisk(expiryDate: string): StockRisk {
  const today = new Date()
  const expiry = new Date(expiryDate)
  const days = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return 'expired'
  if (days <= 180) return 'expires_soon'
  return 'ok'
}

function uniqueValues<T>(items: T[], selector: (item: T) => string) {
  return Array.from(new Set(items.map(selector).filter(Boolean))).sort()
}

export function WarehouseCenterPage({ token }: WarehouseCenterPageProps) {
  const { locale, t } = useI18n()
  const [lots, setLots] = useState<LotItem[]>([])
  const [movements, setMovements] = useState<MovementItem[]>([])
  const [shipments, setShipments] = useState<FGShipmentItem[]>([])
  const [selectedLotId, setSelectedLotId] = useState('')
  const [search, setSearch] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [status, setStatus] = useState('')
  const [risk, setRisk] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const [lotsResponse, movementsResponse, shipmentsResponse] = await Promise.all([listLots(token), listMovements(token), listFgShipments(token)])
      setLots(lotsResponse.lots)
      setMovements(movementsResponse.movements)
      setShipments(shipmentsResponse.shipments)
      setSelectedLotId((current) => current || lotsResponse.lots[0]?.id || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('warehouseCenter.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [token])

  const filteredLots = useMemo(() => {
    const query = search.trim().toLowerCase()
    return lots.filter((lot) => {
      const haystack = [lot.internal_lot, lot.supplier_lot, lot.material_code, lot.material_name, lot.manufacturer_name, lot.location_code].join(' ').toLowerCase()
      return (
        (!query || haystack.includes(query)) &&
        (!warehouse || lot.warehouse_type === warehouse) &&
        (!status || lot.quality_status === status) &&
        (!risk || expiryRisk(lot.expiry_date) === risk)
      )
    })
  }, [lots, risk, search, status, warehouse])

  const selectedLot = filteredLots.find((lot) => lot.id === selectedLotId) || filteredLots[0] || lots.find((lot) => lot.id === selectedLotId)
  const selectedMovements = selectedLot ? movements.filter((movement) => movement.internal_lot === selectedLot.internal_lot).slice(0, 8) : []
  const selectedShipments = selectedLot ? shipments.filter((shipment) => shipment.lines.some((line) => line.lot_id === selectedLot.id)) : []
  const totalQty = filteredLots.reduce((sum, lot) => sum + lot.quantity, 0)
  const releasedQty = filteredLots.filter((lot) => lot.quality_status === 'released').reduce((sum, lot) => sum + lot.quantity, 0)
  const blockedLots = filteredLots.filter((lot) => ['quarantine', 'sampled', 'under_test', 'blocked', 'rejected', 'expired'].includes(lot.quality_status)).length
  const expiringLots = filteredLots.filter((lot) => expiryRisk(lot.expiry_date) !== 'ok').length

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('warehouseCenter.kicker')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('warehouseCenter.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('warehouseCenter.subtitle')}</p>
        </div>
        <button className="btn-secondary" onClick={loadData} type="button">
          {t('common.refresh')}
        </button>
      </div>

      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-3 md:grid-cols-4">
        <Kpi label={t('warehouseCenter.filteredLots')} value={String(filteredLots.length)} />
        <Kpi label={t('warehouseCenter.totalStock')} value={totalQty.toLocaleString(locale)} />
        <Kpi label={t('warehouseCenter.releasedStock')} value={releasedQty.toLocaleString(locale)} />
        <Kpi label={t('warehouseCenter.attention')} value={`${blockedLots} / ${expiringLots}`} />
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="grid gap-3 xl:grid-cols-5">
          <label className="label xl:col-span-2">
            {t('warehouseCenter.search')}
            <input className="input" onChange={(event) => setSearch(event.target.value)} value={search} />
          </label>
          <FilterSelect label={t('lots.warehouse')} onChange={setWarehouse} options={uniqueValues(lots, (lot) => lot.warehouse_type)} value={warehouse} />
          <FilterSelect label={t('common.status')} onChange={setStatus} options={uniqueValues(lots, (lot) => lot.quality_status)} value={status} />
          <FilterSelect label={t('warehouseCenter.expiryRisk')} onChange={setRisk} options={['expired', 'expires_soon', 'ok']} translatePrefix="warehouseCenter.risk" value={risk} />
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">{t('warehouseCenter.stockRegister')}</div>
          <div className="max-h-[620px] overflow-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-500">
                <tr>
                  <Th>{t('lots.internalSeries')}</Th>
                  <Th>{t('lots.material')}</Th>
                  <Th>{t('lots.warehouse')}</Th>
                  <Th>{t('lots.location')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th>{t('lots.qty')}</Th>
                  <Th>{t('lots.expiry')}</Th>
                  <Th>{t('lots.qcNotified')}</Th>
                  <Th>{t('lots.qcResult')}</Th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((lot) => (
                  <tr
                    className={`h-10 cursor-pointer border-b border-slate-100 hover:bg-blue-50 ${selectedLot?.id === lot.id ? 'bg-blue-50' : ''}`}
                    key={lot.id}
                    onClick={() => setSelectedLotId(lot.id)}
                  >
                    <Td strong>{lot.internal_lot}</Td>
                    <Td>{lot.material_code} · {lot.material_name}</Td>
                    <Td>{lot.warehouse_type}</Td>
                    <Td>{lot.location_code}</Td>
                    <Td><StatusBadge status={lot.quality_status} /></Td>
                    <Td>{lot.quantity} {lot.unit}</Td>
                    <Td><RiskLabel risk={expiryRisk(lot.expiry_date)} text={formatDate(lot.expiry_date, locale)} /></Td>
                    <Td>{formatDate(lot.incoming_control_notified_at, locale)}</Td>
                    <Td>{formatDate(lot.qc_result_received_at, locale)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!isLoading && filteredLots.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">{t('warehouseCenter.empty')}</p>}
            {isLoading && <p className="px-4 py-10 text-center text-sm text-slate-500">{t('common.loadingRecords')}</p>}
          </div>
        </div>

        <aside className="space-y-4">
          {selectedLot ? (
            <>
              <div className="rounded-md border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase text-slate-500">{t('warehouseCenter.lotPassport')}</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-950">{selectedLot.internal_lot}</h2>
                  <StatusBadge status={selectedLot.quality_status} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <Fact label={t('lots.material')} value={`${selectedLot.material_code} · ${selectedLot.material_name}`} wide />
                  <Fact label={t('lots.manufacturer')} value={selectedLot.manufacturer_name} wide />
                  <Fact label={t('lots.supplierLot')} value={selectedLot.supplier_lot} />
                  <Fact label={t('lots.qty')} value={`${selectedLot.quantity} ${selectedLot.unit}`} />
                  <Fact label={t('lots.warehouse')} value={selectedLot.warehouse_type} />
                  <Fact label={t('lots.location')} value={selectedLot.location_code} />
                  <Fact label={t('receipt.productionDate')} value={formatDate(selectedLot.production_date, locale)} />
                  <Fact label={t('lots.expiry')} value={formatDate(selectedLot.expiry_date, locale)} />
                  <Fact label={t('lots.qcNotified')} value={formatDate(selectedLot.incoming_control_notified_at, locale)} />
                  <Fact label={t('lots.qcResult')} value={formatDate(selectedLot.qc_result_received_at, locale)} />
                </div>
              </div>

              <TracePanel movements={selectedMovements} shipments={selectedShipments} />
            </>
          ) : (
            <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">{t('warehouseCenter.selectLot')}</div>
          )}
        </aside>
      </div>
    </section>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  )
}

function FilterSelect({ label, onChange, options, translatePrefix, value }: { label: string; onChange: (value: string) => void; options: string[]; translatePrefix?: string; value: string }) {
  const { t } = useI18n()
  return (
    <label className="label">
      {label}
      <select className="input" onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{t('warehouseCenter.all')}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {translatePrefix ? t(`${translatePrefix}.${option}` as never) : option}
          </option>
        ))}
      </select>
    </label>
  )
}

function Th({ children }: { children: ReactNode }) {
  return <th className="h-9 whitespace-nowrap border-b border-slate-200 px-3 text-left font-semibold">{children}</th>
}

function Td({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return <td className={`whitespace-nowrap px-3 py-2 text-slate-800 ${strong ? 'font-semibold' : ''}`}>{children}</td>
}

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-0.5 text-slate-900">{value}</p>
    </div>
  )
}

function RiskLabel({ risk, text }: { risk: StockRisk; text: string }) {
  const className =
    risk === 'expired'
      ? 'bg-red-50 text-red-700 ring-red-200'
      : risk === 'expires_soon'
        ? 'bg-amber-50 text-amber-800 ring-amber-200'
        : 'bg-slate-50 text-slate-700 ring-slate-200'
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ring-1 ${className}`}>{text}</span>
}

function TracePanel({ movements, shipments }: { movements: MovementItem[]; shipments: FGShipmentItem[] }) {
  const { locale, t } = useI18n()
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase text-slate-500">{t('warehouseCenter.traceability')}</p>
      <h3 className="mt-1 text-base font-semibold text-slate-950">{t('warehouseCenter.history')}</h3>
      <div className="mt-3 space-y-3">
        {movements.map((movement) => (
          <div className="border-l-2 border-slate-300 pl-3 text-sm" key={movement.id}>
            <div className="flex justify-between gap-3">
              <p className="font-medium text-slate-900">{movement.movement_type}</p>
              <p className="text-xs text-slate-500">{formatDateTime(movement.created_at, locale)}</p>
            </div>
            <p className="text-slate-700">
              {movement.quantity_delta > 0 ? '+' : ''}{movement.quantity_delta} {movement.unit} · {t('movements.qtyAfter')}: {movement.quantity_after}
            </p>
            {movement.reason && <p className="text-xs text-slate-500">{movement.reason}</p>}
          </div>
        ))}
        {shipments.map((shipment) => (
          <div className="border-l-2 border-blue-500 pl-3 text-sm" key={shipment.id}>
            <div className="flex justify-between gap-3">
              <p className="font-medium text-slate-900">{shipment.document_no}</p>
              <p className="text-xs text-slate-500">{formatDate(shipment.shipment_date, locale)}</p>
            </div>
            <p className="text-slate-700">{shipment.customer_name}</p>
            {shipment.waybill_no && <p className="text-xs text-slate-500">{shipment.waybill_no}</p>}
          </div>
        ))}
        {movements.length === 0 && shipments.length === 0 && <p className="text-sm text-slate-500">{t('warehouseCenter.noHistory')}</p>}
      </div>
    </div>
  )
}
