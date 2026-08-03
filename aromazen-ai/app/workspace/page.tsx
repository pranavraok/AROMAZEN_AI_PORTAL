'use client'

import { useState } from 'react'
import { AppLayout } from '@/components/layouts/app-layout'
import { ChatMessage } from '@/components/workspace/chat-message'
import { ChatComposer } from '@/components/workspace/chat-composer'
import { PromptSuggestions } from '@/components/workspace/prompt-suggestions'
import { api } from '@/lib/api/services'
import type { ChatMessage as ChatMessageDto } from '@/lib/api/types'
import { ApiError } from '@/lib/api/client'

const suggestions = [
  { icon: 'FileText', text: 'Summarise this IFRA document' },
  { icon: 'ClipboardList', text: 'Find the production SOP for batch mixing' },
  { icon: 'Sparkles', text: 'Create a product brochure outline' },
  { icon: 'Scale', text: 'Compare two fragrance ingredients' },
]

export default function WorkspacePage() {
  const [messages, setMessages] = useState<ChatMessageDto[]>([])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendMessage(content: string) {
    setError(null)
    setIsSending(true)
    const optimistic: ChatMessageDto = { id: crypto.randomUUID(), role: 'user', content, created_at: new Date().toISOString(), citations: [] }
    setMessages((current) => [...current, optimistic])
    try {
      const response = await api.workspace.sendMessage({ content, collection_ids: [] })
      setMessages((current) => [...current, response])
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id))
      setError(error instanceof ApiError ? error.message : 'Unable to send this message. Please try again.')
    } finally {
      setIsSending(false)
    }
  }

  return <AppLayout><div className="flex h-full"><div className="flex-1 flex flex-col overflow-hidden"><header className="h-14 border-b border-border bg-card/50 px-6 flex items-center"><span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" /><span className="text-sm font-medium text-foreground">AROMAZEN AI</span><span className="text-xs text-muted-foreground ml-2">Knowledge-aware workspace</span></header><div className="flex-1 overflow-y-auto px-6 py-6">{messages.length === 0 ? <div className="space-y-8 max-w-2xl mx-auto pt-12"><div className="text-center space-y-3"><h1 className="text-3xl font-semibold text-foreground">What can I help you with?</h1><p className="text-muted-foreground">Ask about knowledge you are allowed to access.</p></div><PromptSuggestions suggestions={suggestions} onSelect={(text) => void sendMessage(text)} /></div> : <div className="max-w-3xl mx-auto space-y-6">{messages.map((message) => <ChatMessage key={message.id} role={message.role} content={message.content} timestamp={new Date(message.created_at)} sources={message.citations.map((citation) => ({ name: citation.document_name, collection: citation.collection_name, page: citation.page ?? undefined, relevance: citation.relevance ?? 0 }))} />)}</div>}{error && <p role="alert" className="max-w-3xl mx-auto mt-4 text-sm text-destructive">{error}</p>}</div><ChatComposer disabled={isSending} onSend={sendMessage} /></div></div></AppLayout>
}
