'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, LockKeyhole, Mail, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppLayout } from '@/components/layouts/app-layout'
import { ChatMessage } from '@/components/workspace/chat-message'
import { ChatComposer } from '@/components/workspace/chat-composer'
import { PromptSuggestions } from '@/components/workspace/prompt-suggestions'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import type { ChatAttachment, ChatCitation, ChatMessage as ChatMessageDto, CurrentUser, EmailDraft, UsageSummary } from '@/lib/api/types'
import { ApiError } from '@/lib/api/client'
import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'

type Suggestion = { icon: string; text: string; description?: string; href?: string; mode?: 'chat' | 'image' | 'email' }
type WebSource = { title: string; url: string }
type WorkspaceMessage = ChatMessageDto & { web_sources?: WebSource[]; attachments?: ChatAttachment[] }
type StreamPayload = { conversation_id?: string; message_id?: string; message?: string; text?: string; citations?: ChatCitation[]; sources?: WebSource[]; code?: string; attachment?: ChatAttachment; usage?: UsageSummary; email?: EmailDraft; used_tokens?: number; daily_limit?: number }
type ResponseMode = 'auto' | 'quick' | 'standard' | 'deep' | 'essential'
type PendingRequest = { content: string; conversationId: string | null; collectionIds: string[]; attachmentIds: string[]; mode: 'chat' | 'image' | 'email'; responseMode: ResponseMode; startedAt: number }
type SendOptions = { resume?: boolean; conversationOverride?: string | null; collectionIdsOverride?: string[] }

function suggestionsFor(user: CurrentUser | null): Suggestion[] {
  if (!user) return []
  const permissions = new Set(user.permission_keys)
  const isPlatformAdmin = permissions.has('settings.manage') || user.role_names.some((role) => role === 'Super Admin' || role === 'Admin')
  const department = user.department_name ?? ''
  if (department === 'R&D') return [
    { icon: 'FileOutput', text: 'Smart COA/SDS Creation', description: 'Create a polished COA or SDS through a short guided workflow.', href: '/rnd/documents' },
    { icon: 'FlaskConical', text: 'Formulation and Batch Sheet', description: 'Build a structured formula, quantities, process and batch record.', href: '/department-tools/rnd-formulation' },
    { icon: 'Scale', text: 'Raw Material Evaluation Report', description: 'Evaluate a raw material against technical, quality and supplier requirements.', href: '/department-tools/rnd-raw-material' },
    { icon: 'BookOpenCheck', text: "SOP's to be Followed", description: 'Find and open approved procedures from the R&D knowledge collection.', href: '/department-tools/rnd-sops' },
  ]
  if (department === 'HR' || department === 'Human Resources') return [
    { icon: 'Attendance', text: 'Review monthly attendance', description: 'Upload fingerprint attendance, apply shift rules, and work through exceptions.', href: '/department-tools/hr-attendance' },
    { icon: 'ListChecks', text: 'Calculate leave and LOP', description: 'Merge attendance with the salary workbook and prepare payroll-ready data.', href: '/hr/leave-calculator' },
    { icon: 'FileOutput', text: 'Create an HR letter', description: 'Prepare approved offer, appointment, appreciation, or increment letters.', href: '/department-tools/hr-letters' },
    { icon: 'ClipboardList', text: 'Prepare an interview checklist', description: 'Score a candidate and generate the branded interview PDF.', href: '/department-tools/hr-interview' },
    ...(permissions.has('users.manage') ? [
      { icon: 'Payroll', text: 'Prepare salary slips', description: 'Create, review, and send the monthly salary-slip batch.', href: '/hr/salary-slips' },
      { icon: 'Boxes', text: 'Manage company assets', description: 'Track assignments, maintenance, recovery, and scrap decisions.', href: '/hr/assets' },
    ] : []),
  ]
  if (isPlatformAdmin) return [
    { icon: 'BarChart3', text: 'Show overall API usage in a graph', description: 'See real provider, token, request, and cost activity.' },
    { icon: 'Users', text: 'Manage users and access', description: 'Invite employees and review role access.', href: '/admin/users' },
    { icon: 'FileOutput', text: 'R&D AI Draft Assistant', description: 'Create COA and SDS Word documents.', href: '/rnd/documents' },
    { icon: 'BookOpenCheck', text: 'Summarise the company knowledge I can access' },
  ]
  if (permissions.has('users.manage')) return [
    { icon: 'Users', text: 'Manage my department team', description: 'Review employees in your permitted scope.', href: '/admin/users' },
    ...(user.department_name === 'R&D' ? [{ icon: 'FileOutput', text: 'R&D AI Draft Assistant', description: 'Create COA and SDS Word documents.', href: '/rnd/documents' }] : [{ icon: 'BookOpenCheck', text: `Summarise the latest ${user.department_name ?? 'department'} documents` }]),
    { icon: 'ListChecks', text: `Create a weekly action plan for ${user.department_name ?? 'my department'}` },
    { icon: 'Mail', text: 'Draft a clear update for my department team', mode: 'email' },
  ]
  if (department === 'Production') return [
    { icon: 'ClipboardList', text: 'Find the production SOP for batch mixing' },
    { icon: 'ListChecks', text: 'Create a production quality checklist' },
    { icon: 'Mail', text: 'Draft a professional shift handover note', mode: 'email' },
    { icon: 'BookOpenCheck', text: 'Summarise the production documents I can access' },
  ]
  if (department === 'Accounts') return [
    { icon: 'ListChecks', text: 'Create a monthly accounts closing checklist' },
    { icon: 'FileText', text: 'Summarise a financial report I attach' },
    { icon: 'Mail', text: 'Draft a professional accounts communication', mode: 'email' },
    { icon: 'BookOpenCheck', text: 'Summarise the accounts documents I can access' },
  ]
  if (department === 'Marketing') return [
    { icon: 'Megaphone', text: 'Create a fragrance campaign brief' },
    { icon: 'Image', text: 'Create a premium fragrance product image', mode: 'image' },
    { icon: 'Sparkles', text: 'Create a product brochure outline' },
    { icon: 'BookOpenCheck', text: 'Summarise the marketing assets I can access' },
  ]
  if (department === 'Graphics') return [
    { icon: 'Image', text: 'Create a premium fragrance product image', mode: 'image' },
    { icon: 'Sparkles', text: 'Develop a visual identity concept' },
    { icon: 'FileText', text: 'Create a production-ready design brief' },
    { icon: 'BookOpenCheck', text: 'Summarise the AI Labs and Graphics resources I can access' },
  ]
  if (department === 'Inventory' || department === 'Sourcing') return [
    { icon: 'Boxes', text: 'Create an inventory review checklist' },
    { icon: 'Scale', text: 'Compare two suppliers or raw materials' },
    { icon: 'Mail', text: 'Draft a professional vendor enquiry', mode: 'email' },
    { icon: 'BookOpenCheck', text: 'Summarise the SOPs I can access' },
  ]
  if (department === 'AI Labs') return [
    { icon: 'FlaskConical', text: 'Create a structured AI research brief' },
    { icon: 'Scale', text: 'Compare two automation approaches' },
    { icon: 'ListChecks', text: 'Create an AI experiment plan and checklist' },
    { icon: 'BookOpenCheck', text: 'Summarise the AI Labs and Graphics resources I can access' },
  ]
  if (department === 'Creation Labs') return [
    { icon: 'FlaskConical', text: 'Create a structured research brief' },
    { icon: 'Scale', text: 'Compare two fragrance concepts' },
    { icon: 'ListChecks', text: 'Create an experiment plan and checklist' },
    { icon: 'BookOpenCheck', text: 'Summarise the research documents I can access' },
  ]
  return [
    { icon: 'BookOpenCheck', text: 'Summarise the documents I can access' },
    { icon: 'Mail', text: 'Draft a professional email', mode: 'email' },
    { icon: 'ListChecks', text: 'Create a clear action plan' },
    { icon: 'Sparkles', text: 'Help me analyse an idea' },
  ]
}

async function readEventStream(response: Response, onEvent: (event: string, payload: StreamPayload) => void) {
  if (!response.body) throw new Error('Streaming is not supported by this browser.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      let event = 'message'
      const data: string[] = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) data.push(line.slice(5).trim())
      }
      if (data.length) onEvent(event, JSON.parse(data.join('\n')) as StreamPayload)
    }
    if (done) break
  }
}

function WorkspaceContent() {
  const { accessToken, user } = useAuth()
  const { notify } = useToast()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [messages, setMessages] = useState<WorkspaceMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isLoadingChat, setIsLoadingChat] = useState(false)
  const [stageDetail, setStage] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [pendingEmail, setPendingEmail] = useState<{ messageId: string; draft: EmailDraft } | null>(null)
  const [sendingEmail, setSendingEmail] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeAssistantIdRef = useRef<string | null>(null)
  const activeAnswerRef = useRef('')
  const activeConversationRef = useRef<string | null>(null)
  const requestStartedAtRef = useRef(0)
  const stoppedRef = useRef(false)
  const recoveryAttemptedRef = useRef(false)
  const suggestions = suggestionsFor(user)
  const firstName = user?.full_name?.split(/\s+/)[0] ?? 'there'
  const pendingKey = user ? `aromazen:pending-ai:${user.id}` : ''
  const progressMessages = ['Understanding your request', 'Planning a thorough answer', 'Checking the most relevant information', 'Reading and organizing the details', 'Verifying completeness and accuracy', 'Still working carefully on this detailed request']
  const progressIndex = Math.min(progressMessages.length - 1, Math.floor(elapsedSeconds / 10))
  const stage = isSending ? `${stageDetail || progressMessages[progressIndex]} · ${elapsedSeconds}s` : null

  useEffect(() => {
    if (!isSending) { setElapsedSeconds(0); return }
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - requestStartedAtRef.current) / 1000)))
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer)
  }, [isSending])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: isSending ? 'smooth' : 'auto', block: 'end' }) }, [isSending, messages, stage])
  async function withImagePreview(attachment: ChatAttachment): Promise<ChatAttachment> {
    if (!accessToken || !attachment.is_image) return attachment
    try {
      const response = await fetch(api.workspace.attachmentContentUrl(attachment.id), { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) return attachment
      return { ...attachment, preview_url: URL.createObjectURL(await response.blob()) }
    } catch { return attachment }
  }

  async function loadConversation(conversationIdToLoad: string): Promise<WorkspaceMessage[] | null> {
    if (!accessToken || isSending) return null
    setIsLoadingChat(true)
    try {
      const storedMessages = await api.workspace.messages(accessToken, conversationIdToLoad)
      const hydrated = await Promise.all(storedMessages.map(async (message) => ({ ...message, attachments: await Promise.all((message.attachments ?? []).map(withImagePreview)) })))
      setMessages(hydrated)
      setConversationId(conversationIdToLoad)
      return hydrated
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to open this chat.'); return null }
    finally { setIsLoadingChat(false) }
  }

  const newChat = useCallback(() => {
    if (isSending) return
    setConversationId(null)
    setMessages([])
    setStage(null)
  }, [isSending])

  useEffect(() => {
    const requestedConversation = searchParams.get('conversation')
    if (searchParams.get('new')) { newChat(); return }
    if (requestedConversation && requestedConversation !== conversationId) void loadConversation(requestedConversation)
    // Search parameters intentionally drive workspace navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, searchParams])

  useEffect(() => {
    const handleDeleted = (event: Event) => { if ((event as CustomEvent<string>).detail === conversationId) newChat() }
    window.addEventListener('aromazen:conversation-deleted', handleDeleted)
    return () => window.removeEventListener('aromazen:conversation-deleted', handleDeleted)
  }, [conversationId, newChat])

  function openCitation(citation: { documentId: string; collectionId: string; name: string; page?: number }) {
    const params = new URLSearchParams({ collectionId: citation.collectionId, documentId: citation.documentId, name: citation.name })
    if (citation.page) params.set('page', String(citation.page))
    params.set('returnTo', conversationId ? `/workspace?conversation=${conversationId}` : '/workspace')
    router.push(`/knowledge/viewer?${params.toString()}`)
  }

  function openAttachment(attachment: ChatAttachment) {
    const params = new URLSearchParams({ attachmentId: attachment.id, name: attachment.name })
    params.set('returnTo', conversationId ? `/workspace?conversation=${conversationId}` : '/workspace')
    router.push(`/knowledge/viewer?${params.toString()}`)
  }

  async function uploadAttachment(file: File): Promise<ChatAttachment | null> {
    if (!accessToken) return null
    try { return await withImagePreview(await api.workspace.uploadAttachment(accessToken, file)) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : `Unable to upload ${file.name}.`); return null }
  }

  async function editMessage(messageId: string, revisedContent: string): Promise<boolean> {
    if (!accessToken || !conversationId || isSending) return false
    try {
      await api.workspace.editMessage(accessToken, conversationId, messageId, revisedContent)
      setMessages((current) => {
        const editedIndex = current.findIndex((message) => message.id === messageId)
        if (editedIndex < 0) return current
        return current.slice(0, editedIndex + 1).map((message, index) => index === editedIndex ? { ...message, content: revisedContent } : message)
      })
      return await sendMessage(revisedContent, [], 'chat', 'quick', { resume: true, conversationOverride: conversationId })
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to edit and regenerate this prompt.')
      return false
    }
  }

  async function confirmEmailSend() {
    if (!accessToken || !pendingEmail || sendingEmail) return
    setSendingEmail(true)
    try {
      const result = await api.workspace.sendEmail(accessToken, { message_id: pendingEmail.messageId, ...pendingEmail.draft })
      setMessages((current) => current.map((message) => message.id === pendingEmail.messageId ? { ...message, artifacts: { ...(message.artifacts ?? {}), email: { ...pendingEmail.draft, status: 'sent', sent_at: result.sent_at } } } : message))
      setPendingEmail(null)
      notify('success', 'Email sent successfully through Zoho Mail.')
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to send this email through Zoho Mail.') }
    finally { setSendingEmail(false) }
  }

  async function sendMessage(content: string, attachments: ChatAttachment[] = [], mode: 'chat' | 'image' | 'email' = 'chat', responseMode: ResponseMode = 'quick', options: SendOptions = {}): Promise<boolean> {
    if (!accessToken || isSending) return false
    const controller = new AbortController()
    abortControllerRef.current = controller
    stoppedRef.current = false
    activeAnswerRef.current = ''
    // Timestamp is captured in this user-triggered event, never during render.
    // eslint-disable-next-line react-hooks/purity
    requestStartedAtRef.current = Date.now()
    setIsSending(true)
    setStage(mode === 'image' ? 'Creating your image...' : mode === 'email' ? 'Preparing email draft...' : attachments.length ? 'Reading attached files...' : 'Preparing answer...')
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    activeAssistantIdRef.current = assistantId
    const createdAt = new Date().toISOString()
    setMessages((current) => [...current, ...(options.resume ? [] : [{ id: userId, role: 'user' as const, content, created_at: createdAt, citations: [], attachments }]), { id: assistantId, role: 'assistant', content: '', created_at: createdAt, citations: [], attachments: [] }])
    let accepted = false
    try {
      const collectionIds = options.collectionIdsOverride ?? []
      const requestConversationId = options.conversationOverride ?? conversationId
      activeConversationRef.current = requestConversationId
      // Timestamp is captured while handling a send, never during render.
      // eslint-disable-next-line react-hooks/purity
      const pendingRequest: PendingRequest = { content, conversationId: requestConversationId, collectionIds, attachmentIds: attachments.map((attachment) => attachment.id), mode, responseMode, startedAt: Date.now() }
      if (pendingKey) localStorage.setItem(pendingKey, JSON.stringify(pendingRequest))
      const response = await api.workspace.streamMessage(accessToken, { content, conversation_id: requestConversationId, collection_ids: collectionIds, attachment_ids: pendingRequest.attachmentIds, mode, response_mode: responseMode }, controller.signal)
      accepted = true
      await readEventStream(response, (event, payload) => {
        if (event === 'start' && payload.conversation_id) {
          setConversationId(payload.conversation_id)
          activeConversationRef.current = payload.conversation_id
          if (pendingKey) localStorage.setItem(pendingKey, JSON.stringify({ ...pendingRequest, conversationId: payload.conversation_id }))
          router.replace(`/workspace?conversation=${payload.conversation_id}`, { scroll: false })
          window.dispatchEvent(new Event('aromazen:conversations-updated'))
        }
        if (event === 'status' && payload.message) setStage(payload.message)
        if (event === 'citations' && payload.citations) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, citations: payload.citations ?? [] } : message))
        if (event === 'web_sources' && payload.sources) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, web_sources: payload.sources ?? [] } : message))
        if (event === 'usage_chart' && payload.usage) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, artifacts: { ...(message.artifacts ?? {}), usage: payload.usage } } : message))
        if (event === 'email_draft' && payload.email) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, artifacts: { ...(message.artifacts ?? {}), email: payload.email } } : message))
        if (event === 'delta' && payload.text) { activeAnswerRef.current += payload.text; setStage('Writing the answer...'); setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + payload.text } : message)) }
        if (event === 'generated_image' && payload.attachment) {
          const generated = payload.attachment
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, attachments: [...(message.attachments ?? []), generated] } : message))
          void withImagePreview(generated).then((image) => setMessages((current) => current.map((message) => ({ ...message, attachments: (message.attachments ?? []).map((attachment) => attachment.id === image.id ? image : attachment) }))))
        }
        if (event === 'done' && payload.message_id) { if (pendingKey) localStorage.removeItem(pendingKey); setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, id: payload.message_id ?? message.id } : message)); window.dispatchEvent(new Event('aromazen:conversations-updated')) }
        if (event === 'error') throw new ApiError(payload.message ?? 'The answer could not be completed.', 502, payload)
      })
      return true
    } catch (error) {
      if (controller.signal.aborted || stoppedRef.current) return accepted
      notify('error', error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Unable to send this message. Please try again.')
      if (pendingKey) localStorage.removeItem(pendingKey)
      if (!accepted) setMessages((current) => current.filter((message) => message.id !== userId && message.id !== assistantId))
      else setMessages((current) => current.map((message) => message.id === assistantId && !message.content ? { ...message, content: 'I could not complete that request. Please try again.' } : message))
      return accepted
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setStage(null)
      setIsSending(false)
    }
  }

  async function stopGenerating() {
    if (!isSending) return
    stoppedRef.current = true
    abortControllerRef.current?.abort()
    setStage('Stopping response...')
    const assistantId = activeAssistantIdRef.current
    const activeConversation = activeConversationRef.current
    const partial = activeAnswerRef.current.trim()
    if (pendingKey) localStorage.removeItem(pendingKey)
    try {
      if (accessToken && activeConversation) {
        const saved = await api.workspace.saveStoppedResponse(accessToken, activeConversation, partial)
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, id: saved.id, content: saved.content } : message))
        window.dispatchEvent(new Event('aromazen:conversations-updated'))
      } else if (assistantId) {
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: partial || '_Response stopped by user._' } : message))
      }
    } catch {
      if (assistantId) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: partial || '_Response stopped by user._' } : message))
    } finally {
      setStage(null)
      setIsSending(false)
    }
  }

  useEffect(() => {
    if (!accessToken || !pendingKey || recoveryAttemptedRef.current) return
    recoveryAttemptedRef.current = true
    const raw = localStorage.getItem(pendingKey)
    if (!raw) return
    let pending: PendingRequest
    try { pending = JSON.parse(raw) as PendingRequest } catch { localStorage.removeItem(pendingKey); return }
    // Recovery age is evaluated inside an effect, never during render.
    // eslint-disable-next-line react-hooks/purity
    if (!pending.conversationId || Date.now() - pending.startedAt > 30 * 60 * 1000) { localStorage.removeItem(pendingKey); return }
    void (async () => {
      const restored = await loadConversation(pending.conversationId as string)
      if (!restored?.length) return
      const last = restored[restored.length - 1]
      if (last.role === 'assistant') { localStorage.removeItem(pendingKey); return }
      const lastUser = [...restored].reverse().find((message) => message.role === 'user')
      if (!lastUser || lastUser.content !== pending.content) { localStorage.removeItem(pendingKey); return }
      await sendMessage(pending.content, lastUser.attachments ?? [], pending.mode, pending.responseMode ?? 'quick', { resume: true, conversationOverride: pending.conversationId, collectionIdsOverride: pending.collectionIds })
    })()
    // This runs once per signed-in workspace to recover an interrupted request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, pendingKey])

  return <AppLayout><div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
    <div className="flex-1 overflow-y-auto px-4 py-7 md:px-8">{isLoadingChat ? <div className="mx-auto max-w-3xl space-y-4 py-20"><div className="h-4 w-32 animate-pulse rounded bg-muted" /><div className="h-4 w-full animate-pulse rounded bg-muted/80" /><div className="h-4 w-4/5 animate-pulse rounded bg-muted/60" /></div> : messages.length === 0 ? <div className="mx-auto max-w-[760px] space-y-9 pt-8 md:pt-[9vh]"><div className="space-y-4 text-center"><BrandMark size="lg" className="mx-auto" /><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Aromazen AI</p><h1 className="text-3xl font-medium tracking-[-0.045em] text-foreground md:text-[38px]">How can I help, {firstName}?</h1><p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground">Ask a question, work with a file, create an image, send a Zoho email, or explore company knowledge available to your team.</p><p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/70"><LockKeyhole className="h-3 w-3" />Your workspace follows Aromazen access controls</p></div><PromptSuggestions suggestions={suggestions} onSelect={(text, mode) => void sendMessage(text, [], mode)} /></div> : <div className="mx-auto max-w-3xl space-y-9 pb-4">{messages.map((message, index) => <ChatMessage key={message.id} role={message.role} content={message.content} attachments={message.attachments} artifacts={message.artifacts} emailBusy={sendingEmail && pendingEmail?.messageId === message.id} timestamp={new Date(message.created_at)} status={message.role === 'assistant' && index === messages.length - 1 ? stage : null} webSources={message.web_sources} sources={message.citations.map((citation) => ({ documentId: citation.document_id, collectionId: citation.collection_id, name: citation.document_name, collection: citation.collection_name, page: citation.page ?? undefined, chunk: citation.chunk_index, relevance: citation.relevance ?? 0 }))} editable={!isSending}                onEdit={(revisedContent) => editMessage(message.id, revisedContent)} onOpenSource={(source) => void openCitation(source)} onOpenAttachment={(attachment) => void openAttachment(attachment)} onSendEmail={(draft) => setPendingEmail({ messageId: message.id, draft })} />)}<div ref={messagesEndRef} /></div>}</div>
    <ChatComposer busy={isSending} onStop={() => void stopGenerating()} onSend={sendMessage} onUpload={uploadAttachment} />
    {pendingEmail && <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Confirm email"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><span className="grid h-10 w-10 place-items-center rounded-full bg-amber-500/10"><AlertTriangle className="h-5 w-5 text-amber-500" /></span><button type="button" onClick={() => setPendingEmail(null)} disabled={sendingEmail} className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Cancel sending"><X className="h-4 w-4" /></button></div><h2 className="mt-4 text-lg font-semibold">Send this email through Zoho?</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">This will send the email to <span className="font-medium text-foreground">{pendingEmail.draft.to.join(', ')}</span>. Please confirm the recipient and subject are correct.</p><div className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-sm"><span className="text-muted-foreground">Subject: </span>{pendingEmail.draft.subject}</div><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setPendingEmail(null)} disabled={sendingEmail}>Cancel</Button><Button type="button" onClick={() => void confirmEmailSend()} disabled={sendingEmail}><Mail className="mr-2 h-4 w-4" />{sendingEmail ? 'Sending…' : 'Send email'}</Button></div></div></div>}
  </div></AppLayout>
}

export default function WorkspacePage() {
  return <Suspense fallback={<div className="min-h-dvh bg-background" />}><WorkspaceContent /></Suspense>
}
