import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Hash,
  Info,
  MapPin,
  MoveRight,
  Package,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { adjustLot, listLocations, listLots, transferLot } from '../../lib/api'
import { translatedLocation } from '../../lib/display'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'
import type { LocationItem, LotItem } from '../../types/inventory'

interface WarehouseOperationsPageProps {
  token: string
  user: CurrentUser
}

type Translate = ReturnType<typeof useI18n>['t']

type AdjustReasonKey = 'breakage' | 'qcSampling' | 'expired' | 'inventory' | 'other'

const ADJUST_REASON_KEYS: AdjustReasonKey[] = ['breakage', 'qcSampling', 'expired', 'inventory', 'other']

export function WarehouseOperationsPage({ token, user }: WarehouseOperationsPageProps) {
  const { t } = useI18n()
  const [lots, setLots] = useState<LotItem[]>([])
  const [locations, setLocations] = useState<LocationItem[]>([])

  const [selectedLotId, setSelectedLotId] = useState<string>('')

  // Transfer
  const [targetLocationId, setTargetLocationId] = useState('')
  const [transferReason, setTransferReason] = useState('')

  // Adjust
  const [newQuantity, setNewQuantity] = useState('')
  const [adjustReasonKey, setAdjustReasonKey] = useState<AdjustReasonKey | ''>('')
  const [adjustReasonDetails, setAdjustReasonDetails] = useState('')
  const [adjustPassword, setAdjustPassword] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadData() {
    setIsLoading(true)
    try {
      const [lotsResponse, locationsResponse] = await Promise.all([listLots(token), listLocations(token)])
      setLots(lotsResponse.lots)
      setLocations(locationsResponse.locations)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('warehouseOps.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const selectedLot = lots.find((lot) => lot.id === selectedLotId)
  const scopedLocations = selectedLot
    ? locations.filter(
        (location) => location.warehouse_id === selectedLot.warehouse_id && location.code !== selectedLot.location_code,
      )
    : []

  function clearTransfer() {
    setTargetLocationId('')
    setTransferReason('')
  }

  function clearAdjust() {
    setNewQuantity('')
    setAdjustReasonKey('')
    setAdjustReasonDetails('')
    setAdjustPassword('')
  }

  function clearSelection() {
    setSelectedLotId('')
    clearTransfer()
    clearAdjust()
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

  async function runTransfer() {
    if (!selectedLot || !targetLocationId || !transferReason) return
    await runOperation(async () => {
      await transferLot(token, selectedLot.id, {
        to_location_id: targetLocationId,
        reason: transferReason,
      })
      setSuccess(t('warehouseOps.transferDone'))
      clearTransfer()
      clearSelection()
    })
  }

  async function runAdjust() {
    if (!selectedLot || !adjustReasonKey || newQuantity === '' || !adjustPassword) return
    if (adjustReasonKey === 'other' && !adjustReasonDetails.trim()) return

    const reasonLabel = t(`warehouseOps.adjustReason.${adjustReasonKey}` as never)
    const reason =
      adjustReasonKey === 'other'
        ? `${reasonLabel}: ${adjustReasonDetails.trim()}`
        : reasonLabel

    await runOperation(async () => {
      await adjustLot(token, selectedLot.id, {
        new_quantity: Number(newQuantity),
        username: user.username,
        password: adjustPassword,
        meaning: t('warehouseOps.signatureMeaningAdjust'),
        reason,
      })
      setSuccess(t('warehouseOps.adjustDone'))
      clearAdjust()
      clearSelection()
    })
  }

  const transferValid =
    Boolean(selectedLot) &&
    Boolean(targetLocationId) &&
    transferReason.trim().length > 0

  const adjustValid =
    Boolean(selectedLot) &&
    newQuantity !== '' &&
    Number(newQuantity) >= 0 &&
    Boolean(adjustReasonKey) &&
    (adjustReasonKey !== 'other' || adjustReasonDetails.trim().length > 0) &&
    adjustPassword.length > 0

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            {t('warehouseOps.kicker')}
          </p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-950">
            {t('warehouseOps.title')}
          </h1>
          <p className="max-w-2xl text-sm text-slate-600">{t('warehouseOps.subtitle')}</p>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>{success}</span>
          <button
            type="button"
            onClick={() => setSuccess(null)}
            className="ml-auto text-emerald-700 hover:text-emerald-900"
            aria-label="dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Step 1 — Lot picker (sticky) */}
      <div className="sticky top-4 z-10 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {t('warehouseOps.stepOne')}
            </p>
            <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
              {t('warehouseOps.sectionSelectLot')}
            </h2>
          </div>
          {selectedLot && (
            <button
              type="button"
              onClick={clearSelection}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <X size={13} />
              {t('warehouseOps.resetSelection')}
            </button>
          )}
        </div>

        <div className="mt-3">
          <LotCombobox
            lots={lots}
            selectedLot={selectedLot ?? null}
            onSelect={(lot) => {
              setSelectedLotId(lot.id)
              clearTransfer()
              clearAdjust()
            }}
            t={t}
          />
        </div>

        <SelectedLotCard lot={selectedLot ?? null} t={t} />
      </div>

      {/* Step 2 — Operations */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Transfer */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white">
              <MoveRight size={16} />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {t('warehouseOps.stepTwoA')}
              </p>
              <h2 className="text-[15px] font-semibold text-slate-900">{t('warehouseOps.sectionTransfer')}</h2>
              <p className="text-[12px] text-slate-500">{t('warehouseOps.transferHint')}</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <FormRow label={t('warehouseOps.targetLocation')}>
              <select
                value={targetLocationId}
                onChange={(event) => setTargetLocationId(event.target.value)}
                disabled={!selectedLot}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">
                  {selectedLot ? t('receipt.selectLocation') : t('warehouseOps.selectLotFirst')}
                </option>
                {scopedLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {translatedLocation(location.code, t)} · {location.code}
                  </option>
                ))}
              </select>
            </FormRow>

            <FormRow label={t('warehouseOps.transferReasonLabel')}>
              <input
                type="text"
                value={transferReason}
                onChange={(event) => setTransferReason(event.target.value)}
                disabled={!selectedLot}
                placeholder={t('warehouseOps.transferReasonPlaceholder')}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60 disabled:cursor-not-allowed disabled:bg-slate-50"
              />
            </FormRow>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={isLoading || !transferValid}
              onClick={runTransfer}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-3.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <MoveRight size={15} />
              {t('warehouseOps.transfer')}
            </button>
          </div>
        </div>

        {/* Adjust */}
        <div className="rounded-lg border border-amber-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3 border-b border-amber-100 pb-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-amber-100 text-amber-800">
              <SlidersHorizontal size={16} />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                {t('warehouseOps.stepTwoB')}
              </p>
              <h2 className="text-[15px] font-semibold text-slate-900">{t('warehouseOps.sectionAdjust')}</h2>
              <p className="text-[12px] text-slate-500">{t('warehouseOps.adjustHint')}</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormRow label={t('warehouseOps.currentQuantity')}>
                <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 font-mono text-sm tabular-nums text-slate-500">
                  {selectedLot ? `${selectedLot.quantity} ${selectedLot.unit}` : '—'}
                </div>
              </FormRow>

              <FormRow label={t('warehouseOps.newQuantity')}>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0"
                    value={newQuantity}
                    onChange={(event) => setNewQuantity(event.target.value)}
                    disabled={!selectedLot}
                    placeholder="0"
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm tabular-nums outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                  />
                  {selectedLot && <span className="text-xs text-slate-500">{selectedLot.unit}</span>}
                </div>
              </FormRow>
            </div>

            <FormRow label={t('warehouseOps.adjustReasonHeading')}>
              <select
                value={adjustReasonKey}
                onChange={(event) => setAdjustReasonKey(event.target.value as AdjustReasonKey | '')}
                disabled={!selectedLot}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:cursor-not-allowed disabled:bg-slate-50"
              >
                <option value="">{t('warehouseOps.adjustReasonPlaceholder')}</option>
                {ADJUST_REASON_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {t(`warehouseOps.adjustReason.${key}` as never)}
                  </option>
                ))}
              </select>
            </FormRow>

            {adjustReasonKey === 'other' && (
              <FormRow label={t('warehouseOps.adjustReasonDetailsLabel')}>
                <input
                  type="text"
                  value={adjustReasonDetails}
                  onChange={(event) => setAdjustReasonDetails(event.target.value)}
                  placeholder={t('warehouseOps.adjustReasonDetailsPlaceholder')}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
              </FormRow>
            )}

            <FormRow label={t('quality.signaturePassword')}>
              <input
                type="password"
                value={adjustPassword}
                onChange={(event) => setAdjustPassword(event.target.value)}
                disabled={!selectedLot}
                placeholder="••••••••"
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:cursor-not-allowed disabled:bg-slate-50"
              />
            </FormRow>

            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{t('warehouseOps.adjustWarning')}</span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-amber-100 pt-4">
            <button
              type="button"
              disabled={isLoading || !adjustValid}
              onClick={runAdjust}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border-2 border-amber-600 bg-white px-3.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-amber-200 disabled:text-amber-300"
            >
              <AlertTriangle size={15} />
              {t('warehouseOps.adjust')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Lot combobox ──────────────────────────────────────────────────────────

interface LotComboboxProps {
  lots: LotItem[]
  selectedLot: LotItem | null
  onSelect: (lot: LotItem) => void
  t: Translate
}

function LotCombobox({ lots, selectedLot, onSelect, t }: LotComboboxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const results = useMemo<LotItem[]>(() => {
    const q = query.trim().toLowerCase()
    const haystack = (lot: LotItem) =>
      [lot.internal_lot, lot.supplier_lot, lot.material_code, lot.material_name, lot.manufacturer_name]
        .join(' ')
        .toLowerCase()
    const list = q ? lots.filter((lot) => haystack(lot).includes(q)) : lots
    return list.slice(0, 20)
  }, [lots, query])

  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    setActiveIdx(0)
  }, [query, open])

  function pick(lot: LotItem) {
    onSelect(lot)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  function onInputKey(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter' && results[activeIdx]) {
      event.preventDefault()
      pick(results[activeIdx])
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={`flex items-center gap-2 rounded-md border bg-white pl-2.5 pr-1 transition ${
          open ? 'border-slate-400 ring-2 ring-slate-200/60' : 'border-slate-300'
        }`}
      >
        <Search size={15} className="shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKey}
          placeholder={t('warehouseOps.searchLotPlaceholder')}
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="clear"
          >
            <X size={14} />
          </button>
        )}
        <span className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:inline">
          {results.length}/{lots.length}
        </span>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[360px] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-slate-500">{t('warehouseOps.noLotsFound')}</div>
          ) : (
            results.map((lot, idx) => {
              const isActive = idx === activeIdx
              const isSelected = selectedLot?.id === lot.id
              return (
                <button
                  key={lot.id}
                  type="button"
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => pick(lot)}
                  className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 ${
                    isActive ? 'bg-slate-50' : 'bg-white'
                  } ${isSelected ? 'ring-1 ring-inset ring-slate-300' : ''}`}
                >
                  <span className="inline-flex w-[110px] shrink-0 font-mono text-[12px] font-semibold text-slate-900">
                    {highlight(lot.internal_lot, query)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">
                    {highlight(lot.material_name, query)}
                    <span className="ml-2 text-[11px] text-slate-500">{highlight(lot.manufacturer_name, query)}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] tabular-nums text-slate-700">
                    <span className="font-semibold">{lot.quantity}</span>
                    <span className="text-slate-500">{lot.unit}</span>
                  </span>
                  <span className="hidden w-[120px] shrink-0 truncate text-[12px] text-slate-500 sm:inline">
                    {translatedLocation(lot.location_code, t)}
                  </span>
                  <StatusBadge status={lot.quality_status} />
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

function highlight(text: string, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q)
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-100 px-0.5 text-slate-900">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

// ─── Selected lot summary ──────────────────────────────────────────────────

function SelectedLotCard({ lot, t }: { lot: LotItem | null; t: Translate }) {
  if (!lot) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50/40 px-3 py-3 text-sm text-slate-500">
        <Info size={15} className="text-slate-400" />
        {t('warehouseOps.lotPickerHint')}
      </div>
    )
  }
  return (
    <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200/60 text-sm md:grid-cols-5">
      <Field label={t('warehouseOps.lotMaterial')} value={lot.material_name} icon={<Package size={13} />} />
      <Field
        label={t('warehouseOps.lotBatch')}
        mono
        value={lot.internal_lot}
        icon={<Hash size={13} />}
        sub={lot.supplier_lot}
      />
      <Field
        label={t('warehouseOps.lotQty')}
        mono
        value={
          <>
            <span className="font-semibold">{lot.quantity}</span> <span className="text-slate-500">{lot.unit}</span>
          </>
        }
      />
      <Field label={t('warehouseOps.lotLocation')} value={translatedLocation(lot.location_code, t)} icon={<MapPin size={13} />} />
      <Field label={t('warehouseOps.lotStatus')} value={<StatusBadge status={lot.quality_status} />} />
    </div>
  )
}

interface FieldProps {
  label: string
  value: React.ReactNode
  sub?: string
  mono?: boolean
  icon?: React.ReactNode
}

function Field({ label, value, sub, mono, icon }: FieldProps) {
  return (
    <div className="bg-white px-3 py-2.5">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {icon}
        <span>{label}</span>
      </p>
      <p className={`mt-0.5 text-[13px] font-medium text-slate-900 ${mono ? 'font-mono' : ''}`}>{value}</p>
      {sub && <p className="font-mono text-[11px] text-slate-500">{sub}</p>}
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</label>
      {children}
    </div>
  )
}
