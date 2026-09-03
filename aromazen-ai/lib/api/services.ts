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
  HRTemplate,
  AttendanceAnalysis,
  AttendanceShiftRule,
  LeaveCalculatorAnalysis,
  AssetListResponse,
  AssetPayload,
  ITAsset,
  AssetMaintenanceEvent,
  AssetNotificationSettings,
  GstReconciliationResult,
  OpenRouterUsage,
} from './types'

export const api = {
  gstReconciliation: {
    analyze: (accessToken: string, payload: { purchaseRegister: File; journalRegister: File; gstr2bPortal: File }) => {
      const form = new FormData()
      form.append('purchase_register', payload.purchaseRegister)
      form.append('journal_register', payload.journalRegister)
      form.append('gstr2b_portal', payload.gstr2bPortal)
      return apiRequest<GstReconciliationResult>('/gst-reconciliation/analyze', { method: 'POST', body: form, headers: { Authorization: `Bearer ${accessToken}` } })
    },
  },
  cashFlow: {
    cashFlowTemplate: (accessToken: string) => apiFileRequest('/cash-flow/templates/cash-flow', accessToken),
    fixedAssetsTemplate: (accessToken: string) => apiFileRequest('/cash-flow/templates/fixed-assets', accessToken),
    generate: (accessToken: string, payload: { reportMonth: string; password: string; bob: File; axis: File; indusind: File; cashFlow: File; fixedAssets?: File | null; includePreviousComparison: boolean }) => {
      const form = new FormData()
      form.append('report_month', payload.reportMonth); form.append('pdf_password', payload.password); form.append('include_previous_comparison', String(payload.includePreviousComparison))
      form.append('bob_statement', payload.bob); form.append('axis_statement', payload.axis); form.append('indusind_statement', payload.indusind)
      form.append('cash_flow_excel', payload.cashFlow); if (payload.fixedAssets) form.append('fixed_assets_excel', payload.fixedAssets)
      return apiFileRequest('/cash-flow/generate', accessToken, { method: 'POST', body: form })
    },
  },
  auth: {
    login: (payload: LoginRequest) => apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: payload }),
    logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
    refresh: () => apiRequest<LoginResponse>('/auth/refresh', { method: 'POST' }),
    me: (accessToken: string) => apiRequest<CurrentUser>('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } }),
    forgotPassword: (email: string) => apiRequest<{ detail: string }>('/auth/forgot-password', { method: 'POST', body: { email } }),
    verifyOtp: (email: string, otpCode: string) => apiRequest<{ detail: string }>('/auth/verify-otp', { method: 'POST', body: { email, otp_code: otpCode } }),
    resetPassword: (email: string, otpCode: string, newPassword: string) => apiRequest<{ detail: string }>('/auth/reset-password', { method: 'POST', body: { email, otp_code: otpCode, new_password: newPassword } }),
  },
  dashboard: {
    overview: (accessToken: string) => apiRequest<DashboardOverview>('/dashboard/overview', { headers: { Authorization: `Bearer ${accessToken}` } }),
  },
  assets: {
    list: (accessToken: string, filters: { search?: string; status?: string; category?: string; location?: string; department?: string; register?: string; assetGroup?: string; attentionOnly?: boolean } = {}) => {
      const query = new URLSearchParams()
      if (filters.search) query.set('search', filters.search)
      if (filters.status && filters.status !== 'All') query.set('status', filters.status)
      if (filters.category && filters.category !== 'All') query.set('category', filters.category)
      if (filters.location && filters.location !== 'All') query.set('location', filters.location)
      if (filters.department && filters.department !== 'All') query.set('department', filters.department)
      if (filters.register && filters.register !== 'All') query.set('register', filters.register)
      if (filters.assetGroup) query.set('asset_group', filters.assetGroup)
      if (filters.attentionOnly) query.set('attention_only', 'true')
      return apiRequest<AssetListResponse>(`/assets${query.size ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    },
    create: (accessToken: string, payload: AssetPayload) => apiRequest<ITAsset>('/assets', { method: 'POST', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
    update: (accessToken: string, id: string, payload: Partial<AssetPayload>) => apiRequest<ITAsset>(`/assets/${id}`, { method: 'PATCH', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
    remove: (accessToken: string, id: string) => apiRequest<void>(`/assets/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }),
    recordMaintenance: (accessToken: string, id: string, payload: { service_date: string; vendor?: string | null; cost?: number | null; notes?: string | null; next_due_date?: string | null }) => apiRequest<ITAsset>(`/assets/${id}/maintenance`, { method: 'POST', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
    maintenanceHistory: (accessToken: string, id: string) => apiRequest<AssetMaintenanceEvent[]>(`/assets/${id}/maintenance`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    importRegister: (accessToken: string, file: File) => { const form = new FormData(); form.append('file', file); return apiRequest<{ created: number; updated: number; total_rows: number }>('/assets/import', { method: 'POST', body: form, headers: { Authorization: `Bearer ${accessToken}` } }) },
    exportRegister: (accessToken: string, assetGroup?: string) => apiFileRequest(`/assets/export/register${assetGroup ? `?asset_group=${encodeURIComponent(assetGroup)}` : ''}`, accessToken),
    notificationSettings: (accessToken: string) => apiRequest<AssetNotificationSettings>('/assets/notification-settings', { headers: { Authorization: `Bearer ${accessToken}` } }),
    updateNotificationSettings: (accessToken: string, payload: Omit<AssetNotificationSettings, 'updated_at'>) => apiRequest<AssetNotificationSettings>('/assets/notification-settings', { method: 'PUT', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
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
    uploadDocument: (accessToken: string, collectionId: string, file: File, reminder?: { document_category?: string; expiry_date?: string; reminder_days_before?: number; reminder_owner?: string; is_company_wide?: boolean }) => apiRequest<KnowledgeDocument>(`/knowledge/collections/${collectionId}/documents`, { method: 'POST', body: (() => { const form = new FormData(); form.append('file', file); if (reminder?.document_category) form.append('document_category', reminder.document_category); if (reminder?.expiry_date) form.append('expiry_date', reminder.expiry_date); form.append('reminder_days_before', String(reminder?.reminder_days_before ?? 30)); if (reminder?.reminder_owner) form.append('reminder_owner', reminder.reminder_owner); if (reminder?.is_company_wide) form.append('is_company_wide', 'true'); return form })(), headers: { Authorization: `Bearer ${accessToken}` } }),
    renameDocument: (accessToken: string, collectionId: string, documentId: string, name: string) => apiRequest<KnowledgeDocument>(`/knowledge/collections/${collectionId}/documents/${documentId}/name`, { method: 'PATCH', body: { name }, headers: { Authorization: `Bearer ${accessToken}` } }),
    updateDocumentReminder: (accessToken: string, collectionId: string, documentId: string, reminder: { document_category?: string | null; expiry_date?: string | null; reminder_days_before: number; reminder_owner?: string | null; is_company_wide?: boolean | null }) => apiRequest<KnowledgeDocument>(`/knowledge/collections/${collectionId}/documents/${documentId}/reminder`, { method: 'PATCH', body: reminder, headers: { Authorization: `Bearer ${accessToken}` } }),
    rulesAndReminders: (accessToken: string) => apiRequest<(KnowledgeDocument & { collection_name: string })[]>('/knowledge/rules-and-reminders', { headers: { Authorization: `Bearer ${accessToken}` } }),
  },
  workspace: {
    streamMessage: (accessToken: string, payload: CreateChatMessageRequest, signal?: AbortSignal) =>
      apiStreamRequest('/workspace/messages/stream', { method: 'POST', body: payload, signal, headers: { Authorization: `Bearer ${accessToken}` } }),
    usageSummary: (accessToken: string, range?: { dateFrom: string; dateTo: string }) => apiRequest<UsageSummary>(`/workspace/usage/summary${range ? `?date_from=${encodeURIComponent(range.dateFrom)}&date_to=${encodeURIComponent(range.dateTo)}` : ''}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    notifications: (accessToken: string) => apiRequest<{ notifications: UsageNotification[]; unread_count: number }>('/workspace/notifications', { headers: { Authorization: `Bearer ${accessToken}` } }),
    markNotificationRead: (accessToken: string, notificationId: string) => apiRequest<UsageNotification>(`/workspace/notifications/${notificationId}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}` } }),
    markAllNotificationsRead: (accessToken: string) => apiRequest<{ updated: number }>('/workspace/notifications/read-all', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }),
    conversations: (accessToken: string) => apiRequest<ChatConversation[]>('/workspace/conversations', { headers: { Authorization: `Bearer ${accessToken}` } }),
    messages: (accessToken: string, conversationId: string) => apiRequest<ChatMessage[]>(`/workspace/conversations/${conversationId}/messages`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    editMessage: (accessToken: string, conversationId: string, messageId: string, content: string) => apiRequest<{ id: string; content: string }>(`/workspace/conversations/${conversationId}/messages/${messageId}`, { method: 'PATCH', body: { content }, headers: { Authorization: `Bearer ${accessToken}` } }),
    renameConversation: (accessToken: string, conversationId: string, title: string) => apiRequest<ChatConversation>(`/workspace/conversations/${conversationId}`, { method: 'PATCH', body: { title }, headers: { Authorization: `Bearer ${accessToken}` } }),
    deleteConversation: (accessToken: string, conversationId: string) => apiRequest<void>(`/workspace/conversations/${conversationId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }),
    saveStoppedResponse: (accessToken: string, conversationId: string, content: string) => apiRequest<{ id: string; content: string }>(`/workspace/conversations/${conversationId}/stopped-response`, { method: 'POST', body: { content }, headers: { Authorization: `Bearer ${accessToken}` } }),
    sendEmail: (accessToken: string, payload: SendEmailRequest) => apiRequest<{ status: 'sent'; sent_at: string }>('/workspace/email/send', { method: 'POST', body: payload, headers: { Authorization: `Bearer ${accessToken}` } }),
    uploadAttachment: (accessToken: string, file: File) => apiRequest<ChatAttachment>('/workspace/attachments', { method: 'POST', body: (() => { const form = new FormData(); form.append('file', file); return form })(), headers: { Authorization: `Bearer ${accessToken}` } }),
    openrouterUsage: (accessToken: string) => apiRequest<OpenRouterUsage>('/workspace/openrouter/usage', { headers: { Authorization: `Bearer ${accessToken}` } }),
    attachmentContentUrl: (attachmentId: string) => `/api/v1/workspace/attachments/${attachmentId}/content`,
  },
  documentGenerator: {
    templates: (accessToken: string) => apiRequest<DocumentTemplate[]>('/document-generator/templates', { headers: { Authorization: `Bearer ${accessToken}` } }),
    uploadTemplate: (accessToken: string, documentType: 'coa' | 'sds', file: File) => {
      const form = new FormData(); form.append('document_type', documentType); form.append('template_file', file)
      return apiRequest<DocumentTemplate>('/document-generator/templates', { method: 'POST', body: form, headers: { Authorization: `Bearer ${accessToken}` } })
    },
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
    uploadTemplate: (accessToken: string, file: File) => {
      const form = new FormData(); form.append('template_file', file)
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
    analyzeAttendance: (accessToken: string, file: File, shifts: AttendanceShiftRule[], shiftRoster?: File | null) => {
      const form = new FormData(); form.append('excel_file', file); form.append('shift_rules', JSON.stringify(shifts)); if (shiftRoster) form.append('shift_roster_file', shiftRoster)
      return apiRequest<AttendanceAnalysis>('/payroll/attendance/analyze', { method: 'POST', body: form, headers: { Authorization: `Bearer ${accessToken}` } })
    },
    analyzeLeaves: (accessToken: string, payrollMonth: string, salaryFile: File, attendanceFile: File, shifts: AttendanceShiftRule[], shiftRoster?: File | null) => {
      const form = new FormData(); form.append('payroll_month', payrollMonth); form.append('salary_file', salaryFile); form.append('attendance_file', attendanceFile); form.append('shift_rules', JSON.stringify(shifts)); if (shiftRoster) form.append('shift_roster_file', shiftRoster)
      return apiRequest<LeaveCalculatorAnalysis>('/payroll/leave-calculator/analyze', { method: 'POST', body: form, headers: { Authorization: `Bearer ${accessToken}` } })
    },
    mergeLeaves: (accessToken: string, payrollMonth: string, salaryFile: File, attendanceFile: File, shifts: AttendanceShiftRule[], adjustments: { row_number: number; paid_leave_days: number; lop_override: number | null }[], shiftRoster?: File | null) => {
      const form = new FormData(); form.append('payroll_month', payrollMonth); form.append('salary_file', salaryFile); form.append('attendance_file', attendanceFile); form.append('shift_rules', JSON.stringify(shifts)); form.append('adjustments_json', JSON.stringify(adjustments)); if (shiftRoster) form.append('shift_roster_file', shiftRoster)
      return apiFileRequest('/payroll/leave-calculator/merge', accessToken, { method: 'POST', body: form })
    },
  },
  hrTemplates: {
    list: (accessToken: string) => apiRequest<HRTemplate[]>('/hr-letters/templates', { headers: { Authorization: `Bearer ${accessToken}` } }),
    replace: (accessToken: string, templateKey: string, file: File) => {
      const form = new FormData(); form.append('template_file', file)
      return apiRequest<HRTemplate>(`/hr-letters/templates/${templateKey}`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${accessToken}` } })
    },
    content: (accessToken: string, templateKey: string) => apiFileRequest(`/hr-letters/templates/${templateKey}/content`, accessToken),
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
    deleteKnowledgeCollection: (accessToken: string, id: string) => apiRequest<void>(`/admin/knowledge/collections/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }),
    knowledgeDocuments: (accessToken: string) => apiRequest<AdminKnowledgeDocument[]>('/admin/knowledge/documents', { headers: { Authorization: `Bearer ${accessToken}` } }),
    deleteKnowledgeDocument: (accessToken: string, id: string) => apiRequest<void>(`/admin/knowledge/documents/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }),
  },
}
