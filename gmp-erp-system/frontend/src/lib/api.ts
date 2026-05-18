import type { CurrentUser, LoginRequest, LoginResponse } from '../types/auth'
import type {
  LocationsResponse,
  LotsResponse,
  AdjustLotRequest,
  FGShipmentCreate,
  FGShipmentItem,
  FGShipmentsResponse,
  InventoryCountCreate,
  InventoryCountItem,
  InventoryCountsResponse,
  IssueProductionRequest,
  ManufacturerCreate,
  ManufacturerItem,
  ManufacturersResponse,
  MaterialCreate,
  MaterialItem,
  MaterialsResponse,
  MovementsResponse,
  PostReceiptResponse,
  QCNotificationCreate,
  QCNotificationItem,
  QCNotificationsResponse,
  QCNotificationScanItem,
  QCNotificationScansResponse,
  QCPendingScansResponse,
  QCScanRejectRequest,
  QCScanVerifyRequest,
  InventoryWaveCancelRequest,
  InventoryWaveItem,
  InventoryWaveLineUpdate,
  InventoryWavePostRequest,
  InventoryWaveStartRequest,
  InventoryWaveSubmitRequest,
  InventoryWaveVerifyRequest,
  InventoryWavesResponse,
  ReceiptDefectCreate,
  ReceiptDefectItem,
  ReceiptDefectPhotoItem,
  ReceiptDefectStatusUpdate,
  ReceiptDefectsResponse,
  QADecisionRequest,
  QCResultRequest,
  QCReportCreate,
  QCReportItem,
  QualityLotsResponse,
  ReceiptCreate,
  ReceiptResponse,
  SampleLotRequest,
  SignatureRequest,
  SupplierCreate,
  SupplierItem,
  SuppliersResponse,
  TransferLotRequest,
  WarehousesResponse,
  RequisitionCreate,
  RequisitionItem,
  RequisitionsResponse,
  AllocationUpdateRequest,
  IssueRequisitionRequest,
} from '../types/inventory'

type Method = 'GET' | 'POST' | 'PATCH'

export type LotsQuery = Record<string, string | number | undefined> & {
  date_type?: 'arrival' | 'expiry'
  date_from?: string
  date_to?: string
  material?: string
  quality_status?: string
  location?: string
  manufacturer?: string
  internal_lot?: string
  supplier_lot?: string
  search?: string
}

export type MovementsQuery = Record<string, string | number | undefined> & {
  date_from?: string
  date_to?: string
  material?: string
  internal_lot?: string
  supplier_lot?: string
  document?: string
  movement_type?: string
  search?: string
}

async function request<T>(path: string, method: Method, options?: { token?: string; body?: unknown; query?: Record<string, string | number | undefined> }): Promise<T> {
  const url = new URL(path, window.location.origin)
  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(`${url.pathname}${url.search}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const payload = await response.json()
      if (typeof payload.detail === 'string') {
        detail = payload.detail
      } else if (Array.isArray(payload.detail)) {
        detail = payload.detail.map((item: { msg?: string; type?: string }) => item.msg || item.type).filter(Boolean).join('; ') || detail
      }
    } catch {
      detail = response.statusText || detail
    }
    throw new Error(detail)
  }

  return (await response.json()) as T
}

export function login(payload: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>('/api/auth/login', 'POST', { body: payload })
}

export function me(token: string): Promise<CurrentUser> {
  return request<CurrentUser>('/api/auth/me', 'GET', { token })
}

export function logout(token: string): Promise<{ message: string }> {
  return request<{ message: string }>('/api/auth/logout', 'POST', { token })
}

export function listWarehouses(token: string): Promise<WarehousesResponse> {
  return request<WarehousesResponse>('/api/master-data/warehouses', 'GET', { token })
}

export function listLocations(token: string): Promise<LocationsResponse> {
  return request<LocationsResponse>('/api/master-data/locations', 'GET', { token })
}

export function listSuppliers(token: string): Promise<SuppliersResponse> {
  return request<SuppliersResponse>('/api/master-data/suppliers', 'GET', { token })
}

export function createSupplier(token: string, payload: SupplierCreate): Promise<SupplierItem> {
  return request<SupplierItem>('/api/master-data/suppliers', 'POST', { token, body: payload })
}

export function listManufacturers(token: string): Promise<ManufacturersResponse> {
  return request<ManufacturersResponse>('/api/master-data/manufacturers', 'GET', { token })
}

export function createManufacturer(token: string, payload: ManufacturerCreate): Promise<ManufacturerItem> {
  return request<ManufacturerItem>('/api/master-data/manufacturers', 'POST', { token, body: payload })
}

export function listMaterials(token: string): Promise<MaterialsResponse> {
  return request<MaterialsResponse>('/api/master-data/materials', 'GET', { token })
}

export function createMaterial(token: string, payload: MaterialCreate): Promise<MaterialItem> {
  return request<MaterialItem>('/api/master-data/materials', 'POST', { token, body: payload })
}

export function listLots(token: string, query?: LotsQuery): Promise<LotsResponse> {
  return request<LotsResponse>('/api/inventory/lots', 'GET', { token, query })
}

export function listMovements(token: string, query?: MovementsQuery): Promise<MovementsResponse> {
  return request<MovementsResponse>('/api/inventory/movements', 'GET', { token, query })
}

export function transferLot(token: string, lotId: string, payload: TransferLotRequest): Promise<QualityLotsResponse['lots'][number]> {
  return request<QualityLotsResponse['lots'][number]>(`/api/inventory/lots/${lotId}/transfer`, 'POST', { token, body: payload })
}

export function adjustLot(token: string, lotId: string, payload: AdjustLotRequest): Promise<QualityLotsResponse['lots'][number]> {
  return request<QualityLotsResponse['lots'][number]>(`/api/inventory/lots/${lotId}/adjust`, 'POST', { token, body: payload })
}

export function issueProduction(token: string, lotId: string, payload: IssueProductionRequest): Promise<QualityLotsResponse['lots'][number]> {
  return request<QualityLotsResponse['lots'][number]>(`/api/inventory/lots/${lotId}/issue-production`, 'POST', { token, body: payload })
}

export function createFgShipment(token: string, payload: FGShipmentCreate): Promise<FGShipmentItem> {
  return request<FGShipmentItem>('/api/inventory/fg-shipments', 'POST', { token, body: payload })
}

export function listFgShipments(token: string): Promise<FGShipmentsResponse> {
  return request<FGShipmentsResponse>('/api/inventory/fg-shipments', 'GET', { token })
}

export function createInventoryCount(token: string, payload: InventoryCountCreate): Promise<InventoryCountItem> {
  return request<InventoryCountItem>('/api/inventory/counts', 'POST', { token, body: payload })
}

export function listInventoryCounts(token: string): Promise<InventoryCountsResponse> {
  return request<InventoryCountsResponse>('/api/inventory/counts', 'GET', { token })
}

// ─── Inventory count workflow ──────────────────────────────────────────────

export function listInventoryWaves(token: string, status?: string): Promise<InventoryWavesResponse> {
  return request<InventoryWavesResponse>('/api/inventory/inventory-waves', 'GET', {
    token,
    query: status ? { status } : undefined,
  })
}

export function getInventoryWave(token: string, waveId: string): Promise<InventoryWaveItem> {
  return request<InventoryWaveItem>(`/api/inventory/inventory-waves/${waveId}`, 'GET', { token })
}

export function startInventoryWave(token: string, payload: InventoryWaveStartRequest): Promise<InventoryWaveItem> {
  return request<InventoryWaveItem>('/api/inventory/inventory-waves', 'POST', { token, body: payload })
}

export function saveInventoryWaveLine(
  token: string,
  waveId: string,
  lineId: string,
  payload: InventoryWaveLineUpdate,
): Promise<InventoryWaveItem> {
  return request<InventoryWaveItem>(`/api/inventory/inventory-waves/${waveId}/lines/${lineId}`, 'POST', {
    token,
    body: payload,
  })
}

export function submitInventoryWave(token: string, waveId: string, payload: InventoryWaveSubmitRequest): Promise<InventoryWaveItem> {
  return request<InventoryWaveItem>(`/api/inventory/inventory-waves/${waveId}/submit`, 'POST', { token, body: payload })
}

export function verifyInventoryWaveLine(
  token: string,
  waveId: string,
  lineId: string,
  payload: InventoryWaveVerifyRequest,
): Promise<InventoryWaveItem> {
  return request<InventoryWaveItem>(`/api/inventory/inventory-waves/${waveId}/lines/${lineId}/verify`, 'POST', {
    token,
    body: payload,
  })
}

export function postInventoryWave(token: string, waveId: string, payload: InventoryWavePostRequest): Promise<InventoryWaveItem> {
  return request<InventoryWaveItem>(`/api/inventory/inventory-waves/${waveId}/post`, 'POST', { token, body: payload })
}

export function cancelInventoryWave(token: string, waveId: string, payload: InventoryWaveCancelRequest): Promise<InventoryWaveItem> {
  return request<InventoryWaveItem>(`/api/inventory/inventory-waves/${waveId}/cancel`, 'POST', { token, body: payload })
}

export async function downloadInventoryWavePdf(token: string, waveId: string): Promise<Blob> {
  const response = await fetch(`/api/inventory/inventory-waves/${waveId}/pdf`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export async function downloadLotLedgerCardPdf(token: string, lotId: string): Promise<Blob> {
  const response = await fetch(`/api/inventory/lots/${lotId}/ledger-card/pdf`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

// ─── Receipt defect acts (СОП-209 Ф-12) ────────────────────────────────────

export function listReceiptDefects(token: string, receiptId: string): Promise<ReceiptDefectsResponse> {
  return request<ReceiptDefectsResponse>(`/api/inventory/receipts/${receiptId}/defects`, 'GET', { token })
}

export function createReceiptDefect(token: string, receiptId: string, payload: ReceiptDefectCreate): Promise<ReceiptDefectItem> {
  return request<ReceiptDefectItem>(`/api/inventory/receipts/${receiptId}/defects`, 'POST', { token, body: payload })
}

export function setReceiptDefectStatus(token: string, defectId: string, payload: ReceiptDefectStatusUpdate): Promise<ReceiptDefectItem> {
  return request<ReceiptDefectItem>(`/api/inventory/receipt-defects/${defectId}/status`, 'POST', { token, body: payload })
}

export async function uploadReceiptDefectPhoto(token: string, defectId: string, file: File): Promise<ReceiptDefectPhotoItem> {
  const form = new FormData()
  form.append('file', file, file.name)
  const response = await fetch(`/api/inventory/receipt-defects/${defectId}/photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const payload = await response.json()
      if (typeof payload.detail === 'string') detail = payload.detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return (await response.json()) as ReceiptDefectPhotoItem
}

export async function downloadReceiptDefectPhoto(token: string, photoId: string): Promise<Blob> {
  const response = await fetch(`/api/inventory/receipt-defect-photos/${photoId}/file`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export async function downloadReceiptDefectPdf(token: string, defectId: string): Promise<Blob> {
  const response = await fetch(`/api/inventory/receipt-defects/${defectId}/pdf`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export interface RegistryKpis {
  active: number
  quarantine: number
  rejected: number
  low_stock: number
  total: number
  low_stock_threshold_pct: number
}

export function listRegistryKpis(token: string): Promise<RegistryKpis> {
  return request<RegistryKpis>('/api/inventory/lots/kpis', 'GET', { token })
}

export interface LotsExportParams {
  columns: string[]
  material?: string
  quality_status?: string
  location?: string
  manufacturer?: string
  internal_lot?: string
  supplier_lot?: string
  date_from?: string
  date_to?: string
  date_type?: 'arrival' | 'expiry'
}

export interface MovementsExportParams {
  columns: string[]
  material?: string
  internal_lot?: string
  supplier_lot?: string
  document?: string
  movement_type?: string
  date_from?: string
  date_to?: string
}

function buildQueryString(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== null) {
      usp.append(key, String(value))
    }
  }
  const qs = usp.toString()
  return qs ? `?${qs}` : ''
}

export async function exportLotsXlsx(token: string, params: LotsExportParams): Promise<Blob> {
  const qs = buildQueryString({
    columns: params.columns.join(','),
    material: params.material,
    quality_status: params.quality_status,
    location: params.location,
    manufacturer: params.manufacturer,
    internal_lot: params.internal_lot,
    supplier_lot: params.supplier_lot,
    date_from: params.date_from,
    date_to: params.date_to,
    date_type: params.date_type,
  })
  const response = await fetch(`/api/inventory/lots/export.xlsx${qs}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export async function exportMovementsXlsx(token: string, params: MovementsExportParams): Promise<Blob> {
  const qs = buildQueryString({
    columns: params.columns.join(','),
    material: params.material,
    internal_lot: params.internal_lot,
    supplier_lot: params.supplier_lot,
    document: params.document,
    movement_type: params.movement_type,
    date_from: params.date_from,
    date_to: params.date_to,
  })
  const response = await fetch(`/api/inventory/movements/export.xlsx${qs}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export function requisitionPdfUrl(requisitionId: string, inline = false): string {
  return `/api/requisitions/${requisitionId}/pdf${inline ? '?inline=true' : ''}`
}

export async function downloadRequisitionPdf(token: string, requisitionId: string): Promise<Blob> {
  const response = await fetch(requisitionPdfUrl(requisitionId), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export function createReceipt(token: string, payload: ReceiptCreate): Promise<ReceiptResponse> {
  return request<ReceiptResponse>('/api/inventory/receipts', 'POST', { token, body: payload })
}

export function postReceipt(token: string, receiptId: string, payload: SignatureRequest): Promise<PostReceiptResponse> {
  return request<PostReceiptResponse>(`/api/inventory/receipts/${receiptId}/post`, 'POST', { token, body: payload })
}

export function listQcLots(token: string): Promise<QualityLotsResponse> {
  return request<QualityLotsResponse>('/api/quality/qc/lots', 'GET', { token })
}

export function listQcNotifications(token: string): Promise<QCNotificationsResponse> {
  return request<QCNotificationsResponse>('/api/quality/qc-notifications', 'GET', { token })
}

export function createQcNotification(token: string, payload: QCNotificationCreate): Promise<QCNotificationItem> {
  return request<QCNotificationItem>('/api/inventory/qc-notifications', 'POST', { token, body: payload })
}

export function qcNotificationPdfUrl(notificationId: string): string {
  return `/api/inventory/qc-notifications/${notificationId}/pdf`
}

export async function downloadQcNotificationPdf(token: string, notificationId: string): Promise<Blob> {
  const response = await fetch(qcNotificationPdfUrl(notificationId), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.blob()
}

export function listQcNotificationScans(token: string, notificationId: string): Promise<QCNotificationScansResponse> {
  return request<QCNotificationScansResponse>(`/api/inventory/qc-notifications/${notificationId}/scans`, 'GET', { token })
}

export async function uploadQcNotificationScan(token: string, notificationId: string, file: File): Promise<QCNotificationScanItem> {
  const form = new FormData()
  form.append('file', file, file.name)
  const response = await fetch(`/api/inventory/qc-notifications/${notificationId}/scans`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const payload = await response.json()
      if (typeof payload.detail === 'string') detail = payload.detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return (await response.json()) as QCNotificationScanItem
}

export async function downloadQcNotificationScan(token: string, scanId: string): Promise<Blob> {
  const response = await fetch(`/api/inventory/qc-notifications/scans/${scanId}/file`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.blob()
}

export function listPendingQcScans(token: string): Promise<QCPendingScansResponse> {
  return request<QCPendingScansResponse>('/api/inventory/qc-notifications/scans/pending', 'GET', { token })
}

export function verifyQcScan(token: string, scanId: string, payload: QCScanVerifyRequest): Promise<QCNotificationScanItem> {
  return request<QCNotificationScanItem>(`/api/inventory/qc-notifications/scans/${scanId}/verify`, 'POST', { token, body: payload })
}

export function rejectQcScan(token: string, scanId: string, payload: QCScanRejectRequest): Promise<QCNotificationScanItem> {
  return request<QCNotificationScanItem>(`/api/inventory/qc-notifications/scans/${scanId}/reject`, 'POST', { token, body: payload })
}

export function listQaLots(token: string): Promise<QualityLotsResponse> {
  return request<QualityLotsResponse>('/api/quality/qa/lots', 'GET', { token })
}

export function sampleLot(token: string, lotId: string, payload: SampleLotRequest): Promise<QualityLotsResponse['lots'][number]> {
  return request<QualityLotsResponse['lots'][number]>(`/api/quality/lots/${lotId}/sample`, 'POST', { token, body: payload })
}

export function submitQcResult(token: string, lotId: string, payload: QCResultRequest): Promise<QualityLotsResponse['lots'][number]> {
  return request<QualityLotsResponse['lots'][number]>(`/api/quality/lots/${lotId}/qc-result`, 'POST', { token, body: payload })
}

export function createQcReport(token: string, payload: QCReportCreate): Promise<QCReportItem> {
  return request<QCReportItem>('/api/quality/qc-reports', 'POST', { token, body: payload })
}

export function submitQcReport(token: string, reportId: string, payload: SignatureRequest): Promise<QCReportItem> {
  return request<QCReportItem>(`/api/quality/qc-reports/${reportId}/submit`, 'POST', { token, body: payload })
}

export function submitQaDecision(token: string, lotId: string, payload: QADecisionRequest): Promise<QualityLotsResponse['lots'][number]> {
  return request<QualityLotsResponse['lots'][number]>(`/api/quality/lots/${lotId}/qa-decision`, 'POST', { token, body: payload })
}

// ─── Production Requisitions ─────────────────────────────────────────────────

export function createRequisition(token: string, payload: RequisitionCreate): Promise<RequisitionItem> {
  return request<RequisitionItem>('/api/requisitions', 'POST', { token, body: payload })
}

export function listRequisitions(token: string, status?: string): Promise<RequisitionsResponse> {
  return request<RequisitionsResponse>('/api/requisitions', 'GET', { token, query: status ? { status } : undefined })
}

export function getRequisition(token: string, id: string): Promise<RequisitionItem> {
  return request<RequisitionItem>(`/api/requisitions/${id}`, 'GET', { token })
}

export function allocateRequisition(token: string, id: string): Promise<RequisitionItem> {
  return request<RequisitionItem>(`/api/requisitions/${id}/allocate`, 'POST', { token })
}

export function updateRequisitionAllocation(token: string, id: string, payload: AllocationUpdateRequest): Promise<RequisitionItem> {
  return request<RequisitionItem>(`/api/requisitions/${id}/allocation`, 'PATCH', { token, body: payload })
}

export function issueRequisition(token: string, id: string, payload: IssueRequisitionRequest): Promise<RequisitionItem> {
  return request<RequisitionItem>(`/api/requisitions/${id}/issue`, 'POST', { token, body: payload })
}
