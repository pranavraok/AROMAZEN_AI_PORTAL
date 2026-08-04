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
  AdminRole,
  AdminUser,
  AuditEvent,
  Department,
  InvitationResponse,
  InviteUserRequest,
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
  admin: {
    users: (accessToken: string) => apiRequest<AdminUser[]>('/admin/users', { headers: { Authorization: `Bearer ${accessToken}` } }),
    departments: (accessToken: string) => apiRequest<Department[]>('/admin/departments', { headers: { Authorization: `Bearer ${accessToken}` } }),
    createDepartment: (accessToken: string, name: string) => apiRequest<Department>('/admin/departments', { method: 'POST', body: { name }, headers: { Authorization: `Bearer ${accessToken}` } }),
    updateDepartment: (accessToken: string, id: string, name: string) => apiRequest<Department>(`/admin/departments/${id}`, { method: 'PATCH', body: { name }, headers: { Authorization: `Bearer ${accessToken}` } }),
    removeDepartment: (accessToken: string, id: string) => apiRequest<void>(`/admin/departments/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }),
    roles: (accessToken: string) => apiRequest<AdminRole[]>('/admin/roles', { headers: { Authorization: `Bearer ${accessToken}` } }),
    invite: (accessToken: string, payload: InviteUserRequest) => apiRequest<InvitationResponse>('/admin/users/invitations', { method: 'POST', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
    updateUser: (accessToken: string, userId: string, payload: { full_name?: string; phone_number?: string | null; department_id?: string | null; role_ids?: string[]; status?: 'active' | 'disabled' }) => apiRequest<AdminUser>(`/admin/users/${userId}`, { method: 'PATCH', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
    deleteUser: (accessToken: string, userId: string) => apiRequest<void>(`/admin/users/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }),
    auditEvents: (accessToken: string) => apiRequest<AuditEvent[]>('/admin/audit-events', { headers: { Authorization: `Bearer ${accessToken}` } }),
  },
}
