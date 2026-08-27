'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { Check, ChevronDown, Copy, Download, ExternalLink, FileText, Globe2, Library, Pencil, Sparkles, X } from 'lucide-react'
import { MarkdownContent, markdownToPlainText } from '@/components/workspace/markdown-content'
import type { ChatAttachment } from '@/lib/api/types'
import { BrandMark } from '@/components/brand-mark'
import { EmailDraftCard, TokenUsagePie, UsageChart } from '@/components/workspace/chat-artifacts'
import type { ChatArtifacts, EmailDraft } from '@/lib/api/types'

interface Source {
  documentId: string
  collectionId: string
  name: string
  page?: number
  chunk?: number
  collection: string
  relevance: number
}

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  webSources?: { title: string; url: string }[]
  timestamp?: Date
  status?: string | null
  onOpenSource?: (source: Source) => void
  attachments?: ChatAttachment[]
  onOpenAttachment?: (attachment: ChatAttachment) => void
  artifacts?: ChatArtifacts
  emailBusy?: boolean
  onSendEmail?: (draft: EmailDraft) => void
  editable?: boolean
  onEdit?: (content: string) => Promise<boolean>
  tokenUsage?: { used_tokens: number; daily_limit: number }
}

export function ChatMessage({ role, content, sources = [], webSources = [], status, onOpenSource, attachments = [], onOpenAttachment, artifacts = {}, emailBusy = false, onSendEmail, editable = false, onEdit, tokenUsage }: ChatMessageProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(content)
  const [savingEdit, setSavingEdit] = useState(false)
  const usedSources = useMemo(() => {
    const indexes = [...content.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]) - 1)
    const seen = new Set<string>()
    return indexes.flatMap((sourceIndex) => {
      const source = sources[sourceIndex]
      if (!source) return []
      const key = `${source.documentId}:${source.page ?? source.chunk ?? sourceIndex}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{ ...source, citationNumber: sourceIndex + 1 }]
    })
  }, [content, sources])
  const sourceCount = usedSources.length + webSources.length

  function sourceForCitation(citationNumber: number) {
    const source = sources[citationNumber - 1]
    if (source) onOpenSource?.(source)
  }

  async function copyAnswer() {
    await navigator.clipboard.writeText(markdownToPlainText(content))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  async function saveEdit() {
    const revised = editValue.trim()
    if (!revised || revised === content || !onEdit) { setEditing(false); return }
    setSavingEdit(true)
    try {
      if (await onEdit(revised)) setEditing(false)
    } finally {
      setSavingEdit(false)
    }
  }

  if (role === 'user') {
    return <div className="flex justify-end"><div className="group max-w-[82%] space-y-2"><div className="flex flex-wrap justify-end gap-2">{attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => onOpenAttachment?.(attachment)} className="flex max-w-56 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-xs text-foreground hover:bg-muted"><FileText className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{attachment.name}</span></button>)}</div>{editing ? <div className="w-[min(42rem,78vw)] rounded-[22px] rounded-br-md border border-border bg-muted p-3 shadow-sm"><textarea value={editValue} onChange={(event) => setEditValue(event.target.value)} disabled={savingEdit} rows={Math.min(8, Math.max(2, editValue.split('\n').length))} autoFocus className="max-h-52 w-full resize-y bg-transparent px-1 text-[15px] leading-6 text-foreground outline-none" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void saveEdit() } if (event.key === 'Escape') { setEditValue(content); setEditing(false) } }} /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => { setEditValue(content); setEditing(false) }} disabled={savingEdit} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground"><X className="h-3.5 w-3.5" />Cancel</button><button type="button" onClick={() => void saveEdit()} disabled={savingEdit || !editValue.trim()} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs text-background disabled:opacity-50"><Check className="h-3.5 w-3.5" />{savingEdit ? 'Saving…' : 'Save & regenerate'}</button></div></div> : <><div className="rounded-[22px] rounded-br-md border border-white/[0.035] bg-muted px-4 py-3 text-[15px] leading-6 text-foreground shadow-sm">{content}</div>{editable && onEdit && <div className="flex justify-end opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"><button type="button" onClick={() => { setEditValue(content); setEditing(true) }} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Edit this prompt"><Pencil className="h-3.5 w-3.5" />Edit</button></div>}</>}</div></div>
  }

  return <div className="flex w-full gap-3.5">
    <BrandMark size="sm" className="mt-0.5 shrink-0" />
    <div className="min-w-0 flex-1 pb-2">
      {status && <div className="flex items-center gap-2.5 py-1.5 text-sm text-muted-foreground" role="status" aria-live="polite"><span className="relative flex h-7 w-7 items-center justify-center"><span className="absolute inset-0 animate-ping rounded-full bg-primary/10" /><Sparkles className="relative h-4 w-4 animate-pulse text-primary" /></span><span className="bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent animate-pulse">{status}</span><span className="flex items-end gap-1" aria-hidden="true"><span className="h-1 w-1 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" /><span className="h-1 w-1 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" /><span className="h-1 w-1 animate-bounce rounded-full bg-primary" /></span></div>}
      {content && <MarkdownContent content={content} onCitation={sourceForCitation} />}
      {attachments.filter((attachment) => attachment.kind === 'generated' && !attachment.preview_url).map((attachment) => <div key={attachment.id} className="mt-4 flex aspect-square max-w-xl items-center justify-center overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted via-card to-muted"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 animate-pulse text-primary" />Finishing image preview…</div></div>)}
      {attachments.filter((attachment) => attachment.kind === 'generated' && attachment.preview_url).map((attachment) => <div key={attachment.id} className="mt-4 max-w-xl overflow-hidden rounded-2xl border border-border bg-muted"><button type="button" onClick={() => onOpenAttachment?.(attachment)} className="relative block aspect-square w-full"><Image src={attachment.preview_url!} alt={attachment.name} fill sizes="(max-width: 768px) 100vw, 576px" unoptimized className="object-cover" /></button><div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground"><span>AI-generated image</span><button type="button" onClick={() => onOpenAttachment?.(attachment)} className="inline-flex items-center gap-1 hover:text-foreground"><Download className="h-3.5 w-3.5" />Open</button></div></div>)}
      {artifacts.usage && <UsageChart usage={artifacts.usage} />}
      {artifacts.email && onSendEmail && <EmailDraftCard draft={artifacts.email} busy={emailBusy} onSend={onSendEmail} />}
      {tokenUsage && <TokenUsagePie usedTokens={tokenUsage.used_tokens} dailyLimit={tokenUsage.daily_limit} />}

      {content && <div className="mt-3 flex items-center gap-1 text-muted-foreground">
        <button type="button" onClick={() => void copyAnswer()} className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-muted hover:text-foreground" aria-label="Copy answer">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy'}</button>
        {sourceCount > 0 && <button type="button" onClick={() => setSourcesOpen((current) => !current)} className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-muted hover:text-foreground" aria-expanded={sourcesOpen}><Library className="h-3.5 w-3.5" />Sources <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground">{sourceCount}</span><ChevronDown className={`h-3.5 w-3.5 transition-transform ${sourcesOpen ? 'rotate-180' : ''}`} /></button>}
      </div>}
      {sourcesOpen && sourceCount > 0 && <div className="mt-2 max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-lg">
        <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">Sources used in this answer</div>
        <div className="divide-y divide-border">{usedSources.map((source) => <button type="button" key={`${source.documentId}-${source.citationNumber}-${source.page ?? source.chunk ?? 0}`} onClick={() => onOpenSource?.(source)} className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">{source.citationNumber}</span><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{source.name.split('/').pop()}</span><span className="block truncate text-xs text-muted-foreground">{source.collection}{source.page ? ` · page ${source.page}` : source.chunk !== undefined ? ` · chunk ${source.chunk + 1}` : ''}</span></span><ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" /></button>)}{webSources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-xs font-semibold text-sky-500">{usedSources.length + index + 1}</span><Globe2 className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{source.title}</span><span className="block truncate text-xs text-muted-foreground">{new URL(source.url).hostname.replace(/^www\./, '')}</span></span><ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" /></a>)}</div>
      </div>}
    </div>
  </div>
}
