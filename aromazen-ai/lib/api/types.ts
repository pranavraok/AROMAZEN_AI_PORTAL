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
}

export interface SendEmailRequest extends Omit<EmailDraft, 'status' | 'sent_at'> { message_id: string }

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
}

export interface AttendanceShiftRule { name: string; start: string; end: string; grace_minutes: number }
export interface AttendanceGroupSummary { name: string; employee_count: number; scheduled_days: number; present_days: number; absent_days: number; late_days: number; early_leave_days: number; total_hours: number; overtime_hours: number; attendance_rate: number; average_hours: number }
export interface AttendanceEmployeeSummary { employee_code: string; employee_name: string; department: string; primary_shift: string; scheduled_days: number; present_days: number; absent_days: number; weekly_off_days: number; late_days: number; early_leave_days: number; half_days: number; total_hours: number; overtime_hours: number; average_hours: number; attendance_rate: number }
export interface AttendanceRecord { employee_code: string; employee_name: string; department: string; date: string; shift_name: string; first_in: string; last_out: string; worked_hours: number; overtime_hours: number; status_code: string; status: string; assignment_source: string }
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
  total_hours: number
  overtime_hours: number
  status_counts: Record<string, number>
  shift_rules: AttendanceShiftRule[]
  shifts: AttendanceGroupSummary[]
  departments: AttendanceGroupSummary[]
  employees: AttendanceEmployeeSummary[]
  records: AttendanceRecord[]
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
  severity: 'warning' | 'critical'
  created_at: string
}

export interface DocumentTemplate { id: string; name: string; collection_name: string; document_type: 'coa' | 'sds' }
export interface DocumentField { key: string; label: string; required: boolean }
export interface DocumentTemplateSchema { document_type: 'coa' | 'sds'; fields: DocumentField[]; row_fields: string[]; default_rows: Record<string, string>[]; can_edit_filename: boolean }
export interface GeneratedDocument { id: string; filename: string; status: 'draft'; warnings: string[] }
export interface DocumentDraftUpdate { field_updates: Record<string, string>; row_updates: Record<string, string>[]; unassigned_notes: string; provider: string; model: string }

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
  default_ai_provider: 'openai' | 'anthropic'
  session_timeout_minutes: number
  timezone: string
  daily_ai_request_limit: number
  monthly_ai_request_limit: number
  monthly_ai_cost_limit_inr: number
  currency: 'INR'
  usd_to_inr_rate: number
  exchange_rate_source: string
  exchange_rate_updated_at: string
  providers: { key: 'openai' | 'anthropic'; name: string; connected: boolean; models: string[] }[]
  zoho_email_connected: boolean
  storage_bytes: number
  knowledge_documents: number
  generated_documents: number
  max_upload_size_mb: number
  max_excel_upload_size_mb: number
  updated_at: string | null
}
