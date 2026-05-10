import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { createReceipt, listLocations, listManufacturers, listMaterials, listSuppliers, listWarehouses, postReceipt } from '../../lib/api'
import type { LocationItem, ManufacturerItem, MaterialItem, ReceiptCreate, SupplierItem, WarehouseItem } from '../../types/inventory'
import { Button } from '../../components/ui/button'
import { useI18n } from '../../i18n/I18nProvider'

interface ReceiptDocumentPageProps {
  token: string
  username: string
}

interface ReceiptForm {
  document_no: string
  supplier_id: string
  manufacturer_id: string
  warehouse_id: string
  received_date: string
  material_id: string
  supplier_lot: string
  production_date: string
  production_year: number
  expiry_date: string
  quantity: number
  unit: string
  location_id: string
  signature_password: string
  reason: string
}

export function ReceiptDocumentPage({ token, username }: ReceiptDocumentPageProps) {
  const { t } = useI18n()
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([])
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([])
  const [manufacturers, setManufacturers] = useState<ManufacturerItem[]>([])
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<ReceiptForm>({
    defaultValues: {
      document_no: `REC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-001`,
      received_date: new Date().toISOString().slice(0, 10),
      production_year: new Date().getFullYear(),
      quantity: 0,
      unit: 'kg',
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
        setWarehouses(warehouseResponse.warehouses)
        setLocations(locationResponse.locations)
        setSuppliers(supplierResponse.suppliers)
        setManufacturers(manufacturerResponse.manufacturers)
        setMaterials(materialResponse.materials)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('receipt.loadFailed'))
      } finally {
        setIsLoading(false)
      }
    }
    void loadMasterData()
  }, [token])

  const selectedWarehouseId = form.watch('warehouse_id')
  const allowedLocations = useMemo(() => locations.filter((item) => item.warehouse_id === selectedWarehouseId), [locations, selectedWarehouseId])
  const masterDataReady = warehouses.length > 0 && suppliers.length > 0 && manufacturers.length > 0 && materials.length > 0 && locations.length > 0

  async function submit(values: ReceiptForm) {
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      const payload: ReceiptCreate = {
        document_no: values.document_no,
        supplier_id: values.supplier_id,
        manufacturer_id: values.manufacturer_id,
        warehouse_id: values.warehouse_id,
        received_date: values.received_date,
        lines: [
          {
            material_id: values.material_id,
            supplier_lot: values.supplier_lot,
            production_date: values.production_date || null,
            production_year: Number(values.production_year),
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

      <form className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 xl:grid-cols-3" onSubmit={form.handleSubmit(submit)}>
        <Field label={t('receipt.documentNo')}><input {...form.register('document_no', { required: true })} className="input" /></Field>
        <Field label={t('receipt.receivedDate')}><input type="date" {...form.register('received_date', { required: true })} className="input" /></Field>
        <Field label={t('receipt.warehouse')}>
          <select {...form.register('warehouse_id', { required: true })} className="input">
            <option value="">{t('receipt.selectWarehouse')}</option>
            {warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label={t('receipt.supplier')}>
          <select {...form.register('supplier_id', { required: true })} className="input">
            <option value="">{t('receipt.selectSupplier')}</option>
            {suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label={t('receipt.manufacturer')}>
          <select {...form.register('manufacturer_id', { required: true })} className="input">
            <option value="">{t('receipt.selectManufacturer')}</option>
            {manufacturers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label={t('receipt.material')}>
          <select {...form.register('material_id', { required: true })} className="input">
            <option value="">{t('receipt.selectMaterial')}</option>
            {materials.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
          </select>
        </Field>
        <Field label={t('receipt.supplierLot')}><input {...form.register('supplier_lot', { required: true })} className="input" /></Field>
        <Field label={t('receipt.productionDate')}><input type="date" {...form.register('production_date')} className="input" /></Field>
        <Field label={t('receipt.productionYear')}><input type="number" {...form.register('production_year', { required: true, valueAsNumber: true })} className="input" /></Field>
        <Field label={t('receipt.expiryDate')}><input type="date" {...form.register('expiry_date', { required: true })} className="input" /></Field>
        <Field label={t('receipt.quantity')}><input step="0.001" type="number" {...form.register('quantity', { required: true, valueAsNumber: true })} className="input" /></Field>
        <Field label={t('common.unit')}><input {...form.register('unit', { required: true })} className="input" /></Field>
        <Field label={t('receipt.location')}>
          <select {...form.register('location_id', { required: true })} className="input">
            <option value="">{t('receipt.selectLocation')}</option>
            {allowedLocations.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
          </select>
        </Field>
        <Field label={t('receipt.signaturePassword')}><input type="password" {...form.register('signature_password', { required: true })} className="input" /></Field>
        <Field label={t('common.reason')}><input {...form.register('reason', { required: true })} className="input" /></Field>
        <div className="flex items-end">
          <Button disabled={isLoading || !masterDataReady} type="submit">{t('receipt.post')}</Button>
        </div>
      </form>
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
