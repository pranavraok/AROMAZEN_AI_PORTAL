'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, Copy, ExternalLink, FileText, Globe2, Library } from 'lucide-react'
import { MarkdownContent } from '@/components/workspace/markdown-content'

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
}

export function ChatMessage({ role, content, sources = [], webSources = [], status, onOpenSource }: ChatMessageProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [copied, setCopied] = useState(false)
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
    await navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (role === 'user') {
    return <div className="flex justify-end"><div className="max-w-[82%] rounded-3xl bg-muted px-4 py-3 text-[15px] leading-6 text-foreground shadow-sm">{content}</div></div>
  }

  return <div className="flex w-full gap-3.5">
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-[11px] font-bold text-primary">AZ</div>
    <div className="min-w-0 flex-1 pb-2">
      {status && !content && <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-primary" />{status}</div>}
      {content && <MarkdownContent content={content} onCitation={sourceForCitation} />}
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
