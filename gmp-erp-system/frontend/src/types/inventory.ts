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
  // Physical coordinate (form Ф-3 СОП-415). All optional — any subset may be set.
  rack_no?: string | null
  sector_no?: string | null
  tier_no?: string | null
  place_no?: string | null
  pallet_no?: string | null
  quantity: number
  unit: string
  quality_status: string
  production_date: string | null
  production_year: number
  expiry_date: string
  incoming_control_notified_at: string | null
  sampling_date: string | null
  qc_result_received_at: string | null
  qc_report_no: string | null
  qa_decision_at: string | null
}

export interface LotsResponse {
  lots: LotItem[]
}

export interface QualityLotsResponse {
  lots: LotItem[]
}

export interface QCNotificationLineItem {
  lot_id: string
  material_name: string
  batch_number: string
  expiry_date: string
  quantity: number
  unit: string
  manufacturer_name: string
  invoice_info: string
}

export interface QCNotificationItem {
  id: string
  notification_no: string
  status: string
  warehouse_type: string
  notified_at: string
  lines: QCNotificationLineItem[]
}

export interface QCNotificationsResponse {
  notifications: QCNotificationItem[]
}

export interface QCNotificationCreate {
  receipt_id: string
  notification_no?: string | null
  reason?: string | null
}

export interface QCNotificationScanItem {
  id: string
  notification_id: string
  version: number
  file_size: number
  mime_type: string
  sha256_hash: string
  status: 'pending_verification' | 'verified' | 'rejected'
  uploaded_at: string
  uploaded_by: string
  verified_at: string | null
  verified_by: string | null
  signature_warehouse_ok: boolean | null
  signature_qc_ok: boolean | null
  signature_manager_ok: boolean | null
  remarks: string | null
}

export interface QCNotificationScansResponse {
  notification_id: string
  notification_no: string
  notification_status: string
  scans: QCNotificationScanItem[]
}

export interface QCScanVerifyRequest {
  signature_warehouse_ok: boolean
  signature_qc_ok: boolean
  signature_manager_ok: boolean
  remarks?: string | null
  username: string
  password: string
  meaning: string
  reason?: string | null
}

export interface QCScanRejectRequest {
  remarks: string
  username: string
  password: string
  meaning: string
  reason?: string | null
}

export interface QCPendingScanItem {
  scan_id: string
  notification_id: string
  notification_no: string
  warehouse_type: string
  notified_at: string
  uploaded_at: string
  uploaded_by: string
  uploaded_by_name: string | null
  version: number
  lines_count: number
}

export interface QCPendingScansResponse {
  scans: QCPendingScanItem[]
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
  supplier_lot: string
  material_code: string
  material_name: string
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
  rack_no?: string | null
  sector_no?: string | null
  tier_no?: string | null
  place_no?: string | null
  pallet_no?: string | null
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

// ─── Inventory count workflow (replaces the one-shot form) ──────────────────
//
// In the UI we call this "Инвентаризация" — the backend identifier "wave" is
// kept only for internal table/route names so we don't have to migrate the
// schema.

export type InventoryWaveStatus = 'planning' | 'counting' | 'verification' | 'posted' | 'cancelled'
export type InventoryWaveLineStatus =
  | 'pending'
  | 'counted'
  | 'within_tolerance'
  | 'needs_verification'
  | 'verified'
  | 'rejected'

export interface InventoryWaveLineItem {
  id: string
  lot_id: string
  internal_lot: string
  supplier_lot: string | null
  material_code: string
  material_name: string
  location_code: string
  rack_no: string | null
  sector_no: string | null
  tier_no: string | null
  place_no: string | null
  pallet_no: string | null
  unit: string
  status: InventoryWaveLineStatus
  system_quantity: number
  actual_quantity: number | null
  variance: number | null
  variance_pct: number | null
  notes: string | null
  counted_by: string | null
  counted_by_name: string | null
  counted_at: string | null
  verified_by: string | null
  verified_by_name: string | null
  verified_at: string | null
  verifier_comment: string | null
}

export interface InventoryWaveItem {
  id: string
  wave_no: string
  status: InventoryWaveStatus
  warehouse_type: string
  warehouse_name: string
  scope_description: string
  tolerance_pct: number
  created_by: string
  created_by_name: string | null
  started_at: string
  counters: string[]
  verifier_id: string | null
  verifier_name: string | null
  submitted_at: string | null
  posted_by: string | null
  posted_by_name: string | null
  posted_at: string | null
  total_lines: number
  counted_lines: number
  variance_lines: number
  lines: InventoryWaveLineItem[]
}

export interface InventoryWavesResponse {
  waves: InventoryWaveItem[]
}

export interface InventoryWaveStartRequest {
  wave_no?: string | null
  scope: {
    warehouse_id: string
    location_code?: string | null
    rack_no?: string | null
    lot_ids?: string[]
  }
  tolerance_pct?: number
  counters?: string[]
  verifier_username?: string | null
  reason?: string | null
}

export interface InventoryWaveLineUpdate {
  actual_quantity: number
  notes?: string | null
}

export interface InventoryWaveVerifyRequest {
  decision: 'confirm' | 'escalate'
  comment?: string | null
}

export interface InventoryWavePostRequest extends SignatureRequest {}

export interface InventoryWaveCancelRequest {
  reason: string
}

export interface InventoryWaveSubmitRequest {
  reason?: string | null
}

// ─── Receipt defect acts (СОП-209 Ф-12) ────────────────────────────────────

export type ReceiptDefectSeverity = 'critical' | 'significant' | 'minor'
export type ReceiptDefectStatus = 'pending' | 'escalated' | 'resolved' | 'returned'

export interface ReceiptDefectPhotoItem {
  id: string
  mime_type: string
  file_size: number
  sha256_hash: string
  uploaded_by: string
  uploaded_at: string
}

export interface ReceiptDefectItem {
  id: string
  act_no: string
  receipt_id: string
  receipt_line_id: string | null
  severity: ReceiptDefectSeverity
  description: string
  status: ReceiptDefectStatus
  recorded_by: string
  recorded_by_name: string | null
  recorded_at: string
  resolved_by: string | null
  resolved_by_name: string | null
  resolved_at: string | null
  resolution_comment: string | null
  material_code: string | null
  material_name: string | null
  photos: ReceiptDefectPhotoItem[]
}

export interface ReceiptDefectsResponse {
  defects: ReceiptDefectItem[]
}

export interface ReceiptDefectCreate {
  receipt_line_id?: string | null
  severity: ReceiptDefectSeverity
  description: string
}

export interface ReceiptDefectStatusUpdate {
  status: 'escalated' | 'resolved' | 'returned'
  comment?: string | null
}

export interface ReceiptCreate {
  document_no: string
  supplier_id?: string | null
  supplier?: SupplierCreate | null
  manufacturer_id?: string | null
  manufacturer?: ManufacturerCreate | null
  warehouse_id: string
  received_date: string
    lines: Array<{
      material_id?: string | null
      material?: MaterialCreate | null
      supplier_id?: string | null
      supplier?: SupplierCreate | null
      manufacturer_id?: string | null
      manufacturer?: ManufacturerCreate | null
      supplier_lot?: string | null
      production_date: string | null
    production_year?: number | null
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

// ─── Production Requisitions ───────────────────────────────────────────────

export interface RequisitionAllocationLineItem {
  id: string
  requisition_line_id: string
  lot_id: string
  lot_internal_lot: string
  lot_supplier_lot: string
  lot_expiry_date: string
  lot_location_code: string
  lot_rack_no: string | null
  lot_sector_no: string | null
  lot_tier_no: string | null
  lot_place_no: string | null
  lot_pallet_no: string | null
  lot_available: number
  warehouse_type: string
  allocated_quantity: number
  status: string
}

export interface RequisitionLineItem {
  id: string
  material_id: string
  material_code: string
  material_name: string
  requested_quantity: number
  issued_quantity: number
  unit: string
  warehouse_type: string
  status: string
  allocation_lines: RequisitionAllocationLineItem[]
}

export interface RequisitionItem {
  id: string
  requisition_no: string
  status: string
  product_name: string
  product_series: string | null
  production_date: string | null
  production_order_no: string | null
  notes: string | null
  submitted_at: string | null
  created_at: string
  lines: RequisitionLineItem[]
}

export interface RequisitionsResponse {
  requisitions: RequisitionItem[]
}

export interface RequisitionLineCreate {
  material_id: string
  requested_quantity: number
  unit: string
}

export interface RequisitionCreate {
  product_name: string
  product_series?: string | null
  production_date: string
  production_order_no?: string | null
  lines: RequisitionLineCreate[]
}

export interface AllocationLineUpdate {
  id: string
  allocated_quantity: number
}

export interface AllocationLineAdd {
  requisition_line_id: string
  lot_id: string
  allocated_quantity: number
}

export interface AllocationUpdateRequest {
  updates?: AllocationLineUpdate[]
  additions?: AllocationLineAdd[]
  removals?: string[]
}

export interface IssueRequisitionRequest extends SignatureRequest {
  reason?: string
}
