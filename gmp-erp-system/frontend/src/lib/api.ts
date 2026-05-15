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
