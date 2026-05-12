import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { createReceipt, listLocations, listManufacturers, listMaterials, listSuppliers, listWarehouses, postReceipt } from '../../lib/api'
import { translatedLocation } from '../../lib/display'
import type { CurrentUser } from '../../types/auth'
import type { LocationItem, ManufacturerItem, MaterialItem, ReceiptCreate, SupplierItem, WarehouseItem } from '../../types/inventory'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n/I18nProvider'

interface ReceiptDocumentPageProps {
  token: string
  user: CurrentUser
  username: string
}

interface ReceiptForm {
  document_no: string
  warehouse_id: string
  received_date: string
  signature_password: string
  reason: string
}

interface ReceiptLineForm {
  id: string
  material_mode: 'existing' | 'new'
  material_id: string
  material_code: string
  material_name: string
  material_type: string
  supplier_mode: 'existing' | 'new' | 'none'
  supplier_id: string
  supplier_code: string
  supplier_name: string
  manufacturer_mode: 'existing' | 'new'
  manufacturer_id: string
  manufacturer_code: string
  manufacturer_name: string
  supplier_lot: string
  production_date: string
  expiry_date: string
  quantity: string
  unit: string
  location_id: string
}

interface PostedSummary {
  documentNo: string
  lotsCreated: number
}

const newLine = (locationId = ''): ReceiptLineForm => ({
  id: crypto.randomUUID(),
  material_mode: 'existing',
  material_id: '',
  material_code: '',
  material_name: '',
  material_type: 'raw_material',
  supplier_mode: 'existing',
  supplier_id: '',
  supplier_code: '',
  supplier_name: '',
  manufacturer_mode: 'existing',
  manufacturer_id: '',
  manufacturer_code: '',
  manufacturer_name: '',
  supplier_lot: '',
  production_date: '',
  expiry_date: '',
  quantity: '',
  unit: 'kg',
  location_id: locationId,
})

export function ReceiptDocumentPage({ token, user, username }: ReceiptDocumentPageProps) {
  const { t } = useI18n()
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([])
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([])
  const [manufacturers, setManufacturers] = useState<ManufacturerItem[]>([])
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [lines, setLines] = useState<ReceiptLineForm[]>([newLine()])
  const [error, setError] = useState<string | null>(null)
  const [postedSummary, setPostedSummary] = useState<PostedSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<ReceiptForm>({
    defaultValues: {
      document_no: `REC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-001`,
      received_date: new Date().toISOString().slice(0, 10),
      reason: t('receipt.defaultReason'),
    },
  })

  useEffect(() => {
    async function loadMasterData() {
      setIsLoading(true)
      try {
        const [warehouseResponse, locationResponse, supplierResponse, manufacturerResponse, materialResponse] = await Promise.all([
          listWarehouses(token),
          listLocations(token),
          listSuppliers(token),
          listManufacturers(token),
          listMaterials(token),
        ])
        const visibleWarehouses = user.warehouse_scope
          ? warehouseResponse.warehouses.filter((warehouse) => warehouse.warehouse_type === user.warehouse_scope)
          : warehouseResponse.warehouses
        setWarehouses(visibleWarehouses)
        setLocations(locationResponse.locations)
        setSuppliers(supplierResponse.suppliers)
        setManufacturers(manufacturerResponse.manufacturers)
        setMaterials(materialResponse.materials)
        if (visibleWarehouses.length >= 1) {
          form.setValue('warehouse_id', visibleWarehouses[0].id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('receipt.loadFailed'))
      } finally {
        setIsLoading(false)
      }
    }
    void loadMasterData()
  }, [form, t, token, user.warehouse_scope])

  const selectedWarehouseId = form.watch('warehouse_id')
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === selectedWarehouseId)
  const allowedLocations = useMemo(() => locations.filter((item) => item.warehouse_id === selectedWarehouseId), [locations, selectedWarehouseId])
  const defaultLocationId = useMemo(
    () => allowedLocations.find((item) => item.code === 'QUARANTINE')?.id ?? allowedLocations[0]?.id ?? '',
    [allowedLocations],
  )
  const optionalId = (value: string | undefined) => value || null

  useEffect(() => {
    if (!defaultLocationId) {
      return
    }
    setLines((current) => current.map((line) => (line.location_id ? line : { ...line, location_id: defaultLocationId })))
  }, [defaultLocationId])

  const masterDataReady = warehouses.length > 0 && locations.length > 0
  const lineErrors = lines.map((line) => validateLine(line, t))
  const hasLineErrors = lineErrors.some((items) => items.length > 0)

  function updateLine(id: string, patch: Partial<ReceiptLineForm>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  function changeMaterial(lineId: string, materialId: string) {
    const material = materials.find((item) => item.id === materialId)
    updateLine(lineId, { material_id: materialId, unit: material?.default_unit || 'kg' })
  }

  function addLine() {
    setLines((current) => [...current, newLine(defaultLocationId)])
  }

  function removeLine(lineId: string) {
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.id !== lineId)))
  }

  function resetDocument() {
    form.reset({
      document_no: `REC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-001`,
      received_date: new Date().toISOString().slice(0, 10),
      warehouse_id: selectedWarehouseId,
      reason: t('receipt.defaultReason'),
      signature_password: '',
    })
    setLines([newLine(defaultLocationId)])
    setPostedSummary(null)
    setError(null)
  }

  async function submit(values: ReceiptForm) {
    setError(null)
    setPostedSummary(null)
    if (hasLineErrors) {
      setError(t('receipt.fixLineErrors'))
      return
    }
    setIsLoading(true)
    try {
      const payload: ReceiptCreate = {
        document_no: values.document_no,
        supplier_id: null,
        supplier: null,
        manufacturer_id: null,
        manufacturer: null,
        warehouse_id: values.warehouse_id,
        received_date: values.received_date,
        lines: lines.map((line) => ({
          material_id: line.material_mode === 'existing' ? optionalId(line.material_id) : null,
          material: line.material_mode === 'new'
            ? { code: line.material_code.trim(), name: line.material_name.trim(), item_type: line.material_type.trim() || 'raw_material', default_unit: line.unit.trim() || 'kg' }
            : null,
          supplier_id: line.supplier_mode === 'existing' ? optionalId(line.supplier_id) : null,
          supplier: line.supplier_mode === 'new' ? { code: line.supplier_code.trim(), name: line.supplier_name.trim() } : null,
          manufacturer_id: line.manufacturer_mode === 'existing' ? optionalId(line.manufacturer_id) : null,
          manufacturer: line.manufacturer_mode === 'new' ? { code: line.manufacturer_code.trim(), name: line.manufacturer_name.trim() } : null,
          supplier_lot: line.supplier_lot.trim() || null,
          production_date: line.production_date || null,
          production_year: line.production_date ? new Date(line.production_date).getFullYear() : null,
          expiry_date: line.expiry_date,
          quantity: Number(line.quantity),
          unit: line.unit.trim() || 'kg',
          location_id: line.location_id,
        })),
      }
      const receipt = await createReceipt(token, payload)
      const posted = await postReceipt(token, receipt.id, {
        username,
        password: values.signature_password,
        meaning: t('receipt.postMeaning'),
        reason: values.reason,
      })
      setPostedSummary({ documentNo: posted.document_no, lotsCreated: posted.lots_created })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receipt.postFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{t('receipt.document')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-950">{t('receipt.title')}</h1>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              {postedSummary ? t('receipt.statusPosted') : t('receipt.statusDraft')}
            </span>
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <p className="text-xs uppercase text-slate-500">{t('receipt.warehouse')}</p>
          <p className="font-medium text-slate-950">{selectedWarehouse?.name ?? t('receipt.selectWarehouse')}</p>
        </div>
      </div>

      {!masterDataReady && <Alert tone="warning">{t('receipt.masterDataIncomplete')}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {postedSummary && (
        <Alert tone="success">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{t('receipt.posted', { documentNo: postedSummary.documentNo, count: postedSummary.lotsCreated })}</p>
              <p className="mt-1 text-sm">{t('receipt.qcNotificationCreated')}</p>
            </div>
            <Button type="button" variant="secondary" onClick={resetDocument}>{t('receipt.newReceipt')}</Button>
          </div>
        </Alert>
      )}

      <form className="space-y-5" onSubmit={form.handleSubmit(submit)}>
        <SectionBlock title={t('receipt.sectionDocument')}>
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_minmax(220px,1fr)]">
            <Field label={t('receipt.documentNo')}><input {...form.register('document_no', { required: true })} className="input" /></Field>
            <Field label={t('receipt.receivedDate')}><input type="date" {...form.register('received_date', { required: true })} className="input" /></Field>
            {!user.warehouse_scope && (
              <Field label={t('receipt.warehouse')}>
                <select {...form.register('warehouse_id', { required: true })} className="input">
                  <option value="">{t('receipt.selectWarehouse')}</option>
                  {warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
            )}
            {user.warehouse_scope && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs uppercase text-slate-500">{t('receipt.warehouse')}</p>
                <p className="text-sm font-medium text-slate-950">{selectedWarehouse?.name ?? t('receipt.substanceWarehouse')}</p>
              </div>
            )}
          </div>
        </SectionBlock>

        <SectionBlock
          action={<Button type="button" variant="secondary" onClick={addLine}>+ {t('receipt.addLine')}</Button>}
          title={t('receipt.lines')}
        >
          <div className="space-y-3">
            {lines.map((line, index) => (
              <LinePanel
                allowedLocations={allowedLocations}
                errors={lineErrors[index]}
                index={index}
                key={line.id}
                line={line}
                manufacturers={manufacturers}
                materials={materials}
                onChangeMaterial={changeMaterial}
                onRemove={removeLine}
                onUpdate={updateLine}
                removeDisabled={lines.length === 1}
                suppliers={suppliers}
                t={t}
              />
            ))}
          </div>
        </SectionBlock>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <SectionBlock tone="signature" title={t('receipt.eSignature')}>
            <p className="mb-3 text-sm text-slate-600">{t('receipt.eSignatureHint')}</p>
            <Field label={t('receipt.eSignature')}><input type="password" {...form.register('signature_password', { required: true })} className="input" /></Field>
            <Field label={t('common.reason')}><input {...form.register('reason', { required: true })} className="input" /></Field>
          </SectionBlock>

          <SectionBlock title={t('receipt.summaryTitle')}>
            <dl className="space-y-3 text-sm">
              <SummaryRow label={t('receipt.summaryLines')} value={String(lines.length)} />
              <SummaryRow label={t('receipt.summaryLots')} value={String(lines.length)} />
              <SummaryRow label={t('receipt.summaryWarehouse')} value={selectedWarehouse?.name ?? '—'} />
              <SummaryRow label={t('receipt.summaryStatus')} value={t('status.quarantine')} />
              <SummaryRow label={t('receipt.summaryQc')} value={t('receipt.summaryQcText')} />
            </dl>
          </SectionBlock>
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={resetDocument}>{t('common.cancel')}</Button>
          <Button disabled={isLoading || !masterDataReady || hasLineErrors} type="submit">{isLoading ? t('receipt.posting') : t('receipt.post')}</Button>
        </div>
      </form>
    </section>
  )
}

function LinePanel({
  allowedLocations,
  errors,
  index,
  line,
  manufacturers,
  materials,
  onChangeMaterial,
  onRemove,
  onUpdate,
  removeDisabled,
  suppliers,
  t,
}: {
  allowedLocations: LocationItem[]
  errors: string[]
  index: number
  line: ReceiptLineForm
  manufacturers: ManufacturerItem[]
  materials: MaterialItem[]
  onChangeMaterial: (lineId: string, materialId: string) => void
  onRemove: (lineId: string) => void
  onUpdate: (lineId: string, patch: Partial<ReceiptLineForm>) => void
  removeDisabled: boolean
  suppliers: SupplierItem[]
  t: ReturnType<typeof useI18n>['t']
}) {
  const hasErrors = errors.length > 0
  return (
    <div className={`rounded-md border bg-white shadow-sm ${hasErrors ? 'border-red-200' : 'border-slate-200'}`}>
      <div className={`flex items-center justify-between gap-3 border-b px-4 py-2 ${hasErrors ? 'border-red-100 bg-red-50' : 'border-slate-100 bg-slate-50'}`}>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-slate-900 px-2 text-xs font-semibold text-white">{index + 1}</span>
          <span className="text-sm font-semibold text-slate-900">{t('receipt.lineTitle', { count: index + 1 })}</span>
          {hasErrors && <span className="text-xs font-medium text-red-700">{errors.length}</span>}
        </div>
        <button className="text-sm font-medium text-red-600 hover:text-red-700 disabled:text-slate-300" disabled={removeDisabled} onClick={() => onRemove(line.id)} type="button">
          {t('receipt.removeLine')}
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(280px,1.35fr)_220px_120px_88px_minmax(180px,0.8fr)]">
          <Field label={t('receipt.material')}>
            <ModeButtons
              options={[
                { label: t('receipt.existing'), active: line.material_mode === 'existing', onClick: () => onUpdate(line.id, { material_mode: 'existing' }) },
                { label: t('receipt.new'), active: line.material_mode === 'new', onClick: () => onUpdate(line.id, { material_mode: 'new' }) },
              ]}
            />
            {line.material_mode === 'existing' && (
              <select className="input" value={line.material_id} onChange={(event) => onChangeMaterial(line.id, event.target.value)}>
                <option value="">{t('receipt.selectMaterial')}</option>
                {materials.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
              </select>
            )}
            {line.material_mode === 'new' && (
              <div className="grid gap-2">
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                  <input className="input" placeholder={t('common.code')} value={line.material_code} onChange={(event) => onUpdate(line.id, { material_code: event.target.value })} />
                  <input className="input" placeholder={t('common.name')} value={line.material_name} onChange={(event) => onUpdate(line.id, { material_name: event.target.value })} />
                </div>
                <input className="input" placeholder={t('common.type')} value={line.material_type} onChange={(event) => onUpdate(line.id, { material_type: event.target.value })} />
              </div>
            )}
          </Field>

          <Field label={t('receipt.supplierLot')}>
            <input className="input font-mono" placeholder="LOT-2026-..." value={line.supplier_lot} onChange={(event) => onUpdate(line.id, { supplier_lot: event.target.value })} />
          </Field>

          <Field label={t('receipt.quantity')}>
            <input className="input" min="0" step="0.001" type="number" value={line.quantity} onChange={(event) => onUpdate(line.id, { quantity: event.target.value })} />
          </Field>

          <Field label={t('common.unit')}>
            <input className="input px-2" value={line.unit} onChange={(event) => onUpdate(line.id, { unit: event.target.value })} />
          </Field>

          <Field label={t('receipt.location')}>
            <select className="input" value={line.location_id} onChange={(event) => onUpdate(line.id, { location_id: event.target.value })}>
              <option value="">{t('receipt.selectLocation')}</option>
              {allowedLocations.map((item) => <option key={item.id} value={item.id}>{translatedLocation(item.code, t)}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_minmax(280px,1fr)_150px_150px]">
          <Field label={t('receipt.manufacturer')}>
            <OriginPicker
              emptyText={t('receipt.selectManufacturer')}
              mode={line.manufacturer_mode}
              modeOptions={['existing', 'new']}
              onModeChange={(mode) => onUpdate(line.id, { manufacturer_mode: mode as 'existing' | 'new' })}
              onNewCodeChange={(value) => onUpdate(line.id, { manufacturer_code: value })}
              onNewNameChange={(value) => onUpdate(line.id, { manufacturer_name: value })}
              onSelect={(value) => onUpdate(line.id, { manufacturer_id: value })}
              references={manufacturers}
              t={t}
              value={line.manufacturer_id}
              newCode={line.manufacturer_code}
              newName={line.manufacturer_name}
            />
          </Field>

          <Field label={t('receipt.supplier')}>
            <OriginPicker
              emptyText={t('receipt.selectSupplier')}
              mode={line.supplier_mode}
              modeOptions={['existing', 'new', 'none']}
              onModeChange={(mode) => onUpdate(line.id, { supplier_mode: mode as 'existing' | 'new' | 'none' })}
              onNewCodeChange={(value) => onUpdate(line.id, { supplier_code: value })}
              onNewNameChange={(value) => onUpdate(line.id, { supplier_name: value })}
              onSelect={(value) => onUpdate(line.id, { supplier_id: value })}
              references={suppliers}
              t={t}
              value={line.supplier_id}
              newCode={line.supplier_code}
              newName={line.supplier_name}
            />
          </Field>

          <Field label={t('receipt.productionDate')}>
            <input className="input px-2" type="date" value={line.production_date} onChange={(event) => onUpdate(line.id, { production_date: event.target.value })} />
          </Field>

          <Field label={t('receipt.expiryDate')}>
            <input className="input px-2" type="date" value={line.expiry_date} onChange={(event) => onUpdate(line.id, { expiry_date: event.target.value })} />
          </Field>
        </div>

        {hasErrors && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.join('; ')}</p>}
      </div>
    </div>
  )
}

function OriginPicker({
  emptyText,
  mode,
  modeOptions,
  newCode,
  newName,
  onModeChange,
  onNewCodeChange,
  onNewNameChange,
  onSelect,
  references,
  t,
  value,
}: {
  emptyText: string
  mode: 'existing' | 'new' | 'none'
  modeOptions: Array<'existing' | 'new' | 'none'>
  newCode: string
  newName: string
  onModeChange: (mode: 'existing' | 'new' | 'none') => void
  onNewCodeChange: (value: string) => void
  onNewNameChange: (value: string) => void
  onSelect: (value: string) => void
  references: Array<SupplierItem | ManufacturerItem>
  t: ReturnType<typeof useI18n>['t']
  value: string
}) {
  return (
    <div className="min-w-0">
      <ModeButtons
        options={modeOptions.map((item) => ({
          label: item === 'existing' ? t('receipt.existing') : item === 'new' ? t('receipt.new') : t('receipt.noSupplier'),
          active: mode === item,
          onClick: () => onModeChange(item),
        }))}
      />
      {mode === 'existing' && (
        <select className="input truncate text-left" value={value} onChange={(event) => onSelect(event.target.value)}>
          <option value="">{emptyText}</option>
          {references.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
        </select>
      )}
      {mode === 'new' && (
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
          <input className="input" placeholder={t('common.code')} value={newCode} onChange={(event) => onNewCodeChange(event.target.value)} />
          <input className="input" placeholder={t('common.name')} value={newName} onChange={(event) => onNewNameChange(event.target.value)} />
        </div>
      )}
      {mode === 'none' && <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{t('receipt.noSupplierSelected')}</p>}
    </div>
  )
}

function validateLine(line: ReceiptLineForm, t: ReturnType<typeof useI18n>['t']) {
  const errors: string[] = []
  const quantity = Number(line.quantity)
  if (line.material_mode === 'existing' && !line.material_id) errors.push(t('receipt.materialRequired'))
  if (line.material_mode === 'new' && (!line.material_code.trim() || !line.material_name.trim())) errors.push(t('receipt.materialRequired'))
  if (line.manufacturer_mode === 'existing' && !line.manufacturer_id) errors.push(t('receipt.manufacturerRequired'))
  if (line.manufacturer_mode === 'new' && (!line.manufacturer_code.trim() || !line.manufacturer_name.trim())) errors.push(t('receipt.manufacturerRequired'))
  if (line.supplier_mode === 'existing' && !line.supplier_id) errors.push(t('receipt.supplierRequired'))
  if (line.supplier_mode === 'new' && (!line.supplier_code.trim() || !line.supplier_name.trim())) errors.push(t('receipt.supplierRequired'))
  if (!line.supplier_lot.trim()) errors.push(t('receipt.supplierLotRequired'))
  if (!line.production_date) errors.push(t('receipt.productionDateRequired'))
  if (!line.expiry_date) errors.push(t('receipt.expiryDateRequired'))
  if (!Number.isFinite(quantity) || quantity <= 0) errors.push(t('receipt.quantityWarning'))
  if (!line.location_id) errors.push(t('receipt.locationRequired'))
  if (line.production_date && line.expiry_date && line.expiry_date < line.production_date) errors.push(t('receipt.expiryWarning'))
  return errors
}

function Alert({ children, tone }: { children: ReactNode; tone: 'error' | 'success' | 'warning' }) {
  const classes = {
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
  }
  return <div className={`rounded-md border px-4 py-3 text-sm ${classes[tone]}`}>{children}</div>
}

function SectionBlock({ action, children, title, tone = 'default' }: { action?: ReactNode; children: ReactNode; title: string; tone?: 'default' | 'signature' }) {
  const toneClass = tone === 'signature' ? 'border-amber-300 bg-[#fffaf0]' : 'border-slate-200 bg-white'
  return (
    <section className={`rounded-md border p-5 shadow-sm ${toneClass}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

function ModeButtons({ options }: { options: Array<{ active: boolean; label: string; onClick: () => void }> }) {
  return (
    <div className="mb-2 flex flex-nowrap gap-1">
      {options.map((option) => (
        <button className={`mode-button whitespace-nowrap px-2 py-1 text-xs ${option.active ? 'mode-button-active' : ''}`} key={option.label} onClick={option.onClick} type="button">
          {option.label}
        </button>
      ))}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  )
}
