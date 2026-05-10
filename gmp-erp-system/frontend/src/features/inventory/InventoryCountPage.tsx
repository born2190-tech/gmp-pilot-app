import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/table/DataTable'
import { createInventoryCount, listInventoryCounts, listLots } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { InventoryCountItem, LotItem } from '../../types/inventory'

interface InventoryCountPageProps {
  token: string
  user: CurrentUser
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale).format(new Date(value))
}

export function InventoryCountPage({ token, user }: InventoryCountPageProps) {
  const { locale, t } = useI18n()
  const [lots, setLots] = useState<LotItem[]>([])
  const [counts, setCounts] = useState<InventoryCountItem[]>([])
  const [selectedLotId, setSelectedLotId] = useState('')
  const [actualQuantity, setActualQuantity] = useState('')
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
      const [lotsResponse, countsResponse] = await Promise.all([listLots(token), listInventoryCounts(token)])
      setLots(lotsResponse.lots)
      setCounts(countsResponse.counts)
      setSelectedLotId((current) => current || lotsResponse.lots[0]?.id || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventoryCount.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [token])

  const selectedLot = lots.find((lot) => lot.id === selectedLotId)
  const variance = selectedLot && actualQuantity !== '' ? Number(actualQuantity) - selectedLot.quantity : 0
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
    if (!selectedLot || actualQuantity === '') return
    setError(null)
    setSuccess(null)
    try {
      await createInventoryCount(token, {
        document_no: documentNo,
        count_date: countDate,
        lines: [{ lot_id: selectedLot.id, actual_quantity: Number(actualQuantity) }],
        username: user.username,
        password,
        meaning: t('inventoryCount.signatureMeaning'),
        reason,
      })
      setSuccess(t('inventoryCount.posted'))
      setActualQuantity('')
      setPassword('')
      setReason('')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventoryCount.actionFailed'))
    }
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

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-base font-semibold text-slate-900">{t('inventoryCount.newDocument')}</h2>
          <div className="grid gap-3">
            <label className="label">{t('inventoryCount.documentNo')}<input className="input" onChange={(event) => setDocumentNo(event.target.value)} value={documentNo} /></label>
            <label className="label">{t('inventoryCount.countDate')}<input className="input" onChange={(event) => setCountDate(event.target.value)} type="date" value={countDate} /></label>
            <label className="label">
              {t('inventoryCount.lot')}
              <select className="input" onChange={(event) => setSelectedLotId(event.target.value)} value={selectedLotId}>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>{lot.internal_lot} · {lot.material_code} · {lot.quantity} {lot.unit}</option>
                ))}
              </select>
            </label>
            {selectedLot && (
              <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                <p>{selectedLot.material_name}</p>
                <p>{selectedLot.warehouse_type} · {selectedLot.location_code}</p>
                <p>{t('inventoryCount.systemQuantity')}: {selectedLot.quantity} {selectedLot.unit}</p>
              </div>
            )}
            <label className="label">{t('inventoryCount.actualQuantity')}<input className="input" min="0" onChange={(event) => setActualQuantity(event.target.value)} type="number" value={actualQuantity} /></label>
            <div className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <span className="text-slate-500">{t('inventoryCount.variance')}: </span>
              <span className={variance === 0 ? 'text-slate-900' : variance > 0 ? 'text-emerald-700' : 'text-red-700'}>{variance > 0 ? '+' : ''}{variance}</span>
            </div>
            <label className="label">{t('common.password')}<input className="input" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>
            <label className="label">{t('common.reason')}<input className="input" onChange={(event) => setReason(event.target.value)} value={reason} /></label>
            <button className="btn-primary" disabled={!selectedLot || actualQuantity === '' || !password || !reason} onClick={postCount} type="button">{t('inventoryCount.post')}</button>
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
