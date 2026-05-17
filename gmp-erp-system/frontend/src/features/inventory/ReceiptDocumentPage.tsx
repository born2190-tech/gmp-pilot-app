import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, FileDown, Info, Paperclip, Plus, Search, ShieldAlert, X } from 'lucide-react'
import {
  createQcNotification,
  createReceipt,
  createReceiptDefect,
  downloadQcNotificationPdf,
  downloadReceiptDefectPdf,
  listLocations,
  listManufacturers,
  listMaterials,
  listReceiptDefects,
  listSuppliers,
  listWarehouses,
  postReceipt,
  setReceiptDefectStatus,
  uploadReceiptDefectPhoto,
} from '../../lib/api'
import { translatedLocation } from '../../lib/display'
import type { CurrentUser } from '../../types/auth'
import type {
  LocationItem,
  ManufacturerItem,
  MaterialItem,
  ReceiptCreate,
  ReceiptDefectItem,
  ReceiptDefectSeverity,
  SupplierItem,
  WarehouseItem,
} from '../../types/inventory'
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
  receiptId: string
  documentNo: string
  lotsCreated: number
  warehouseType: string
  notificationId?: string
  notificationNo?: string
}

type ReferenceDialogType = 'material' | 'manufacturer' | 'supplier'

interface CreateReferenceDialogState {
  lineId: string
  type: ReferenceDialogType
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
  const [expandedLineIds, setExpandedLineIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [postedSummary, setPostedSummary] = useState<PostedSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [createReferenceDialog, setCreateReferenceDialog] = useState<CreateReferenceDialogState | null>(null)
  const [referenceDraft, setReferenceDraft] = useState({ code: '', name: '', item_type: 'raw_material' })
  const [notificationDialogOpen, setNotificationDialogOpen] = useState(false)
  const [notificationDraftNo, setNotificationDraftNo] = useState('')

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
      setExpandedLineIds((currentExpanded) => {
        const nextExpanded = new Set(currentExpanded)
        nextExpanded.delete(lineId)
        return nextExpanded
      })
      return next
    })
  }

  function toggleLineExpanded(lineId: string) {
    setExpandedLineIds((current) => {
      const next = new Set(current)
      if (next.has(lineId)) {
        next.delete(lineId)
      } else {
        next.add(lineId)
      }
      return next
    })
  }

  function openCreateReferenceDialog(type: ReferenceDialogType, lineId: string) {
    setReferenceDraft({ code: '', name: '', item_type: 'raw_material' })
    setCreateReferenceDialog({ type, lineId })
  }

  function closeCreateReferenceDialog() {
    setCreateReferenceDialog(null)
  }

  function saveCreatedReference() {
    if (!createReferenceDialog || !referenceDraft.code.trim() || !referenceDraft.name.trim()) {
      return
    }
    const { lineId, type } = createReferenceDialog
    if (type === 'material') {
      updateLine(lineId, {
        material_mode: 'new',
        material_id: '',
        material_code: referenceDraft.code,
        material_name: referenceDraft.name,
        material_type: referenceDraft.item_type || 'raw_material',
      })
    }
    if (type === 'manufacturer') {
      updateLine(lineId, {
        manufacturer_mode: 'new',
        manufacturer_id: '',
        manufacturer_code: referenceDraft.code,
        manufacturer_name: referenceDraft.name,
      })
    }
    if (type === 'supplier') {
      updateLine(lineId, {
        supplier_mode: 'new',
        supplier_id: '',
        supplier_code: referenceDraft.code,
        supplier_name: referenceDraft.name,
      })
    }
    closeCreateReferenceDialog()
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
    setExpandedLineIds(new Set())
    setPostedSummary(null)
    setError(null)
  }

  async function submitNotificationNumber(notificationNo: string) {
    if (!postedSummary) return
    setError(null)
    setIsLoading(true)
    try {
      const notification = await createQcNotification(token, {
        receipt_id: postedSummary.receiptId,
        notification_no: notificationNo,
        reason: t('receipt.defaultReason'),
      })
      setPostedSummary({ ...postedSummary, notificationId: notification.id, notificationNo: notification.notification_no })
      setNotificationDialogOpen(false)
      setNotificationDraftNo('')
      // Open print dialog directly via hidden iframe so the operator can send
      // the form to the printer in one click — same flow as on the QC page.
      const blob = await downloadQcNotificationPdf(token, notification.id)
      const url = URL.createObjectURL(blob)
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.src = url
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus()
          iframe.contentWindow?.print()
        } catch {
          /* swallow */
        }
        window.setTimeout(() => {
          iframe.remove()
          URL.revokeObjectURL(url)
        }, 60_000)
      }
      document.body.appendChild(iframe)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('qcNotifications.createFailed'))
    } finally {
      setIsLoading(false)
    }
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
      setPostedSummary({
        receiptId: receipt.id,
        documentNo: posted.document_no,
        lotsCreated: posted.lots_created,
        warehouseType: selectedWarehouse?.warehouse_type ?? '',
      })
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
              {postedSummary.notificationNo ? (
                <p className="mt-1 text-sm">{t('qcNotifications.createSuccess', { no: postedSummary.notificationNo })}</p>
              ) : (
                postedSummary.warehouseType === 'SUBSTANCE_WAREHOUSE' && (
                  <p className="mt-1 text-sm">{t('receipt.qcNotificationManualHint')}</p>
                )
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {postedSummary.warehouseType === 'SUBSTANCE_WAREHOUSE' && !postedSummary.notificationId && (
                <Button
                  type="button"
                  onClick={() => {
                    setNotificationDraftNo('')
                    setNotificationDialogOpen(true)
                  }}
                  disabled={isLoading}
                >
                  {t('qcNotifications.create')}
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={resetDocument}>{t('receipt.newReceipt')}</Button>
            </div>
          </div>
        </Alert>
      )}

      {postedSummary && (
        <DefectsPanel
          token={token}
          user={user}
          receiptId={postedSummary.receiptId}
          documentNo={postedSummary.documentNo}
        />
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
                        isExpanded={expandedLineIds.has(line.id)}
                        isSelected={selectedLine?.id === line.id}
                        key={line.id}
                        line={line}
                        manufacturerName={displayReference(line.manufacturer_mode, line.manufacturer_id, line.manufacturer_name, manufacturers)}
                        materialName={displayMaterial(line, materials)}
                        locationName={displayLocation(line.location_id, allowedLocations, t)}
                        onRemove={removeLine}
                        onSelect={() => setSelectedLineId(line.id)}
                        onToggleExpand={() => toggleLineExpanded(line.id)}
                        removeDisabled={lines.length === 1}
                        supplierName={displaySupplier(line, suppliers, t)}
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
                    onCreateNew={openCreateReferenceDialog}
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
      <CreateReferenceDialog
        draft={referenceDraft}
        onChange={setReferenceDraft}
        onClose={closeCreateReferenceDialog}
        onSave={saveCreatedReference}
        open={Boolean(createReferenceDialog)}
        t={t}
        type={createReferenceDialog?.type ?? 'material'}
      />
      <NotificationNumberDialog
        open={notificationDialogOpen}
        value={notificationDraftNo}
        onChange={setNotificationDraftNo}
        onClose={() => setNotificationDialogOpen(false)}
        onSubmit={() => {
          const v = notificationDraftNo.trim()
          if (v) void submitNotificationNumber(v)
        }}
        loading={isLoading}
        t={t}
      />
    </section>
  )
}

function NotificationNumberDialog({
  open,
  value,
  onChange,
  onClose,
  onSubmit,
  loading,
  t,
}: {
  open: boolean
  value: string
  onChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
  loading: boolean
  t: ReturnType<typeof useI18n>['t']
}) {
  if (!open) return null
  const canSave = Boolean(value.trim()) && !loading
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-950">{t('qcNotifications.numberDialogTitle')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('qcNotifications.numberDialogHint')}</p>
        </div>
        <div className="px-6 py-5">
          <Field label={t('qcNotifications.notificationNo')}>
            <input
              autoFocus
              className="input bg-slate-50 font-mono"
              placeholder={t('qcNotifications.numberDialogPlaceholder')}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSave) {
                  event.preventDefault()
                  onSubmit()
                }
              }}
              maxLength={64}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={onSubmit}>
            {loading ? t('receipt.posting') : t('qcNotifications.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MaterialLineItem({
  errors,
  isExpanded,
  isSelected,
  line,
  locationName,
  manufacturerName,
  materialName,
  onRemove,
  onSelect,
  onToggleExpand,
  removeDisabled,
  supplierName,
  t,
}: {
  errors: string[]
  isExpanded: boolean
  isSelected: boolean
  line: ReceiptLineForm
  locationName: string
  manufacturerName: string
  materialName: string
  onRemove: (lineId: string) => void
  onSelect: () => void
  onToggleExpand: () => void
  removeDisabled: boolean
  supplierName: string
  t: ReturnType<typeof useI18n>['t']
}) {
  const hasErrors = errors.length > 0
  return (
    <>
      <tr className={`cursor-pointer border-b border-slate-100 transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`} onClick={onSelect}>
        <td className="px-3 py-2.5">
          <button
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={(event) => {
              event.stopPropagation()
              onToggleExpand()
            }}
            title={isExpanded ? t('common.collapse') : t('common.expand')}
            type="button"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex min-w-0 items-start gap-2">
            {hasErrors && (
              <span className="mt-0.5 flex-shrink-0" title={errors.join('; ')}>
                <AlertCircle className="h-4 w-4 text-red-500" />
              </span>
            )}
            <div className="min-w-0">
              <div className="max-w-[280px] truncate text-sm text-slate-900" title={materialName}>
                {materialName || <span className="italic text-slate-400">{t('receipt.materialRequired')}</span>}
              </div>
              {manufacturerName && (
                <div className="max-w-[280px] truncate text-xs text-slate-500" title={manufacturerName}>
                  {manufacturerName}
                </div>
              )}
              {hasErrors && (
                <div className="mt-1 max-w-[320px] truncate text-xs text-red-600" title={errors.join('; ')}>
                  {errors[0]}
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

      {isExpanded && (
        <tr className={`border-b border-slate-100 ${isSelected ? 'bg-blue-50' : 'bg-slate-50'}`}>
          <td className="px-3 py-3" colSpan={6}>
            {hasErrors && (
              <div className="mb-3 ml-8 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {errors.join('; ')}
              </div>
            )}
            <div className="grid gap-x-6 gap-y-2 pl-8 text-xs md:grid-cols-3">
              <ExpandedValue label={t('receipt.manufacturer')} value={manufacturerName} />
              <ExpandedValue label={t('receipt.supplier')} value={supplierName} />
              <ExpandedValue label={t('receipt.location')} value={locationName} />
              <ExpandedValue label={t('receipt.productionDate')} value={line.production_date} />
              <ExpandedValue label={t('receipt.supplierLot')} value={line.supplier_lot} mono />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ExpandedValue({ label, mono = false, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-slate-500">{label}: </span>
      <span className={`break-words font-medium text-slate-800 ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
    </div>
  )
}

function MaterialDetailPanel({
  allowedLocations,
  line,
  manufacturers,
  materials,
  onChangeMaterial,
  onCreateNew,
  onUpdate,
  suppliers,
  t,
}: {
  allowedLocations: LocationItem[]
  line: ReceiptLineForm
  manufacturers: ManufacturerItem[]
  materials: MaterialItem[]
  onChangeMaterial: (lineId: string, materialId: string) => void
  onCreateNew: (type: ReferenceDialogType, lineId: string) => void
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
          onCreateNew={() => onCreateNew('material', line.id)}
          onSelect={(value) => onChangeMaterial(line.id, value)}
          references={materials}
          referenceType="material"
          selectedValue={line.material_id}
          t={t}
          typeValue={line.material_type}
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
          onCreateNew={() => onCreateNew('manufacturer', line.id)}
          onSelect={(value) => onUpdate(line.id, { manufacturer_id: value })}
          referenceType="manufacturer"
          references={manufacturers}
          selectedValue={line.manufacturer_id}
          t={t}
        />

        <Separator />

        <DetailReference
          allowNone
          createLabel={t('receipt.createNew')}
          emptyText={t('receipt.selectSupplier')}
          label={t('receipt.supplier')}
          mode={line.supplier_mode}
          newCode={line.supplier_code}
          newName={line.supplier_name}
          onModeChange={(mode) => onUpdate(line.id, { supplier_mode: mode as 'existing' | 'new' | 'none', supplier_id: mode === 'existing' ? line.supplier_id : '' })}
          onCreateNew={() => onCreateNew('supplier', line.id)}
          onSelect={(value) => onUpdate(line.id, { supplier_id: value })}
          referenceType="supplier"
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
  onCreateNew,
  onModeChange,
  onSelect,
  referenceType,
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
  onCreateNew: () => void
  onModeChange: (mode: 'existing' | 'new' | 'none') => void
  onSelect: (value: string) => void
  referenceType: ReferenceDialogType
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
        <div className="flex items-center gap-2">
          {(mode === 'new' || mode === 'none') ? (
            <button className="inline-flex h-6 items-center rounded px-2 text-xs font-medium text-blue-700 hover:bg-blue-50" onClick={() => onModeChange('existing')} type="button">
              {t('receipt.chooseExisting')}
            </button>
          ) : (
            <button className="inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium text-blue-700 hover:bg-blue-50" onClick={onCreateNew} type="button">
              <Plus className="h-3 w-3" />
              {createLabel}
            </button>
          )}
          {allowNone && mode !== 'none' && (
            <button className="inline-flex h-6 items-center rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => onModeChange('none')} type="button">
              {t('receipt.noSupplier')}
            </button>
          )}
        </div>
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
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
          <p className="font-medium text-slate-900">{newCode} · {newName}</p>
          {referenceType === 'material' && <p className="mt-1 text-xs text-slate-500">{typeValue || 'raw_material'}</p>}
        </div>
      )}
      {mode === 'none' && <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">{t('receipt.noSupplierSelected')}</p>}
      {selectedText && <p className="mt-2 break-words text-xs text-slate-600">{selectedText}</p>}
      {mode === 'new' && newName && <p className="mt-2 break-words text-xs text-slate-600">{newName}</p>}
    </div>
  )
}

function CreateReferenceDialog({
  draft,
  onChange,
  onClose,
  onSave,
  open,
  t,
  type,
}: {
  draft: { code: string; name: string; item_type: string }
  onChange: (draft: { code: string; name: string; item_type: string }) => void
  onClose: () => void
  onSave: () => void
  open: boolean
  t: ReturnType<typeof useI18n>['t']
  type: ReferenceDialogType
}) {
  if (!open) return null
  const titles: Record<ReferenceDialogType, string> = {
    material: t('receipt.createMaterial'),
    manufacturer: t('receipt.createManufacturer'),
    supplier: t('receipt.createSupplier'),
  }
  const canSave = Boolean(draft.code.trim() && draft.name.trim())
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-950">{titles[type]}</h2>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('common.code')}>
              <input className="input bg-slate-50" placeholder={t('common.code')} value={draft.code} onChange={(event) => onChange({ ...draft, code: event.target.value })} />
            </Field>
            <Field label={t('common.name')}>
              <input className="input bg-slate-50" placeholder={t('common.name')} value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
            </Field>
          </div>
          {type === 'material' && (
            <Field label={t('common.type')}>
              <input className="input bg-slate-50" placeholder="raw_material" value={draft.item_type} onChange={(event) => onChange({ ...draft, item_type: event.target.value })} />
            </Field>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="button" disabled={!canSave} onClick={onSave}>{t('receipt.create')}</Button>
        </div>
      </div>
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

function displaySupplier(line: ReceiptLineForm, suppliers: SupplierItem[], t: ReturnType<typeof useI18n>['t']) {
  if (line.supplier_mode === 'none') {
    return t('receipt.noSupplier')
  }
  return displayReference(line.supplier_mode, line.supplier_id, line.supplier_name, suppliers)
}

function displayLocation(locationId: string, locations: LocationItem[], t: ReturnType<typeof useI18n>['t']) {
  const location = locations.find((item) => item.id === locationId)
  return location ? translatedLocation(location.code, t) : ''
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

// ─── Receipt defect acts (СОП-209 Ф-12) ────────────────────────────────────

const SEVERITY_COLOR: Record<ReceiptDefectSeverity, string> = {
  critical: 'border-rose-200 bg-rose-50 text-rose-800',
  significant: 'border-amber-200 bg-amber-50 text-amber-800',
  minor: 'border-slate-200 bg-slate-50 text-slate-700',
}

function DefectsPanel({
  token,
  user,
  receiptId,
  documentNo,
}: {
  token: string
  user: CurrentUser
  receiptId: string
  documentNo: string
}) {
  const { t } = useI18n()
  const [defects, setDefects] = useState<ReceiptDefectItem[]>([])
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const canResolve = user.permissions.includes('VIEW_QA') || user.permissions.includes('VIEW_QC')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await listReceiptDefects(token, receiptId)
      setDefects(response.defects)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receipt.defects.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [token, receiptId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const criticalOpen = defects.filter((d) => d.severity === 'critical' && d.status !== 'resolved' && d.status !== 'returned').length

  return (
    <section
      className={`rounded-md border-2 p-4 shadow-sm ${criticalOpen > 0 ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200 bg-white'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className={criticalOpen > 0 ? 'text-rose-600' : 'text-slate-500'} />
          <h2 className="text-base font-semibold text-slate-900">{t('receipt.defects.title')}</h2>
          {defects.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {defects.length}
            </span>
          )}
          {criticalOpen > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
              <AlertTriangle size={11} />
              {t('receipt.defects.criticalOpen', { n: String(criticalOpen) })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} className="mr-1" />
            {t('receipt.defects.create')}
          </Button>
          {defects.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {open ? t('common.collapse') : t('common.expand')}
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-[12px] text-slate-600">{t('receipt.defects.subtitle')}</p>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {open && defects.length > 0 && (
        <ul className="mt-3 space-y-2">
          {defects.map((defect) => (
            <DefectCard
              key={defect.id}
              defect={defect}
              token={token}
              canResolve={canResolve}
              onChanged={reload}
              t={t}
            />
          ))}
        </ul>
      )}

      {createOpen && (
        <CreateDefectDialog
          token={token}
          receiptId={receiptId}
          documentNo={documentNo}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            setOpen(true)
            void reload()
          }}
          t={t}
        />
      )}
    </section>
  )
}

function DefectCard({
  defect,
  token,
  canResolve,
  onChanged,
  t,
}: {
  defect: ReceiptDefectItem
  token: string
  canResolve: boolean
  onChanged: () => void
  t: ReturnType<typeof useI18n>['t']
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')

  async function setStatus(next: 'resolved' | 'returned' | 'escalated') {
    setError(null)
    setBusy(true)
    try {
      await setReceiptDefectStatus(token, defect.id, { status: next, comment: commentDraft.trim() || null })
      setCommentDraft('')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receipt.defects.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function viewPdf() {
    try {
      const blob = await downloadReceiptDefectPdf(token, defect.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receipt.defects.pdfFailed'))
    }
  }

  const statusLabel = t(`receipt.defects.status.${defect.status}` as never)

  return (
    <li className={`rounded-md border p-3 ${SEVERITY_COLOR[defect.severity]}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12.5px] font-semibold text-slate-900">{defect.act_no}</span>
            <span className="rounded-full border border-current/40 bg-white/70 px-2 py-0.5 text-[10px] font-medium uppercase">
              {t(`receipt.defects.severity.${defect.severity}` as never)}
            </span>
            <span className="text-[11px] text-slate-700">· {statusLabel}</span>
          </div>
          {defect.material_name && (
            <div className="mt-0.5 text-[12px] text-slate-700">
              {defect.material_name} <span className="font-mono text-[10.5px] text-slate-500">· {defect.material_code}</span>
            </div>
          )}
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-slate-800">{defect.description}</p>
          {defect.photos.length > 0 && (
            <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-600">
              <Paperclip size={12} />
              {t('receipt.defects.photosCount', { n: String(defect.photos.length) })}
            </div>
          )}
          <div className="mt-1.5 text-[11px] text-slate-500">
            {defect.recorded_by_name ?? '—'} · {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(defect.recorded_at))}
          </div>
          {defect.resolution_comment && (
            <div className="mt-2 rounded border border-white/60 bg-white/60 px-2 py-1 text-[11.5px] text-slate-700">
              <span className="font-medium">{t('receipt.defects.resolution')}: </span>
              {defect.resolution_comment}
              <div className="text-[10.5px] text-slate-500">
                {defect.resolved_by_name ?? '—'}
                {defect.resolved_at && ` · ${new Intl.DateTimeFormat('ru-RU').format(new Date(defect.resolved_at))}`}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => void viewPdf()}
            className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileDown size={11} />
            {t('receipt.defects.pdf')}
          </button>
        </div>
      </div>

      {canResolve && defect.status !== 'resolved' && defect.status !== 'returned' && (
        <div className="mt-2 border-t border-white/60 pt-2">
          <input
            type="text"
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            placeholder={t('receipt.defects.commentPlaceholder')}
            className="mb-2 h-8 w-full rounded border border-slate-300 bg-white px-2 text-[12px] outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
          />
          <div className="flex flex-wrap justify-end gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void setStatus('resolved')}
              className="inline-flex h-7 items-center gap-1 rounded bg-emerald-600 px-2 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {t('receipt.defects.resolve')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void setStatus('returned')}
              className="inline-flex h-7 items-center gap-1 rounded border border-amber-500 bg-white px-2 text-[11px] font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              {t('receipt.defects.return')}
            </button>
            {defect.status === 'pending' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void setStatus('escalated')}
                className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {t('receipt.defects.escalate')}
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-800">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </li>
  )
}

function CreateDefectDialog({
  token,
  receiptId,
  documentNo,
  onClose,
  onCreated,
  t,
}: {
  token: string
  receiptId: string
  documentNo: string
  onClose: () => void
  onCreated: () => void
  t: ReturnType<typeof useI18n>['t']
}) {
  const [severity, setSeverity] = useState<ReceiptDefectSeverity>('significant')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const photoRequired = severity !== 'minor'
  const canSubmit = description.trim().length > 0 && (!photoRequired || files.length > 0)

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const created = await createReceiptDefect(token, receiptId, {
        severity,
        description: description.trim(),
      })
      for (const file of files) {
        await uploadReceiptDefectPhoto(token, created.id, file)
      }
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receipt.defects.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              СОП-209 Ф-12
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {t('receipt.defects.modalTitle', { docNo: documentNo })}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {t('receipt.defects.severity.label')}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(['critical', 'significant', 'minor'] as ReceiptDefectSeverity[]).map((sev) => {
                const active = severity === sev
                const color =
                  sev === 'critical'
                    ? 'border-rose-500 bg-rose-50 text-rose-900'
                    : sev === 'significant'
                    ? 'border-amber-500 bg-amber-50 text-amber-900'
                    : 'border-slate-400 bg-slate-50 text-slate-800'
                return (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverity(sev)}
                    className={`rounded-md border-2 px-3 py-2 text-left text-xs font-medium transition ${
                      active ? color : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-[13px] font-semibold">{t(`receipt.defects.severity.${sev}` as never)}</div>
                    <div className="mt-0.5 text-[11px] font-normal opacity-80">
                      {t(`receipt.defects.severity.${sev}.desc` as never)}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {t('receipt.defects.description')}
            </label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder={t('receipt.defects.descriptionPlaceholder')}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {t('receipt.defects.photos')}
              {photoRequired && <span className="text-rose-500"> *</span>}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            {files.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">
                {t('receipt.defects.photosSelected', { n: String(files.length) })}
              </p>
            )}
            {photoRequired && files.length === 0 && (
              <p className="mt-1 text-[11px] text-rose-600">{t('receipt.defects.photoRequired')}</p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit || busy}>
            {busy ? t('receipt.defects.saving') : t('receipt.defects.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
