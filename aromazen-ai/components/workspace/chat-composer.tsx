'use client'

import { FileText, Image as ImageIcon, Library, Loader2, Mail, Paperclip, Send, X, Zap } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { VoiceInputButton } from '@/components/voice-input-button'
import type { ChatAttachment, KnowledgeCollection } from '@/lib/api/types'

interface ChatComposerProps {
  disabled?: boolean
  onSend: (message: string, attachments: ChatAttachment[], mode: 'chat' | 'image' | 'email') => Promise<boolean>
  onUpload: (file: File) => Promise<ChatAttachment | null>
  collections?: KnowledgeCollection[]
  knowledgeScope?: string
  onKnowledgeScopeChange?: (value: string) => void
}

export function ChatComposer({ disabled = false, onSend, onUpload, collections = [], knowledgeScope = 'auto', onKnowledgeScopeChange }: ChatComposerProps) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [mode, setMode] = useState<'chat' | 'image' | 'email'>('chat')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSend() {
    const value = message.trim()
    if (!value || disabled || uploading) return
    const sent = await onSend(value, attachments, mode)
    if (sent) {
      setMessage('')
      setAttachments([])
      setMode('chat')
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, 8 - attachments.length))) {
        const uploaded = await onUpload(file)
        if (uploaded) setAttachments((current) => [...current, uploaded])
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return <div className="shrink-0 border-t border-transparent bg-gradient-to-t from-background via-background to-background/60 px-3 pb-4 pt-2 md:px-6">
    <div className="mx-auto max-w-3xl">
      <div className="rounded-[24px] border border-border bg-card shadow-[0_18px_55px_rgba(0,0,0,0.28)] transition-all focus-within:border-foreground/25 focus-within:shadow-[0_20px_65px_rgba(0,0,0,0.38)]">
        {attachments.length > 0 && <div className="flex gap-2 overflow-x-auto px-3 pt-3">
          {attachments.map((attachment) => <div key={attachment.id} className="flex max-w-52 shrink-0 items-center gap-2 rounded-xl border border-border bg-muted/60 px-2.5 py-2">
            {attachment.is_image ? <ImageIcon className="h-4 w-4 shrink-0 text-primary" /> : <FileText className="h-4 w-4 shrink-0 text-primary" />}
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{attachment.name}</span>
            <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} className="rounded-md p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`Remove ${attachment.name}`}><X className="h-3.5 w-3.5" /></button>
          </div>)}
        </div>}
        {mode === 'image' && <div className="px-4 pt-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><ImageIcon className="h-3.5 w-3.5" />Create image mode<button type="button" onClick={() => setMode('chat')} aria-label="Exit image mode"><X className="h-3 w-3" /></button></span></div>}
        {mode === 'email' && <div className="px-4 pt-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><Mail className="h-3.5 w-3.5" />Email mode<button type="button" onClick={() => setMode('chat')} aria-label="Exit email mode"><X className="h-3 w-3" /></button></span></div>}
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSend() } }} disabled={disabled} placeholder={mode === 'image' ? 'Describe the image you want to create…' : attachments.length ? 'Ask anything about your attached files…' : 'Message AI Assistant…'} className="max-h-40 min-h-14 w-full resize-none bg-transparent px-4 pb-2 pt-4 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60" rows={1} />
        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex items-center gap-1">
            <input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp" onChange={(event) => void handleFiles(event.target.files)} />
            <Button type="button" size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={disabled || uploading || mode === 'image' || attachments.length >= 8} className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground" aria-label="Attach files">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}</Button>
            <Button type="button" variant="ghost" onClick={() => { setMode((current) => current === 'image' ? 'chat' : 'image'); setAttachments([]) }} disabled={disabled || uploading} className="h-9 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"><ImageIcon className="mr-1.5 h-4 w-4" />Create image</Button>
            <Button type="button" variant="ghost" onClick={() => setMode((current) => current === 'email' ? 'chat' : 'email')} disabled={disabled || uploading || mode === 'image'} className="h-9 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"><Mail className="mr-1.5 h-4 w-4" />Email</Button>
          </div>
          <div className="flex items-center gap-1">
            <VoiceInputButton disabled={disabled || uploading} label="Speak your question" onTranscript={(text) => setMessage((current) => current.trim() ? `${current.trim()} ${text}` : text)} />
            <Button type="button" size="icon" onClick={() => void handleSend()} disabled={disabled || uploading || !message.trim()} className="h-9 w-9 rounded-full bg-foreground text-background hover:bg-foreground/85"><Send className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3 text-primary" />Permission-aware</span>
        <label className="inline-flex items-center gap-1"><Library className="h-3 w-3" /><select aria-label="Knowledge source" value={knowledgeScope} onChange={(event) => onKnowledgeScopeChange?.(event.target.value)} disabled={disabled} className="max-w-44 bg-transparent text-[11px] text-muted-foreground outline-none"><option value="auto">Automatic knowledge</option><option value="all">All I can access</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
        <span>AI can make mistakes. Check important information.</span>
      </div>
    </div>
  </div>
}
