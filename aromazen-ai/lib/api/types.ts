export type UserStatus = 'active' | 'invited' | 'disabled'
export type DocumentStatus = 'indexed' | 'processing' | 'failed'
export type ChatRole = 'user' | 'assistant'

export interface CurrentUser {
  id: string
  email: string
  full_name: string
  department_name: string | null
  role_names: string[]
  permission_keys: string[]
  status: UserStatus
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
}

export interface KnowledgeDocument {
  id: string
  name: string
  collection_id: string
  collection_name: string
  uploaded_by_name: string
  status: DocumentStatus
  version: number
  created_at: string
}

export interface ChatCitation {
  document_id: string
  document_name: string
  collection_name: string
  page: number | null
  relevance: number | null
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  created_at: string
  citations: ChatCitation[]
}

export interface CreateChatMessageRequest {
  content: string
  collection_ids: string[]
}

export interface DashboardOverview {
  ai_cost_today: number
  documents_indexed: number
  active_users: number
  ai_requests_this_month: number
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
