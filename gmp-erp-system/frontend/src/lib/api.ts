import type { CurrentUser, LoginRequest, LoginResponse } from '../types/auth'
import type {
  LocationsResponse,
  LotsResponse,
  ManufacturerCreate,
  ManufacturerItem,
  ManufacturersResponse,
  MaterialCreate,
  MaterialItem,
  MaterialsResponse,
  MovementsResponse,
  PostReceiptResponse,
  ReceiptCreate,
  ReceiptResponse,
  SignatureRequest,
  SupplierCreate,
  SupplierItem,
  SuppliersResponse,
  WarehousesResponse,
} from '../types/inventory'

type Method = 'GET' | 'POST'

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
      detail = typeof payload.detail === 'string' ? payload.detail : detail
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

export function listLots(token: string): Promise<LotsResponse> {
  return request<LotsResponse>('/api/inventory/lots', 'GET', { token })
}

export function listMovements(token: string): Promise<MovementsResponse> {
  return request<MovementsResponse>('/api/inventory/movements', 'GET', { token })
}

export function createReceipt(token: string, payload: ReceiptCreate): Promise<ReceiptResponse> {
  return request<ReceiptResponse>('/api/inventory/receipts', 'POST', { token, body: payload })
}

export function postReceipt(token: string, receiptId: string, payload: SignatureRequest): Promise<PostReceiptResponse> {
  return request<PostReceiptResponse>(`/api/inventory/receipts/${receiptId}/post`, 'POST', { token, body: payload })
}
