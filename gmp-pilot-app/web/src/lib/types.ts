export type Role =
  | 'WAREHOUSE_OPERATOR'
  | 'WAREHOUSE_MANAGER'
  | 'QC_ANALYST'
  | 'QA_MANAGER'
  | 'PRODUCTION_OPERATOR'
  | 'SHIFT_MASTER'
  | 'SYS_ADMIN'

export type WarehouseType = 'SUBSTANCE_WAREHOUSE' | 'PACKAGING_WAREHOUSE' | 'FG_WAREHOUSE'

export interface LoginRequest {
  username: string
  password: string
  workstation_id?: string
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  expires_at: string
  username: string
  role: Role
  warehouse_scope?: WarehouseType | ''
  workstation_id?: string | ''
}

export interface MeResponse {
  username: string
  role: Role
  warehouse_scope: WarehouseType | ''
  workstation_id: string | ''
}

export interface LotItem {
  id: number
  internal_lot: string
  supplier_lot: string
  warehouse_type: WarehouseType
  material_code: string
  material_name: string
  production_year: number | null
  expiry_date: string | null
  quantity: number
  unit: string
  location: string
  quality_status: string
  sop_status: string
  sop_labels: string[]
  incoming_control_notified_at: string | null
  qc_result_received_at: string | null
  has_open_deviation: boolean
  created_at: string
}

export interface LotsResponse {
  count: number
  lots: LotItem[]
}

export interface MovementItem {
  id: number
  timestamp_utc: string
  movement_type: string
  warehouse_type: WarehouseType
  lot_id: number
  internal_lot: string
  supplier_lot: string
  production_year: number | null
  expiry_date: string | null
  material_code: string
  material_name: string
  quantity_delta: number
  quantity_after: number
  unit: string
  reference_type: string
  reference_id: string
  user_id: string
  comment: string | null
}

export interface MovementsResponse {
  count: number
  movements: MovementItem[]
}
