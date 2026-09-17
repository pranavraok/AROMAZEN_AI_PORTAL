'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Check,
  Clock3,
  Download,
  Flame,
  LoaderCircle,
  MessageCircleQuestion,
  Plus,
  Search,
  Send,
  X,
} from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { Button } from '@/components/ui/button'
import { MetricCard } from '@/components/ui/metric-card'
import { ModalShell } from '@/components/ui/modal'
import { PageHeader } from '@/components/ui/page-header'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type {
  CreateMarketingLeadPayload,
  MarketingLead,
  MarketingLeadPriority,
  MarketingLeadStatus,
  MarketingMonthlyReport,
  MarketingReportRow,
} from '@/lib/api/types'

type LeadTab = 'all' | 'awaiting' | 'clarification_required' | 'accepted' | 'rejected'
type DecisionAction = 'reject' | 'question' | null

const STATUS: Record<MarketingLeadStatus, { label: string; className: string }> = {
  submitted: { label: 'Awaiting review', className: 'bg-sky-500/10 text-sky-500' },
  resubmitted: { label: 'Answer sent', className: 'bg-blue-500/10 text-blue-500' },
  clarification_required: { label: 'Clarification required', className: 'bg-amber-500/10 text-amber-500' },
  accepted: { label: 'Accepted', className: 'bg-emerald-500/10 text-emerald-500' },
  rejected: { label: 'Rejected', className: 'bg-red-500/10 text-red-500' },
}

const SOURCE_OPTIONS = ['Field visit', 'Exhibition', 'Referral', 'Website', 'Existing network', 'Other']

function emptyLead(): CreateMarketingLeadPayload {
  return {
    company_name: '', contact_person: '', phone_number: '', email: '', country: '', region: '',
    product_interest: '', expected_quantity: '', lead_source: 'Field visit', priority: 'warm',
    requirement: '', notes: '',
  }
}

function humanDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function csvValue(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const content = [headers, ...rows].map((row) => row.map(csvValue).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  URL.revokeObjectURL(url)
}

function LeadStatus({ status }: { status: MarketingLeadStatus }) {
  const item = STATUS[status]
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${item.className}`}>{item.label}</span>
}

function Field({ label, required, children, wide = false }: { label: string; required?: boolean; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? 'md:col-span-2' : ''}>
    <span className="mb-1.5 block text-xs text-muted-foreground">{label}{required ? <span className="ml-1 text-red-400">*</span> : null}</span>
    {children}
  </label>
}

function ReportTable({ title, rows }: { title: string; rows: MarketingReportRow[] }) {
  return <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="border-b border-border px-4 py-3"><h3 className="font-semibold">{title}</h3></div>
    <div className="overflow-auto"><table className="w-full min-w-[680px] text-sm">
      <thead className="text-xs text-muted-foreground"><tr><th className="p-3 text-left">Name</th><th>Total</th><th>Accepted</th><th>Rejected</th><th>Needs answer</th><th>Pending</th><th>Acceptance</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.label} className="border-t border-border"><td className="p-3 font-medium">{row.label}</td><td className="text-center">{row.total}</td><td className="text-center text-emerald-500">{row.accepted}</td><td className="text-center text-red-500">{row.rejected}</td><td className="text-center text-amber-500">{row.clarification_required}</td><td className="text-center">{row.pending}</td><td className="text-center font-medium">{row.acceptance_rate}%</td></tr>)}
        {rows.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No leads were submitted in this month.</td></tr> : null}
      </tbody>
    </table></div>
  </section>
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const maximum = Math.max(1, ...rows.map((row) => row.count))
  return <section className="rounded-2xl border border-border bg-card p-4">
    <h3 className="font-semibold">{title}</h3>
    <div className="mt-4 space-y-3">{rows.slice(0, 8).map((row) => <div key={row.label}>
      <div className="mb-1 flex justify-between gap-3 text-xs"><span className="truncate">{row.label}</span><span className="font-medium">{row.count}</span></div>
      <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(5, row.count * 100 / maximum)}%` }} /></div>
    </div>)}{rows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No data for this month.</p> : null}</div>
  </section>
}

function MonthlyReportView({ report, month, onMonthChange, loading }: { report: MarketingMonthlyReport | null; month: string; onMonthChange: (month: string) => void; loading: boolean }) {
  if (!report && loading) return <div className="grid min-h-72 place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-primary" /></div>
  if (!report) return null
  const activeReport = report
  function exportReport() {
    downloadCsv(`marketing-report-${activeReport.month}.csv`, ['Employee', 'Total submitted', 'Accepted', 'Rejected', 'Clarification required', 'Pending', 'Acceptance rate %'], activeReport.employees.map((row) => [row.label, row.total, row.accepted, row.rejected, row.clarification_required, row.pending, row.acceptance_rate]))
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border bg-card p-4">
      <label><span className="mb-1.5 block text-xs text-muted-foreground">Reporting month</span><input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm" /></label>
      <Button variant="outline" onClick={exportReport}><Download className="mr-2 h-4 w-4" />Download employee report</Button>
    </div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <MetricCard label="Submitted" value={String(report.total)} />
      <MetricCard label="Accepted" value={String(report.accepted)} />
      <MetricCard label="Rejected" value={String(report.rejected)} />
      <MetricCard label="Needs answer" value={String(report.clarification_required)} />
      <MetricCard label="Acceptance" value={`${report.acceptance_rate}%`} />
      <MetricCard label="Avg response" value={report.average_response_hours === null ? '—' : `${report.average_response_hours}h`} />
    </section>
    <div className="grid gap-5 xl:grid-cols-2"><ReportTable title="Employee performance" rows={report.employees} /><ReportTable title="Regional performance" rows={report.regions} /></div>
    <div className="grid gap-5 md:grid-cols-3"><Breakdown title="Lead sources" rows={report.lead_sources} /><Breakdown title="Product interest" rows={report.product_interests} /><Breakdown title="Rejection reasons" rows={report.rejection_reasons} /></div>
  </div>
}

export function MarketingLeadsTool() {
  const { accessToken, user } = useAuth()
  const { notify } = useToast()
  const isMarketing = user?.department_name === 'Marketing'
  const isMerchandising = user?.department_name === 'Merchandising'
  const isSuperAdmin = user?.role_names.includes('Super Admin') ?? false
  const canCreate = isMarketing
  const canDecide = isMerchandising
  const [items, setItems] = useState<MarketingLead[]>([])
  const [counts, setCounts] = useState<Record<MarketingLeadStatus, number>>({ submitted: 0, clarification_required: 0, resubmitted: 0, accepted: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<LeadTab>(isMerchandising ? 'awaiting' : 'all')
  const [view, setView] = useState<'leads' | 'report'>('leads')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateMarketingLeadPayload>(emptyLead)
  const [decisionAction, setDecisionAction] = useState<DecisionAction>(null)
  const [message, setMessage] = useState('')
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [report, setReport] = useState<MarketingMonthlyReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)

  const loadLeads = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    try {
      const result = await api.marketingLeads.list(accessToken)
      setItems(result.items); setCounts(result.counts)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to load Marketing leads.')
    } finally { setLoading(false) }
  }, [accessToken, notify])

  const loadReport = useCallback(async (nextMonth: string) => {
    if (!accessToken || !isSuperAdmin) return
    setReportLoading(true)
    try { setReport(await api.marketingLeads.monthlyReport(accessToken, nextMonth)) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to load the monthly Marketing report.') }
    finally { setReportLoading(false) }
  }, [accessToken, isSuperAdmin, notify])

  useEffect(() => { void loadLeads() }, [loadLeads])
  useEffect(() => { if (view === 'report') void loadReport(month) }, [loadReport, month, view])

  const selected = items.find((item) => item.id === selectedId) ?? null
  const shown = useMemo(() => items.filter((item) => {
    const matchesTab = tab === 'all' || (tab === 'awaiting' ? ['submitted', 'resubmitted'].includes(item.status) : item.status === tab)
    const haystack = `${item.company_name} ${item.contact_person} ${item.region} ${item.product_interest}`.toLowerCase()
    return matchesTab && haystack.includes(search.trim().toLowerCase())
  }), [items, search, tab])

  function updateForm<K extends keyof CreateMarketingLeadPayload>(key: K, value: CreateMarketingLeadPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submitLead(event: FormEvent) {
    event.preventDefault()
    if (!accessToken) return
    setBusy('create')
    try {
      await api.marketingLeads.create(accessToken, form)
      notify('success', 'Lead sent to Merchandising for review.')
      setForm(emptyLead()); setShowCreate(false); await loadLeads()
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to submit this lead.') }
    finally { setBusy('') }
  }

  async function decide(lead: MarketingLead, action: 'accept' | 'reject' | 'question', response = '') {
    if (!accessToken) return
    setBusy(`${action}-${lead.id}`)
    try {
      await api.marketingLeads.decide(accessToken, lead.id, action, response)
      notify('success', action === 'accept' ? 'Lead accepted. The handover is complete.' : action === 'reject' ? 'Lead rejected and Marketing has been notified.' : 'Question sent to Marketing.')
      setDecisionAction(null); setMessage(''); await loadLeads()
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to update this lead.') }
    finally { setBusy('') }
  }

  async function reply(lead: MarketingLead) {
    if (!accessToken || !message.trim()) return
    setBusy(`reply-${lead.id}`)
    try {
      await api.marketingLeads.reply(accessToken, lead.id, message)
      notify('success', 'Your clarification was sent back to Merchandising.')
      setMessage(''); await loadLeads()
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to send this clarification.') }
    finally { setBusy('') }
  }

  const tabs: { key: LeadTab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: Object.values(counts).reduce((sum, count) => sum + count, 0) },
    { key: 'awaiting', label: 'Awaiting review', count: counts.submitted + counts.resubmitted },
    { key: 'clarification_required', label: 'Needs clarification', count: counts.clarification_required },
    { key: 'accepted', label: 'Accepted', count: counts.accepted },
    { key: 'rejected', label: 'Rejected', count: counts.rejected },
  ]

  return <main className="space-y-5 p-4 md:p-6">
    <PageHeader title="Marketing Lead Handover" description="Marketing submits a lead once. Merchandising only accepts, rejects or asks a question—no ongoing lead updates are required." actions={<>
      {isSuperAdmin ? <Button variant="outline" onClick={() => setView((current) => current === 'leads' ? 'report' : 'leads')}>{view === 'leads' ? <BarChart3 className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}{view === 'leads' ? 'Monthly report' : 'Lead handovers'}</Button> : null}
      {canCreate && view === 'leads' ? <Button onClick={() => setShowCreate(true)}><Plus className="mr-2 h-4 w-4" />Send new lead</Button> : null}
    </>} />

    {view === 'report' ? <MonthlyReportView report={report} month={month} onMonthChange={setMonth} loading={reportLoading} /> : <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Awaiting Merchandising" value={String(counts.submitted + counts.resubmitted)} />
        <MetricCard label="Clarification required" value={String(counts.clarification_required)} />
        <MetricCard label="Accepted handovers" value={String(counts.accepted)} />
        <MetricCard label="Rejected handovers" value={String(counts.rejected)} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex flex-wrap gap-2">{tabs.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${tab === item.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{item.label} · {item.count}</button>)}</div>
          <div className="relative max-w-xl"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, contact, region or product" className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm" /></div>
        </div>
        {loading ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-primary" /></div> : shown.length === 0 ? <div className="py-16 text-center"><Send className="mx-auto h-9 w-9 text-muted-foreground" /><p className="mt-3 font-medium">No lead handovers here</p><p className="mt-1 text-sm text-muted-foreground">{canCreate ? 'Send a new lead when it is ready for Merchandising.' : 'New Marketing leads will appear here automatically.'}</p></div> : <div className="divide-y divide-border">{shown.map((lead) => <button key={lead.id} type="button" onClick={() => { setSelectedId(lead.id); setDecisionAction(null); setMessage('') }} className="grid w-full gap-3 p-4 text-left transition hover:bg-muted/30 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{lead.company_name}</p><LeadStatus status={lead.status} />{lead.priority === 'hot' ? <span className="inline-flex items-center text-xs font-medium text-orange-500"><Flame className="mr-1 h-3.5 w-3.5" />Hot</span> : null}</div><p className="mt-1 truncate text-sm text-muted-foreground">{lead.product_interest} · {lead.region}{lead.country ? `, ${lead.country}` : ''}</p></div>
          <div className="text-sm"><p>{lead.contact_person}</p><p className="mt-1 text-xs text-muted-foreground">Submitted by {lead.created_by_name}</p></div>
          <div className="flex items-center justify-between gap-4 md:justify-end"><span className="text-xs text-muted-foreground">{humanDate(lead.submitted_at)}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /></div>
        </button>)}</div>}
      </section>
    </>}

    {showCreate ? <ModalShell label="Send a new lead to Merchandising" width="max-w-3xl" onClose={() => setShowCreate(false)}><form onSubmit={submitLead}>
      <div className="flex items-start justify-between border-b border-border p-5"><div><h2 className="text-lg font-semibold">Send lead to Merchandising</h2><p className="mt-1 text-sm text-muted-foreground">Enter enough information for a quick accept, reject or clarification decision.</p></div><button type="button" onClick={() => setShowCreate(false)} aria-label="Close"><X className="h-5 w-5" /></button></div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <Field label="Company / customer" required><input required minLength={2} value={form.company_name} onChange={(event) => updateForm('company_name', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Contact person" required><input required minLength={2} value={form.contact_person} onChange={(event) => updateForm('contact_person', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Phone number"><input value={form.phone_number ?? ''} onChange={(event) => updateForm('phone_number', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Email"><input type="email" value={form.email ?? ''} onChange={(event) => updateForm('email', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Region" required><input required minLength={2} value={form.region} onChange={(event) => updateForm('region', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Country"><input value={form.country} onChange={(event) => updateForm('country', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Product / category of interest" required><input required minLength={2} value={form.product_interest} onChange={(event) => updateForm('product_interest', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Expected quantity"><input value={form.expected_quantity ?? ''} onChange={(event) => updateForm('expected_quantity', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Lead source" required><select required value={form.lead_source} onChange={(event) => updateForm('lead_source', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">{SOURCE_OPTIONS.map((source) => <option key={source}>{source}</option>)}</select></Field>
        <Field label="Priority" required><select value={form.priority} onChange={(event) => updateForm('priority', event.target.value as MarketingLeadPriority)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select></Field>
        <Field label="Customer requirement" required wide><textarea required minLength={5} rows={4} value={form.requirement} onChange={(event) => updateForm('requirement', event.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></Field>
        <Field label="Additional notes" wide><textarea rows={3} value={form.notes ?? ''} onChange={(event) => updateForm('notes', event.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></Field>
        {!form.phone_number?.trim() && !form.email?.trim() ? <div className="flex items-center gap-2 text-xs text-amber-500 md:col-span-2"><AlertCircle className="h-4 w-4" />Add at least a phone number or email address.</div> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-4"><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" disabled={busy === 'create' || (!form.phone_number?.trim() && !form.email?.trim())}>{busy === 'create' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send to Merchandising</Button></div>
    </form></ModalShell> : null}

    {selected ? <ModalShell label={`Lead from ${selected.company_name}`} width="max-w-4xl" onClose={() => setSelectedId(null)}>
      <div className="flex items-start justify-between border-b border-border p-5"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{selected.company_name}</h2><LeadStatus status={selected.status} /></div><p className="mt-1 text-sm text-muted-foreground">Submitted by {selected.created_by_name} · {humanDate(selected.submitted_at)}</p></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Close"><X className="h-5 w-5" /></button></div>
      <div className="space-y-5 p-5">
        <section className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-3">{[
          ['Contact', selected.contact_person], ['Phone', selected.phone_number || '—'], ['Email', selected.email || '—'], ['Region', `${selected.region}${selected.country ? `, ${selected.country}` : ''}`], ['Product', selected.product_interest], ['Expected quantity', selected.expected_quantity || '—'], ['Source', selected.lead_source], ['Priority', selected.priority],
        ].map(([label, value]) => <div key={label}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium capitalize">{value}</p></div>)}</section>
        <section className="rounded-xl border border-border p-4"><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer requirement</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{selected.requirement}</p>{selected.notes ? <><h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Additional notes</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{selected.notes}</p></> : null}</section>

        {canDecide && ['submitted', 'resubmitted'].includes(selected.status) ? <section className="rounded-xl border border-primary/25 bg-primary/5 p-4">
          <h3 className="font-semibold">Merchandising response</h3><p className="mt-1 text-sm text-muted-foreground">Choose one response. Accepting or rejecting completes this handover.</p>
          {decisionAction ? <div className="mt-4 space-y-3"><textarea autoFocus rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={decisionAction === 'question' ? 'What information should Marketing clarify?' : 'Why is this lead being rejected?'} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setDecisionAction(null); setMessage('') }}>Cancel</Button><Button variant={decisionAction === 'reject' ? 'destructive' : 'default'} disabled={!message.trim() || Boolean(busy)} onClick={() => void decide(selected, decisionAction, message)}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : decisionAction === 'question' ? <MessageCircleQuestion className="mr-2 h-4 w-4" /> : <X className="mr-2 h-4 w-4" />}{decisionAction === 'question' ? 'Send question' : 'Reject lead'}</Button></div></div> : <div className="mt-4 flex flex-wrap gap-2"><Button disabled={Boolean(busy)} onClick={() => void decide(selected, 'accept')}><Check className="mr-2 h-4 w-4" />Accept</Button><Button variant="outline" onClick={() => setDecisionAction('question')}><MessageCircleQuestion className="mr-2 h-4 w-4" />Ask question</Button><Button variant="destructive" onClick={() => setDecisionAction('reject')}><X className="mr-2 h-4 w-4" />Reject</Button></div>}
        </section> : null}

        {isMarketing && selected.status === 'clarification_required' && (selected.created_by_user_id === user?.id || user?.role_names.includes('Department Admin')) ? <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><h3 className="font-semibold">Answer Merchandising</h3><p className="mt-1 text-sm text-muted-foreground">Your answer returns the lead to their review queue.</p><textarea rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Type the clarification…" className="mt-3 w-full rounded-xl border border-border bg-background p-3 text-sm" /><div className="mt-3 flex justify-end"><Button disabled={!message.trim() || Boolean(busy)} onClick={() => void reply(selected)}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send answer</Button></div></section> : null}

        <section><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary" /><h3 className="font-semibold">Handover history</h3></div><div className="mt-3 space-y-3">{selected.activities.map((activity) => <div key={activity.id} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" /><div className="min-w-0 flex-1 rounded-xl bg-muted/40 p-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium">{activity.actor_name}<span className="ml-1 font-normal text-muted-foreground">· {activity.action.replaceAll('_', ' ')}</span></p><span className="text-xs text-muted-foreground">{humanDate(activity.created_at)}</span></div>{activity.message ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{activity.message}</p> : null}</div></div>)}</div></section>
      </div>
    </ModalShell> : null}
  </main>
}
