'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock3,
  Download,
  Flame,
  FlaskConical,
  LoaderCircle,
  MessageCircleQuestion,
  Plus,
  Search,
  Send,
  Trash2,
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
  CreateMarketingSamplePayload,
  MarketingLead,
  MarketingLeadPriority,
  MarketingLeadStatus,
  MarketingSample,
  MarketingSampleItemInput,
  MarketingSampleStatus,
} from '@/lib/api/types'

type LeadTab = 'all' | 'awaiting' | 'clarification_required' | 'accepted' | 'rejected'
type DecisionAction = 'reject' | 'question' | null
type MarketingView = 'leads' | 'samples'

const STATUS: Record<MarketingLeadStatus, { label: string; className: string }> = {
  submitted: { label: 'Awaiting review', className: 'bg-sky-500/10 text-sky-500' },
  resubmitted: { label: 'Answer sent', className: 'bg-blue-500/10 text-blue-500' },
  clarification_required: { label: 'Clarification required', className: 'bg-amber-500/10 text-amber-500' },
  accepted: { label: 'Accepted', className: 'bg-emerald-500/10 text-emerald-500' },
  rejected: { label: 'Rejected', className: 'bg-red-500/10 text-red-500' },
}

const SOURCE_OPTIONS = ['Field visit', 'Exhibition', 'Referral', 'Website', 'Existing network', 'Other']
const SAMPLE_STATUS: Record<MarketingSampleStatus, { label: string; className: string }> = {
  recorded: { label: 'Recorded', className: 'bg-slate-500/10 text-slate-500' },
  dispatched: { label: 'Dispatched', className: 'bg-blue-500/10 text-blue-500' },
  awaiting_feedback: { label: 'Awaiting feedback', className: 'bg-amber-500/10 text-amber-500' },
  satisfied: { label: 'Satisfied', className: 'bg-emerald-500/10 text-emerald-500' },
  not_satisfied: { label: 'Not satisfied', className: 'bg-red-500/10 text-red-500' },
  order_received: { label: 'Order received', className: 'bg-violet-500/10 text-violet-500' },
  closed: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
}
const SAMPLE_STATUS_OPTIONS = Object.entries(SAMPLE_STATUS) as [MarketingSampleStatus, { label: string; className: string }][]

function today() {
  return new Date().toISOString().slice(0, 10)
}

function emptySampleItem(): MarketingSampleItemInput {
  return { fragrance_name: '', fragrance_code: '', application: '', quantity: '', cost: '' }
}

function emptySample(): CreateMarketingSamplePayload {
  return {
    linked_lead_id: null,
    serial_number: '',
    sample_date: today(),
    company_name: '',
    remark: '',
    status: 'awaiting_feedback',
    items: [emptySampleItem()],
  }
}

function emptyLead(): CreateMarketingLeadPayload {
  return {
    company_name: '', contact_person: '', phone_number: '', email: '', country: '', region: '',
    product_interest: '', expected_quantity: '', lead_source: 'Field visit', priority: 'warm',
    requirement: '', notes: '', sample: null,
  }
}

function humanDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function LeadStatus({ status }: { status: MarketingLeadStatus }) {
  const item = STATUS[status]
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${item.className}`}>{item.label}</span>
}

function SampleStatus({ status }: { status: MarketingSampleStatus }) {
  const item = SAMPLE_STATUS[status]
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${item.className}`}>{item.label}</span>
}

function Field({ label, required, children, wide = false }: { label: string; required?: boolean; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? 'md:col-span-2' : ''}>
    <span className="mb-1.5 block text-xs text-muted-foreground">{label}{required ? <span className="ml-1 text-red-400">*</span> : null}</span>
    {children}
  </label>
}

function SampleItemsEditor({ items, onChange, fragranceRequired = false }: { items: MarketingSampleItemInput[]; onChange: (items: MarketingSampleItemInput[]) => void; fragranceRequired?: boolean }) {
  function update(index: number, key: keyof MarketingSampleItemInput, value: string) {
    onChange(items.map((item, rowIndex) => rowIndex === index ? { ...item, [key]: value } : item))
  }
  return <div className="space-y-3 md:col-span-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">Fragrance samples</p><p className="text-xs text-muted-foreground">Add one row for every fragrance sent to this customer.</p></div><Button type="button" size="sm" variant="outline" onClick={() => onChange([...items, emptySampleItem()])}><Plus className="mr-1.5 h-3.5 w-3.5" />Add fragrance</Button></div>
    {items.map((item, index) => <div key={index} className="grid gap-3 rounded-xl border border-border bg-muted/15 p-3 sm:grid-cols-2 xl:grid-cols-5">
      <Field label="Fragrance name" required={fragranceRequired}><input required={fragranceRequired} minLength={fragranceRequired ? 2 : undefined} value={item.fragrance_name} onChange={(event) => update(index, 'fragrance_name', event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" /></Field>
      <Field label="Code"><input value={item.fragrance_code ?? ''} onChange={(event) => update(index, 'fragrance_code', event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" /></Field>
      <Field label="Application"><input value={item.application ?? ''} onChange={(event) => update(index, 'application', event.target.value)} placeholder="Candle, soap, perfume…" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" /></Field>
      <Field label="Quantity"><input value={item.quantity ?? ''} onChange={(event) => update(index, 'quantity', event.target.value)} placeholder="25 ml / 50 g" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" /></Field>
      <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Field label="Cost"><input value={item.cost ?? ''} onChange={(event) => update(index, 'cost', event.target.value)} placeholder="Optional" className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" /></Field></div>{items.length > 1 ? <button type="button" onClick={() => onChange(items.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Remove fragrance ${index + 1}`} className="mb-1 rounded-lg p-2 text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button> : null}</div>
    </div>)}
  </div>
}

export function MarketingLeadsTool({ initialView = 'leads' }: { initialView?: MarketingView }) {
  const { accessToken, user } = useAuth()
  const { notify } = useToast()
  const isMarketing = user?.department_name === 'Marketing'
  const isMerchandising = user?.department_name === 'Merchandising'
  const isSuperAdmin = user?.role_names.includes('Super Admin') ?? false
  const isDepartmentAdmin = user?.role_names.includes('Department Admin') ?? false
  const isMarketingAdmin = isMarketing && isDepartmentAdmin
  const isMerchandisingAdmin = isMerchandising && isDepartmentAdmin
  const canCreate = isMarketing
  const canDecide = isMerchandising
  const [items, setItems] = useState<MarketingLead[]>([])
  const [counts, setCounts] = useState<Record<MarketingLeadStatus, number>>({ submitted: 0, clarification_required: 0, resubmitted: 0, accepted: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<LeadTab>(isMerchandising ? 'awaiting' : 'all')
  const [view, setView] = useState<MarketingView>(initialView)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateMarketingLeadPayload>(emptyLead)
  const [leadSample, setLeadSample] = useState<CreateMarketingSamplePayload>(emptySample)
  const [decisionAction, setDecisionAction] = useState<DecisionAction>(null)
  const [message, setMessage] = useState('')
  const [samples, setSamples] = useState<MarketingSample[]>([])
  const [sampleCounts, setSampleCounts] = useState<Record<MarketingSampleStatus, number>>({ recorded: 0, dispatched: 0, awaiting_feedback: 0, satisfied: 0, not_satisfied: 0, order_received: 0, closed: 0 })
  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleSearch, setSampleSearch] = useState('')
  const [sampleStatus, setSampleStatus] = useState<MarketingSampleStatus | 'all'>('all')
  const [showSampleCreate, setShowSampleCreate] = useState(false)
  const [sampleForm, setSampleForm] = useState<CreateMarketingSamplePayload>(emptySample)
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null)

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

  const loadSamples = useCallback(async () => {
    if (!accessToken || (!isMarketing && !isSuperAdmin)) return
    setSampleLoading(true)
    try {
      const result = await api.marketingLeads.samples(accessToken)
      setSamples(result.items); setSampleCounts(result.counts)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to load customer samples.')
    } finally { setSampleLoading(false) }
  }, [accessToken, isMarketing, isSuperAdmin, notify])

  useEffect(() => { if (view === 'leads') void loadLeads() }, [loadLeads, view])
  useEffect(() => { if (view === 'samples') void loadSamples() }, [loadSamples, view])

  const selected = items.find((item) => item.id === selectedId) ?? null
  const selectedSample = samples.find((item) => item.id === selectedSampleId) ?? null
  const shown = useMemo(() => items.filter((item) => {
    const matchesTab = tab === 'all' || (tab === 'awaiting' ? ['submitted', 'resubmitted'].includes(item.status) : item.status === tab)
    const haystack = `${item.company_name} ${item.contact_person} ${item.region} ${item.product_interest}`.toLowerCase()
    return matchesTab && haystack.includes(search.trim().toLowerCase())
  }), [items, search, tab])
  const shownSamples = useMemo(() => samples.filter((sample) => {
    const matchesStatus = sampleStatus === 'all' || sample.status === sampleStatus
    const haystack = `${sample.company_name} ${sample.serial_number ?? ''} ${sample.items.map((item) => `${item.fragrance_name} ${item.fragrance_code ?? ''} ${item.application ?? ''}`).join(' ')}`.toLowerCase()
    return matchesStatus && haystack.includes(sampleSearch.trim().toLowerCase())
  }), [sampleSearch, sampleStatus, samples])

  function updateForm<K extends keyof CreateMarketingLeadPayload>(key: K, value: CreateMarketingLeadPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submitLead(event: FormEvent) {
    event.preventDefault()
    if (!accessToken) return
    const usedSampleItems = leadSample.items.filter((item) => Object.values(item).some((value) => value?.trim()))
    const hasSample = Boolean(leadSample.serial_number?.trim() || leadSample.remark?.trim() || usedSampleItems.length)
    if (hasSample && usedSampleItems.some((item) => !item.fragrance_name.trim())) {
      notify('error', 'Add a fragrance name for each sample row you use.')
      return
    }
    setBusy('create')
    try {
      await api.marketingLeads.create(accessToken, {
        ...form,
        sample: hasSample ? {
          serial_number: leadSample.serial_number,
          sample_date: leadSample.sample_date,
          remark: leadSample.remark,
          items: usedSampleItems,
        } : null,
      })
      notify('success', 'Lead sent to Merchandising for review.')
      setForm(emptyLead()); setLeadSample(emptySample()); setShowCreate(false); await loadLeads()
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to submit this lead.') }
    finally { setBusy('') }
  }

  async function createSample(event: FormEvent) {
    event.preventDefault()
    if (!accessToken) return
    const usedItems = sampleForm.items.filter((item) => Object.values(item).some((value) => value?.trim()))
    if (!sampleForm.company_name.trim() || usedItems.length === 0 || usedItems.some((item) => !item.fragrance_name.trim())) {
      notify('error', 'Add the company and a fragrance name for each sample row.')
      return
    }
    setBusy('sample-create')
    try {
      await api.marketingLeads.createSample(accessToken, { ...sampleForm, items: usedItems })
      notify('success', 'Customer sample added to the Marketing register.')
      setSampleForm(emptySample()); setShowSampleCreate(false); await loadSamples()
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to save this customer sample.') }
    finally { setBusy('') }
  }

  async function updateSampleStatus(sample: MarketingSample, status: MarketingSampleStatus) {
    if (!accessToken) return
    setBusy(`sample-${sample.id}`)
    try {
      await api.marketingLeads.updateSample(accessToken, sample.id, status)
      notify('success', 'Sample status updated.')
      await loadSamples()
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to update this sample.') }
    finally { setBusy('') }
  }

  async function exportSampleRequests() {
    if (!accessToken) return
    setBusy('sample-export')
    try {
      const file = await api.marketingLeads.exportMerchandisingSampleRequests(accessToken)
      saveDownload(file.blob, file.filename)
      notify('success', 'Sample requests exported to Excel.')
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to export sample requests.') }
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
  const roleScope = isSuperAdmin
    ? { label: 'Super Admin', description: 'Organization-wide Marketing handovers and customer sample records.' }
    : isMarketingAdmin
      ? { label: 'Marketing Department Admin', description: 'All Marketing team leads, samples and clarification activity.' }
      : isMarketing
        ? { label: 'Marketing Employee', description: 'Only your submitted leads, clarifications and customer samples.' }
        : isMerchandisingAdmin
          ? { label: 'Merchandising Department Admin', description: 'The complete incoming queue and decision history for the Merchandising team.' }
          : { label: 'Merchandising Employee', description: 'Active incoming leads, your clarification threads and leads you personally completed.' }
  const leadMetricPrefix = isMarketingAdmin || isMerchandisingAdmin || isSuperAdmin ? 'Department' : 'My'
  const awaitingMetricLabel = isMerchandising && !isMerchandisingAdmin ? 'Open review queue' : `${leadMetricPrefix} awaiting review`
  const sampleMetricPrefix = isMarketingAdmin || isSuperAdmin ? 'Team' : 'My'
  const leadDescription = isMarketingAdmin
    ? 'Review every Marketing team handover, answer team clarifications and monitor outcomes.'
    : isMarketing
      ? 'Send your leads and answer clarification questions. Merchandising only accepts, rejects or asks a question.'
      : isMerchandisingAdmin
        ? 'Review all Marketing handovers and the complete decision history for your department.'
        : 'Work on active Marketing handovers and revisit the leads you personally handled.'
  const sampleDescription = isMarketingAdmin || isSuperAdmin
    ? 'Review and manage customer samples recorded across the Marketing team.'
    : 'Record and manage your customer samples without requiring Merchandising to maintain the tracker.'

  return <main className="space-y-5 p-4 md:p-6">
    <PageHeader title={view === 'samples' ? 'Marketing Customer Samples' : 'Marketing Lead Handover'} description={view === 'samples' ? sampleDescription : leadDescription} actions={<>
      {view !== 'leads' ? <Button variant="outline" onClick={() => setView('leads')}><Send className="mr-2 h-4 w-4" />Lead handovers</Button> : null}
      {(isMarketing || isSuperAdmin) && view !== 'samples' ? <Button variant="outline" onClick={() => setView('samples')}><FlaskConical className="mr-2 h-4 w-4" />Customer samples</Button> : null}
      {isMerchandisingAdmin && view === 'leads' ? <Button variant="outline" onClick={() => void exportSampleRequests()} disabled={busy === 'sample-export'}>{busy === 'sample-export' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Export sample requests</Button> : null}
      {canCreate && view === 'leads' ? <Button onClick={() => setShowCreate(true)}><Plus className="mr-2 h-4 w-4" />Send new lead</Button> : null}
      {(isMarketing || isSuperAdmin) && view === 'samples' ? <Button onClick={() => setShowSampleCreate(true)}><Plus className="mr-2 h-4 w-4" />Record sample</Button> : null}
    </>} />
    <section className="flex flex-col gap-1 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-semibold">{roleScope.label}</p><p className="text-xs text-muted-foreground">{roleScope.description}</p></section>

    {view === 'samples' ? <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={`${sampleMetricPrefix} sample entries`} value={String(Object.values(sampleCounts).reduce((sum, count) => sum + count, 0))} />
        <MetricCard label="Awaiting feedback" value={String(sampleCounts.awaiting_feedback)} />
        <MetricCard label="Satisfied" value={String(sampleCounts.satisfied)} />
        <MetricCard label="Orders received" value={String(sampleCounts.order_received)} />
      </section>
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setSampleStatus('all')} className={`rounded-full px-3 py-1.5 text-xs font-medium ${sampleStatus === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>All · {Object.values(sampleCounts).reduce((sum, count) => sum + count, 0)}</button>{SAMPLE_STATUS_OPTIONS.map(([key, item]) => <button key={key} type="button" onClick={() => setSampleStatus(key)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${sampleStatus === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{item.label} · {sampleCounts[key]}</button>)}</div>
          <div className="relative max-w-xl"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input value={sampleSearch} onChange={(event) => setSampleSearch(event.target.value)} placeholder="Search company, fragrance, code or application" className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm" /></div>
        </div>
        {sampleLoading ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-primary" /></div> : shownSamples.length === 0 ? <div className="py-16 text-center"><FlaskConical className="mx-auto h-9 w-9 text-muted-foreground" /><p className="mt-3 font-medium">No customer samples here</p><p className="mt-1 text-sm text-muted-foreground">Record a sample dispatch to begin tracking feedback.</p></div> : <div className="divide-y divide-border">{shownSamples.map((sample) => <button key={sample.id} type="button" onClick={() => setSelectedSampleId(sample.id)} className="grid w-full gap-3 p-4 text-left transition hover:bg-muted/30 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{sample.company_name}</p><SampleStatus status={sample.status} /></div><p className="mt-1 truncate text-sm text-muted-foreground">{sample.items.map((item) => item.fragrance_name).join(', ')}</p></div>
          <div className="text-sm"><p>{sample.items.length} fragrance{sample.items.length === 1 ? '' : 's'}</p><p className="mt-1 text-xs text-muted-foreground">Ref: {sample.serial_number || 'Not provided'} · {sample.sample_date}</p></div>
          <div className="flex items-center justify-between gap-4 md:justify-end"><span className="text-xs text-muted-foreground">{sample.created_by_name}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /></div>
        </button>)}</div>}
      </section>
    </> : <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={awaitingMetricLabel} value={String(counts.submitted + counts.resubmitted)} />
        <MetricCard label={`${leadMetricPrefix} clarification required`} value={String(counts.clarification_required)} />
        <MetricCard label={`${leadMetricPrefix} accepted`} value={String(counts.accepted)} />
        <MetricCard label={`${leadMetricPrefix} rejected`} value={String(counts.rejected)} />
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
        <Field label="Lead source"><select value={form.lead_source} onChange={(event) => updateForm('lead_source', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">{SOURCE_OPTIONS.map((source) => <option key={source}>{source}</option>)}</select></Field>
        <Field label="Priority"><select value={form.priority} onChange={(event) => updateForm('priority', event.target.value as MarketingLeadPriority)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select></Field>
        <Field label="Customer requirement" required wide><textarea required minLength={5} rows={4} value={form.requirement} onChange={(event) => updateForm('requirement', event.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></Field>
        <Field label="Additional notes" wide><textarea rows={3} value={form.notes ?? ''} onChange={(event) => updateForm('notes', event.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></Field>
        <div className="border-t border-border pt-4 md:col-span-2"><h3 className="font-semibold">Sample details</h3><p className="mt-1 text-xs text-muted-foreground">Optional. These are the same columns used in the Customer Samples workbook and will be visible to Merchandising with the lead.</p></div>
        <Field label="SL No. / Sample reference"><input value={leadSample.serial_number ?? ''} onChange={(event) => setLeadSample((current) => ({ ...current, serial_number: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Sample date"><input type="date" value={leadSample.sample_date} onChange={(event) => setLeadSample((current) => ({ ...current, sample_date: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <SampleItemsEditor items={leadSample.items} onChange={(items) => setLeadSample((current) => ({ ...current, items }))} />
        <Field label="Sample remark" wide><textarea rows={3} value={leadSample.remark ?? ''} onChange={(event) => setLeadSample((current) => ({ ...current, remark: event.target.value }))} placeholder="Feedback, dispatch note or current result" className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></Field>
        {!form.phone_number?.trim() && !form.email?.trim() ? <div className="flex items-center gap-2 text-xs text-amber-500 md:col-span-2"><AlertCircle className="h-4 w-4" />Add at least a phone number or email address.</div> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-4"><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" disabled={busy === 'create' || (!form.phone_number?.trim() && !form.email?.trim())}>{busy === 'create' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send to Merchandising</Button></div>
    </form></ModalShell> : null}

    {showSampleCreate ? <ModalShell label="Record a customer sample" width="max-w-4xl" onClose={() => setShowSampleCreate(false)}><form onSubmit={createSample}>
      <div className="flex items-start justify-between border-b border-border p-5"><div><h2 className="text-lg font-semibold">Record customer sample</h2><p className="mt-1 text-sm text-muted-foreground">Company, date and at least one fragrance are required. All other workbook columns are optional.</p></div><button type="button" onClick={() => setShowSampleCreate(false)} aria-label="Close"><X className="h-5 w-5" /></button></div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <Field label="Company / customer" required><input required minLength={2} value={sampleForm.company_name} onChange={(event) => setSampleForm((current) => ({ ...current, company_name: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Sample date" required><input required type="date" value={sampleForm.sample_date} onChange={(event) => setSampleForm((current) => ({ ...current, sample_date: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="SL No. / Sample reference"><input value={sampleForm.serial_number ?? ''} onChange={(event) => setSampleForm((current) => ({ ...current, serial_number: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></Field>
        <Field label="Current status"><select value={sampleForm.status} onChange={(event) => setSampleForm((current) => ({ ...current, status: event.target.value as MarketingSampleStatus }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">{SAMPLE_STATUS_OPTIONS.map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></Field>
        <SampleItemsEditor items={sampleForm.items} onChange={(items) => setSampleForm((current) => ({ ...current, items }))} fragranceRequired />
        <Field label="Remark" wide><textarea rows={3} value={sampleForm.remark ?? ''} onChange={(event) => setSampleForm((current) => ({ ...current, remark: event.target.value }))} placeholder="Customer feedback or follow-up note" className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-4"><Button type="button" variant="outline" onClick={() => setShowSampleCreate(false)}>Cancel</Button><Button type="submit" disabled={busy === 'sample-create'}>{busy === 'sample-create' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}Save sample</Button></div>
    </form></ModalShell> : null}

    {selectedSample ? <ModalShell label={`Sample for ${selectedSample.company_name}`} width="max-w-4xl" onClose={() => setSelectedSampleId(null)}>
      <div className="flex items-start justify-between border-b border-border p-5"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{selectedSample.company_name}</h2><SampleStatus status={selectedSample.status} /></div><p className="mt-1 text-sm text-muted-foreground">Recorded by {selectedSample.created_by_name} · {selectedSample.sample_date}</p></div><button type="button" onClick={() => setSelectedSampleId(null)} aria-label="Close"><X className="h-5 w-5" /></button></div>
      <div className="space-y-5 p-5">
        <section className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-3"><div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">SL No. / Reference</p><p className="mt-1 text-sm font-medium">{selectedSample.serial_number || '—'}</p></div><div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Linked lead</p><p className="mt-1 text-sm font-medium">{selectedSample.linked_lead_id ? 'Yes' : 'Standalone sample'}</p></div><Field label="Update status"><select disabled={busy === `sample-${selectedSample.id}`} value={selectedSample.status} onChange={(event) => void updateSampleStatus(selectedSample, event.target.value as MarketingSampleStatus)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">{SAMPLE_STATUS_OPTIONS.map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></Field></section>
        <section className="overflow-hidden rounded-xl border border-border"><div className="overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="p-3 text-left">Fragrance name</th><th>Code</th><th>Application</th><th>Quantity</th><th>Cost</th></tr></thead><tbody>{selectedSample.items.map((item) => <tr key={item.id} className="border-t border-border"><td className="p-3 font-medium">{item.fragrance_name}</td><td className="text-center">{item.fragrance_code || '—'}</td><td className="text-center">{item.application || '—'}</td><td className="text-center">{item.quantity || '—'}</td><td className="text-center">{item.cost || '—'}</td></tr>)}</tbody></table></div></section>
        <section className="rounded-xl border border-border p-4"><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remark</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{selectedSample.remark || 'No remark added.'}</p></section>
      </div>
    </ModalShell> : null}

    {selected ? <ModalShell label={`Lead from ${selected.company_name}`} width="max-w-4xl" onClose={() => setSelectedId(null)}>
      <div className="flex items-start justify-between border-b border-border p-5"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{selected.company_name}</h2><LeadStatus status={selected.status} /></div><p className="mt-1 text-sm text-muted-foreground">Submitted by {selected.created_by_name} · {humanDate(selected.submitted_at)}</p></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Close"><X className="h-5 w-5" /></button></div>
      <div className="space-y-5 p-5">
        <section className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-3">{[
          ['Contact', selected.contact_person], ['Phone', selected.phone_number || '—'], ['Email', selected.email || '—'], ['Region', `${selected.region}${selected.country ? `, ${selected.country}` : ''}`], ['Product', selected.product_interest], ['Expected quantity', selected.expected_quantity || '—'], ['Source', selected.lead_source], ['Priority', selected.priority],
        ].map(([label, value]) => <div key={label}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium capitalize">{value}</p></div>)}</section>
        <section className="rounded-xl border border-border p-4"><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer requirement</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{selected.requirement}</p>{selected.notes ? <><h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Additional notes</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{selected.notes}</p></> : null}</section>
        {selected.samples.map((sample) => <section key={sample.id} className="overflow-hidden rounded-xl border border-border"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/20 p-4"><div><h3 className="font-semibold">Customer sample details</h3><p className="mt-1 text-xs text-muted-foreground">SL No. / Ref: {sample.serial_number || '—'} · Date: {sample.sample_date}</p></div><SampleStatus status={sample.status} /></div><div className="overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="p-3 text-left">Fragrance name</th><th>Code</th><th>Application</th><th>Quantity</th><th>Cost</th></tr></thead><tbody>{sample.items.map((item) => <tr key={item.id} className="border-t border-border"><td className="p-3 font-medium">{item.fragrance_name}</td><td className="text-center">{item.fragrance_code || '—'}</td><td className="text-center">{item.application || '—'}</td><td className="text-center">{item.quantity || '—'}</td><td className="text-center">{item.cost || '—'}</td></tr>)}</tbody></table></div>{sample.remark ? <div className="border-t border-border p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remark</p><p className="mt-2 whitespace-pre-wrap text-sm">{sample.remark}</p></div> : null}</section>)}

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
