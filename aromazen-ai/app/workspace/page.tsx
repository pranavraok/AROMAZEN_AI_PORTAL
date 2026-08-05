'use client'

import { useState } from 'react'
import { AppLayout } from '@/components/layouts/app-layout'
import { ChatMessage } from '@/components/workspace/chat-message'
import { ChatComposer } from '@/components/workspace/chat-composer'
import { PromptSuggestions } from '@/components/workspace/prompt-suggestions'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import type { ChatCitation, ChatMessage as ChatMessageDto } from '@/lib/api/types'
import { ApiError } from '@/lib/api/client'

const generalSuggestions = [
  { icon: 'FileText', text: 'Summarise the key points in the documents I can access' },
  { icon: 'ClipboardList', text: 'Find the production SOP for batch mixing' },
  { icon: 'Sparkles', text: 'Create a product brochure outline' },
  { icon: 'Scale', text: 'Compare two fragrance ingredients' },
]

type StreamPayload = {
  conversation_id?: string
  message_id?: string
  message?: string
  text?: string
  citations?: ChatCitation[]
  sources?: WebSource[]
  code?: string
}

type WebSource = { title: string; url: string }
type WorkspaceMessage = ChatMessageDto & { web_sources?: WebSource[] }

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

export default function WorkspacePage() {
  const { accessToken, user } = useAuth()
  const { notify } = useToast()
  const [messages, setMessages] = useState<WorkspaceMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const canUseRndDocuments = user?.department_name === 'R&D' || user?.role_names.some((role) => role === 'Owner' || role === 'Super Admin')
  const suggestions = canUseRndDocuments ? [
    { icon: 'FileOutput', text: 'R&D AI Draft Assistant', description: 'Speak continuously or use Excel to auto-fill COA and SDS Word templates.', href: '/rnd/documents' },
    ...generalSuggestions.slice(0, 3),
  ] : generalSuggestions

  async function openCitation(citation: { documentId: string; collectionId: string; page?: number }) {
    if (!accessToken) return
    try {
      const response = await fetch(api.knowledge.documentContentUrl(citation.collectionId, citation.documentId), { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw new Error('Unable to open source.')
      const documentUrl = URL.createObjectURL(await response.blob())
      window.open(citation.page ? `${documentUrl}#page=${citation.page}` : documentUrl, '_blank', 'noopener,noreferrer')
    } catch { notify('error', 'Unable to open this source document.') }
  }

  async function sendMessage(content: string) {
    if (!accessToken || isSending) return
    setIsSending(true)
    setStage('Searching permitted knowledge...')
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', content, created_at: createdAt, citations: [] },
      { id: assistantId, role: 'assistant', content: '', created_at: createdAt, citations: [] },
    ])
    try {
      const response = await api.workspace.streamMessage(accessToken, { content, conversation_id: conversationId, collection_ids: [] })
      await readEventStream(response, (event, payload) => {
        if (event === 'start' && payload.conversation_id) setConversationId(payload.conversation_id)
        if (event === 'status' && payload.message) setStage(payload.message)
        if (event === 'citations' && payload.citations) {
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, citations: payload.citations ?? [] } : message))
        }
        if (event === 'web_sources' && payload.sources) {
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, web_sources: payload.sources ?? [] } : message))
        }
        if (event === 'delta' && payload.text) {
          setStage(null)
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + payload.text } : message))
        }
        if (event === 'done' && payload.message_id) {
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, id: payload.message_id ?? message.id } : message))
        }
        if (event === 'error') throw new ApiError(payload.message ?? 'The answer could not be completed.', 502, payload)
      })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Unable to send this message. Please try again.'
      notify('error', message)
      setMessages((current) => current.map((item) => item.id === assistantId && !item.content ? { ...item, content: 'I could not complete that answer. Please try again.' } : item))
    } finally {
      setStage(null)
      setIsSending(false)
    }
  }

  return <AppLayout><div className="flex h-full"><div className="flex-1 flex flex-col overflow-hidden"><header className="h-14 border-b border-border bg-card/50 px-6 flex items-center"><span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" /><span className="text-sm font-medium text-foreground">AROMAZEN AI</span><span className="text-xs text-muted-foreground ml-2">Permission-aware streaming workspace</span></header><div className="flex-1 overflow-y-auto px-5 py-7 md:px-8">{messages.length === 0 ? <div className="space-y-8 max-w-2xl mx-auto pt-12"><div className="text-center space-y-3"><h1 className="text-3xl font-semibold text-foreground">What can I help you with?</h1><p className="text-muted-foreground">Ask about knowledge you are allowed to access.</p></div><PromptSuggestions suggestions={suggestions} onSelect={(text) => void sendMessage(text)} /></div> : <div className="mx-auto max-w-3xl space-y-8">{messages.map((message, index) => <ChatMessage key={message.id} role={message.role} content={message.content} timestamp={new Date(message.created_at)} status={message.role === 'assistant' && index === messages.length - 1 ? stage : null} webSources={message.web_sources} sources={message.citations.map((citation) => ({ documentId: citation.document_id, collectionId: citation.collection_id, name: citation.document_name, collection: citation.collection_name, page: citation.page ?? undefined, chunk: citation.chunk_index, relevance: citation.relevance ?? 0 }))} onOpenSource={(source) => void openCitation(source)} />)}</div>}</div><ChatComposer disabled={isSending} onSend={sendMessage} /></div></div></AppLayout>
}
