'use client'

import { Check, ChevronDown, FileText, FolderUp, Gauge, Image as ImageIcon, Loader2, Mail, Plus, Send, Square, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { VoiceInputButton } from '@/components/voice-input-button'
import type { ChatAttachment } from '@/lib/api/types'

type ChatMode = 'chat' | 'image' | 'email'
type ResponseMode = 'auto' | 'quick' | 'standard' | 'deep' | 'essential'
type OpenMenu = 'tools' | 'response' | null

const RESPONSE_OPTIONS: { value: ResponseMode; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto', description: 'Adapts to your query' },
  { value: 'quick', label: 'Quick', description: 'Short and fast' },
  { value: 'standard', label: 'Standard', description: 'Balanced detail' },
  { value: 'deep', label: 'Deep', description: 'Thorough answer' },
  { value: 'essential', label: 'Essential', description: 'Free-tier' },
]

interface ChatComposerProps {
  disabled?: boolean
  busy?: boolean
  onStop?: () => void
  onSend: (message: string, attachments: ChatAttachment[], mode: ChatMode, responseMode: ResponseMode) => Promise<boolean>
  onUpload: (file: File) => Promise<ChatAttachment | null>
}

export function ChatComposer({ disabled = false, busy = false, onStop, onSend, onUpload }: ChatComposerProps) {
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [mode, setMode] = useState<ChatMode>('chat')
  const [responseMode, setResponseMode] = useState<ResponseMode>('auto')
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const responseOption = RESPONSE_OPTIONS.find((option) => option.value === responseMode) ?? RESPONSE_OPTIONS[0]

  useEffect(() => {
    function closeMenus(event: PointerEvent) {
      if (!composerRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', closeMenus)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenus)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  async function handleSend() {
    const value = message.trim()
    if (!value || disabled || busy || uploading) return
    const submittedAttachments = attachments
    const submittedMode = mode
    setMessage('')
    setAttachments([])
    setMode('chat')
    setOpenMenu(null)
    const sent = await onSend(value, submittedAttachments, submittedMode, responseMode)
    if (!sent) {
      setMessage(value)
      setAttachments(submittedAttachments)
      setMode(submittedMode)
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    setOpenMenu(null)
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, 8 - attachments.length))) {
        const uploaded = await onUpload(file)
        if (uploaded) setAttachments((current) => [...current, uploaded])
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (folderInputRef.current) folderInputRef.current.value = ''
    }
  }

  function chooseMode(nextMode: ChatMode) {
    setMode(nextMode)
    if (nextMode === 'image') setAttachments([])
    setOpenMenu(null)
  }

  return <div className="shrink-0 border-t border-transparent bg-gradient-to-t from-background via-background to-background/60 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 md:px-6">
    <div ref={composerRef} className="relative mx-auto max-w-3xl">
      <div className="rounded-[26px] border border-border bg-card shadow-[0_18px_55px_rgba(0,0,0,0.16)] transition-all focus-within:border-foreground/25 focus-within:shadow-[0_20px_65px_rgba(0,0,0,0.22)]">
        {attachments.length > 0 && <div className="flex gap-2 overflow-x-auto px-3 pt-3">
          {attachments.map((attachment) => <div key={attachment.id} className="flex max-w-52 shrink-0 items-center gap-2 rounded-xl border border-border bg-muted/60 px-2.5 py-2">
            {attachment.is_image ? <ImageIcon className="h-4 w-4 shrink-0 text-primary" /> : <FileText className="h-4 w-4 shrink-0 text-primary" />}
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{attachment.name}</span>
            <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} className="rounded-md p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`Remove ${attachment.name}`}><X className="h-3.5 w-3.5" /></button>
          </div>)}
        </div>}
        {mode !== 'chat' && <div className="px-4 pt-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{mode === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}{mode === 'image' ? 'Create image' : 'Email'}<button type="button" onClick={() => setMode('chat')} aria-label={`Exit ${mode} mode`}><X className="h-3 w-3" /></button></span></div>}
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSend() } }} disabled={disabled} placeholder={mode === 'image' ? 'Describe the image you want to create…' : attachments.length ? 'Ask anything about your attached files…' : mode === 'email' ? 'Describe the email you want to prepare…' : 'Message AI Assistant…'} className="max-h-40 min-h-16 w-full resize-none bg-transparent px-5 pb-2 pt-4 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60" rows={1} />
        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp" onChange={(event) => void handleFiles(event.target.files)} />
            <input ref={folderInputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp" onChange={(event) => void handleFiles(event.target.files)} {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} />

            <div className="relative">
              <Button type="button" size="icon" variant="outline" onClick={() => setOpenMenu((current) => current === 'tools' ? null : 'tools')} disabled={disabled || uploading} className="h-9 w-9 rounded-full bg-transparent" aria-label="Add files or use tools" aria-haspopup="menu" aria-expanded={openMenu === 'tools'}>{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5" />}</Button>
              {openMenu === 'tools' && <div role="menu" className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-[min(16rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl">
                <MenuButton icon={<Upload />} label="Upload files" description="PDF, Office, text or image" disabled={mode === 'image' || attachments.length >= 8} onClick={() => fileInputRef.current?.click()} />
                <MenuButton icon={<FolderUp />} label="Upload folder" description="Add supported files together" disabled={mode === 'image' || attachments.length >= 8} onClick={() => folderInputRef.current?.click()} />
                <div className="my-1 border-t border-border" />
                <MenuButton icon={<ImageIcon />} label="Create image" description="Generate a new visual" active={mode === 'image'} onClick={() => chooseMode(mode === 'image' ? 'chat' : 'image')} />
                <MenuButton icon={<Mail />} label="Prepare email" description="Draft and send through Zoho" active={mode === 'email'} disabled={mode === 'image'} onClick={() => chooseMode(mode === 'email' ? 'chat' : 'email')} />
              </div>}
            </div>

            <div className="relative">
              <button type="button" onClick={() => setOpenMenu((current) => current === 'response' ? null : 'response')} disabled={disabled || mode !== 'chat'} className="inline-flex h-9 max-w-[14rem] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-45" aria-haspopup="menu" aria-expanded={openMenu === 'response'} title="Choose response detail"><Gauge className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{responseOption.label}</span><span className="hidden text-muted-foreground sm:inline">· {responseOption.description}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></button>
              {openMenu === 'response' && <div role="menu" className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-[min(15rem,calc(100vw-5rem))] rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl">
                <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Response style</p>
                {RESPONSE_OPTIONS.map((option) => <ChoiceButton key={option.value} selected={responseMode === option.value} label={option.label} description={option.description} onClick={() => { setResponseMode(option.value); setOpenMenu(null) }} />)}
              </div>}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <VoiceInputButton disabled={disabled || uploading} label="Speak your question" onTranscript={(text) => setMessage((current) => current.trim() ? `${current.trim()} ${text}` : text)} />
            {busy ? <Button type="button" size="icon" onClick={onStop} className="h-9 w-9 rounded-full bg-foreground text-background hover:bg-foreground/85" aria-label="Stop generating"><Square className="h-3.5 w-3.5 fill-current" /></Button> : <Button type="button" size="icon" onClick={() => void handleSend()} disabled={disabled || uploading || !message.trim()} className="h-9 w-9 rounded-full bg-foreground text-background hover:bg-foreground/85" aria-label="Send message"><Send className="h-4 w-4" /></Button>}
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] leading-4 text-muted-foreground">{busy ? 'You can type your next message while this answer is being prepared.' : 'AI can make mistakes. Check important information.'}</p>
    </div>
  </div>
}

function MenuButton({ icon, label, description, active = false, disabled = false, onClick }: { icon: React.ReactNode; label: string; description: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40 ${active ? 'bg-primary/10 text-primary' : ''}`}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span><span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="block truncate text-[11px] text-muted-foreground">{description}</span></span></button>
}

function ChoiceButton({ selected, label, description, onClick }: { selected: boolean; label: string; description: string; onClick: () => void }) {
  return <button type="button" role="menuitemradio" aria-checked={selected} onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted ${selected ? 'bg-primary/10' : ''}`}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{selected ? <Check className="h-3 w-3" /> : null}</span><span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="block truncate text-[11px] text-muted-foreground">{description}</span></span></button>
}
