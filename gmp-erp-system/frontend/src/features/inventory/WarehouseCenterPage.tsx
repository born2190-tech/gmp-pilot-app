import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { listFgShipments, listInventoryCounts, listLots, listMovements } from '../../lib/api'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useI18n } from '../../i18n/I18nProvider'
import type { FGShipmentItem, InventoryCountItem, LotItem, MovementItem } from '../../types/inventory'

interface WarehouseCenterPageProps {
  token: string
}

type StockRisk = 'expired' | 'expires_soon' | 'ok'
type LotStage = 'receipt' | 'qc' | 'qa' | 'available'

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

function daysUntil(expiryDate: string) {
  return Math.ceil((new Date(expiryDate).getTime() - new Date().getTime()) / 86_400_000)
}

function lotStages(lot: LotItem): Record<LotStage, boolean> {
  return {
    receipt: Boolean(lot.incoming_control_notified_at),
    qc: Boolean(lot.qc_result_received_at),
    qa: Boolean(lot.qa_decision_at),
    available: lot.quality_status === 'released',
  }
}

function uniqueValues<T>(items: T[], selector: (item: T) => string) {
  return Array.from(new Set(items.map(selector).filter(Boolean))).sort()
}

export function WarehouseCenterPage({ token }: WarehouseCenterPageProps) {
  const { locale, t } = useI18n()
  const [lots, setLots] = useState<LotItem[]>([])
  const [movements, setMovements] = useState<MovementItem[]>([])
  const [shipments, setShipments] = useState<FGShipmentItem[]>([])
  const [counts, setCounts] = useState<InventoryCountItem[]>([])
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
      const [lotsResponse, movementsResponse, shipmentsResponse, countsResponse] = await Promise.all([listLots(token), listMovements(token), listFgShipments(token), listInventoryCounts(token)])
      setLots(lotsResponse.lots)
      setMovements(movementsResponse.movements)
      setShipments(shipmentsResponse.shipments)
      setCounts(countsResponse.counts)
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
  const selectedCounts = selectedLot ? counts.filter((count) => count.lines.some((line) => line.lot_id === selectedLot.id)) : []
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

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_460px]">
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
                    className={`h-10 cursor-pointer border-b border-slate-100 hover:bg-blue-50 ${selectedLot?.id === lot.id ? 'bg-blue-50 shadow-[inset_3px_0_0_#2563eb]' : ''}`}
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
              <LotPassport lot={selectedLot} />
              <TracePanel counts={selectedCounts} movements={selectedMovements} shipments={selectedShipments} />
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

function LotPassport({ lot }: { lot: LotItem }) {
  const { locale, t } = useI18n()
  const stages = lotStages(lot)
  const daysLeft = daysUntil(lot.expiry_date)
  const risk = expiryRisk(lot.expiry_date)

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-slate-500">{t('warehouseCenter.lotPassport')}</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{lot.internal_lot}</h2>
            <p className="mt-1 text-sm text-slate-600">{lot.material_code} · {lot.material_name}</p>
          </div>
          <StatusBadge status={lot.quality_status} />
        </div>
      </div>

      <div className="grid grid-cols-3 border-b border-slate-200 text-sm">
        <Metric label={t('lots.qty')} value={`${lot.quantity} ${lot.unit}`} />
        <Metric label={t('lots.location')} value={lot.location_code} />
        <Metric label={t('warehouseCenter.daysLeft')} tone={risk === 'expired' ? 'danger' : risk === 'expires_soon' ? 'warning' : 'normal'} value={daysLeft < 0 ? t('warehouseCenter.expired') : String(daysLeft)} />
      </div>

      <div className="p-4">
        <div className="grid grid-cols-4 gap-2">
          <Stage done={stages.receipt} label={t('warehouseCenter.stage.receipt')} />
          <Stage done={stages.qc} label={t('warehouseCenter.stage.qc')} />
          <Stage done={stages.qa} label={t('warehouseCenter.stage.qa')} />
          <Stage done={stages.available} label={t('warehouseCenter.stage.available')} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Fact label={t('lots.manufacturer')} value={lot.manufacturer_name} wide />
          <Fact label={t('lots.supplierLot')} value={lot.supplier_lot} />
          <Fact label={t('lots.warehouse')} value={lot.warehouse_type} />
          <Fact label={t('receipt.productionDate')} value={formatDate(lot.production_date, locale)} />
          <Fact label={t('lots.expiry')} value={formatDate(lot.expiry_date, locale)} />
          <Fact label={t('lots.qcNotified')} value={formatDate(lot.incoming_control_notified_at, locale)} />
          <Fact label={t('lots.qcResult')} value={formatDate(lot.qc_result_received_at, locale)} />
        </div>
      </div>
    </div>
  )
}

function Metric({ label, tone = 'normal', value }: { label: string; tone?: 'normal' | 'warning' | 'danger'; value: string }) {
  const valueClass = tone === 'danger' ? 'text-red-700' : tone === 'warning' ? 'text-amber-700' : 'text-slate-950'
  return (
    <div className="border-r border-slate-200 px-3 py-3 last:border-r-0">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className={`mt-1 text-base font-semibold ${valueClass}`}>{value}</p>
    </div>
  )
}

function Stage({ done, label }: { done: boolean; label: string }) {
  return (
    <div className={`rounded-md border px-2 py-2 text-center text-xs font-medium ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
      {label}
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

function TracePanel({ counts, movements, shipments }: { counts: InventoryCountItem[]; movements: MovementItem[]; shipments: FGShipmentItem[] }) {
  const { locale, t } = useI18n()
  const events = [
    ...movements.map((movement) => ({
      id: movement.id,
      at: movement.created_at,
      title: movement.movement_type,
      body: `${movement.quantity_delta > 0 ? '+' : ''}${movement.quantity_delta} ${movement.unit} · ${t('movements.qtyAfter')}: ${movement.quantity_after}`,
      note: movement.reason,
      tone: movement.quantity_delta < 0 ? 'danger' : movement.quantity_delta > 0 ? 'success' : 'neutral',
    })),
    ...counts.map((count) => {
      const line = count.lines[0]
      return {
        id: count.id,
        at: count.posted_at,
        title: `${t('nav.inventoryCounts')} ${count.document_no}`,
        body: line ? `${line.actual_quantity} ${line.unit} (${line.variance > 0 ? '+' : ''}${line.variance})` : count.warehouse_type,
        note: formatDate(count.count_date, locale),
        tone: 'warning',
      }
    }),
    ...shipments.map((shipment) => ({
      id: shipment.id,
      at: shipment.posted_at,
      title: shipment.document_no,
      body: shipment.customer_name,
      note: shipment.waybill_no || formatDate(shipment.shipment_date, locale),
      tone: 'info',
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 10)

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase text-slate-500">{t('warehouseCenter.traceability')}</p>
      <h3 className="mt-1 text-base font-semibold text-slate-950">{t('warehouseCenter.history')}</h3>
      <div className="mt-3 space-y-3">
        {events.map((event) => (
          <div className={`border-l-2 pl-3 text-sm ${event.tone === 'danger' ? 'border-red-500' : event.tone === 'success' ? 'border-emerald-500' : event.tone === 'warning' ? 'border-amber-500' : event.tone === 'info' ? 'border-blue-500' : 'border-slate-300'}`} key={event.id}>
            <div className="flex justify-between gap-3">
              <p className="font-medium text-slate-900">{event.title}</p>
              <p className="text-xs text-slate-500">{formatDateTime(event.at, locale)}</p>
            </div>
            <p className="text-slate-700">{event.body}</p>
            {event.note && <p className="text-xs text-slate-500">{event.note}</p>}
          </div>
        ))}
        {events.length === 0 && <p className="text-sm text-slate-500">{t('warehouseCenter.noHistory')}</p>}
      </div>
    </div>
  )
}
