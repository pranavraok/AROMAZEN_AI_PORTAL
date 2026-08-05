'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { AppLayout } from '@/components/layouts/app-layout'
import { ChatMessage } from '@/components/workspace/chat-message'
import { ChatComposer } from '@/components/workspace/chat-composer'
import { PromptSuggestions } from '@/components/workspace/prompt-suggestions'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import type { ChatAttachment, ChatCitation, ChatMessage as ChatMessageDto, CurrentUser, KnowledgeCollection } from '@/lib/api/types'
import { ApiError } from '@/lib/api/client'

type Suggestion = { icon: string; text: string; description?: string; href?: string; mode?: 'chat' | 'image' }
type WebSource = { title: string; url: string }
type WorkspaceMessage = ChatMessageDto & { web_sources?: WebSource[]; attachments?: ChatAttachment[] }
type StreamPayload = { conversation_id?: string; message_id?: string; message?: string; text?: string; citations?: ChatCitation[]; sources?: WebSource[]; code?: string; attachment?: ChatAttachment }

function suggestionsFor(user: CurrentUser | null): Suggestion[] {
  if (!user) return []
  const permissions = new Set(user.permission_keys)
  const isPlatformAdmin = permissions.has('settings.manage') || user.role_names.some((role) => role === 'Super Admin' || role === 'Admin')
  if (isPlatformAdmin) return [
    { icon: 'BarChart3', text: 'Review AI usage and costs', description: 'See provider, model, user, and department usage.', href: '/admin/usage' },
    { icon: 'Users', text: 'Manage users and access', description: 'Invite employees and review role access.', href: '/admin/users' },
    { icon: 'FileOutput', text: 'R&D AI Draft Assistant', description: 'Create COA and SDS Word documents.', href: '/rnd/documents' },
    { icon: 'BookOpenCheck', text: 'Summarise the company knowledge I can access' },
  ]
  if (permissions.has('users.manage')) return [
    { icon: 'Users', text: 'Manage my department team', description: 'Review employees in your permitted scope.', href: '/admin/users' },
    ...(user.department_name === 'R&D' ? [{ icon: 'FileOutput', text: 'R&D AI Draft Assistant', description: 'Create COA and SDS Word documents.', href: '/rnd/documents' }] : [{ icon: 'BookOpenCheck', text: `Summarise the latest ${user.department_name ?? 'department'} documents` }]),
    { icon: 'ListChecks', text: `Create a weekly action plan for ${user.department_name ?? 'my department'}` },
    { icon: 'Mail', text: 'Draft a clear update for my department team' },
  ]
  const department = user.department_name ?? ''
  if (department === 'R&D') return [
    { icon: 'FileOutput', text: 'R&D AI Draft Assistant', description: 'Create COA and SDS Word documents.', href: '/rnd/documents' },
    { icon: 'FlaskConical', text: 'Compare two fragrance formulations' },
    { icon: 'BookOpenCheck', text: 'Summarise the R&D documents I can access' },
    { icon: 'ListChecks', text: 'Create a formulation trial checklist' },
  ]
  if (department === 'Production') return [
    { icon: 'ClipboardList', text: 'Find the production SOP for batch mixing' },
    { icon: 'ListChecks', text: 'Create a production quality checklist' },
    { icon: 'Mail', text: 'Draft a professional shift handover note' },
    { icon: 'BookOpenCheck', text: 'Summarise the production documents I can access' },
  ]
  if (department === 'Accounts & HR') return [
    { icon: 'BookOpenCheck', text: 'Explain the HR policies I can access' },
    { icon: 'Mail', text: 'Draft a professional employee communication' },
    { icon: 'ListChecks', text: 'Create a monthly accounts closing checklist' },
    { icon: 'FileText', text: 'Summarise a policy or report I attach' },
  ]
  if (department === 'Marketing' || department === 'Graphics') return [
    { icon: 'Megaphone', text: 'Create a fragrance campaign brief' },
    { icon: 'Image', text: 'Create a premium fragrance product image', mode: 'image' },
    { icon: 'Sparkles', text: 'Create a product brochure outline' },
    { icon: 'BookOpenCheck', text: 'Summarise the marketing assets I can access' },
  ]
  if (department === 'Stores' || department === 'Sourcing') return [
    { icon: 'Boxes', text: 'Create an inventory review checklist' },
    { icon: 'Scale', text: 'Compare two suppliers or raw materials' },
    { icon: 'Mail', text: 'Draft a professional vendor enquiry' },
    { icon: 'BookOpenCheck', text: 'Summarise the SOPs I can access' },
  ]
  if (department === 'AI Lab' || department === 'Creation Lab') return [
    { icon: 'FlaskConical', text: 'Create a structured research brief' },
    { icon: 'Scale', text: 'Compare two fragrance concepts' },
    { icon: 'ListChecks', text: 'Create an experiment plan and checklist' },
    { icon: 'BookOpenCheck', text: 'Summarise the research documents I can access' },
  ]
  return [
    { icon: 'BookOpenCheck', text: 'Summarise the documents I can access' },
    { icon: 'Mail', text: 'Draft a professional email' },
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
  const [messages, setMessages] = useState<WorkspaceMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isLoadingChat, setIsLoadingChat] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [collections, setCollections] = useState<KnowledgeCollection[]>([])
  const [knowledgeScope, setKnowledgeScope] = useState('auto')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const suggestions = suggestionsFor(user)

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: isSending ? 'smooth' : 'auto', block: 'end' }) }, [isSending, messages, stage])
  useEffect(() => {
    if (!accessToken || !user?.permission_keys.includes('knowledge.read')) return
    void api.knowledge.collections(accessToken).then(setCollections).catch((error) => notify('error', error instanceof ApiError ? error.message : 'Unable to load your permitted knowledge collections.'))
  }, [accessToken, notify, user?.permission_keys])

  async function withImagePreview(attachment: ChatAttachment): Promise<ChatAttachment> {
    if (!accessToken || !attachment.is_image) return attachment
    try {
      const response = await fetch(api.workspace.attachmentContentUrl(attachment.id), { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) return attachment
      return { ...attachment, preview_url: URL.createObjectURL(await response.blob()) }
    } catch { return attachment }
  }

  async function loadConversation(conversationIdToLoad: string) {
    if (!accessToken || isSending) return
    setIsLoadingChat(true)
    try {
      const storedMessages = await api.workspace.messages(accessToken, conversationIdToLoad)
      const hydrated = await Promise.all(storedMessages.map(async (message) => ({ ...message, attachments: await Promise.all((message.attachments ?? []).map(withImagePreview)) })))
      setMessages(hydrated)
      setConversationId(conversationIdToLoad)
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to open this chat.') }
    finally { setIsLoadingChat(false) }
  }

  function newChat() {
    if (isSending) return
    setConversationId(null)
    setMessages([])
    setStage(null)
  }

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
  }, [conversationId, isSending])

  async function openCitation(citation: { documentId: string; collectionId: string; page?: number }) {
    if (!accessToken) return
    try {
      const response = await fetch(api.knowledge.documentContentUrl(citation.collectionId, citation.documentId), { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw new Error('Unable to open source.')
      const documentUrl = URL.createObjectURL(await response.blob())
      window.open(citation.page ? `${documentUrl}#page=${citation.page}` : documentUrl, '_blank', 'noopener,noreferrer')
    } catch { notify('error', 'Unable to open this source document.') }
  }

  async function openAttachment(attachment: ChatAttachment) {
    if (!accessToken) return
    try {
      const response = await fetch(api.workspace.attachmentContentUrl(attachment.id), { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw new Error()
      window.open(URL.createObjectURL(await response.blob()), '_blank', 'noopener,noreferrer')
    } catch { notify('error', 'Unable to open this attachment.') }
  }

  async function uploadAttachment(file: File): Promise<ChatAttachment | null> {
    if (!accessToken) return null
    try { return await withImagePreview(await api.workspace.uploadAttachment(accessToken, file)) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : `Unable to upload ${file.name}.`); return null }
  }

  async function sendMessage(content: string, attachments: ChatAttachment[] = [], mode: 'chat' | 'image' = 'chat'): Promise<boolean> {
    if (!accessToken || isSending) return false
    setIsSending(true)
    setStage(mode === 'image' ? 'Creating your image...' : attachments.length ? 'Reading attached files...' : 'Preparing answer...')
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    setMessages((current) => [...current, { id: userId, role: 'user', content, created_at: createdAt, citations: [], attachments }, { id: assistantId, role: 'assistant', content: '', created_at: createdAt, citations: [], attachments: [] }])
    let accepted = false
    try {
      const collectionIds = knowledgeScope === 'all' ? collections.map((collection) => collection.id) : knowledgeScope === 'auto' ? [] : [knowledgeScope]
      const response = await api.workspace.streamMessage(accessToken, { content, conversation_id: conversationId, collection_ids: collectionIds, attachment_ids: attachments.map((attachment) => attachment.id), mode })
      accepted = true
      await readEventStream(response, (event, payload) => {
        if (event === 'start' && payload.conversation_id) { setConversationId(payload.conversation_id); window.dispatchEvent(new Event('aromazen:conversations-updated')) }
        if (event === 'status' && payload.message) setStage(payload.message)
        if (event === 'citations' && payload.citations) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, citations: payload.citations ?? [] } : message))
        if (event === 'web_sources' && payload.sources) setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, web_sources: payload.sources ?? [] } : message))
        if (event === 'delta' && payload.text) { setStage(null); setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + payload.text } : message)) }
        if (event === 'generated_image' && payload.attachment) {
          const generated = payload.attachment
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, attachments: [...(message.attachments ?? []), generated] } : message))
          void withImagePreview(generated).then((image) => setMessages((current) => current.map((message) => ({ ...message, attachments: (message.attachments ?? []).map((attachment) => attachment.id === image.id ? image : attachment) }))))
        }
        if (event === 'done' && payload.message_id) { setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, id: payload.message_id ?? message.id } : message)); window.dispatchEvent(new Event('aromazen:conversations-updated')) }
        if (event === 'error') throw new ApiError(payload.message ?? 'The answer could not be completed.', 502, payload)
      })
      return true
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Unable to send this message. Please try again.')
      if (!accepted) setMessages((current) => current.filter((message) => message.id !== userId && message.id !== assistantId))
      else setMessages((current) => current.map((message) => message.id === assistantId && !message.content ? { ...message, content: 'I could not complete that request. Please try again.' } : message))
      return accepted
    } finally { setStage(null); setIsSending(false) }
  }

  return <AppLayout><div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 px-4 md:px-6"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">AZ</span><div><p className="text-sm font-medium text-foreground">AROMAZEN AI</p><p className="text-[10px] text-muted-foreground">Company assistant</p></div></div><MoreHorizontal className="h-4 w-4 text-muted-foreground" /></header>
    <div className="flex-1 overflow-y-auto px-4 py-7 md:px-8">{isLoadingChat ? <div className="mx-auto max-w-3xl space-y-4 py-20"><div className="h-4 w-32 animate-pulse rounded bg-muted" /><div className="h-4 w-full animate-pulse rounded bg-muted/80" /><div className="h-4 w-4/5 animate-pulse rounded bg-muted/60" /></div> : messages.length === 0 ? <div className="mx-auto max-w-2xl space-y-8 pt-8 md:pt-14"><div className="space-y-3 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">AZ</div><h1 className="text-3xl font-semibold tracking-tight text-foreground">What can I help you with?</h1><p className="text-sm text-muted-foreground">Ask anything, attach files, create images, or search company knowledge permitted for your department.</p></div><PromptSuggestions suggestions={suggestions} onSelect={(text, mode) => void sendMessage(text, [], mode)} /></div> : <div className="mx-auto max-w-3xl space-y-8 pb-4">{messages.map((message, index) => <ChatMessage key={message.id} role={message.role} content={message.content} attachments={message.attachments} timestamp={new Date(message.created_at)} status={message.role === 'assistant' && index === messages.length - 1 ? stage : null} webSources={message.web_sources} sources={message.citations.map((citation) => ({ documentId: citation.document_id, collectionId: citation.collection_id, name: citation.document_name, collection: citation.collection_name, page: citation.page ?? undefined, chunk: citation.chunk_index, relevance: citation.relevance ?? 0 }))} onOpenSource={(source) => void openCitation(source)} onOpenAttachment={(attachment) => void openAttachment(attachment)} />)}<div ref={messagesEndRef} /></div>}</div>
    <ChatComposer disabled={isSending} onSend={sendMessage} onUpload={uploadAttachment} collections={collections} knowledgeScope={knowledgeScope} onKnowledgeScopeChange={setKnowledgeScope} />
  </div></AppLayout>
}

export default function WorkspacePage() {
  return <Suspense fallback={<div className="min-h-screen bg-background" />}><WorkspaceContent /></Suspense>
}
