import type { CurrentUser, LoginRequest, LoginResponse } from '../types/auth'
import type {
  LocationsResponse,
  LotsResponse,
  AccountLedgerResponse,
  InventoryAccountInput,
  InventoryAccountItem,
  InventoryAccountsResponse,
  OOSItem,
  OOSListResponse,
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
  VerificationQueueResponse,
  ScanVerifyRequest,
  ScanRejectRequest,
  QcReportListItem,
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
  ReceiptCertificateItem,
  ReceiptCertificatesResponse,
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
  ProductionBatchBmrIssueRequest,
  ProductionBatchCancelRequest,
  ProductionBatchChecklistUpdate,
  ProductionBatchCompleteRequest,
  ProductionBatchCreate,
  ProductionBatchItem,
  ProductionBatchNumberCheckRequest,
  ProductionBatchPreview,
  ProductionBatchPreviewRequest,
  ProductionBatchAuditResponse,
  ProductionBatchesResponse,
  ProductItem,
  ProductInput,
  ProductsResponse,
  ProductionBatchStartRequest,
  SamplingActCreate,
  SamplingActItem,
  SamplingActsResponse,
  QcReportsListResponse,
  MaterialSpecificationInput,
  MaterialSpecificationItem,
  MaterialSpecificationsResponse,
  EquipmentCalibrationCreate,
  EquipmentCreate,
  EquipmentDetail,
  EquipmentListResponse,
  EquipmentUpdate,
  ReagentAuditResponse,
  ReagentCertificateItem,
  ReagentCreate,
  ReagentDetail,
  ReagentUpdate,
  ReagentUseRequest,
  ReagentsResponse,
} from '../types/inventory'

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT'

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

export function getAccountLedger(token: string, query?: { date_from?: string; date_to?: string }): Promise<AccountLedgerResponse> {
  return request<AccountLedgerResponse>('/api/inventory/accounts/ledger', 'GET', { token, query })
}

export async function downloadAccountLedgerXlsx(token: string, query?: { date_from?: string; date_to?: string }): Promise<Blob> {
  const params = new URLSearchParams()
  if (query?.date_from) params.set('date_from', query.date_from)
  if (query?.date_to) params.set('date_to', query.date_to)
  const qs = params.toString()
  const response = await fetch(`/api/inventory/accounts/ledger.xlsx${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export function listInventoryAccounts(token: string): Promise<InventoryAccountsResponse> {
  return request<InventoryAccountsResponse>('/api/inventory/accounts', 'GET', { token })
}

export function createInventoryAccount(token: string, payload: InventoryAccountInput): Promise<InventoryAccountItem> {
  return request<InventoryAccountItem>('/api/inventory/accounts', 'POST', { token, body: payload })
}

export function updateInventoryAccount(token: string, id: string, payload: InventoryAccountInput): Promise<InventoryAccountItem> {
  return request<InventoryAccountItem>(`/api/inventory/accounts/${id}`, 'PUT', { token, body: payload })
}

export async function deleteInventoryAccount(token: string, id: string): Promise<void> {
  const response = await fetch(`/api/inventory/accounts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok && response.status !== 204) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
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

// ─── Sampling acts (СОП-533 / СОП-548 Ф-10) ─────────────────────────────────

export async function downloadLotQcReportPdf(token: string, lotId: string): Promise<Blob> {
  const response = await fetch(`/api/quality/lots/${lotId}/qc-report/pdf`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export async function downloadLotQcReportDocx(token: string, lotId: string): Promise<Blob> {
  const response = await fetch(`/api/quality/lots/${lotId}/qc-report/docx`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

// Сертификат производителя (CoA) по партии (через приход).
export async function downloadLotCertificate(token: string, lotId: string): Promise<Blob> {
  const response = await fetch(`/api/inventory/lots/${lotId}/certificate/file`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
  return response.blob()
}

// Скан подписанного аналитического листа по партии (для реестра).
export async function downloadLotQcReportScan(token: string, lotId: string): Promise<Blob> {
  const response = await fetch(`/api/quality/lots/${lotId}/qc-report/scan`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
  return response.blob()
}

export function listQcReports(token: string): Promise<QcReportsListResponse> {
  return request<QcReportsListResponse>('/api/quality/qc-reports', 'GET', { token })
}

export async function uploadQcReportScan(token: string, reportId: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`/api/quality/qc-reports/${reportId}/scan`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
}

export async function downloadQcReportScan(token: string, scanId: string): Promise<Blob> {
  const response = await fetch(`/api/quality/qc-report-scans/${scanId}/file`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export async function downloadQcReportPdf(token: string, reportId: string): Promise<Blob> {
  const response = await fetch(`/api/quality/qc-reports/${reportId}/pdf`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export async function downloadQcReportDocx(token: string, reportId: string): Promise<Blob> {
  const response = await fetch(`/api/quality/qc-reports/${reportId}/docx`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export function listSamplingActs(token: string, status?: string): Promise<SamplingActsResponse> {
  return request<SamplingActsResponse>('/api/quality/sampling-acts', 'GET', { token, query: { status } })
}

export function getSamplingActForLot(token: string, lotId: string): Promise<SamplingActItem | null> {
  return request<SamplingActItem | null>(`/api/quality/lots/${lotId}/sampling-act`, 'GET', { token })
}

export function getSamplingAct(token: string, actId: string): Promise<SamplingActItem> {
  return request<SamplingActItem>(`/api/quality/sampling-acts/${actId}`, 'GET', { token })
}

export function createSamplingAct(token: string, payload: SamplingActCreate): Promise<SamplingActItem> {
  return request<SamplingActItem>('/api/quality/sampling-acts', 'POST', { token, body: payload })
}

export function updateSamplingAct(token: string, actId: string, payload: SamplingActCreate): Promise<SamplingActItem> {
  return request<SamplingActItem>(`/api/quality/sampling-acts/${actId}`, 'PUT', { token, body: payload })
}

export function postSamplingAct(token: string, actId: string, payload: SignatureRequest): Promise<SamplingActItem> {
  return request<SamplingActItem>(`/api/quality/sampling-acts/${actId}/post`, 'POST', { token, body: payload })
}

export function cancelSamplingAct(token: string, actId: string): Promise<SamplingActItem> {
  return request<SamplingActItem>(`/api/quality/sampling-acts/${actId}/cancel`, 'POST', { token })
}

export async function uploadSamplingScan(token: string, actId: string, file: File): Promise<SamplingActItem> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`/api/quality/sampling-acts/${actId}/scans`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
  return response.json()
}

export function samplingActPdfUrl(actId: string, inline = false): string {
  return `/api/quality/sampling-acts/${actId}/pdf${inline ? '?inline=true' : ''}`
}

export async function downloadSamplingActPdf(token: string, actId: string): Promise<Blob> {
  const response = await fetch(samplingActPdfUrl(actId), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export function listReceiptCertificates(token: string, receiptId: string): Promise<ReceiptCertificatesResponse> {
  return request<ReceiptCertificatesResponse>(`/api/inventory/receipts/${receiptId}/certificates`, 'GET', { token })
}

export async function uploadReceiptCertificate(
  token: string,
  receiptId: string,
  file: File,
  certificateNo?: string,
): Promise<ReceiptCertificateItem> {
  const form = new FormData()
  form.append('file', file)
  const qs = certificateNo ? `?certificate_no=${encodeURIComponent(certificateNo)}` : ''
  const response = await fetch(`/api/inventory/receipts/${receiptId}/certificates${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
  return response.json()
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

// --- Unified ДОК verification queue (Ф-14 / Ф-10 / Ф-11) -------------------
export function listVerificationQueue(token: string): Promise<VerificationQueueResponse> {
  return request<VerificationQueueResponse>('/api/quality/verification-queue', 'GET', { token })
}

export function verifySamplingScan(token: string, scanId: string, payload: ScanVerifyRequest): Promise<SamplingActItem> {
  return request<SamplingActItem>(`/api/quality/sampling-scans/${scanId}/verify`, 'POST', { token, body: payload })
}

export function rejectSamplingScan(token: string, scanId: string, payload: ScanRejectRequest): Promise<SamplingActItem> {
  return request<SamplingActItem>(`/api/quality/sampling-scans/${scanId}/reject`, 'POST', { token, body: payload })
}

export function verifyQcReportScan(token: string, scanId: string, payload: ScanVerifyRequest): Promise<QcReportListItem> {
  return request<QcReportListItem>(`/api/quality/qc-report-scans/${scanId}/verify`, 'POST', { token, body: payload })
}

export function rejectQcReportScan(token: string, scanId: string, payload: ScanRejectRequest): Promise<QcReportListItem> {
  return request<QcReportListItem>(`/api/quality/qc-report-scans/${scanId}/reject`, 'POST', { token, body: payload })
}

export async function downloadSamplingScanFile(token: string, scanId: string): Promise<Blob> {
  const response = await fetch(`/api/quality/sampling-scans/${scanId}/file`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export async function downloadQcReportScanFile(token: string, scanId: string): Promise<Blob> {
  const response = await fetch(`/api/quality/qc-report-scans/${scanId}/file`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
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

export function listOos(token: string, status?: string): Promise<OOSListResponse> {
  return request<OOSListResponse>('/api/quality/oos', 'GET', { token, query: { status } })
}

export function updateOos(token: string, oosId: string, payload: { root_cause?: string | null; conclusion?: string | null; disposition?: string | null }): Promise<OOSItem> {
  return request<OOSItem>(`/api/quality/oos/${oosId}`, 'PUT', { token, body: payload })
}

export function closeOos(token: string, oosId: string, payload: SignatureRequest & { conclusion: string; disposition: string; root_cause?: string | null }): Promise<OOSItem> {
  return request<OOSItem>(`/api/quality/oos/${oosId}/close`, 'POST', { token, body: payload })
}

export function submitQaDecision(token: string, lotId: string, payload: QADecisionRequest): Promise<QualityLotsResponse['lots'][number]> {
  return request<QualityLotsResponse['lots'][number]>(`/api/quality/lots/${lotId}/qa-decision`, 'POST', { token, body: payload })
}

// ─── Спецификации (НД) ──────────────────────────────────────────────────────

export function listSpecifications(token: string): Promise<MaterialSpecificationsResponse> {
  return request<MaterialSpecificationsResponse>('/api/quality/specifications', 'GET', { token })
}

export function getSpecification(token: string, specId: string): Promise<MaterialSpecificationItem> {
  return request<MaterialSpecificationItem>(`/api/quality/specifications/${specId}`, 'GET', { token })
}

export function resolveLotSpecification(token: string, lotId: string): Promise<MaterialSpecificationItem | null> {
  return request<MaterialSpecificationItem | null>(`/api/quality/lots/${lotId}/specification`, 'GET', { token })
}

export function createSpecification(token: string, payload: MaterialSpecificationInput): Promise<MaterialSpecificationItem> {
  return request<MaterialSpecificationItem>('/api/quality/specifications', 'POST', { token, body: payload })
}

export function updateSpecification(token: string, specId: string, payload: MaterialSpecificationInput): Promise<MaterialSpecificationItem> {
  return request<MaterialSpecificationItem>(`/api/quality/specifications/${specId}`, 'PUT', { token, body: payload })
}

export async function deleteSpecification(token: string, specId: string): Promise<void> {
  const response = await fetch(`/api/quality/specifications/${specId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok && response.status !== 204) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
}

// ─── Equipment registry (КИП) ────────────────────────────────────────────────

export function listEquipment(
  token: string,
  query?: { active?: boolean; category?: string },
): Promise<EquipmentListResponse> {
  const q: Record<string, string | number | undefined> = {}
  if (query?.active !== undefined) q.active = query.active ? 'true' : 'false'
  if (query?.category) q.category = query.category
  return request<EquipmentListResponse>('/api/equipment', 'GET', { token, query: q })
}

export function getEquipment(token: string, equipmentId: string): Promise<EquipmentDetail> {
  return request<EquipmentDetail>(`/api/equipment/${equipmentId}`, 'GET', { token })
}

export function createEquipment(token: string, payload: EquipmentCreate): Promise<EquipmentDetail> {
  return request<EquipmentDetail>('/api/equipment', 'POST', { token, body: payload })
}

export function updateEquipment(
  token: string,
  equipmentId: string,
  payload: EquipmentUpdate,
): Promise<EquipmentDetail> {
  return request<EquipmentDetail>(`/api/equipment/${equipmentId}`, 'PATCH', { token, body: payload })
}

export function addEquipmentCalibration(
  token: string,
  equipmentId: string,
  payload: EquipmentCalibrationCreate,
): Promise<EquipmentDetail> {
  return request<EquipmentDetail>(`/api/equipment/${equipmentId}/calibrations`, 'POST', {
    token,
    body: payload,
  })
}

// ─── QC reagents / standards registry ───────────────────────────────────────

export function listReagents(
  token: string,
  query?: { search?: string; type?: string; status?: string; opened_only?: boolean },
): Promise<ReagentsResponse> {
  const q: Record<string, string | number | undefined> = {}
  if (query?.search) q.search = query.search
  if (query?.type) q.type = query.type
  if (query?.status) q.status = query.status
  if (query?.opened_only !== undefined) q.opened_only = query.opened_only ? 'true' : 'false'
  return request<ReagentsResponse>('/api/qc/reagents', 'GET', { token, query: q })
}

export function getReagent(token: string, reagentId: string): Promise<ReagentDetail> {
  return request<ReagentDetail>(`/api/qc/reagents/${reagentId}`, 'GET', { token })
}

export function createReagent(token: string, payload: ReagentCreate): Promise<ReagentDetail> {
  return request<ReagentDetail>('/api/qc/reagents', 'POST', { token, body: payload })
}

export function updateReagent(token: string, reagentId: string, payload: ReagentUpdate): Promise<ReagentDetail> {
  return request<ReagentDetail>(`/api/qc/reagents/${reagentId}`, 'PATCH', { token, body: payload })
}

export function useReagent(token: string, reagentId: string, payload: ReagentUseRequest): Promise<ReagentDetail> {
  return request<ReagentDetail>(`/api/qc/reagents/${reagentId}/use`, 'POST', { token, body: payload })
}

export function changeReagentStatus(
  token: string,
  reagentId: string,
  payload: SignatureRequest & { status: string },
): Promise<ReagentDetail> {
  return request<ReagentDetail>(`/api/qc/reagents/${reagentId}/status`, 'POST', { token, body: payload })
}

export function getReagentAudit(token: string, reagentId: string): Promise<ReagentAuditResponse> {
  return request<ReagentAuditResponse>(`/api/qc/reagents/${reagentId}/audit`, 'GET', { token })
}

export async function uploadReagentCertificate(
  token: string,
  reagentId: string,
  file: File,
  meta?: { certificate_no?: string; note?: string },
): Promise<ReagentCertificateItem> {
  const params = new URLSearchParams()
  if (meta?.certificate_no) params.set('certificate_no', meta.certificate_no)
  if (meta?.note) params.set('note', meta.note)
  const form = new FormData()
  form.append('file', file, file.name)
  const response = await fetch(`/api/qc/reagents/${reagentId}/certificates${params.toString() ? `?${params}` : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
  return (await response.json()) as ReagentCertificateItem
}

export async function downloadReagentCertificate(token: string, certificateId: string): Promise<Blob> {
  const response = await fetch(`/api/qc/reagents/certificates/${certificateId}/file`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
  return response.blob()
}

export async function downloadReagentCardPdf(token: string, reagentId: string): Promise<Blob> {
  const response = await fetch(`/api/qc/reagents/${reagentId}/card.pdf`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
  return response.blob()
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

// ─── Production Batches ─────────────────────────────────────────────────────

export function listProducts(token: string): Promise<ProductsResponse> {
  return request<ProductsResponse>('/api/production/products', 'GET', { token })
}

export function createProduct(token: string, payload: ProductInput): Promise<ProductItem> {
  return request<ProductItem>('/api/production/products', 'POST', { token, body: payload })
}

export function updateProduct(token: string, id: string, payload: ProductInput): Promise<ProductItem> {
  return request<ProductItem>(`/api/production/products/${id}`, 'PUT', { token, body: payload })
}

export function previewProductionBatch(token: string, payload: ProductionBatchPreviewRequest): Promise<ProductionBatchPreview> {
  return request<ProductionBatchPreview>('/api/production/batches/preview', 'POST', { token, body: payload })
}

export function createProductionBatch(token: string, payload: ProductionBatchCreate): Promise<ProductionBatchItem> {
  return request<ProductionBatchItem>('/api/production/batches', 'POST', { token, body: payload })
}

export function listProductionBatches(token: string, status?: string): Promise<ProductionBatchesResponse> {
  return request<ProductionBatchesResponse>('/api/production/batches', 'GET', { token, query: status ? { status } : undefined })
}

export function getProductionBatchAudit(token: string, id: string): Promise<ProductionBatchAuditResponse> {
  return request<ProductionBatchAuditResponse>(`/api/production/batches/${id}/audit`, 'GET', { token })
}

export function getProductionBatchRequisitions(token: string, id: string): Promise<RequisitionsResponse> {
  return request<RequisitionsResponse>(`/api/production/batches/${id}/requisitions`, 'GET', { token })
}

export function issueProductionBmr(token: string, id: string, payload: ProductionBatchBmrIssueRequest): Promise<ProductionBatchItem> {
  return request<ProductionBatchItem>(`/api/production/batches/${id}/issue-bmr`, 'POST', { token, body: payload })
}

export function assignProductionBatch(token: string, id: string): Promise<ProductionBatchItem> {
  return request<ProductionBatchItem>(`/api/production/batches/${id}/assign`, 'POST', { token })
}

export function cancelProductionBatch(token: string, id: string, payload: ProductionBatchCancelRequest): Promise<ProductionBatchItem> {
  return request<ProductionBatchItem>(`/api/production/batches/${id}/cancel`, 'POST', { token, body: payload })
}

export function checkProductionBatchNumber(token: string, id: string, payload: ProductionBatchNumberCheckRequest): Promise<ProductionBatchItem> {
  return request<ProductionBatchItem>(`/api/production/batches/${id}/check-number`, 'POST', { token, body: payload })
}

export function updateProductionBatchChecklist(token: string, id: string, payload: ProductionBatchChecklistUpdate): Promise<ProductionBatchItem> {
  return request<ProductionBatchItem>(`/api/production/batches/${id}/checklist`, 'PATCH', { token, body: payload })
}

export function startProductionBatch(token: string, id: string, payload: ProductionBatchStartRequest): Promise<ProductionBatchItem> {
  return request<ProductionBatchItem>(`/api/production/batches/${id}/start`, 'POST', { token, body: payload })
}

export function completeProductionBatch(token: string, id: string, payload: ProductionBatchCompleteRequest): Promise<ProductionBatchItem> {
  return request<ProductionBatchItem>(`/api/production/batches/${id}/complete`, 'POST', { token, body: payload })
}
