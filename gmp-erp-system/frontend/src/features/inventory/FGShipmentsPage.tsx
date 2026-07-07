import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { createFgShipment, listFgShipments, listLots } from '../../lib/api'
import { isOutsideBarrier } from '../../lib/timeBarrier'
import { useI18n } from '../../i18n/I18nProvider'
import type { FGShipmentItem, LotItem } from '../../types/inventory'
import type { CurrentUser } from '../../types/auth'

interface FGShipmentsPageProps {
  token: string
  user: CurrentUser
}

function formatDate(value: string | null, locale: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function FGShipmentsPage({ token, user }: FGShipmentsPageProps) {
  const { locale, t } = useI18n()
  const [shipments, setShipments] = useState<FGShipmentItem[]>([])
  const [lots, setLots] = useState<LotItem[]>([])
  const [selectedLotId, setSelectedLotId] = useState('')
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [form, setForm] = useState({
    document_no: `SHP-${new Date().getFullYear()}-`,
    customer_name: '',
    customer_tax_id: '',
    destination_address: '',
    shipment_date: new Date().toISOString().slice(0, 10),
    vehicle_no: '',
    waybill_no: '',
    quantity: 0,
    password: '',
    reason: '',
  })

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const [shipmentsResponse, lotsResponse] = await Promise.all([listFgShipments(token), listLots(token)])
      const fgLots = lotsResponse.lots.filter((lot) => lot.warehouse_type === 'FG_WAREHOUSE' && lot.quality_status === 'released' && lot.quantity > 0)
      setShipments(shipmentsResponse.shipments)
      setLots(fgLots)
      setSelectedLotId((current) => (fgLots.some((lot) => lot.id === current) ? current : fgLots[0]?.id || ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgShipments.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [token])

  const selectedLot = lots.find((lot) => lot.id === selectedLotId)
  const shipmentDisabledReason = !selectedLot
    ? t('fgShipments.noLots')
    : !form.customer_name.trim()
      ? t('fgShipments.customerRequired')
      : form.quantity <= 0
        ? t('fgShipments.quantityRequired')
        : form.quantity > selectedLot.quantity
          ? t('fgShipments.quantityExceedsStock')
          : !form.password
            ? t('fgShipments.passwordRequired')
            : ''
  const shipmentReady = shipmentDisabledReason === ''

  const columns = useMemo<ColumnDef<FGShipmentItem>[]>(
    () => [
      { accessorKey: 'posted_at', header: t('fgShipments.postedAt'), cell: ({ row }) => formatDateTime(row.original.posted_at, locale) },
      { accessorKey: 'document_no', header: t('fgShipments.documentNo') },
      { accessorKey: 'customer_name', header: t('fgShipments.customerName') },
      { accessorKey: 'waybill_no', header: t('fgShipments.waybillNo') },
      { accessorKey: 'shipment_date', header: t('fgShipments.shipmentDate'), cell: ({ row }) => formatDate(row.original.shipment_date, locale) },
      {
        id: 'lines',
        header: t('fgShipments.lines'),
        cell: ({ row }) =>
          row.original.lines.map((line) => `${line.internal_lot} / ${line.quantity} ${line.unit} / ${formatDate(line.expiry_date, locale)}`).join('; '),
      },
    ],
    [locale, t],
  )

  async function submitShipment() {
    if (!selectedLot || form.quantity <= 0) return
    setError(null)
    setSuccess(null)
    try {
      await createFgShipment(token, {
        document_no: form.document_no,
        customer_name: form.customer_name,
        customer_tax_id: form.customer_tax_id || undefined,
        destination_address: form.destination_address,
        shipment_date: form.shipment_date,
        vehicle_no: form.vehicle_no || undefined,
        waybill_no: form.waybill_no || undefined,
        lines: [{ lot_id: selectedLot.id, quantity: Number(form.quantity) }],
        username: user.username,
        password: form.password,
        meaning: t('fgShipments.signatureMeaning'),
        reason: form.reason || t('fgShipments.signatureMeaning'),
      })
      setSuccess(t('fgShipments.created'))
      setForm((current) => ({ ...current, quantity: 0, password: '', reason: '' }))
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fgShipments.actionFailed'))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">{t('fgShipments.trace')}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{t('fgShipments.title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('fgShipments.subtitle')}</p>
        </div>
        <button className="btn-secondary" onClick={loadData} type="button">
          {t('common.refresh')}
        </button>
      </div>

      {(error || success) && <div className={error ? 'alert-error' : 'alert-success'}>{error || success}</div>}

      {!isLoading && lots.length === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t('fgShipments.noLots')}
        </div>
      )}

      {isOutsideBarrier('ship') && (
        <div className="rounded-md border border-amber-200 bg-amber-50/70 px-4 py-2 text-[13px] text-amber-800">
          {t('fgBarrier.ship')}
        </div>
      )}

      <section className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm xl:grid-cols-4">
        <label className="label">
          {t('fgShipments.documentNo')}
          <input autoComplete="off" className="input" onChange={(event) => setForm({ ...form, document_no: event.target.value })} value={form.document_no} />
        </label>
        <label className="label">
          {t('fgShipments.customerName')}
          <input autoComplete="off" className="input" onChange={(event) => setForm({ ...form, customer_name: event.target.value })} value={form.customer_name} />
        </label>
        <label className="label">
          {t('fgShipments.customerTaxId')}
          <input autoComplete="off" className="input" onChange={(event) => setForm({ ...form, customer_tax_id: event.target.value })} value={form.customer_tax_id} />
        </label>
        <label className="label">
          {t('fgShipments.destinationAddress')}
          <input autoComplete="off" className="input" onChange={(event) => setForm({ ...form, destination_address: event.target.value })} value={form.destination_address} />
        </label>
        <label className="label">
          {t('fgShipments.shipmentDate')}
          <input autoComplete="off" className="input" onChange={(event) => setForm({ ...form, shipment_date: event.target.value })} type="date" value={form.shipment_date} />
        </label>
        <label className="label">
          {t('fgShipments.vehicleNo')}
          <input autoComplete="off" className="input" onChange={(event) => setForm({ ...form, vehicle_no: event.target.value })} value={form.vehicle_no} />
        </label>
        <label className="label">
          {t('fgShipments.waybillNo')}
          <input autoComplete="off" className="input" onChange={(event) => setForm({ ...form, waybill_no: event.target.value })} value={form.waybill_no} />
        </label>
        <label className="label">
          {t('fgShipments.selectLot')}
          <select className="input" onChange={(event) => setSelectedLotId(event.target.value)} value={selectedLotId}>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.internal_lot} - {lot.material_code} - {lot.quantity} {lot.unit} - {formatDate(lot.expiry_date, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          {t('fgShipments.quantity')}
          <input autoComplete="off" inputMode="decimal" name="fg-shipment-quantity" className="input" max={selectedLot?.quantity} min="0" onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} type="number" value={form.quantity} />
        </label>
        <label className="label">
          {t('common.password')}
          <input autoComplete="one-time-code" name="fg-shipment-signature-pin" className="input" onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" value={form.password} />
        </label>
        <label className="label xl:col-span-2">
          {t('common.reason')}
          <input autoComplete="off" className="input" onChange={(event) => setForm({ ...form, reason: event.target.value })} value={form.reason} />
        </label>
        <div className="flex flex-col justify-end gap-1">
          <button className="btn-primary w-full" disabled={!shipmentReady} onClick={submitShipment} type="button">
            {t('fgShipments.create')}
          </button>
          {shipmentDisabledReason && <p className="text-[12px] leading-snug text-slate-500">{shipmentDisabledReason}</p>}
        </div>
      </section>

      <div className="flex justify-end">
        <input autoComplete="off" className="input w-80" onChange={(event) => setFilter(event.target.value)} placeholder={t('movements.search')} value={filter} />
      </div>
      <DataTable columns={columns} data={shipments} emptyLabel={t('fgShipments.empty')} globalFilter={filter} isLoading={isLoading} />
    </div>
  )
}
