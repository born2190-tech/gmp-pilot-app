import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { createInventoryCount, listInventoryCounts, listLocations, listLots } from '../../lib/api'
import { translatedLocation } from '../../lib/display'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { InventoryCountItem, LocationItem, LotItem } from '../../types/inventory'

interface InventoryCountPageProps {
  token: string
  user: CurrentUser
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

interface CountDraftLine {
  lot_id: string
  actual_quantity: string
}

export function InventoryCountPage({ token, user }: InventoryCountPageProps) {
  const { locale, t } = useI18n()
  const [lots, setLots] = useState<LotItem[]>([])
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [counts, setCounts] = useState<InventoryCountItem[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [selectedLocation, setSelectedLocation] = useState('')
  const [draftLines, setDraftLines] = useState<CountDraftLine[]>([])
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [filter, setFilter] = useState('')
  const [documentNo, setDocumentNo] = useState(`INV-${new Date().getFullYear()}-`)
  const [countDate, setCountDate] = useState(new Date().toISOString().slice(0, 10))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const [lotsResponse, locationsResponse, countsResponse] = await Promise.all([listLots(token), listLocations(token), listInventoryCounts(token)])
      setLots(lotsResponse.lots)
      setLocations(locationsResponse.locations)
      setCounts(countsResponse.counts)
      setSelectedWarehouse((current) => current || lotsResponse.lots[0]?.warehouse_type || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventoryCount.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [token])

  const warehouseOptions = Array.from(new Set(lots.map((lot) => lot.warehouse_type))).sort()
  const selectedWarehouseId = lots.find((lot) => lot.warehouse_type === selectedWarehouse)?.warehouse_id
  const locationOptions = locations.filter((location) => !selectedWarehouseId || location.warehouse_id === selectedWarehouseId)
  const zoneLots = lots.filter((lot) => lot.warehouse_type === selectedWarehouse && (!selectedLocation || lot.location_code === selectedLocation))
  const draftLotIds = new Set(draftLines.map((line) => line.lot_id))
  const draftRows = draftLines.map((line) => {
    const lot = lots.find((item) => item.id === line.lot_id)
    const actual = line.actual_quantity === '' ? NaN : Number(line.actual_quantity)
    return { ...line, lot, variance: lot && !Number.isNaN(actual) ? actual - lot.quantity : 0 }
  })
  const totalVariance = draftRows.reduce((sum, row) => sum + row.variance, 0)
  const columns = useMemo<ColumnDef<InventoryCountItem>[]>(
    () => [
      { accessorKey: 'document_no', header: t('inventoryCount.documentNo') },
      { accessorKey: 'warehouse_type', header: t('lots.warehouse') },
      { accessorKey: 'count_date', header: t('inventoryCount.countDate'), cell: ({ row }) => formatDate(row.original.count_date, locale) },
      {
        id: 'lines',
        header: t('inventoryCount.lines'),
        cell: ({ row }) => row.original.lines.map((line) => `${line.internal_lot}: ${line.actual_quantity} ${line.unit} (${line.variance > 0 ? '+' : ''}${line.variance})`).join('; '),
      },
    ],
    [locale, t],
  )

  async function postCount() {
    const lines = draftRows
      .filter((row) => row.lot && row.actual_quantity !== '')
      .map((row) => ({ lot_id: row.lot_id, actual_quantity: Number(row.actual_quantity) }))
    if (lines.length === 0) return
    setError(null)
    setSuccess(null)
    try {
      await createInventoryCount(token, {
        document_no: documentNo,
        count_date: countDate,
        lines,
        username: user.username,
        password,
        meaning: t('inventoryCount.signatureMeaning'),
        reason,
      })
      setSuccess(t('inventoryCount.posted'))
      setDraftLines([])
      setPassword('')
      setReason('')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventoryCount.actionFailed'))
    }
  }

  function fillZoneLines() {
    setDraftLines(zoneLots.map((lot) => ({ lot_id: lot.id, actual_quantity: String(lot.quantity) })))
  }

  function addLot(lotId: string) {
    const lot = lots.find((item) => item.id === lotId)
    if (!lot || draftLotIds.has(lot.id)) return
    setDraftLines((current) => [...current, { lot_id: lot.id, actual_quantity: String(lot.quantity) }])
  }

  function updateLine(lotId: string, actualQuantity: string) {
    setDraftLines((current) => current.map((line) => (line.lot_id === lotId ? { ...line, actual_quantity: actualQuantity } : line)))
  }

  function removeLine(lotId: string) {
    setDraftLines((current) => current.filter((line) => line.lot_id !== lotId))
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('inventoryCount.kicker')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('inventoryCount.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('inventoryCount.subtitle')}</p>
        </div>
        <button className="btn-secondary" onClick={loadData} type="button">{t('common.refresh')}</button>
      </div>
      {(error || success) && <p className={error ? 'alert-error' : 'alert-success'}>{error || success}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-base font-semibold text-slate-900">{t('inventoryCount.newDocument')}</h2>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-4">
              <label className="label">{t('inventoryCount.documentNo')}<input className="input" onChange={(event) => setDocumentNo(event.target.value)} value={documentNo} /></label>
              <label className="label">{t('inventoryCount.countDate')}<input className="input" onChange={(event) => setCountDate(event.target.value)} type="date" value={countDate} /></label>
              <label className="label">
                {t('lots.warehouse')}
                <select className="input" onChange={(event) => { setSelectedWarehouse(event.target.value); setSelectedLocation(''); setDraftLines([]) }} value={selectedWarehouse}>
                  {warehouseOptions.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}
                </select>
              </label>
              <label className="label">
                {t('lots.location')}
                <select className="input" onChange={(event) => { setSelectedLocation(event.target.value); setDraftLines([]) }} value={selectedLocation}>
                  <option value="">{t('inventoryCount.allLocations')}</option>
                  {locationOptions.map((location) => <option key={location.id} value={location.code}>{translatedLocation(location.code, t)}</option>)}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="label min-w-80">
                {t('inventoryCount.addLot')}
                <select className="input" onChange={(event) => addLot(event.target.value)} value="">
                  <option value="">{t('inventoryCount.selectLine')}</option>
                  {zoneLots.filter((lot) => !draftLotIds.has(lot.id)).map((lot) => (
                    <option key={lot.id} value={lot.id}>{lot.internal_lot} · {lot.material_code} · {translatedLocation(lot.location_code, t)} · {lot.quantity} {lot.unit}</option>
                  ))}
                </select>
              </label>
              <button className="btn-secondary" disabled={zoneLots.length === 0} onClick={fillZoneLines} type="button">{t('inventoryCount.fillZone')}</button>
              <button className="btn-secondary" disabled={draftLines.length === 0} onClick={() => setDraftLines([])} type="button">{t('inventoryCount.clearLines')}</button>
            </div>

            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('lots.internalSeries')}</th>
                    <th className="px-3 py-2 text-left">{t('lots.material')}</th>
                    <th className="px-3 py-2 text-left">{t('lots.location')}</th>
                    <th className="px-3 py-2 text-left">{t('inventoryCount.systemQuantity')}</th>
                    <th className="px-3 py-2 text-left">{t('inventoryCount.actualQuantity')}</th>
                    <th className="px-3 py-2 text-left">{t('inventoryCount.variance')}</th>
                    <th className="px-3 py-2 text-left">{t('inventoryCount.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {draftRows.map((row) => row.lot && (
                    <tr className="border-t border-slate-100" key={row.lot_id}>
                      <td className="px-3 py-2 font-semibold">{row.lot.internal_lot}</td>
                      <td className="px-3 py-2">{row.lot.material_code} · {row.lot.material_name}</td>
                      <td className="px-3 py-2">{translatedLocation(row.lot.location_code, t)}</td>
                      <td className="px-3 py-2">{row.lot.quantity} {row.lot.unit}</td>
                      <td className="px-3 py-2"><input className="input max-w-32" min="0" onChange={(event) => updateLine(row.lot_id, event.target.value)} type="number" value={row.actual_quantity} /></td>
                      <td className={`px-3 py-2 font-medium ${row.variance === 0 ? 'text-slate-900' : row.variance > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{row.variance > 0 ? '+' : ''}{row.variance}</td>
                      <td className="px-3 py-2"><button className="text-sm text-red-700" onClick={() => removeLine(row.lot_id)} type="button">{t('inventoryCount.remove')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {draftLines.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">{t('inventoryCount.noDraftLines')}</p>}
            </div>

            <div className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <span className="text-slate-500">{t('inventoryCount.totalVariance')}: </span>
              <span className={totalVariance === 0 ? 'text-slate-900' : totalVariance > 0 ? 'text-emerald-700' : 'text-red-700'}>{totalVariance > 0 ? '+' : ''}{totalVariance}</span>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="label">{t('common.password')}<input className="input" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>
              <label className="label md:col-span-2">{t('common.reason')}<input className="input" onChange={(event) => setReason(event.target.value)} value={reason} /></label>
            </div>
            <button className="btn-primary w-fit" disabled={draftLines.length === 0 || !password || !reason || draftRows.some((row) => row.actual_quantity === '')} onClick={postCount} type="button">{t('inventoryCount.post')}</button>
          </div>
        </div>

        <div>
          <div className="mb-3 flex justify-end">
            <input className="input w-80" onChange={(event) => setFilter(event.target.value)} placeholder={t('inventoryCount.search')} value={filter} />
          </div>
          <DataTable columns={columns} data={counts} emptyLabel={t('inventoryCount.empty')} globalFilter={filter} isLoading={isLoading} />
        </div>
      </div>
    </section>
  )
}
