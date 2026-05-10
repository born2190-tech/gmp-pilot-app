export interface LoginRequest {
  username: string
  password: string
  workstation_id: string
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  expires_at: string
  username: string
  role: string
  department: string | null
  warehouse_scope: string | null
  workstation_id: string
}

export interface CurrentUser {
  username: string
  full_name: string
  role: string
  department: string | null
  permissions: string[]
  warehouse_scope: string | null
  workstation_id: string
}
