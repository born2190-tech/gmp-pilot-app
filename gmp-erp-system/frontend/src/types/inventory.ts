export interface WarehouseItem {
  id: string
  code: string
  name: string
  warehouse_type: string
}

export interface WarehousesResponse {
  warehouses: WarehouseItem[]
}

export interface LocationItem {
  id: string
  warehouse_id: string
  code: string
  name: string
  storage_condition: string | null
}

export interface LocationsResponse {
  locations: LocationItem[]
}

export interface SupplierItem {
  id: string
  code: string
  name: string
}

export interface SupplierCreate {
  code: string
  name: string
}

export interface SuppliersResponse {
  suppliers: SupplierItem[]
}

export interface ManufacturerItem {
  id: string
  code: string
  name: string
}

export interface ManufacturerCreate {
  code: string
  name: string
}

export interface ManufacturersResponse {
  manufacturers: ManufacturerItem[]
}

export interface MaterialItem {
  id: string
  code: string
  name: string
  item_type: string
  default_unit: string
}

export interface MaterialCreate {
  code: string
  name: string
  item_type: string
  default_unit: string
}

export interface MaterialsResponse {
  materials: MaterialItem[]
}

export interface LotItem {
  id: string
  internal_lot: string
  supplier_lot: string
  material_code: string
  material_name: string
  supplier_name: string
  manufacturer_name: string
  warehouse_type: string
  location_code: string
  quantity: number
  unit: string
  quality_status: string
  production_date: string | null
  production_year: number
  expiry_date: string
  incoming_control_notified_at: string | null
  sampling_date: string | null
  qc_result_received_at: string | null
  qa_decision_at: string | null
}

export interface LotsResponse {
  lots: LotItem[]
}

export interface MovementItem {
  id: string
  movement_type: string
  document_type: string
  document_id: string
  internal_lot: string
  material_code: string
  quantity_delta: number
  quantity_after: number
  unit: string
  reason: string | null
  workstation_id: string
  created_at: string
}

export interface MovementsResponse {
  movements: MovementItem[]
}

export interface ReceiptCreate {
  document_no: string
  supplier_id: string
  manufacturer_id: string
  warehouse_id: string
  received_date: string
  lines: Array<{
    material_id: string
    supplier_lot: string
    production_date: string | null
    production_year: number
    expiry_date: string
    quantity: number
    unit: string
    location_id: string
  }>
}

export interface ReceiptResponse {
  id: string
  document_no: string
  status: string
}

export interface SignatureRequest {
  username: string
  password: string
  meaning: string
  reason?: string
}

export interface PostReceiptResponse {
  id: string
  document_no: string
  status: string
  lots_created: number
}
