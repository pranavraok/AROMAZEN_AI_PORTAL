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
  mode?: 'chat' | 'image'
}

export interface UsageSummary {
  totals: { cost: number; requests: number; input_tokens: number; output_tokens: number }
  providers: { provider: string; model: string; requests: number; input_tokens: number; output_tokens: number; cost: number }[]
  departments: { department: string; requests: number; cost: number }[]
  users: { name: string; department: string; provider: string; model: string; requests: number; cost: number }[]
}

export interface DocumentTemplate { id: string; name: string; collection_name: string; document_type: 'coa' | 'sds' }
export interface DocumentField { key: string; label: string; required: boolean }
export interface DocumentTemplateSchema { document_type: 'coa' | 'sds'; fields: DocumentField[]; row_fields: string[]; default_rows: Record<string, string>[]; can_edit_filename: boolean }
export interface GeneratedDocument { id: string; filename: string; status: 'draft'; warnings: string[] }
export interface DocumentDraftUpdate { field_updates: Record<string, string>; row_updates: Record<string, string>[]; unassigned_notes: string; provider: string; model: string }

export interface DashboardOverview {
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
  providers: { key: 'openai' | 'anthropic'; name: string; connected: boolean; models: string[] }[]
  storage_bytes: number
  knowledge_documents: number
  generated_documents: number
  max_upload_size_mb: number
  updated_at: string | null
}
