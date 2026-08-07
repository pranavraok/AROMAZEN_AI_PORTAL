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
  UsageNotification,
  DocumentTemplate,
  DocumentTemplateSchema,
  GeneratedDocument,
  DocumentDraftUpdate,
  OrganizationSettings,
  ChatAttachment,
  ChatConversation,
  ChatMessage,
  SendEmailRequest,
  PayrollBatch,
  PayrollTemplate,
} from './types'

export const api = {
  auth: {
    login: (payload: LoginRequest) => apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: payload }),
    logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
    refresh: () => apiRequest<LoginResponse>('/auth/refresh', { method: 'POST' }),
    me: (accessToken: string) => apiRequest<CurrentUser>('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } }),
  },
  dashboard: {
    overview: (accessToken: string) => apiRequest<DashboardOverview>('/dashboard/overview', { headers: { Authorization: `Bearer ${accessToken}` } }),
  },
  settings: {
    get: (accessToken: string) => apiRequest<OrganizationSettings>('/settings', { headers: { Authorization: `Bearer ${accessToken}` } }),
    update: (accessToken: string, payload: Pick<OrganizationSettings, 'organization_name' | 'platform_name' | 'theme' | 'default_ai_provider' | 'session_timeout_minutes' | 'timezone' | 'daily_ai_request_limit' | 'monthly_ai_request_limit' | 'monthly_ai_cost_limit_inr'>) => apiRequest<OrganizationSettings>('/settings', { method: 'PUT', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
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
    usageSummary: (accessToken: string, range?: { dateFrom: string; dateTo: string }) => apiRequest<UsageSummary>(`/workspace/usage/summary${range ? `?date_from=${encodeURIComponent(range.dateFrom)}&date_to=${encodeURIComponent(range.dateTo)}` : ''}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    notifications: (accessToken: string) => apiRequest<{ notifications: UsageNotification[]; unread_count: number }>('/workspace/notifications', { headers: { Authorization: `Bearer ${accessToken}` } }),
    conversations: (accessToken: string) => apiRequest<ChatConversation[]>('/workspace/conversations', { headers: { Authorization: `Bearer ${accessToken}` } }),
    messages: (accessToken: string, conversationId: string) => apiRequest<ChatMessage[]>(`/workspace/conversations/${conversationId}/messages`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    renameConversation: (accessToken: string, conversationId: string, title: string) => apiRequest<ChatConversation>(`/workspace/conversations/${conversationId}`, { method: 'PATCH', body: { title }, headers: { Authorization: `Bearer ${accessToken}` } }),
    deleteConversation: (accessToken: string, conversationId: string) => apiRequest<void>(`/workspace/conversations/${conversationId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }),
    sendEmail: (accessToken: string, payload: SendEmailRequest) => apiRequest<{ status: 'sent'; sent_at: string }>('/workspace/email/send', { method: 'POST', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
    uploadAttachment: (accessToken: string, file: File) => apiRequest<ChatAttachment>('/workspace/attachments', { method: 'POST', body: (() => { const form = new FormData(); form.append('file', file); return form })(), headers: { Authorization: `Bearer ${accessToken}` } }),
    attachmentContentUrl: (attachmentId: string) => `/api/v1/workspace/attachments/${attachmentId}/content`,
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
  payroll: {
    template: (accessToken: string) => apiFileRequest('/payroll/template', accessToken),
    templates: (accessToken: string) => apiRequest<PayrollTemplate[]>('/payroll/templates', { headers: { Authorization: `Bearer ${accessToken}` } }),
    uploadTemplate: (accessToken: string, name: string, file: File) => {
      const form = new FormData(); form.append('template_name', name); form.append('template_file', file)
      return apiRequest<PayrollTemplate>('/payroll/templates', { method: 'POST', body: form, headers: { Authorization: `Bearer ${accessToken}` } })
    },
    activateTemplate: (accessToken: string, templateId: string) => apiRequest<PayrollTemplate>(`/payroll/templates/${templateId}/activate`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }),
    templateContent: (accessToken: string, templateId: string) => apiFileRequest(`/payroll/templates/${templateId}/content`, accessToken),
    batches: (accessToken: string) => apiRequest<PayrollBatch[]>('/payroll/batches', { headers: { Authorization: `Bearer ${accessToken}` } }),
    batch: (accessToken: string, batchId: string) => apiRequest<PayrollBatch>(`/payroll/batches/${batchId}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    updateEmail: (accessToken: string, batchId: string, subject: string, body: string) => apiRequest<PayrollBatch>(`/payroll/batches/${batchId}/email`, { method: 'PATCH', body: { subject, body }, headers: { Authorization: `Bearer ${accessToken}` } }),
    upload: (accessToken: string, payrollMonth: string, file: File) => {
      const form = new FormData(); form.append('payroll_month', payrollMonth); form.append('excel_file', file)
      return apiRequest<PayrollBatch>('/payroll/batches', { method: 'POST', body: form, headers: { Authorization: `Bearer ${accessToken}` } })
    },
    send: (accessToken: string, batchId: string) => apiRequest<PayrollBatch>(`/payroll/batches/${batchId}/send`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }),
    retryFailed: (accessToken: string, batchId: string) => apiRequest<PayrollBatch>(`/payroll/batches/${batchId}/retry-failed`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }),
    pdf: (accessToken: string, batchId: string, recipientId: string) => apiFileRequest(`/payroll/batches/${batchId}/recipients/${recipientId}/pdf`, accessToken),
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
