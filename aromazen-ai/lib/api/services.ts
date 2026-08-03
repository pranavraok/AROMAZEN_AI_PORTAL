import { apiRequest } from './client'
import type {
  ChatMessage,
  CreateChatMessageRequest,
  CurrentUser,
  DashboardOverview,
  KnowledgeCollection,
  KnowledgeDocument,
  LoginRequest,
  LoginResponse,
} from './types'

export const api = {
  auth: {
    login: (payload: LoginRequest) => apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: payload }),
    logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
    refresh: () => apiRequest<LoginResponse>('/auth/refresh', { method: 'POST' }),
    me: (accessToken: string) => apiRequest<CurrentUser>('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } }),
  },
  dashboard: {
    overview: () => apiRequest<DashboardOverview>('/dashboard/overview'),
  },
  knowledge: {
    collections: () => apiRequest<KnowledgeCollection[]>('/knowledge/collections'),
    documents: () => apiRequest<KnowledgeDocument[]>('/knowledge/documents'),
  },
  workspace: {
    sendMessage: (payload: CreateChatMessageRequest) =>
      apiRequest<ChatMessage>('/workspace/messages', { method: 'POST', body: payload }),
  },
}
