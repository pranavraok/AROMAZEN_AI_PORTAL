import { apiFileRequest, apiRequest, apiStreamRequest } from './client'
import type {
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
  AdminKnowledgeCollection,
  AdminKnowledgeDocument,
  UsageSummary,
  DocumentTemplate,
  DocumentTemplateSchema,
  GeneratedDocument,
  DocumentDraftUpdate,
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
    collections: (accessToken: string) => apiRequest<KnowledgeCollection[]>('/knowledge/collections', { headers: { Authorization: `Bearer ${accessToken}` } }),
    documents: (accessToken: string, collectionId: string) => apiRequest<KnowledgeDocument[]>(`/knowledge/collections/${collectionId}/documents`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    processDocument: (accessToken: string, collectionId: string, documentId: string) => apiRequest<{ id: string; status: string; extracted_characters: number }>(`/knowledge/collections/${collectionId}/documents/${documentId}/process`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }),
    documentContentUrl: (collectionId: string, documentId: string) => `/api/v1/knowledge/collections/${collectionId}/documents/${documentId}/content`,
    uploadDocument: (accessToken: string, collectionId: string, file: File) => apiRequest<{ id: string; name: string; status: string; version: number }>(`/knowledge/collections/${collectionId}/documents`, { method: 'POST', body: (() => { const form = new FormData(); form.append('file', file); return form })(), headers: { Authorization: `Bearer ${accessToken}` } }),
  },
  workspace: {
    streamMessage: (accessToken: string, payload: CreateChatMessageRequest) =>
      apiStreamRequest('/workspace/messages/stream', { method: 'POST', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
    usageSummary: (accessToken: string) => apiRequest<UsageSummary>('/workspace/usage/summary', { headers: { Authorization: `Bearer ${accessToken}` } }),
  },
  documentGenerator: {
    templates: (accessToken: string) => apiRequest<DocumentTemplate[]>('/document-generator/templates', { headers: { Authorization: `Bearer ${accessToken}` } }),
    schema: (accessToken: string, templateId: string) => apiRequest<DocumentTemplateSchema>(`/document-generator/templates/${templateId}/schema`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    excelTemplate: (accessToken: string, templateId: string) => apiFileRequest(`/document-generator/templates/${templateId}/excel-template`, accessToken),
    transcribe: (accessToken: string, audio: File) => {
      const form = new FormData(); form.append('audio_file', audio)
      return apiRequest<{ text: string }>('/document-generator/transcribe', { method: 'POST', body: form, headers: { Authorization: `Bearer ${accessToken}` } })
    },
    draftFromNotes: (accessToken: string, payload: { templateId: string; notes: string; currentFields: Record<string, string>; currentRows: Record<string, string>[] }) => apiRequest<DocumentDraftUpdate>('/document-generator/draft-from-notes', { method: 'POST', body: { template_document_id: payload.templateId, notes: payload.notes, current_fields: payload.currentFields, current_rows: payload.currentRows }, headers: { Authorization: `Bearer ${accessToken}` } }),
    generate: (accessToken: string, payload: { templateId: string; documentType: 'coa' | 'sds'; fields: Record<string, string>; rows: Record<string, string>[]; outputFilename?: string; excel?: File | null }) => {
      const form = new FormData(); form.append('template_document_id', payload.templateId); form.append('document_type', payload.documentType); form.append('fields_json', JSON.stringify(payload.fields)); form.append('rows_json', JSON.stringify(payload.rows)); if (payload.outputFilename?.trim()) form.append('output_filename', payload.outputFilename.trim()); if (payload.excel) form.append('excel_file', payload.excel)
      return apiRequest<GeneratedDocument>('/document-generator/generate', { method: 'POST', body: form, headers: { Authorization: `Bearer ${accessToken}` } })
    },
    download: (accessToken: string, generationId: string) => apiFileRequest(`/document-generator/generations/${generationId}/download`, accessToken),
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
    knowledgeCollections: (accessToken: string) => apiRequest<AdminKnowledgeCollection[]>('/admin/knowledge/collections', { headers: { Authorization: `Bearer ${accessToken}` } }),
    createKnowledgeCollection: (accessToken: string, payload: { name: string; description: string | null; is_shared: boolean; department_ids: string[] }) => apiRequest<AdminKnowledgeCollection>('/admin/knowledge/collections', { method: 'POST', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
    updateKnowledgeCollection: (accessToken: string, id: string, payload: { name: string; description: string | null; is_shared: boolean; department_ids: string[] }) => apiRequest<AdminKnowledgeCollection>(`/admin/knowledge/collections/${id}`, { method: 'PATCH', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
    archiveKnowledgeCollection: (accessToken: string, id: string) => apiRequest<AdminKnowledgeCollection>(`/admin/knowledge/collections/${id}/archive`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }),
    knowledgeDocuments: (accessToken: string) => apiRequest<AdminKnowledgeDocument[]>('/admin/knowledge/documents', { headers: { Authorization: `Bearer ${accessToken}` } }),
    deleteKnowledgeDocument: (accessToken: string, id: string) => apiRequest<void>(`/admin/knowledge/documents/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }),
  },
}
