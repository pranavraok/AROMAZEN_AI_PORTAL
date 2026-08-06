'use client'

import { useEffect, useMemo, useState } from 'react'
import { BarChart3, CheckCircle2, Mail, Paperclip, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EmailDraft, UsageSummary } from '@/lib/api/types'

function money(value: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 4 : 2 }).format(value) }
function compact(value: number) { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : value.toLocaleString() }

export function UsageChart({ usage }: { usage: UsageSummary }) {
  const maximum = Math.max(1, ...usage.timeseries.map((row) => row.requests))
  const totalTokens = usage.totals.input_tokens + usage.totals.output_tokens
  return <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="flex items-start justify-between border-b border-border px-4 py-3.5"><div><p className="text-sm font-semibold">Overall API usage</p><p className="mt-0.5 text-xs text-muted-foreground">{usage.range.date_from} to {usage.range.date_to}</p></div><BarChart3 className="h-5 w-5 text-primary" /></div>
    <div className="grid grid-cols-3 divide-x divide-border border-b border-border"><div className="p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Requests</p><p className="mt-1 text-xl font-semibold">{compact(usage.totals.requests)}</p></div><div className="p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tokens</p><p className="mt-1 text-xl font-semibold">{compact(totalTokens)}</p></div><div className="p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Est. cost</p><p className="mt-1 text-xl font-semibold">{money(usage.totals.cost)}</p></div></div>
    <div className="p-4"><div className="flex h-40 items-end gap-1 rounded-xl bg-muted/25 px-3 pb-3 pt-6">{usage.timeseries.length ? usage.timeseries.map((row) => <div key={row.date} className="group relative flex h-full min-w-0 flex-1 items-end"><div className="w-full rounded-t bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(4, row.requests / maximum * 100)}%` }} /><div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] text-background shadow-lg group-hover:block">{row.date}: {row.requests} requests</div></div>) : <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">No recorded API activity yet.</div>}</div>
      <div className="mt-4 space-y-2">{usage.providers.slice(0, 5).map((row) => <div key={`${row.provider}-${row.model}`} className="flex items-center gap-3 text-xs"><span className="h-2 w-2 rounded-full bg-primary" /><span className="min-w-0 flex-1 truncate capitalize">{row.provider} · {row.model}</span><span className="text-muted-foreground">{row.requests} · {money(row.cost)}</span></div>)}</div>
    </div>
  </section>
}

function splitAddresses(value: string) { return value.split(/[;,]/).map((item) => item.trim()).filter(Boolean) }

export function EmailDraftCard({ draft, busy, onSend }: { draft: EmailDraft; busy?: boolean; onSend: (draft: EmailDraft) => void }) {
  const [to, setTo] = useState(draft.to.join(', '))
  const [cc, setCc] = useState(draft.cc.join(', '))
  const [bcc, setBcc] = useState(draft.bcc.join(', '))
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  useEffect(() => { setTo(draft.to.join(', ')); setCc(draft.cc.join(', ')); setBcc(draft.bcc.join(', ')); setSubject(draft.subject); setBody(draft.body) }, [draft])
  const prepared = useMemo<EmailDraft>(() => ({ ...draft, to: splitAddresses(to), cc: splitAddresses(cc), bcc: splitAddresses(bcc), subject: subject.trim(), body: body.trim() }), [bcc, body, cc, draft, subject, to])
  const sent = draft.status === 'sent'
  return <section className="mt-4 max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="flex items-center justify-between border-b border-border px-4 py-3"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10"><Mail className="h-4 w-4 text-primary" /></span><div><p className="text-sm font-semibold">Zoho email</p><p className="text-[11px] text-muted-foreground">{sent ? 'Sent from AROMAZEN' : 'Review before sending'}</p></div></div>{sent && <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500"><CheckCircle2 className="h-4 w-4" />Sent</span>}</div>
    <div className="space-y-3 p-4"><label className="grid gap-1 text-xs text-muted-foreground">To<input value={to} onChange={(event) => setTo(event.target.value)} disabled={sent} placeholder="name@company.com" className="control text-sm text-foreground" /></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs text-muted-foreground">Cc<input value={cc} onChange={(event) => setCc(event.target.value)} disabled={sent} className="control text-sm text-foreground" /></label><label className="grid gap-1 text-xs text-muted-foreground">Bcc<input value={bcc} onChange={(event) => setBcc(event.target.value)} disabled={sent} className="control text-sm text-foreground" /></label></div><label className="grid gap-1 text-xs text-muted-foreground">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={sent} className="control text-sm font-medium text-foreground" /></label><label className="grid gap-1 text-xs text-muted-foreground">Message<textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={sent} rows={8} className="control resize-y text-sm leading-6 text-foreground" /></label>
      <div className="flex flex-wrap items-center justify-between gap-3">{draft.attachment_ids.length ? <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Paperclip className="h-3.5 w-3.5" />{draft.attachment_ids.length} chat attachment{draft.attachment_ids.length === 1 ? '' : 's'}</span> : <span />}{!sent && <Button type="button" onClick={() => onSend(prepared)} disabled={busy || !prepared.to.length || !prepared.subject || !prepared.body} className="rounded-full"><Send className="mr-2 h-4 w-4" />{busy ? 'Sending…' : 'Review & send'}</Button>}</div>
    </div>
  </section>
}
