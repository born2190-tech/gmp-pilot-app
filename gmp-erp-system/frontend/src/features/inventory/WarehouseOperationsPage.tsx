import { useEffect, useState } from 'react'
import { adjustLot, issueProduction, listLocations, listLots, transferLot } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { LocationItem, LotItem } from '../../types/inventory'

interface WarehouseOperationsPageProps {
  token: string
  user: CurrentUser
}

export function WarehouseOperationsPage({ token, user }: WarehouseOperationsPageProps) {
  const { t } = useI18n()
  const [lots, setLots] = useState<LotItem[]>([])
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [selectedLotId, setSelectedLotId] = useState('')
  const [targetLocationId, setTargetLocationId] = useState('')
  const [newQuantity, setNewQuantity] = useState('')
  const [issueQuantity, setIssueQuantity] = useState('')
  const [productionOrderNo, setProductionOrderNo] = useState('')
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadData() {
    setIsLoading(true)
    try {
      const [lotsResponse, locationsResponse] = await Promise.all([listLots(token), listLocations(token)])
      setLots(lotsResponse.lots)
      setLocations(locationsResponse.locations)
      setSelectedLotId((current) => current || lotsResponse.lots[0]?.id || '')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('warehouseOps.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [token])

  const selectedLot = lots.find((lot) => lot.id === selectedLotId)
  const scopedLocations = selectedLot ? locations.filter((location) => location.warehouse_id && location.code !== selectedLot.location_code) : locations

  async function runTransfer() {
    if (!selectedLot) return
    await runOperation(async () => {
      await transferLot(token, selectedLot.id, { to_location_id: targetLocationId, reason })
      setSuccess(t('warehouseOps.transferDone'))
    })
  }

  async function runAdjust() {
    if (!selectedLot) return
    await runOperation(async () => {
      await adjustLot(token, selectedLot.id, {
        new_quantity: Number(newQuantity),
        username: user.username,
        password,
        meaning: t('warehouseOps.signatureMeaningAdjust'),
        reason,
      })
      setSuccess(t('warehouseOps.adjustDone'))
    })
  }

  async function runIssue() {
    if (!selectedLot) return
    await runOperation(async () => {
      await issueProduction(token, selectedLot.id, {
        quantity: Number(issueQuantity),
        production_order_no: productionOrderNo,
        username: user.username,
        password,
        meaning: t('warehouseOps.signatureMeaningIssue'),
        reason,
      })
      setSuccess(t('warehouseOps.issueDone'))
    })
  }

  async function runOperation(operation: () => Promise<void>) {
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      await operation()
      setPassword('')
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('warehouseOps.actionFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs uppercase text-slate-500">{t('warehouseOps.subtitle')}</p>
        <h1 className="text-2xl font-semibold text-slate-950">{t('warehouseOps.title')}</h1>
      </div>
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium text-slate-700">
          {t('warehouseOps.selectLot')}
          <select className="input mt-1" onChange={(event) => setSelectedLotId(event.target.value)} value={selectedLotId}>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.internal_lot} · {lot.material_code} · {lot.quantity} {lot.unit}
              </option>
            ))}
          </select>
        </label>
        {selectedLot && (
          <div className="mt-3 grid gap-3 text-sm text-slate-700 xl:grid-cols-4">
            <p>{selectedLot.material_name}</p>
            <p>{selectedLot.location_code}</p>
            <p>{selectedLot.quantity} {selectedLot.unit}</p>
            <StatusBadge status={selectedLot.quality_status} />
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-base font-semibold text-slate-900">{t('warehouseOps.transfer')}</h2>
          <label className="mb-3 block text-sm font-medium text-slate-700">
            {t('warehouseOps.targetLocation')}
            <select className="input mt-1" onChange={(event) => setTargetLocationId(event.target.value)} value={targetLocationId}>
              <option value="">{t('receipt.selectLocation')}</option>
              {scopedLocations.map((location) => (
                <option key={location.id} value={location.id}>{location.code} · {location.name}</option>
              ))}
            </select>
          </label>
          <Reason value={reason} onChange={setReason} />
          <Button disabled={isLoading || !selectedLot || !targetLocationId || !reason} onClick={runTransfer} type="button">{t('warehouseOps.transfer')}</Button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-base font-semibold text-slate-900">{t('warehouseOps.adjust')}</h2>
          <FormInput label={t('warehouseOps.newQuantity')} onChange={setNewQuantity} type="number" value={newQuantity} />
          <FormInput label={t('quality.signaturePassword')} onChange={setPassword} type="password" value={password} />
          <Reason value={reason} onChange={setReason} />
          <Button disabled={isLoading || !selectedLot || !newQuantity || !password || !reason} onClick={runAdjust} type="button">{t('warehouseOps.adjust')}</Button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-base font-semibold text-slate-900">{t('warehouseOps.issue')}</h2>
          <FormInput label={t('warehouseOps.productionOrder')} onChange={setProductionOrderNo} value={productionOrderNo} />
          <FormInput label={t('warehouseOps.issueQuantity')} onChange={setIssueQuantity} type="number" value={issueQuantity} />
          <FormInput label={t('quality.signaturePassword')} onChange={setPassword} type="password" value={password} />
          <Reason value={reason} onChange={setReason} />
          <Button disabled={isLoading || !selectedLot || selectedLot.quality_status !== 'released' || !productionOrderNo || !issueQuantity || !password || !reason} onClick={runIssue} type="button">
            {t('warehouseOps.issue')}
          </Button>
        </div>
      </div>
    </section>
  )
}

function FormInput({ label, onChange, type = 'text', value }: { label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return (
    <label className="mb-3 block text-sm font-medium text-slate-700">
      {label}
      <input className="input mt-1" onChange={(event) => onChange(event.target.value)} type={type} value={value} />
    </label>
  )
}

function Reason({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  const { t } = useI18n()
  return <FormInput label={t('common.reason')} onChange={onChange} value={value} />
}
