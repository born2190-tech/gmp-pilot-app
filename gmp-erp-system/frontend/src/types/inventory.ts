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
  warehouse_id?: string
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

export interface QualityLotsResponse {
  lots: LotItem[]
}

export interface SampleLotRequest {
  reason: string
}

export interface QCResultRequest extends SignatureRequest {
  result_summary: string
}

export interface QCReportParameterCreate {
  parameter_name: string
  specification: string
  result_value: string
  unit: string | null
  method_reference: string | null
  complies: boolean
}

export interface QCReportCreate {
  lot_id: string
  report_no: string
  analysis_started_at: string | null
  analysis_finished_at: string | null
  method_reference: string | null
  parameters: QCReportParameterCreate[]
}

export interface QCReportItem {
  id: string
  lot_id: string
  report_no: string
  status: string
  method_reference: string | null
  analysis_started_at: string | null
  analysis_finished_at: string | null
  overall_result: string | null
  submitted_at: string | null
  parameters: Array<QCReportParameterCreate & { id: string }>
}

export interface QADecisionRequest extends SignatureRequest {
  decision: 'released' | 'rejected'
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

export interface TransferLotRequest {
  to_location_id: string
  reason: string
}

export interface AdjustLotRequest extends SignatureRequest {
  new_quantity: number
}

export interface IssueProductionRequest extends SignatureRequest {
  quantity: number
  production_order_no: string
}

export interface FGShipmentLineCreate {
  lot_id: string
  quantity: number
}

export interface FGShipmentCreate extends SignatureRequest {
  document_no: string
  customer_name: string
  customer_tax_id?: string
  destination_address: string
  shipment_date: string
  vehicle_no?: string
  waybill_no?: string
  lines: FGShipmentLineCreate[]
}

export interface FGShipmentLineItem {
  lot_id: string
  internal_lot: string
  material_code: string
  material_name: string
  production_date: string | null
  expiry_date: string
  quantity: number
  unit: string
  quantity_after: number
}

export interface FGShipmentItem {
  id: string
  document_no: string
  status: string
  customer_name: string
  customer_tax_id: string | null
  destination_address: string
  shipment_date: string
  vehicle_no: string | null
  waybill_no: string | null
  posted_at: string
  lines: FGShipmentLineItem[]
}

export interface FGShipmentsResponse {
  shipments: FGShipmentItem[]
}

export interface InventoryCountCreate extends SignatureRequest {
  document_no: string
  count_date: string
  lines: Array<{
    lot_id: string
    actual_quantity: number
  }>
}

export interface InventoryCountLineItem {
  lot_id: string
  internal_lot: string
  material_code: string
  system_quantity: number
  actual_quantity: number
  variance: number
  unit: string
}

export interface InventoryCountItem {
  id: string
  document_no: string
  status: string
  warehouse_type: string
  count_date: string
  posted_at: string
  lines: InventoryCountLineItem[]
}

export interface InventoryCountsResponse {
  counts: InventoryCountItem[]
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
