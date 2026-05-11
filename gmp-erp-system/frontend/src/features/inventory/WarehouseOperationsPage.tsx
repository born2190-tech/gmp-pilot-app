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

interface IssueLine {
  id: string
  lotId: string
  quantity: string
}

function makeId() {
  return Math.random().toString(36).slice(2)
}

function emptyLine(): IssueLine {
  return { id: makeId(), lotId: '', quantity: '' }
}

export function WarehouseOperationsPage({ token, user }: WarehouseOperationsPageProps) {
  const { t } = useI18n()
  const [lots, setLots] = useState<LotItem[]>([])
  const [locations, setLocations] = useState<LocationItem[]>([])

  // Transfer / Adjust shared selected lot
  const [selectedLotId, setSelectedLotId] = useState('')
  const [targetLocationId, setTargetLocationId] = useState('')
  const [newQuantity, setNewQuantity] = useState('')
  const [adjustPassword, setAdjustPassword] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [transferReason, setTransferReason] = useState('')

  // Multi-lot issue
  const [issueLines, setIssueLines] = useState<IssueLine[]>([emptyLine()])
  const [productionOrderNo, setProductionOrderNo] = useState('')
  const [issuePassword, setIssuePassword] = useState('')
  const [issueReason, setIssueReason] = useState('')

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
  const scopedLocations = selectedLot
    ? locations.filter((location) => location.warehouse_id === selectedLot.warehouse_id && location.code !== selectedLot.location_code)
    : locations
  const releasedLots = lots.filter((lot) => lot.quality_status === 'released')

  // --------------- Transfer ---------------
  async function runTransfer() {
    if (!selectedLot) return
    await runOperation(async () => {
      await transferLot(token, selectedLot.id, { to_location_id: targetLocationId, reason: transferReason })
      setSuccess(t('warehouseOps.transferDone'))
      setTargetLocationId('')
      setTransferReason('')
    })
  }

  // --------------- Adjust ---------------
  async function runAdjust() {
    if (!selectedLot) return
    await runOperation(async () => {
      await adjustLot(token, selectedLot.id, {
        new_quantity: Number(newQuantity),
        username: user.username,
        password: adjustPassword,
        meaning: t('warehouseOps.signatureMeaningAdjust'),
        reason: adjustReason,
      })
      setSuccess(t('warehouseOps.adjustDone'))
      setNewQuantity('')
      setAdjustPassword('')
      setAdjustReason('')
    })
  }

  // --------------- Issue (multi-lot) ---------------
  function addIssueLine() {
    setIssueLines((prev) => [...prev, emptyLine()])
  }

  function removeIssueLine(id: string) {
    setIssueLines((prev) => prev.length > 1 ? prev.filter((line) => line.id !== id) : prev)
  }

  function updateIssueLine(id: string, patch: Partial<IssueLine>) {
    setIssueLines((prev) => prev.map((line) => line.id === id ? { ...line, ...patch } : line))
  }

  async function runIssueAll() {
    const validLines = issueLines.filter((line) => line.lotId && Number(line.quantity) > 0)
    if (!validLines.length || !productionOrderNo || !issuePassword || !issueReason) return
    await runOperation(async () => {
      for (const line of validLines) {
        await issueProduction(token, line.lotId, {
          quantity: Number(line.quantity),
          production_order_no: productionOrderNo,
          username: user.username,
          password: issuePassword,
          meaning: t('warehouseOps.signatureMeaningIssue'),
          reason: issueReason,
        })
      }
      setSuccess(t('warehouseOps.issueAllDone', { count: String(validLines.length) }))
      setIssueLines([emptyLine()])
      setIssuePassword('')
      setIssueReason('')
    })
  }

  async function runOperation(operation: () => Promise<void>) {
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      await operation()
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('warehouseOps.actionFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const issueValid =
    issueLines.some((line) => line.lotId && Number(line.quantity) > 0) &&
    !!productionOrderNo &&
    !!issuePassword &&
    !!issueReason

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs uppercase text-slate-500">{t('warehouseOps.subtitle')}</p>
        <h1 className="text-2xl font-semibold text-slate-950">{t('warehouseOps.title')}</h1>
      </div>
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      {/* Lot selector for Transfer / Adjust */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium uppercase text-slate-400">{t('warehouseOps.sectionTransferAdjust')}</p>
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

      {/* Transfer + Adjust — 2-col */}
      <div className="grid gap-4 xl:grid-cols-2">
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
          <FormInput label={t('common.reason')} onChange={setTransferReason} value={transferReason} />
          <Button disabled={isLoading || !selectedLot || !targetLocationId || !transferReason} onClick={runTransfer} type="button">
            {t('warehouseOps.transfer')}
          </Button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-base font-semibold text-slate-900">{t('warehouseOps.adjust')}</h2>
          <FormInput label={t('warehouseOps.newQuantity')} onChange={setNewQuantity} type="number" value={newQuantity} />
          <FormInput label={t('quality.signaturePassword')} onChange={setAdjustPassword} type="password" value={adjustPassword} />
          <FormInput label={t('common.reason')} onChange={setAdjustReason} value={adjustReason} />
          <Button disabled={isLoading || !selectedLot || !newQuantity || !adjustPassword || !adjustReason} onClick={runAdjust} type="button">
            {t('warehouseOps.adjust')}
          </Button>
        </div>
      </div>

      {/* Issue to Production — full-width multi-lot */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t('warehouseOps.issue')}</h2>
            <p className="text-xs text-slate-500">{t('warehouseOps.issueHint')}</p>
          </div>
          <span className="inline-flex items-center rounded-full bg-orange-50 border border-orange-200 px-2.5 py-0.5 text-xs font-medium text-orange-700">
            {issueLines.length} {t('warehouseOps.substanceCount')}
          </span>
        </div>

        {/* Production order */}
        <div className="mb-4">
          <FormInput label={t('warehouseOps.productionOrder')} onChange={setProductionOrderNo} value={productionOrderNo} />
        </div>

        {/* Lines table */}
        <div className="mb-3 overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">{t('warehouseOps.substanceLot')}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">{t('warehouseOps.available')}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">{t('warehouseOps.issueQuantity')}</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">{t('registry.location')}</th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {issueLines.map((line, idx) => {
                const lot = lots.find((l) => l.id === line.lotId)
                const qtyNum = Number(line.quantity)
                const overLimit = lot && qtyNum > lot.quantity
                return (
                  <tr key={line.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <select
                        className="input py-1 text-sm"
                        onChange={(e) => updateIssueLine(line.id, { lotId: e.target.value, quantity: '' })}
                        value={line.lotId}
                      >
                        <option value="">{t('warehouseOps.selectLotPlaceholder')}</option>
                        {releasedLots.map((l) => (
                          <option
                            key={l.id}
                            value={l.id}
                            disabled={issueLines.some((il) => il.id !== line.id && il.lotId === l.id)}
                          >
                            {l.internal_lot} · {l.material_name || l.material_code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {lot ? `${lot.quantity} ${lot.unit}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          className={`input w-24 py-1 text-sm ${overLimit ? 'border-red-400 text-red-700' : ''}`}
                          min="0"
                          onChange={(e) => updateIssueLine(line.id, { quantity: e.target.value })}
                          placeholder="0"
                          type="number"
                          value={line.quantity}
                        />
                        {lot && line.quantity && (
                          <span className="text-xs text-slate-400">{lot.unit}</span>
                        )}
                        {overLimit && (
                          <span className="text-xs text-red-500">{t('warehouseOps.overLimit')}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{lot?.location_code ?? '—'}</td>
                    <td className="px-3 py-2">
                      <button
                        className="text-slate-300 hover:text-red-500 disabled:opacity-30"
                        disabled={issueLines.length <= 1}
                        onClick={() => removeIssueLine(line.id)}
                        title={t('warehouseOps.removeLine')}
                        type="button"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <button
          className="mb-4 flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700"
          onClick={addIssueLine}
          type="button"
        >
          + {t('warehouseOps.addSubstance')}
        </button>

        {/* Shared signature + reason */}
        <div className="grid gap-4 border-t border-slate-100 pt-4 xl:grid-cols-2">
          <FormInput label={t('quality.signaturePassword')} onChange={setIssuePassword} type="password" value={issuePassword} />
          <FormInput label={t('common.reason')} onChange={setIssueReason} value={issueReason} />
        </div>

        <div className="mt-2 flex items-center gap-3">
          <Button
            className="bg-orange-600 hover:bg-orange-700"
            disabled={isLoading || !issueValid}
            onClick={runIssueAll}
            type="button"
          >
            {t('warehouseOps.issueAll')}
          </Button>
          {issueLines.filter((l) => l.lotId && Number(l.quantity) > 0).length > 0 && (
            <span className="text-xs text-slate-400">
              {t('warehouseOps.willIssue', { count: String(issueLines.filter((l) => l.lotId && Number(l.quantity) > 0).length) })}
            </span>
          )}
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
