import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { AlertCircle, ChevronDown, ChevronRight, Info, Plus, Search } from 'lucide-react'
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
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
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

  useEffect(() => {
    if (!selectedLineId && lines.length > 0) {
      setSelectedLineId(lines[0].id)
    }
  }, [lines, selectedLineId])

  const masterDataReady = warehouses.length > 0 && locations.length > 0
  const lineErrors = lines.map((line) => validateLine(line, t))
  const hasLineErrors = lineErrors.some((items) => items.length > 0)
  const selectedLine = lines.find((line) => line.id === selectedLineId) ?? lines[0]

  function updateLine(id: string, patch: Partial<ReceiptLineForm>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  function changeMaterial(lineId: string, materialId: string) {
    const material = materials.find((item) => item.id === materialId)
    updateLine(lineId, { material_id: materialId, unit: material?.default_unit || 'kg' })
  }

  function addLine() {
    const line = newLine(defaultLocationId)
    setLines((current) => [...current, line])
    setSelectedLineId(line.id)
  }

  function removeLine(lineId: string) {
    setLines((current) => {
      if (current.length === 1) {
        return current
      }
      const next = current.filter((line) => line.id !== lineId)
      if (selectedLineId === lineId) {
        setSelectedLineId(next[0]?.id ?? null)
      }
      return next
    })
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
    setSelectedLineId(null)
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
        {!user.warehouse_scope && (
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            <p className="text-xs uppercase text-slate-500">{t('receipt.warehouse')}</p>
            <p className="font-medium text-slate-950">{selectedWarehouse?.name ?? t('receipt.selectWarehouse')}</p>
          </div>
        )}
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
            <Field label={t('common.reason')}><input {...form.register('reason', { required: true })} className="input" /></Field>
          </div>
        </SectionBlock>

        <SectionBlock
          action={<Button type="button" variant="secondary" onClick={addLine}>+ {t('receipt.addLine')}</Button>}
          title={t('receipt.lines')}
        >
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="flex h-[480px]">
              <div className="w-[60%] overflow-auto border-r border-slate-200">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="w-8 px-3 py-2.5"></th>
                      <th className="px-3 py-2.5">{t('receipt.material')}</th>
                      <th className="px-3 py-2.5">{t('receipt.supplierLot')}</th>
                      <th className="w-24 px-3 py-2.5">{t('receipt.quantity')}</th>
                      <th className="px-3 py-2.5">{t('receipt.expiryDate')}</th>
                      <th className="w-8 px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      <MaterialLineItem
                        errors={lineErrors[index]}
                        isSelected={selectedLine?.id === line.id}
                        key={line.id}
                        line={line}
                        manufacturerName={displayReference(line.manufacturer_mode, line.manufacturer_id, line.manufacturer_name, manufacturers)}
                        materialName={displayMaterial(line, materials)}
                        onRemove={removeLine}
                        onSelect={() => setSelectedLineId(line.id)}
                        removeDisabled={lines.length === 1}
                        t={t}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="w-[40%] bg-slate-50">
                {selectedLine ? (
                  <MaterialDetailPanel
                    allowedLocations={allowedLocations}
                    line={selectedLine}
                    manufacturers={manufacturers}
                    materials={materials}
                    onChangeMaterial={changeMaterial}
                    onUpdate={updateLine}
                    suppliers={suppliers}
                    t={t}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">{t('receipt.selectMaterial')}</div>
                )}
              </div>
            </div>
          </div>
        </SectionBlock>

        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-800">{t('receipt.summaryTitle')}</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3 text-sm">
              <SummaryInline label={t('receipt.summaryLines')} value={String(lines.length)} />
              <SummaryInline label={t('receipt.summaryLots')} value={String(lines.length)} />
              <SummaryInline label={t('receipt.summaryWarehouse')} value={selectedWarehouse?.name ?? '—'} />
            </div>
            <div className="space-y-3 text-sm">
              <SummaryInline label={t('receipt.summaryStatus')} value={<span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{t('status.quarantine')}</span>} />
              <SummaryInline label={t('receipt.summaryQc')} value={<span className="text-slate-600">{t('receipt.summaryQcText')}</span>} />
            </div>
          </div>
        </section>

        <section className="rounded-md border-2 border-amber-300 bg-amber-50/60 p-5 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <Info className="mt-0.5 text-amber-600" size={20} />
            <div>
              <h2 className="text-base font-semibold text-slate-800">{t('receipt.eSignature')}</h2>
              <p className="mt-1 text-sm text-slate-600">{t('receipt.eSignatureHint')}</p>
            </div>
          </div>
          <Field label={t('receipt.eSignaturePin')}>
            <input type="password" {...form.register('signature_password', { required: true })} className="input max-w-xl bg-white" />
          </Field>
        </section>

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={resetDocument}>{t('common.cancel')}</Button>
          <Button disabled={isLoading || !masterDataReady || hasLineErrors} type="submit">{isLoading ? t('receipt.posting') : t('receipt.post')}</Button>
        </div>
      </form>
    </section>
  )
}

function MaterialLineItem({
  errors,
  isSelected,
  line,
  manufacturerName,
  materialName,
  onRemove,
  onSelect,
  removeDisabled,
  t,
}: {
  errors: string[]
  isSelected: boolean
  line: ReceiptLineForm
  manufacturerName: string
  materialName: string
  onRemove: (lineId: string) => void
  onSelect: () => void
  removeDisabled: boolean
  t: ReturnType<typeof useI18n>['t']
}) {
  const hasErrors = errors.length > 0
  return (
    <tr className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`} onClick={onSelect}>
      <td className="px-3 py-2.5">
        {isSelected ? <ChevronDown className="h-4 w-4 text-blue-600" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          {hasErrors && <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />}
          <div className="min-w-0">
            <div className="max-w-[280px] truncate text-sm text-slate-900" title={materialName}>
              {materialName || <span className="italic text-slate-400">{t('receipt.materialRequired')}</span>}
            </div>
            {manufacturerName && (
              <div className="max-w-[280px] truncate text-xs text-slate-500" title={manufacturerName}>
                {manufacturerName}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="max-w-[180px] truncate font-mono text-sm text-slate-800" title={line.supplier_lot}>
          {line.supplier_lot || <span className="font-sans italic text-slate-400">—</span>}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-sm text-slate-800">{Number(line.quantity) > 0 ? `${line.quantity} ${line.unit}` : <span className="italic text-slate-400">—</span>}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-sm text-slate-800">{line.expiry_date || <span className="italic text-slate-400">—</span>}</span>
      </td>
      <td className="px-3 py-2.5">
        {isSelected && <div className="ml-auto h-8 w-1 rounded-full bg-blue-600" />}
        {!removeDisabled && (
          <button
            className="ml-auto rounded px-1 text-red-500 hover:bg-red-50"
            onClick={(event) => {
              event.stopPropagation()
              onRemove(line.id)
            }}
            title={t('receipt.removeLine')}
            type="button"
          >
            ×
          </button>
        )}
      </td>
    </tr>
  )
}

function MaterialDetailPanel({
  allowedLocations,
  line,
  manufacturers,
  materials,
  onChangeMaterial,
  onUpdate,
  suppliers,
  t,
}: {
  allowedLocations: LocationItem[]
  line: ReceiptLineForm
  manufacturers: ManufacturerItem[]
  materials: MaterialItem[]
  onChangeMaterial: (lineId: string, materialId: string) => void
  onUpdate: (lineId: string, patch: Partial<ReceiptLineForm>) => void
  suppliers: SupplierItem[]
  t: ReturnType<typeof useI18n>['t']
}) {
  return (
    <div className="h-full overflow-auto p-5">
      <div className="space-y-5">
        <DetailReference
          createLabel={t('receipt.createNew')}
          emptyText={t('receipt.selectMaterial')}
          label={t('receipt.material')}
          mode={line.material_mode}
          newCode={line.material_code}
          newName={line.material_name}
          onModeChange={(mode) => onUpdate(line.id, { material_mode: mode as 'existing' | 'new', material_id: mode === 'new' ? '' : line.material_id })}
          onNewCodeChange={(value) => onUpdate(line.id, { material_code: value })}
          onNewNameChange={(value) => onUpdate(line.id, { material_name: value })}
          onSelect={(value) => onChangeMaterial(line.id, value)}
          references={materials}
          selectedValue={line.material_id}
          t={t}
          typeValue={line.material_type}
          onTypeChange={(value) => onUpdate(line.id, { material_type: value })}
        />

        <Separator />

        <Field label={t('receipt.supplierLot')}>
          <input className="input bg-white font-mono" placeholder="Введите серию" title={line.supplier_lot} value={line.supplier_lot} onChange={(event) => onUpdate(line.id, { supplier_lot: event.target.value })} />
          {line.supplier_lot && <p className="mt-2 break-words text-xs text-slate-600">{line.supplier_lot}</p>}
        </Field>

        <Separator />

        <DetailReference
          createLabel={t('receipt.createNew')}
          emptyText={t('receipt.selectManufacturer')}
          label={t('receipt.manufacturer')}
          mode={line.manufacturer_mode}
          newCode={line.manufacturer_code}
          newName={line.manufacturer_name}
          onModeChange={(mode) => onUpdate(line.id, { manufacturer_mode: mode as 'existing' | 'new', manufacturer_id: mode === 'new' ? '' : line.manufacturer_id })}
          onNewCodeChange={(value) => onUpdate(line.id, { manufacturer_code: value })}
          onNewNameChange={(value) => onUpdate(line.id, { manufacturer_name: value })}
          onSelect={(value) => onUpdate(line.id, { manufacturer_id: value })}
          references={manufacturers}
          selectedValue={line.manufacturer_id}
          t={t}
        />

        <Separator />

        <DetailReference
          allowNone
          createLabel={t('receipt.createNew')}
          emptyText={t('receipt.selectSupplier')}
          label={`${t('receipt.supplier')} (${t('receipt.noSupplier').toLowerCase()})`}
          mode={line.supplier_mode}
          newCode={line.supplier_code}
          newName={line.supplier_name}
          onModeChange={(mode) => onUpdate(line.id, { supplier_mode: mode as 'existing' | 'new' | 'none', supplier_id: mode === 'new' ? '' : line.supplier_id })}
          onNewCodeChange={(value) => onUpdate(line.id, { supplier_code: value })}
          onNewNameChange={(value) => onUpdate(line.id, { supplier_name: value })}
          onSelect={(value) => onUpdate(line.id, { supplier_id: value })}
          references={suppliers}
          selectedValue={line.supplier_id}
          t={t}
        />

        <Separator />

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('receipt.productionDate')}><input className="input bg-white" type="date" value={line.production_date} onChange={(event) => onUpdate(line.id, { production_date: event.target.value })} /></Field>
          <Field label={t('receipt.expiryDate')}><input className="input bg-white" type="date" value={line.expiry_date} onChange={(event) => onUpdate(line.id, { expiry_date: event.target.value })} /></Field>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('receipt.quantity')}><input className="input bg-white" min="0" step="0.001" type="number" value={line.quantity} onChange={(event) => onUpdate(line.id, { quantity: event.target.value })} /></Field>
          <Field label={t('common.unit')}><input className="input bg-white" value={line.unit} onChange={(event) => onUpdate(line.id, { unit: event.target.value })} /></Field>
        </div>

        <Separator />

        <Field label={t('receipt.location')}>
          <select className="input bg-white" value={line.location_id} onChange={(event) => onUpdate(line.id, { location_id: event.target.value })}>
            <option value="">{t('receipt.selectLocation')}</option>
            {allowedLocations.map((item) => <option key={item.id} value={item.id}>{translatedLocation(item.code, t)}</option>)}
          </select>
        </Field>
      </div>
    </div>
  )
}

function DetailReference({
  allowNone = false,
  createLabel,
  emptyText,
  label,
  mode,
  newCode,
  newName,
  onModeChange,
  onNewCodeChange,
  onNewNameChange,
  onSelect,
  onTypeChange,
  references,
  selectedValue,
  t,
  typeValue,
}: {
  allowNone?: boolean
  createLabel: string
  emptyText: string
  label: string
  mode: 'existing' | 'new' | 'none'
  newCode: string
  newName: string
  onModeChange: (mode: 'existing' | 'new' | 'none') => void
  onNewCodeChange: (value: string) => void
  onNewNameChange: (value: string) => void
  onSelect: (value: string) => void
  onTypeChange?: (value: string) => void
  references: Array<MaterialItem | SupplierItem | ManufacturerItem>
  selectedValue: string
  t: ReturnType<typeof useI18n>['t']
  typeValue?: string
}) {
  const selected = references.find((item) => item.id === selectedValue)
  const selectedText = selected ? `${selected.code} · ${selected.name}` : ''
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <button className="inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium text-blue-700 hover:bg-blue-50" onClick={() => onModeChange(mode === 'new' ? 'existing' : 'new')} type="button">
          <Plus className="h-3 w-3" />
          {mode === 'new' ? t('receipt.chooseExisting') : createLabel}
        </button>
      </div>

      {mode === 'existing' && (
        <div className="relative">
          <select className="input bg-white pr-8" value={selectedValue} onChange={(event) => onSelect(event.target.value)}>
            <option value="">{emptyText}</option>
            {references.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
          </select>
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      )}
      {mode === 'new' && (
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
          <input className="input bg-white" placeholder={t('common.code')} value={newCode} onChange={(event) => onNewCodeChange(event.target.value)} />
          <input className="input bg-white" placeholder={t('common.name')} value={newName} onChange={(event) => onNewNameChange(event.target.value)} />
          {onTypeChange && <input className="input col-span-2 bg-white" placeholder={t('common.type')} value={typeValue ?? ''} onChange={(event) => onTypeChange(event.target.value)} />}
        </div>
      )}
      {allowNone && (
        <button className="mt-2 text-xs font-medium text-slate-600 hover:text-slate-900" onClick={() => onModeChange('none')} type="button">
          {t('receipt.noSupplier')}
        </button>
      )}
      {mode === 'none' && <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{t('receipt.noSupplierSelected')}</p>}
      {selectedText && <p className="mt-2 break-words text-xs text-slate-600">{selectedText}</p>}
      {mode === 'new' && newName && <p className="mt-2 break-words text-xs text-slate-600">{newName}</p>}
    </div>
  )
}

function Separator() {
  return <div className="h-px bg-slate-200" />
}

function displayMaterial(line: ReceiptLineForm, materials: MaterialItem[]) {
  if (line.material_mode === 'new') {
    return line.material_name || line.material_code
  }
  const material = materials.find((item) => item.id === line.material_id)
  return material ? `${material.code} · ${material.name}` : ''
}

function displayReference(mode: 'existing' | 'new' | 'none', id: string, name: string, references: Array<SupplierItem | ManufacturerItem>) {
  if (mode === 'none') {
    return ''
  }
  if (mode === 'new') {
    return name
  }
  const reference = references.find((item) => item.id === id)
  return reference ? `${reference.code} · ${reference.name}` : ''
}

function LineTableRow({
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
  const hasNewReference = line.material_mode === 'new' || line.manufacturer_mode === 'new' || line.supplier_mode === 'new'
  const selectedLocation = allowedLocations.find((item) => item.id === line.location_id)
  return (
    <>
      <tr className={`border-b border-slate-100 align-top ${hasErrors ? 'bg-red-50/50' : 'hover:bg-slate-50/70'}`}>
        <td className="px-3 py-3">
          <MaterialPicker
            line={line}
            materials={materials}
            onChangeMaterial={onChangeMaterial}
            onUpdate={onUpdate}
            t={t}
          />
        </td>
        <td className="px-3 py-3">
          <input
            className="input font-mono transition-[width,box-shadow] focus:relative focus:z-30 focus:w-[360px] focus:bg-white focus:shadow-lg"
            placeholder="LOT-2026-..."
            title={line.supplier_lot}
            value={line.supplier_lot}
            onChange={(event) => onUpdate(line.id, { supplier_lot: event.target.value })}
          />
        </td>
        <td className="px-3 py-3">
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
        </td>
        <td className="px-3 py-3">
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
        </td>
        <td className="px-3 py-3"><input className="input px-2" title={line.production_date} type="date" value={line.production_date} onChange={(event) => onUpdate(line.id, { production_date: event.target.value })} /></td>
        <td className="px-3 py-3"><input className="input px-2" title={line.expiry_date} type="date" value={line.expiry_date} onChange={(event) => onUpdate(line.id, { expiry_date: event.target.value })} /></td>
        <td className="px-3 py-3"><input className="input" min="0" step="0.001" title={line.quantity} type="number" value={line.quantity} onChange={(event) => onUpdate(line.id, { quantity: event.target.value })} /></td>
        <td className="px-3 py-3"><input className="input px-2 transition-[width,box-shadow] focus:relative focus:z-30 focus:w-[120px] focus:bg-white focus:shadow-lg" title={line.unit} value={line.unit} onChange={(event) => onUpdate(line.id, { unit: event.target.value })} /></td>
        <td className="px-3 py-3">
          <select
            className="input truncate transition-[width,box-shadow] focus:relative focus:z-30 focus:w-[260px] focus:bg-white focus:shadow-lg"
            title={selectedLocation ? translatedLocation(selectedLocation.code, t) : ''}
            value={line.location_id}
            onChange={(event) => onUpdate(line.id, { location_id: event.target.value })}
          >
            <option value="">{t('receipt.selectLocation')}</option>
            {allowedLocations.map((item) => <option key={item.id} value={item.id}>{translatedLocation(item.code, t)}</option>)}
          </select>
        </td>
        <td className="px-3 py-3 text-right">
          <button className="rounded-md px-2 py-1 text-lg leading-none text-red-500 hover:bg-red-50 disabled:text-slate-300" disabled={removeDisabled} onClick={() => onRemove(line.id)} type="button" title={t('receipt.removeLine')}>
            ×
          </button>
        </td>
      </tr>
      {hasErrors && (
        <tr className="border-b border-slate-100 bg-red-50/50">
          <td className="px-3 pb-3 text-xs text-red-700" colSpan={10}>
            {t('receipt.lineTitle', { count: index + 1 })}: {errors.join('; ')}
          </td>
        </tr>
      )}
      {hasNewReference && (
        <tr className="border-b border-slate-100 bg-slate-50/80">
          <td className="px-3 py-3" colSpan={10}>
            <NewReferenceDetails line={line} onUpdate={onUpdate} t={t} />
          </td>
        </tr>
      )}
    </>
  )
}

function MaterialPicker({ line, materials, onChangeMaterial, onUpdate, t }: {
  line: ReceiptLineForm
  materials: MaterialItem[]
  onChangeMaterial: (lineId: string, materialId: string) => void
  onUpdate: (lineId: string, patch: Partial<ReceiptLineForm>) => void
  t: ReturnType<typeof useI18n>['t']
}) {
  const value = line.material_mode === 'new' ? '__new__' : line.material_id
  const selectedMaterial = materials.find((item) => item.id === line.material_id)
  const materialTitle = selectedMaterial ? `${selectedMaterial.code} · ${selectedMaterial.name}` : line.material_name
  return (
    <div className="grid gap-2">
      <select
        className="input truncate transition-[width,box-shadow] focus:relative focus:z-30 focus:w-[420px] focus:bg-white focus:shadow-lg"
        title={materialTitle}
        value={value}
        onChange={(event) => {
          if (event.target.value === '__new__') {
            onUpdate(line.id, { material_mode: 'new', material_id: '' })
          } else {
            onUpdate(line.id, { material_mode: 'existing' })
            onChangeMaterial(line.id, event.target.value)
          }
        }}
      >
        <option value="">{t('receipt.selectMaterial')}</option>
        {materials.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
        <option value="__new__">{t('receipt.createNew')}</option>
      </select>
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
  const selectedReference = references.find((item) => item.id === value)
  const referenceTitle = selectedReference ? `${selectedReference.code} · ${selectedReference.name}` : newName
  return (
    <div className="min-w-0">
      {mode === 'existing' && (
        <select
          className="input truncate text-left transition-[width,box-shadow] focus:relative focus:z-30 focus:w-[420px] focus:bg-white focus:shadow-lg"
          title={referenceTitle}
          value={value}
          onChange={(event) => {
            if (event.target.value === '__new__') {
              onModeChange('new')
              return
            }
            if (event.target.value === '__none__') {
              onModeChange('none')
              return
            }
            onSelect(event.target.value)
          }}
        >
          <option value="">{emptyText}</option>
          {references.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
          <option value="__new__">{t('receipt.createNew')}</option>
          {modeOptions.includes('none') && <option value="__none__">{t('receipt.noSupplier')}</option>}
        </select>
      )}
      {mode === 'new' && (
        <div className="grid gap-2">
          <select className="input truncate" value="__new__" onChange={(event) => event.target.value === '' && onModeChange('existing')}>
            <option value="__new__">{t('receipt.createNew')}</option>
            <option value="">{emptyText}</option>
          </select>
        </div>
      )}
      {mode === 'none' && (
        <select className="input truncate" title={t('receipt.noSupplierSelected')} value="__none__" onChange={(event) => event.target.value === '' && onModeChange('existing')}>
          <option value="__none__">{t('receipt.noSupplier')}</option>
          <option value="">{emptyText}</option>
        </select>
      )}
    </div>
  )
}

function NewReferenceDetails({ line, onUpdate, t }: {
  line: ReceiptLineForm
  onUpdate: (lineId: string, patch: Partial<ReceiptLineForm>) => void
  t: ReturnType<typeof useI18n>['t']
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-3">
      {line.material_mode === 'new' && (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">{t('receipt.material')}</p>
          <div className="grid grid-cols-[120px_minmax(240px,1fr)] gap-2">
            <input className="input" placeholder={t('common.code')} title={line.material_code} value={line.material_code} onChange={(event) => onUpdate(line.id, { material_code: event.target.value })} />
            <input className="input" placeholder={t('common.name')} title={line.material_name} value={line.material_name} onChange={(event) => onUpdate(line.id, { material_name: event.target.value })} />
            <input className="input col-span-2" placeholder={t('common.type')} title={line.material_type} value={line.material_type} onChange={(event) => onUpdate(line.id, { material_type: event.target.value })} />
          </div>
        </div>
      )}
      {line.manufacturer_mode === 'new' && (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">{t('receipt.manufacturer')}</p>
          <div className="grid grid-cols-[120px_minmax(260px,1fr)] gap-2">
            <input className="input" placeholder={t('common.code')} title={line.manufacturer_code} value={line.manufacturer_code} onChange={(event) => onUpdate(line.id, { manufacturer_code: event.target.value })} />
            <input className="input" placeholder={t('common.name')} title={line.manufacturer_name} value={line.manufacturer_name} onChange={(event) => onUpdate(line.id, { manufacturer_name: event.target.value })} />
          </div>
        </div>
      )}
      {line.supplier_mode === 'new' && (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">{t('receipt.supplier')}</p>
          <div className="grid grid-cols-[120px_minmax(260px,1fr)] gap-2">
            <input className="input" placeholder={t('common.code')} title={line.supplier_code} value={line.supplier_code} onChange={(event) => onUpdate(line.id, { supplier_code: event.target.value })} />
            <input className="input" placeholder={t('common.name')} title={line.supplier_name} value={line.supplier_name} onChange={(event) => onUpdate(line.id, { supplier_name: event.target.value })} />
          </div>
        </div>
      )}
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

function SummaryInline({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500">{label}:</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  )
}
