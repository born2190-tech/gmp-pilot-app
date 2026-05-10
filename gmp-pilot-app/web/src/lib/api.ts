import type { LoginRequest, LoginResponse, LotsResponse, MeResponse, MovementsResponse, WarehouseType } from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

type HttpMethod = 'GET' | 'POST'

async function request<T>(
  path: string,
  method: HttpMethod,
  options?: {
    token?: string
    query?: Record<string, string | number | undefined>
    body?: unknown
  },
): Promise<T> {
  const url = new URL(path, API_BASE_URL)

  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const response = await fetch(url, {
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
      detail = payload.detail ?? detail
    } catch {
      detail = response.statusText || detail
    }
    throw new Error(detail)
  }

  return (await response.json()) as T
}

export function login(payload: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', 'POST', { body: payload })
}

export function me(token: string): Promise<MeResponse> {
  return request<MeResponse>('/auth/me', 'GET', { token })
}

export function logout(token: string): Promise<{ message: string }> {
  return request<{ message: string }>('/auth/logout', 'POST', { token })
}

export function listLots(token: string, warehouseType?: WarehouseType | ''): Promise<LotsResponse> {
  return request<LotsResponse>('/lots', 'GET', {
    token,
    query: {
      warehouse_type: warehouseType || undefined,
    },
  })
}

export function listMovements(token: string, warehouseType?: WarehouseType | ''): Promise<MovementsResponse> {
  return request<MovementsResponse>('/inventory/movements', 'GET', {
    token,
    query: {
      warehouse_type: warehouseType || undefined,
      limit: 100,
    },
  })
}
