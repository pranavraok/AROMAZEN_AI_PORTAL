export type UserStatus = 'active' | 'invited' | 'disabled'
export type DocumentStatus = 'ready' | 'processing' | 'failed' | 'uploaded'
export type ChatRole = 'user' | 'assistant'

export interface CurrentUser {
  id: string
  email: string
  full_name: string
  department_name: string | null
  role_names: string[]
  permission_keys: string[]
  status: UserStatus
  organization_name: string
  platform_name: string
  theme: 'dark' | 'light' | 'system'
}

export interface LoginRequest {
  email: string
  phone_number?: string | null
  password: string
  remember_me: boolean
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  user: CurrentUser
}

export interface KnowledgeCollection {
  id: string
  slug: string
  name: string
  description: string | null
  document_count: number
  updated_at: string
  is_shared: boolean
  department_names: string[]
  category_counts: Record<string, number>
}

export interface KnowledgeDocument {
  id: string
  name: string
  collection_id: string
  collection_name: string
  uploaded_by_name: string
  status: DocumentStatus
  version: number
  size_bytes: number
  extracted_characters: number
  created_at: string
  processed_at: string | null
  document_category: string | null
  expiry_date: string | null
  reminder_days_before: number
  reminder_owner: string | null
  is_company_wide: boolean
  source_key: string | null
  external_edit_url: string | null
}

export interface ChatCitation {
  document_id: string
  document_name: string
  collection_id: string
  collection_name: string
  page: number | null
  chunk_index: number
  relevance: number | null
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  created_at: string
  citations: ChatCitation[]
  web_sources?: { title: string; url: string }[]
  attachments?: ChatAttachment[]
  artifacts?: ChatArtifacts
}

export interface EmailDraft {
  sender_key?: string
  sender_email?: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  attachment_ids: string[]
  status: 'draft' | 'sent'
  sent_at?: string
}

export interface ChatArtifacts {
  usage?: UsageSummary
  email?: EmailDraft
}

export interface ChatAttachment {
  id: string
  name: string
  mime_type: string
  size_bytes: number
  kind: 'upload' | 'generated'
  status: string
  is_image: boolean
  content_url: string
  preview_url?: string
}

export interface ChatConversation {
  id: string
  title: string
  preview: string
  created_at: string
  updated_at: string
}

export interface CreateChatMessageRequest {
  content: string
  conversation_id?: string | null
  collection_ids: string[]
  attachment_ids?: string[]
  mode?: 'chat' | 'image' | 'email'
  response_mode?: 'auto' | 'quick' | 'standard' | 'deep' | 'essential'
  sender_key?: string
}

export interface SendEmailRequest extends Omit<EmailDraft, 'status' | 'sent_at' | 'sender_email'> { message_id: string }

export interface PayrollRecipient {
  id: string
  row_number: number
  employee_name: string
  employee_code: string
  personal_email: string
  unit: string
  unit_address: string
  password_hint: string
  status: 'pending' | 'sending' | 'sent' | 'failed'
  attempt_count: number
  error_message: string | null
  sent_at: string | null
  gross: string
  deductions: string
  net_wages: string
  template_name: string
}

export interface PayrollBatch {
  id: string
  payroll_month: string
  original_filename: string
  status: 'draft' | 'sending' | 'completed' | 'partial' | 'failed'
  total_count: number
  sent_count: number
  failed_count: number
  pending_count: number
  created_at: string
  completed_at: string | null
  template_name: string
  email_subject: string
  email_body: string
  duplicate_email_count: number
  recipients?: PayrollRecipient[]
}

export interface PayrollTemplate {
  id: string
  name: string
  original_filename: string
  is_active: boolean
  created_at: string
  unit_number: number | null
  source: string
  detected_fields: string[]
  supports_dynamic_fields: boolean
}

export interface HRTemplateField {
  key: string
  label: string
  multiline: boolean
  required: boolean
  default_value: string
}

export interface HRTemplateSalaryRow {
  key: string
  label: string
  columns: ('existing' | 'revised' | 'monthly' | 'annual')[]
}

export interface HRTemplate {
  key: string
  title: string
  short: string
  description: string
  filename: string
  version: number
  source: 'knowledge' | 'built_in'
  uploaded_at: string | null
  supports_dynamic_fields: boolean
  detected_field_count: number
  fields: HRTemplateField[]
  salary_rows: HRTemplateSalaryRow[]
}

export interface HRCustomTemplate {
  id: string
  title: string
  filename: string
  version: number
  uploaded_at: string
  canva_edit_url: string | null
  detected_field_count: number
  fields: HRTemplateField[]
  salary_rows: HRTemplateSalaryRow[]
}

export interface AttendanceShiftRule { name: string; start: string; end: string; grace_minutes: number }
export interface AttendanceGroupSummary { name: string; employee_count: number; scheduled_days: number; present_days: number; absent_days: number; late_days: number; early_leave_days: number; late_penalty_half_days: number; total_hours: number; overtime_hours: number; attendance_rate: number; average_hours: number }
export interface AttendanceEmployeeSummary { employee_code: string; employee_name: string; department: string; primary_shift: string; scheduled_days: number; present_days: number; absent_days: number; weekly_off_days: number; late_days: number; early_leave_days: number; half_days: number; late_penalty_half_days: number; total_hours: number; overtime_hours: number; average_hours: number; attendance_rate: number }
export interface AttendanceRecord { employee_code: string; employee_name: string; department: string; date: string; shift_name: string; first_in: string; last_out: string; worked_hours: number; overtime_hours: number; status_code: string; status: string; late_penalty_half_day: boolean; assignment_source: string }
export interface AttendanceAnalysis {
  filename: string
  period: { from: string; to: string }
  employee_count: number
  record_count: number
  roster_assigned_records: number
  automatic_assigned_records: number
  scheduled_days: number
  present_days: number
  absent_days: number
  weekly_off_days: number
  late_days: number
  early_leave_days: number
  half_days: number
  late_penalty_half_days: number
  total_hours: number
  overtime_hours: number
  status_counts: Record<string, number>
  shift_rules: AttendanceShiftRule[]
  shifts: AttendanceGroupSummary[]
  departments: AttendanceGroupSummary[]
  employees: AttendanceEmployeeSummary[]
  records: AttendanceRecord[]
}

export interface LeaveCalculatorRow {
  row_number: number
  employee_name: string
  employee_code: string
  department: string
  primary_shift: string
  calendar_days: number
  scheduled_days: number | null
  attendance_present_days: number | null
  absent_days: number | null
  half_days: number | null
  late_penalty_half_days: number | null
  weekly_off_days: number | null
  paid_leave_days: number
  calculated_lop: number | null
  lop_override: number | null
  final_lop: number | null
  paid_days: number | null
  ot_hours: number | null
  match_status: 'Matched by employee code' | 'Matched by employee name' | 'Not found in attendance'
}

export interface LeaveCalculatorAnalysis {
  payroll_month: string
  month_label: string
  calendar_days: number
  salary_filename: string
  attendance_filename: string
  employee_count: number
  matched_count: number
  unmatched_count: number
  attendance_only_count: number
  total_calculated_lop: number
  total_late_penalty_half_days: number
  total_paid_days: number
  total_ot_hours: number
  rows: LeaveCalculatorRow[]
  attendance_only: { employee_code: string; employee_name: string; department: string }[]
  shift_rules: AttendanceShiftRule[]
}

export interface UsageSummary {
  currency: 'INR'
  usd_to_inr_rate: number
  exchange_rate_source: string
  exchange_rate_updated_at: string
  range: { date_from: string; date_to: string }
  totals: { cost: number; requests: number; input_tokens: number; output_tokens: number }
  providers: { provider: string; model: string; requests: number; input_tokens: number; output_tokens: number; cost: number }[]
  departments: { department: string; requests: number; cost: number }[]
  users: { name: string; department: string; provider: string; model: string; requests: number; cost: number }[]
  timeseries: { date: string; requests: number; cost: number; tokens: number }[]
}

export interface UsageNotification {
  id: string
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  created_at: string
  kind?: 'usage' | 'document_reminder' | 'asset_maintenance' | 'knowledge_document_added'
  href?: string
  is_read: boolean
  read_at: string | null
}

export type AssetStatus = 'Active' | 'Spare' | 'Under maintenance' | 'Repair needed' | 'Recovery required' | 'Lost' | 'Scrap proposed' | 'Approved for scrap' | 'Scrapped' | 'Disposed'
export type AssetCondition = 'Good' | 'Fair' | 'Poor' | 'Damaged' | 'Obsolete'
export type AssetGroup = 'IT' | 'General'

export interface ITAsset {
  id: string
  source_sn: string | null
  source_register: string | null
  asset_group: AssetGroup
  employee: string | null
  physical_location: string | null
  department_name: string | null
  home_office: string | null
  category: string | null
  brand: string | null
  model: string | null
  serial_imei: string | null
  sim_no: string | null
  ups: string | null
  label_no: string | null
  invoice_date: string | null
  invoice_no: string | null
  supplier_name: string | null
  price: number | null
  warranty: string | null
  custom_fields: Record<string, string>
  status: AssetStatus
  condition: AssetCondition
  notes: string | null
  last_maintenance_date: string | null
  next_maintenance_date: string | null
  maintenance_interval_months: number | null
  maintenance_reminder_days: number
  notification_enabled: boolean
  maintenance_owner: string | null
  maintenance_notes: string | null
  scrap_reason: string | null
  scrap_date: string | null
  scrap_value: number | null
  maintenance_state: 'overdue' | 'due' | 'scheduled' | 'not_scheduled'
  maintenance_days_remaining: number | null
  created_at: string
  updated_at: string
}

export type AssetPayload = Omit<ITAsset, 'id' | 'source_sn' | 'maintenance_state' | 'maintenance_days_remaining' | 'created_at' | 'updated_at'>

export interface AssetSummary {
  total: number
  active: number
  spare: number
  maintenance_due: number
  maintenance_overdue: number
  repair_needed: number
  recovery_required: number
  scrap_queue: number
  scrapped_or_disposed: number
  total_value: number
}

export interface AssetListResponse {
  items: ITAsset[]
  summary: AssetSummary
  categories: string[]
  locations: string[]
  departments: string[]
  registers: string[]
  group_counts: Record<AssetGroup, number>
}

export interface AssetNotificationSettings {
  default_notification_enabled: boolean
  default_reminder_days: number
  default_maintenance_interval_months: number | null
  notify_inventory_admin: boolean
  notify_hr_admin: boolean
  notify_accounts_admin: boolean
  notify_admins: boolean
  apply_to_current_assets: boolean
  updated_at: string | null
}

export interface AssetMaintenanceEvent {
  id: string
  asset_id: string
  service_date: string
  vendor: string | null
  cost: number | null
  notes: string | null
  next_due_date: string | null
  created_at: string
}

export interface DocumentTemplate { id: string; name: string; collection_name: string; document_type: 'coa' | 'sds'; version?: number; source_key?: string | null; external_edit_url?: string | null }
export interface DocumentField { key: string; label: string; required: boolean }
export interface DocumentTemplateSchema { document_type: 'coa' | 'sds'; fields: DocumentField[]; row_fields: string[]; default_rows: Record<string, string>[]; can_edit_filename: boolean }
export interface GeneratedDocument { id: string; filename: string; status: 'draft'; warnings: string[] }
export interface DocumentDraftUpdate { field_updates: Record<string, string>; row_updates: Record<string, string>[]; unassigned_notes: string; provider: string; model: string }

export interface OpenRouterUsage {
  date: string
  used_tokens: number
  daily_limit: number
  remaining_tokens: number
  percentage: number
}

export interface DashboardOverview {
  currency: 'INR'
  usd_to_inr_rate: number
  exchange_rate_source: string
  exchange_rate_updated_at: string
  role_key: 'owner' | 'super_admin' | 'department_admin' | 'employee'
  role_label: 'Super Admin' | 'Admin' | 'Department Admin' | 'Employee'
  scope: 'platform' | 'organization' | 'department' | 'personal'
  scope_label: string
  capabilities: string[]
  metrics: { key: string; label: string; value: number; format: 'number' | 'currency' }[]
  department_usage: { department: string; requests: number; cost: number }[]
  recent_documents: { id: string; name: string; collection: string; uploader: string; status: DocumentStatus; version: number; created_at: string }[]
  recent_activity: { id: string; actor: string; action: string; department: string; created_at: string }[]
  hr_action_center: {
    due_reminders: number
    overdue_documents: number
    rule_documents: number
    open_payroll_batches: number
    items: { key: string; title: string; description: string; href: string; tone: 'default' | 'primary' | 'warning' | 'danger' | 'disabled'; count: number | null }[]
  } | null
  refreshed_at: string
}

export interface Department {
  id: string
  name: string
  slug: string
}

export interface AdminRole {
  id: string
  key: string
  name: string
  description: string | null
  permission_keys: string[]
}

export interface AdminUser {
  id: string
  full_name: string
  email: string
  phone_number: string | null
  status: UserStatus
  department: Department | null
  roles: AdminRole[]
  last_login_at: string | null
  created_at: string
}

export interface AuditEvent {
  id: string
  action: string
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface AdminKnowledgeCollection {
  id: string
  name: string
  slug: string
  description: string | null
  is_shared: boolean
  status: 'active' | 'archived'
  department_ids: string[]
  department_names: string[]
  document_count: number
  created_at: string
}

export interface AdminKnowledgeDocument {
  id: string
  collection_id: string
  collection_name: string
  name: string
  status: DocumentStatus
  size_bytes: number
  extracted_characters: number
  version: number
  created_at: string
}

export interface InviteUserRequest {
  full_name: string
  email: string
  phone_number: string | null
  department_id: string | null
  role_ids: string[]
}

export interface InvitationResponse {
  user: AdminUser
  invitation_token: string
  expires_at: string
}

export interface OrganizationSettings {
  organization_name: string
  platform_name: string
  theme: 'dark' | 'light' | 'system'
  default_ai_provider: 'auto' | 'openai' | 'anthropic'
  session_timeout_minutes: number
  timezone: string
  daily_ai_request_limit: number
  monthly_ai_request_limit: number
  monthly_ai_cost_limit_inr: number
  currency: 'INR'
  usd_to_inr_rate: number
  exchange_rate_source: string
  exchange_rate_updated_at: string
  providers: { key: 'auto' | 'openai' | 'anthropic'; name: string; connected: boolean; models: string[] }[]
  zoho_email_connected: boolean
  email_mailboxes: EmailMailboxStatus[]
  storage_bytes: number
  knowledge_documents: number
  generated_documents: number
  max_upload_size_mb: number
  max_excel_upload_size_mb: number
  updated_at: string | null
}

export interface EmailMailboxStatus {
  key: string
  department_slug: string
  department_name: string
  email: string
}

export type GstReconciliationStatus = 'matched' | 'mismatch' | 'books_only' | 'portal_only' | 'incomplete_books' | 'duplicate'

export interface GstReconciliationRow {
  id: string
  status: GstReconciliationStatus
  issues: string[]
  supplier: string
  gstin: string
  invoice_number: string
  books_source: string
  books_row: string
  books_date: string | null
  portal_date: string | null
  books_invoice_value: number | null
  portal_invoice_value: number | null
  difference: number | null
  portal_taxable_value: number | null
  igst: number | null
  cgst: number | null
  sgst: number | null
  cess: number | null
  itc_availability: string
  portal_reason: string
}

export interface GstReconciliationResult {
  period: string
  company_gstin: string
  company_name: string
  summary: {
    book_invoices: number
    portal_invoices: number
    matched: number
    mismatched: number
    books_only: number
    portal_only: number
    incomplete_books: number
    duplicates: number
    portal_credit_notes: number
    portal_imports: number
    book_invoice_value: number
    portal_invoice_value: number
  }
  rows: GstReconciliationRow[]
  warnings: string[]
  ignored_non_invoice_rows: number
  amount_tolerance: number
}

export type RegulatoryDocumentType = 'sds' | 'ifra_certificate' | 'ifra_amendment' | 'allergen_report' | 'reach_declaration'
export interface RegulatorySourceCheck {
  status: 'matched' | 'listed' | 'not_listed' | 'not_found' | 'unavailable'
  source: string
  checked_at: string
  details?: string
}
export interface RegulatoryIngredient {
  name: string; canonical_name?: string; concentration: string; cas: string; ec: string; classification: string
  hazard_statements?: string; precautionary_statements?: string; signal_word?: string; pictograms?: string
  toxicology?: string; ecology?: string; transport?: string; allergen_identity?: string; svhc_identity?: string; ifra_limits?: string
  aliases?: string[]; sources?: string[]; source_checks?: Record<string, RegulatorySourceCheck>; source_versions?: Record<string, string | number>
  provenance?: 'excel' | 'official_database' | 'approved_master' | 'ai_suggested' | 'employee_approved'
}
export interface RegulatoryWorkflow {
  id: string; product_name: string; product_code: string; market: 'other' | 'eu'; status: 'review' | 'approved'
  source_files: Record<string, string>; sds_fields: Record<string, string>; ingredients: RegulatoryIngredient[]
  generated: Partial<Record<RegulatoryDocumentType, string>>; approved_at: string | null
  intake_warnings?: { code: string; message: string }[]
  research_summary?: { mode: 'official' | 'ai'; attempted: number; populated: number; unresolved: number; failed: number; cached: number; ai_requests: number }
}
export interface RegulatoryTemplate { id: string; document_type: RegulatoryDocumentType; name: string; version: number }
