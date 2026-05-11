import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { createReceipt, listLocations, listManufacturers, listMaterials, listSuppliers, listWarehouses, postReceipt } from '../../lib/api'
import type { LocationItem, ManufacturerItem, MaterialItem, ReceiptCreate, SupplierItem, WarehouseItem } from '../../types/inventory'
import type { CurrentUser } from '../../types/auth'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n/I18nProvider'

interface ReceiptDocumentPageProps {
  token: string
  user: CurrentUser
  username: string
}

interface ReceiptForm {
  document_no: string
  supplier_id: string
  supplier_code: string
  supplier_name: string
  manufacturer_id: string
  manufacturer_code: string
  manufacturer_name: string
  warehouse_id: string
  received_date: string
  material_id: string
  material_code: string
  material_name: string
  material_type: string
  supplier_lot: string
  production_date: string
  expiry_date: string
  quantity: number
  unit: string
  location_id: string
  signature_password: string
  reason: string
}

export function ReceiptDocumentPage({ token, user, username }: ReceiptDocumentPageProps) {
  const { t } = useI18n()
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([])
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([])
  const [manufacturers, setManufacturers] = useState<ManufacturerItem[]>([])
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [supplierMode, setSupplierMode] = useState<'existing' | 'new' | 'none'>('existing')
  const [manufacturerMode, setManufacturerMode] = useState<'existing' | 'new'>('existing')
  const [materialMode, setMaterialMode] = useState<'existing' | 'new'>('existing')

  const form = useForm<ReceiptForm>({
    defaultValues: {
      document_no: `REC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-001`,
      received_date: new Date().toISOString().slice(0, 10),
      quantity: 0,
      unit: 'kg',
      material_type: 'raw_material',
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
  }, [token])

  const selectedWarehouseId = form.watch('warehouse_id')
  const watchedQuantity = form.watch('quantity')
  const watchedProductionDate = form.watch('production_date')
  const watchedExpiryDate = form.watch('expiry_date')
  const allowedLocations = useMemo(() => locations.filter((item) => item.warehouse_id === selectedWarehouseId), [locations, selectedWarehouseId])
  const masterDataReady = warehouses.length > 0 && locations.length > 0
  const hasQuantityWarning = Number(watchedQuantity) <= 0
  const hasExpiryWarning = Boolean(watchedProductionDate && watchedExpiryDate && watchedExpiryDate < watchedProductionDate)
  async function submit(values: ReceiptForm) {
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      const payload: ReceiptCreate = {
        document_no: values.document_no,
        supplier_id: supplierMode === 'existing' ? values.supplier_id : null,
        supplier: supplierMode === 'new' ? { code: values.supplier_code, name: values.supplier_name } : null,
        manufacturer_id: manufacturerMode === 'existing' ? values.manufacturer_id : null,
        manufacturer: manufacturerMode === 'new' ? { code: values.manufacturer_code, name: values.manufacturer_name } : null,
        warehouse_id: values.warehouse_id,
        received_date: values.received_date,
        lines: [
          {
            material_id: materialMode === 'existing' ? values.material_id : null,
            material: materialMode === 'new' ? { code: values.material_code, name: values.material_name, item_type: values.material_type, default_unit: values.unit } : null,
            supplier_lot: values.supplier_lot || null,
            production_date: values.production_date || null,
            production_year: values.production_date ? new Date(values.production_date).getFullYear() : null,
            expiry_date: values.expiry_date,
            quantity: Number(values.quantity),
            unit: values.unit,
            location_id: values.location_id,
          },
        ],
      }
      const receipt = await createReceipt(token, payload)
      const posted = await postReceipt(token, receipt.id, {
        username,
        password: values.signature_password,
        meaning: t('receipt.postMeaning'),
        reason: values.reason,
      })
      setSuccess(t('receipt.posted', { documentNo: posted.document_no, count: posted.lots_created }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receipt.postFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section>
      <div className="mb-4">
        <p className="text-xs uppercase text-slate-500">{t('receipt.document')}</p>
        <h1 className="text-2xl font-semibold text-slate-950">{t('receipt.title')}</h1>
      </div>

      {!masterDataReady && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('receipt.masterDataIncomplete')}
        </p>
      )}
      {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      <form className="max-w-5xl space-y-4" onSubmit={form.handleSubmit(submit)}>
        <SectionBlock title={t('receipt.sectionDocument')}>
          <div className="grid gap-4 md:grid-cols-2">
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
          </div>
        </SectionBlock>

        <SectionBlock tone="primary" title={t('receipt.sectionMaterial')}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_220px_180px_120px]">
            <Field label={t('receipt.material')}>
              <Segment value={materialMode} onChange={(value) => setMaterialMode(value as typeof materialMode)} options={[
                ['existing', t('receipt.existing')],
                ['new', t('receipt.new')],
              ]} />
              {materialMode === 'existing' && (
                <select {...form.register('material_id', { required: materialMode === 'existing' })} className="input mt-2">
                  <option value="">{t('receipt.selectMaterial')}</option>
                  {materials.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                </select>
              )}
              {materialMode === 'new' && (
                <div className="mt-2 grid gap-2 md:grid-cols-[140px_minmax(0,1fr)]">
                  <input {...form.register('material_code', { required: true })} className="input" placeholder={t('common.code')} />
                  <input {...form.register('material_name', { required: true })} className="input" placeholder={t('common.name')} />
                  <input {...form.register('material_type', { required: materialMode === 'new' })} className="input md:col-span-2" placeholder={t('common.type')} />
                </div>
              )}
            </Field>
            <Field label={t('receipt.supplierLot')}><input {...form.register('supplier_lot')} className="input" /></Field>
            <Field label={t('receipt.quantity')}><input step="0.001" type="number" {...form.register('quantity', { required: true, valueAsNumber: true })} className="input" /></Field>
            <Field label={t('common.unit')}><input {...form.register('unit', { required: true })} className="input" /></Field>
          </div>
          {hasQuantityWarning && <p className="alert-error mt-3">{t('receipt.quantityWarning')}</p>}
        </SectionBlock>

        <SectionBlock title={t('receipt.sectionDatesAndLocation')}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('receipt.productionDate')}><input type="date" {...form.register('production_date')} className="input" /></Field>
            <Field label={t('receipt.expiryDate')}><input type="date" {...form.register('expiry_date', { required: true })} className="input" /></Field>
            <Field label={t('receipt.location')}>
              <select {...form.register('location_id', { required: true })} className="input">
                <option value="">{t('receipt.selectLocation')}</option>
                {allowedLocations.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
              </select>
            </Field>
          </div>
          {hasExpiryWarning && <p className="alert-error mt-3">{t('receipt.expiryWarning')}</p>}
        </SectionBlock>

        <SectionBlock title={t('receipt.sectionOrigin')}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('receipt.manufacturer')}>
              <Segment value={manufacturerMode} onChange={(value) => setManufacturerMode(value as typeof manufacturerMode)} options={[
                ['existing', t('receipt.existing')],
                ['new', t('receipt.new')],
              ]} />
              {manufacturerMode === 'existing' && (
                <select {...form.register('manufacturer_id', { required: manufacturerMode === 'existing' })} className="input mt-2">
                  <option value="">{t('receipt.selectManufacturer')}</option>
                  {manufacturers.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                </select>
              )}
              {manufacturerMode === 'new' && <InlineReference codeName="manufacturer_code" form={form} nameName="manufacturer_name" />}
            </Field>
            <Field label={t('receipt.supplier')}>
              <Segment value={supplierMode} onChange={(value) => setSupplierMode(value as typeof supplierMode)} options={[
                ['existing', t('receipt.existing')],
                ['new', t('receipt.new')],
                ['none', t('receipt.noSupplier')],
              ]} />
              {supplierMode === 'existing' && (
                <select {...form.register('supplier_id', { required: supplierMode === 'existing' })} className="input mt-2">
                  <option value="">{t('receipt.selectSupplier')}</option>
                  {suppliers.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                </select>
              )}
              {supplierMode === 'new' && <InlineReference codeName="supplier_code" form={form} nameName="supplier_name" />}
            </Field>
          </div>
        </SectionBlock>

        <SectionBlock title={t('receipt.sectionReason')}>
          <Field label={t('common.reason')}><input {...form.register('reason', { required: true })} className="input" /></Field>
        </SectionBlock>

        <SectionBlock tone="signature" title={t('receipt.eSignature')}>
          <p className="mb-3 text-sm text-slate-600">{t('receipt.eSignatureHint')}</p>
          <Field label={t('receipt.eSignature')}><input type="password" {...form.register('signature_password', { required: true })} className="input" /></Field>
        </SectionBlock>

        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-medium">{t('receipt.afterPostTitle')}</p>
          <p className="mt-1">{t('receipt.afterPostBody')}</p>
        </div>

        <div className="flex justify-end">
          <Button disabled={isLoading || !masterDataReady || hasQuantityWarning || hasExpiryWarning} type="submit">{isLoading ? t('receipt.posting') : t('receipt.post')}</Button>
        </div>
      </form>
    </section>
  )
}

function SectionBlock({ children, title, tone = 'default' }: { children: ReactNode; title: string; tone?: 'default' | 'primary' | 'signature' }) {
  const toneClass =
    tone === 'primary'
      ? 'border-blue-200 bg-blue-50/50'
      : tone === 'signature'
        ? 'border-amber-200 bg-amber-50/70'
        : 'border-slate-200 bg-white'
  return (
    <section className={`rounded-md border p-4 shadow-sm ${toneClass}`}>
      <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>
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

function Segment({ onChange, options, value }: { onChange: (value: string) => void; options: Array<[string, string]>; value: string }) {
  return (
    <div className="grid grid-cols-3 rounded-md border border-slate-200 bg-slate-50 p-1 text-xs">
      {options.map(([optionValue, label]) => (
        <button
          className={`rounded px-2 py-1 font-medium ${value === optionValue ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}
          key={optionValue}
          onClick={() => onChange(optionValue)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function InlineReference({ codeName, form, nameName }: { codeName: keyof ReceiptForm; form: ReturnType<typeof useForm<ReceiptForm>>; nameName: keyof ReceiptForm }) {
  const { t } = useI18n()
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <input {...form.register(codeName, { required: true })} className="input" placeholder={t('common.code')} />
      <input {...form.register(nameName, { required: true })} className="input" placeholder={t('common.name')} />
    </div>
  )
}
