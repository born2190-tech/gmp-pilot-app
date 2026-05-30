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
  initial_quantity?: number
  unit: string
  quality_status: string
  production_date: string | null
  production_year: number
  expiry_date: string
  // Нормы отбора Ф-1 из карточки материала (только в QC-ленте).
  sample_pc_qty?: number | null
  sample_micro_qty?: number | null
  sample_archive_qty?: number | null
  sample_stability_qty?: number | null
  sample_unit?: string | null
  incoming_control_notified_at: string | null
  sampling_date: string | null
  qc_result_received_at: string | null
  qc_report_no: string | null
  qa_decision_at: string | null
  has_certificate?: boolean
  // Стоимость / счёт учёта / счёт-фактура / ГТД (Этап финучёта).
  unit_cost?: number | null
  currency?: string | null
  account_code?: string | null
  invoice_no?: string | null
  gtd_number?: string | null
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

// --- Unified ДОК verification queue (Ф-14 / Ф-10 / Ф-11) -------------------
export type VerificationDocType = 'qc_notification' | 'sampling_act' | 'qc_report'

export interface VerificationQueueItem {
  doc_type: VerificationDocType
  scan_id: string
  doc_id: string
  doc_no: string
  sop_form: string | null
  title: string | null
  uploaded_at: string
  uploaded_by: string
  uploaded_by_name: string | null
  version: number
  micro?: boolean | null
}

export interface VerificationQueueResponse {
  items: VerificationQueueItem[]
}

export interface ScanVerifyRequest {
  signature_1_ok: boolean
  signature_2_ok: boolean
  signature_3_ok: boolean
  remarks?: string | null
  username: string
  password: string
  meaning: string
  reason?: string | null
}

export interface ScanRejectRequest {
  remarks: string
  username: string
  password: string
  meaning: string
  reason?: string | null
}

export interface SampleLotRequest {
  reason: string
}

export interface QCResultRequest extends SignatureRequest {
  result_summary: string
}

export type QCParamCategory = 'physicochemical' | 'microbiological'

export interface QCReportParameterCreate {
  category?: QCParamCategory
  parameter_name: string
  specification: string
  result_value: string
  unit: string | null
  method_reference: string | null
  complies: boolean
  equipment_id?: string | null
}

export interface QCReportCreate {
  lot_id: string
  report_no: string
  analysis_started_at: string | null
  analysis_finished_at: string | null
  method_reference: string | null
  equipment?: string | null
  equipment_ids?: string[]
  room_temp?: string | null
  humidity?: string | null
  micro_required?: boolean
  micro_method_reference?: string | null
  micro_started_at?: string | null
  micro_finished_at?: string | null
  parameters: QCReportParameterCreate[]
}

// ---------------------------------------------------------------------------
// КИП — реестр приборов и калибровок
// ---------------------------------------------------------------------------

export type CalibrationStatus = 'ok' | 'expiring' | 'expired' | 'missing'

export interface EquipmentCalibrationCreate {
  certificate_no: string | null
  performed_by: string | null
  valid_from: string
  valid_until: string
  notes: string | null
}

export interface EquipmentCalibrationItem {
  id: string
  equipment_id: string
  certificate_no: string | null
  performed_by: string | null
  valid_from: string
  valid_until: string
  notes: string | null
  recorded_by: string | null
  recorded_at: string
}

export interface EquipmentCreate {
  code: string
  name: string
  category: string | null
  manufacturer: string | null
  model: string | null
  serial_no: string | null
  location: string | null
  notes: string | null
}

export interface EquipmentUpdate {
  name?: string | null
  category?: string | null
  manufacturer?: string | null
  model?: string | null
  serial_no?: string | null
  location?: string | null
  is_active?: boolean | null
  notes?: string | null
}

export interface EquipmentItem {
  id: string
  code: string
  name: string
  category: string | null
  manufacturer: string | null
  model: string | null
  serial_no: string | null
  location: string | null
  is_active: boolean
  notes: string | null
  calibration_status: CalibrationStatus
  calibration_valid_until: string | null
  calibration_certificate_no: string | null
}

export interface EquipmentDetail extends EquipmentItem {
  calibrations: EquipmentCalibrationItem[]
}

export interface EquipmentListResponse {
  equipment: EquipmentItem[]
}

export interface QCReportEquipmentItem {
  id: string
  code: string
  name: string
  category: string | null
  calibration_status: CalibrationStatus
  calibration_valid_until: string | null
}

export interface SpecificationParameterInput {
  category: QCParamCategory
  parameter_name: string
  specification: string
  method_reference: string | null
  unit: string | null
}

export interface SpecificationParameterItem extends SpecificationParameterInput {
  id: string
  ordinal: number
}

export interface MaterialSpecificationInput {
  nd_code: string
  revision: string | null
  material_name: string
  material_id: string | null
  match_keywords: string | null
  sop_form: string
  micro_required: boolean
  micro_method_ref: string | null
  is_active: boolean
  effective_date: string | null
  notes: string | null
  parameters: SpecificationParameterInput[]
}

export interface MaterialSpecificationItem extends MaterialSpecificationInput {
  id: string
  parameters: SpecificationParameterItem[]
}

export interface MaterialSpecificationListItem {
  id: string
  nd_code: string
  revision: string | null
  material_name: string
  material_id: string | null
  sop_form: string
  micro_required: boolean
  is_active: boolean
  effective_date: string | null
  parameters_count: number
}

export interface MaterialSpecificationsResponse {
  specifications: MaterialSpecificationListItem[]
}

export type OOSDisposition = 'confirmed_reject' | 'lab_error_retest' | 'use_as_is'

export interface OOSItem {
  id: string
  number: string
  report_id: string
  lot_id: string
  status: string
  failed_summary: string | null
  root_cause: string | null
  conclusion: string | null
  disposition: OOSDisposition | null
  opened_at: string
  closed_at: string | null
  internal_lot: string | null
  material_name: string | null
  report_no: string | null
}

export interface OOSListResponse {
  investigations: OOSItem[]
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
  equipment?: string | null
  room_temp?: string | null
  humidity?: string | null
  micro_required?: boolean
  micro_method_reference?: string | null
  micro_started_at?: string | null
  micro_finished_at?: string | null
  parameters: Array<QCReportParameterCreate & { id: string; equipment_code?: string | null; equipment_name?: string | null }>
  equipments?: QCReportEquipmentItem[]
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
  value?: number | null
  currency?: string | null
  from_account_code?: string | null
  to_account_code?: string | null
}

export interface MovementsResponse {
  movements: MovementItem[]
}

export interface TransferLotRequest extends SignatureRequest {
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

export interface InventoryAccountInput {
  code: string
  name: string
  account_group: string | null
  zone: string | null
  is_active: boolean
}

export interface InventoryAccountItem extends InventoryAccountInput {
  id: string
}

export interface InventoryAccountsResponse {
  accounts: InventoryAccountItem[]
}

export interface AccountWarehouseValue {
  warehouse_type: string
  value: number
}

export interface AccountLedgerItem {
  account_id: string | null
  account_code: string
  account_name: string
  account_group: string | null
  lots_count: number
  balance_value: number
  in_value: number
  out_value: number
  by_warehouse: AccountWarehouseValue[]
}

export interface AccountLedgerResponse {
  currency: string
  total_balance: number
  accounts: AccountLedgerItem[]
}

export interface ImportDeclarationInput {
  gtd_number: string
  gtd_date?: string | null
  procedure?: string | null
  country_origin?: string | null
  country_dispatch?: string | null
  foreign_manufacturer?: string | null
  broker?: string | null
  incoterms?: string | null
  contract_currency?: string | null
  invoice_value?: number | null
  customs_value?: number | null
  exchange_rate?: number | null
  gross_weight?: number | null
  net_weight?: number | null
  edeclaration_external_id?: string | null
  notes?: string | null
}

export interface ReceiptCreate {
  document_no: string
  supplier_id?: string | null
  supplier?: SupplierCreate | null
  manufacturer_id?: string | null
  manufacturer?: ManufacturerCreate | null
  warehouse_id: string
  received_date: string
  invoice_no?: string | null
  invoice_date?: string | null
  contract_no?: string | null
  contract_date?: string | null
  currency?: string
  einvoice_external_id?: string | null
  import_declaration?: ImportDeclarationInput | null
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
    ikpu_code?: string | null
    unit_price?: number | null
    vat_rate?: number | null
    hs_code?: string | null
  }>
}

export interface ReceiptResponse {
  id: string
  document_no: string
  status: string
}

export interface ReceiptCertificateItem {
  id: string
  receipt_id: string
  certificate_no: string | null
  note: string | null
  file_size: number
  mime_type: string
  sha256_hash: string
  uploaded_at: string
  uploaded_by: string
}

export interface ReceiptCertificatesResponse {
  receipt_id: string
  certificates: ReceiptCertificateItem[]
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

// ─── Sampling acts (СОП-533 / СОП-548 Ф-10) ─────────────────────────────────

export type SamplingPurpose = 'PHYSICOCHEMICAL' | 'MICROBIOLOGICAL' | 'ARCHIVE' | 'STABILITY'
export type SamplingActStatus = 'draft' | 'scan_uploaded' | 'verified' | 'cancelled'

export interface SamplingLineInput {
  purpose: SamplingPurpose
  quantity: number
  unit: string
}

export interface SamplingLineItem {
  id: string
  purpose: SamplingPurpose
  quantity: number
  unit: string
}

export interface SamplingScanItem {
  id: string
  version: number
  file_size: number
  mime_type: string
  sha256_hash: string
  uploaded_at: string
  uploaded_by: string
}

export interface SamplingActCreate {
  lot_id: string
  head_qc_user_id?: string | null
  warehouse_member_user_id?: string | null
  qc_representative_user_id?: string | null
  sampling_date?: string | null
  sampling_location?: string | null
  sample_condition?: string | null
  temperature_c?: number | null
  humidity_pct?: number | null
  scale_model?: string | null
  scale_calibration_no?: string | null
  transport_with_ice?: boolean
  specification_ref?: string | null
  registration_no?: string | null
  containers_outer_total?: number | null
  containers_outer_sampled?: number | null
  containers_inner_total?: number | null
  containers_inner_sampled?: number | null
  notes?: string | null
  lines: SamplingLineInput[]
}

export interface SamplingActItem {
  id: string
  act_no: string
  lot_id: string
  qc_notification_id: string | null
  sop_form: '533' | '548'
  status: SamplingActStatus
  head_qc_user_id: string | null
  warehouse_member_user_id: string | null
  qc_representative_user_id: string | null
  head_qc_name: string | null
  warehouse_member_name: string | null
  qc_representative_name: string | null
  sampling_date: string | null
  sampling_location: string | null
  sample_condition: string | null
  temperature_c: number | null
  humidity_pct: number | null
  scale_model: string | null
  scale_calibration_no: string | null
  transport_with_ice: boolean
  specification_ref: string | null
  registration_no: string | null
  containers_outer_total: number | null
  containers_outer_sampled: number | null
  containers_inner_total: number | null
  containers_inner_sampled: number | null
  notes: string | null
  posted_at: string | null
  created_at: string
  material_name: string | null
  material_code: string | null
  internal_lot: string | null
  supplier_lot: string | null
  manufacturer_name: string | null
  lot_quantity: number | null
  lot_unit: string | null
  total_sampled: number
  lines: SamplingLineItem[]
  scans: SamplingScanItem[]
}

export interface SamplingActsResponse {
  sampling_acts: SamplingActItem[]
}

export interface QcReportListItem {
  id: string
  lot_id: string
  report_no: string
  status: string
  overall_result: string | null
  submitted_at: string | null
  internal_lot: string | null
  material_name: string | null
  manufacturer_name: string | null
  scan_id: string | null
  scan_sha256: string | null
  scan_status: string | null
}

export interface QcReportsListResponse {
  reports: QcReportListItem[]
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
  production_batch_id?: string | null
  batch_no?: string | null
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
  production_batch_id?: string | null
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

// ─── Production batch start / BMR issue ───────────────────────────────────

export interface ProductItem {
  id: string
  code: string
  market_code: string
  market_name: string
  name: string
  dosage_form: string | null
  default_shelf_life_months: number
  batch_format: string | null
  is_active: boolean
  notes: string | null
}

export interface ProductsResponse {
  products: ProductItem[]
}

export interface ProductInput {
  code?: string
  market_code?: string
  market_name?: string
  name: string
  dosage_form?: string | null
  default_shelf_life_months: number
  batch_format?: string | null
  is_active: boolean
  notes?: string | null
}

export interface ProductionBatchItem {
  id: string
  batch_no: string
  status: string
  product_id: string | null
  product_code: string
  serial_no: number
  product_name: string
  dosage_form: string | null
  batch_size: number
  batch_size_unit: string
  production_date: string
  expiry_date: string
  shelf_life_months: number
  bmr_no: string | null
  bmr_requested_at: string | null
  number_checked_at: string | null
  bmr_issued_at: string | null
  room_ready: boolean
  equipment_ready: boolean
  scales_checked: boolean
  materials_ready: boolean
  qa_line_clearance: boolean
  checklist_updated_at: string | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  notes: string | null
  created_at: string
}

export interface ProductionBatchesResponse {
  batches: ProductionBatchItem[]
}

// --- Electronic BMR template constructor (СОП-11) --------------------------
export interface BmrSectionItem {
  id?: string
  ordinal?: number
  section_type: string
  title: string
  config: { fields?: BmrFieldDef[]; note?: string }
}

export interface BmrFieldDef {
  label: string
  type: string // text|number|checkbox|select|datetime|signature_operator|signature_qa|calc
  unit?: string | null
  required?: boolean
}

export interface BmrTemplateListItem {
  id: string
  product_id: string
  product_code: string | null
  product_name: string | null
  market_code: string | null
  title: string
  version: number
  status: string
  effective_date: string | null
  sections_count: number
  updated_at: string
}

export interface BmrTemplateItem {
  id: string
  product_id: string
  product_code: string | null
  product_name: string | null
  market_code: string | null
  title: string
  version: number
  status: string
  effective_date: string | null
  notes: string | null
  created_by: string
  approved_by: string | null
  approved_at: string | null
  sections: BmrSectionItem[]
}

export interface BmrTemplatesResponse {
  templates: BmrTemplateListItem[]
}

export interface BmrTemplateInput {
  product_id: string
  title: string
  notes?: string | null
  sections: { section_type: string; title: string; config: Record<string, unknown> }[]
}

export interface BmrQueueItem {
  id: string
  batch_no: string
  product_code: string
  product_name: string
  dosage_form: string | null
  batch_size: number
  batch_size_unit: string
  production_date: string
  expiry_date: string
  bmr_requested_at: string
  requested_by_name: string | null
}

export interface BmrQueueResponse {
  items: BmrQueueItem[]
}

export interface ProductionBatchAuditItem {
  id: string
  action_type: string
  user_name: string | null
  role_code: string | null
  reason: string | null
  created_at: string
}

export interface ProductionBatchAuditResponse {
  events: ProductionBatchAuditItem[]
}

export interface ProductionBatchPreviewRequest {
  product_id: string
  production_date: string
  shelf_life_months: number
}

export interface ProductionBatchPreview {
  batch_no: string
  serial_no: number
  expiry_date: string
}

export interface ProductionBatchCreate {
  product_id: string
  production_date: string
  shelf_life_months: number
  product_name?: string | null
  dosage_form?: string | null
  batch_size: number
  batch_size_unit: string
  notes?: string | null
  batch_no_override?: string | null
  override_reason?: string | null
  as_draft?: boolean
}

export interface ProductionBatchCancelRequest extends SignatureRequest {
  reason?: string
}

export interface ProductionBatchChecklistUpdate {
  room_ready: boolean
  equipment_ready: boolean
  scales_checked: boolean
  materials_ready: boolean
  qa_line_clearance: boolean
}

export interface ProductionBatchBmrIssueRequest extends SignatureRequest {
  bmr_no?: string | null
}

export interface ProductionBatchNumberCheckRequest extends SignatureRequest {
  reason?: string
}

export interface ProductionBatchStartRequest extends SignatureRequest {
  reason?: string
}

export interface ProductionBatchCompleteRequest extends SignatureRequest {
  reason?: string
}

// ─── QC reagents / standards registry ───────────────────────────────────────

export interface ReagentItem {
  id: string
  code: string
  name: string
  type: string
  grade: string | null
  manufacturer: string | null
  supplier: string | null
  batch_number: string | null
  internal_batch_number: string
  received_date: string
  opened_date: string | null
  expiry_date_unopened: string
  expiry_date_after_opening_days: number
  status: string
  quantity: number
  unit: string
  storage_location: string | null
  storage_conditions: string | null
  responsible: string | null
  notes: string | null
  effective_expiry_date: string
  days_to_expiry: number
  has_certificate: boolean
}

export interface ReagentMovementItem {
  id: string
  reagent_id: string
  operation_type: string
  quantity_before: number
  quantity_operation: number
  quantity_after: number
  analytical_sheet: string | null
  material_batch: string | null
  reason: string | null
  signature_required: boolean
  performed_by: string | null
  performed_at: string
}

export interface ReagentCertificateItem {
  id: string
  reagent_id: string
  certificate_no: string | null
  note: string | null
  mime_type: string
  file_size: number
  sha256_hash: string
  uploaded_by: string | null
  uploaded_at: string
}

export interface ReagentDetail extends ReagentItem {
  movements: ReagentMovementItem[]
  certificates: ReagentCertificateItem[]
}

export interface ReagentsResponse {
  reagents: ReagentItem[]
}

export interface ReagentCreate {
  code: string
  name: string
  type: string
  grade?: string | null
  manufacturer?: string | null
  supplier?: string | null
  batch_number?: string | null
  internal_batch_number: string
  received_date: string
  opened_date?: string | null
  expiry_date_unopened: string
  expiry_date_after_opening_days: number
  status?: string
  quantity: number
  unit: string
  storage_location?: string | null
  storage_conditions?: string | null
  responsible?: string | null
  notes?: string | null
}

export interface ReagentUpdate extends Partial<ReagentCreate> {
  reason?: string | null
}

export interface ReagentUseRequest extends SignatureRequest {
  quantity: number
  analytical_sheet: string
  material_batch: string
}

export interface ReagentAuditEvent {
  id: string
  created_at: string
  user_id: string
  role_code: string
  workstation_id: string
  action_type: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  reason: string | null
  source: string
}

export interface ReagentAuditResponse {
  events: ReagentAuditEvent[]
}
