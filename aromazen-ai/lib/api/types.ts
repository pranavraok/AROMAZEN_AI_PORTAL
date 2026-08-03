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
