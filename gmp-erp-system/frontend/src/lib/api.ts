import type { CurrentUser, LoginRequest, LoginResponse } from '../types/auth'

type Method = 'GET' | 'POST'

async function request<T>(path: string, method: Method, options?: { token?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
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
