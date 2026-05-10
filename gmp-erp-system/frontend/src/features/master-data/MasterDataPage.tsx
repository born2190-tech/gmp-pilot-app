import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import type { UseFormRegisterReturn } from 'react-hook-form'
import type { ColumnDef } from '@tanstack/react-table'
import { createManufacturer, createMaterial, createSupplier, listManufacturers, listMaterials, listSuppliers } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { DataTable } from '../../components/table/DataTable'
import type { CurrentUser } from '../../types/auth'
import type { ManufacturerCreate, ManufacturerItem, MaterialCreate, MaterialItem, SupplierCreate, SupplierItem } from '../../types/inventory'
import { useI18n } from '../../i18n/I18nProvider'

interface MasterDataPageProps {
  token: string
  user: CurrentUser
}

export function MasterDataPage({ token, user }: MasterDataPageProps) {
  const { t } = useI18n()
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([])
  const [manufacturers, setManufacturers] = useState<ManufacturerItem[]>([])
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const canManage = user.permissions.includes('MANAGE_MASTER_DATA')

  const supplierForm = useForm<SupplierCreate>({ defaultValues: { code: '', name: '' } })
  const manufacturerForm = useForm<ManufacturerCreate>({ defaultValues: { code: '', name: '' } })
  const materialForm = useForm<MaterialCreate>({ defaultValues: { code: '', name: '', item_type: 'SUBSTANCE', default_unit: 'kg' } })

  async function loadMasterData() {
    setIsLoading(true)
    try {
      const [supplierResponse, manufacturerResponse, materialResponse] = await Promise.all([
        listSuppliers(token),
        listManufacturers(token),
        listMaterials(token),
      ])
      setSuppliers(supplierResponse.suppliers)
      setManufacturers(manufacturerResponse.manufacturers)
      setMaterials(materialResponse.materials)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('master.loadFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadMasterData()
  }, [token])

  async function submitSupplier(values: SupplierCreate) {
    await submitCreate(() => createSupplier(token, values), t('master.supplierCreated'))
    supplierForm.reset()
  }

  async function submitManufacturer(values: ManufacturerCreate) {
    await submitCreate(() => createManufacturer(token, values), t('master.manufacturerCreated'))
    manufacturerForm.reset()
  }

  async function submitMaterial(values: MaterialCreate) {
    await submitCreate(() => createMaterial(token, values), t('master.materialCreated'))
    materialForm.reset({ code: '', name: '', item_type: 'SUBSTANCE', default_unit: 'kg' })
  }

  async function submitCreate(createFn: () => Promise<unknown>, message: string) {
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      await createFn()
      setSuccess(message)
      await loadMasterData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('master.createFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const supplierColumns = useMemo<ColumnDef<SupplierItem>[]>(
    () => [
      { accessorKey: 'code', header: t('common.code') },
      { accessorKey: 'name', header: t('common.name') },
    ],
    [t],
  )

  const manufacturerColumns = useMemo<ColumnDef<ManufacturerItem>[]>(
    () => [
      { accessorKey: 'code', header: t('common.code') },
      { accessorKey: 'name', header: t('common.name') },
    ],
    [t],
  )

  const materialColumns = useMemo<ColumnDef<MaterialItem>[]>(
    () => [
      { accessorKey: 'code', header: t('common.code') },
      { accessorKey: 'name', header: t('common.name') },
      { accessorKey: 'item_type', header: t('common.type') },
      { accessorKey: 'default_unit', header: t('common.unit') },
    ],
    [t],
  )

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs uppercase text-slate-500">{t('master.referenceData')}</p>
        <h1 className="text-2xl font-semibold text-slate-950">{t('master.title')}</h1>
      </div>

      {!canManage && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {t('master.readOnly')}
        </p>
      )}
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</p>}

      <div className="max-w-md">
        <input
          className="input"
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('master.filter')}
          value={filter}
        />
      </div>

      {canManage && (
        <div className="grid gap-4 xl:grid-cols-3">
          <form className="rounded-lg border border-slate-200 bg-white p-4" onSubmit={supplierForm.handleSubmit(submitSupplier)}>
            <h2 className="mb-3 text-base font-semibold text-slate-900">{t('master.newSupplier')}</h2>
            <FormInput label={t('common.code')} register={supplierForm.register('code', { required: true })} />
            <FormInput label={t('common.name')} register={supplierForm.register('name', { required: true })} />
            <Button disabled={isLoading} type="submit">{t('master.createSupplier')}</Button>
          </form>

          <form className="rounded-lg border border-slate-200 bg-white p-4" onSubmit={manufacturerForm.handleSubmit(submitManufacturer)}>
            <h2 className="mb-3 text-base font-semibold text-slate-900">{t('master.newManufacturer')}</h2>
            <FormInput label={t('common.code')} register={manufacturerForm.register('code', { required: true })} />
            <FormInput label={t('common.name')} register={manufacturerForm.register('name', { required: true })} />
            <Button disabled={isLoading} type="submit">{t('master.createManufacturer')}</Button>
          </form>

          <form className="rounded-lg border border-slate-200 bg-white p-4" onSubmit={materialForm.handleSubmit(submitMaterial)}>
            <h2 className="mb-3 text-base font-semibold text-slate-900">{t('master.newMaterial')}</h2>
            <FormInput label={t('common.code')} register={materialForm.register('code', { required: true })} />
            <FormInput label={t('common.name')} register={materialForm.register('name', { required: true })} />
            <label className="mb-3 block text-sm font-medium text-slate-700">
              {t('common.type')}
              <select className="input mt-1" {...materialForm.register('item_type', { required: true })}>
                <option value="SUBSTANCE">SUBSTANCE</option>
                <option value="EXCIPIENT">EXCIPIENT</option>
                <option value="PACKAGING">PACKAGING</option>
                <option value="FINISHED_GOOD">FINISHED_GOOD</option>
              </select>
            </label>
            <FormInput label={t('master.defaultUnit')} register={materialForm.register('default_unit', { required: true })} />
            <Button disabled={isLoading} type="submit">{t('master.createMaterial')}</Button>
          </form>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t('master.suppliers')}>
          <DataTable columns={supplierColumns} data={suppliers} emptyLabel={t('master.noSuppliers')} globalFilter={filter} isLoading={isLoading} />
        </Panel>
        <Panel title={t('master.manufacturers')}>
          <DataTable columns={manufacturerColumns} data={manufacturers} emptyLabel={t('master.noManufacturers')} globalFilter={filter} isLoading={isLoading} />
        </Panel>
      </div>
      <Panel title={t('master.materials')}>
        <DataTable columns={materialColumns} data={materials} emptyLabel={t('master.noMaterials')} globalFilter={filter} isLoading={isLoading} />
      </Panel>
    </section>
  )
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </div>
  )
}

function FormInput({ label, register }: { label: string; register: UseFormRegisterReturn }) {
  return (
    <label className="mb-3 block text-sm font-medium text-slate-700">
      {label}
      <input className="input mt-1" {...register} />
    </label>
  )
}
