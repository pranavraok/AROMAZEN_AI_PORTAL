'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Download,
  FlaskConical,
  LoaderCircle,
  MapPinned,
  PackageCheck,
  RefreshCw,
  Send,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { useAuth } from '@/components/auth/auth-provider'
import { PageHeader } from '@/components/ui/page-header'
import { MetricCard } from '@/components/ui/metric-card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type {
  MarketingAnalysisFeedItem,
  MarketingLiveAnalysis,
  MarketingReportRow,
} from '@/lib/api/types'

const RANGE_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 12 months' },
  { value: 0, label: 'All time' },
]

function readableStatus(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function shortDate(value: string | null) {
  if (!value) return 'No activity yet'
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
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

function BreakdownList({
  title,
  description,
  rows,
  icon: Icon,
}: {
  title: string
  description: string
  rows: { label: string; count: number }[]
  icon: typeof TrendingUp
}) {
  const topRows = rows.slice(0, 6)
  const maximum = Math.max(1, ...topRows.map((row) => row.count))
  return <section className="rounded-2xl border border-border bg-card p-5">
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
      <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>
    </div>
    <div className="mt-5 space-y-4">
      {topRows.map((row) => <div key={row.label}>
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs"><span className="truncate">{row.label}</span><span className="shrink-0 font-semibold">{row.count}</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(5, row.count / maximum * 100)}%` }} /></div>
      </div>)}
      {topRows.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No activity in this range.</p> : null}
    </div>
  </section>
}

function RegionTable({ rows }: { rows: MarketingReportRow[] }) {
  return <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="flex items-start gap-3 border-b border-border p-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><MapPinned className="h-4 w-4" /></span>
      <div><h2 className="text-sm font-semibold">Regional performance</h2><p className="mt-0.5 text-xs text-muted-foreground">Lead volume and completed outcomes by region.</p></div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Region</th><th className="px-3 py-3 font-medium">Leads</th><th className="px-3 py-3 font-medium">Accepted</th><th className="px-3 py-3 font-medium">Pending</th><th className="px-5 py-3 text-right font-medium">Acceptance</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.slice(0, 8).map((row) => <tr key={row.label}><td className="px-5 py-3 font-medium">{row.label}</td><td className="px-3 py-3">{row.total}</td><td className="px-3 py-3">{row.accepted}</td><td className="px-3 py-3">{row.pending}</td><td className="px-5 py-3 text-right font-semibold">{row.acceptance_rate.toFixed(1)}%</td></tr>)}</tbody>
      </table>
      {rows.length === 0 ? <p className="px-5 py-12 text-center text-xs text-muted-foreground">No regional lead activity in this range.</p> : null}
    </div>
  </section>
}

function FeedIcon({ item }: { item: MarketingAnalysisFeedItem }) {
  if (item.kind === 'sample') return <FlaskConical className="h-4 w-4" />
  if (item.status === 'accepted') return <CheckCircle2 className="h-4 w-4" />
  if (item.status === 'questioned' || item.status === 'clarification_replied') return <CircleHelp className="h-4 w-4" />
  return <Send className="h-4 w-4" />
}

export default function MarketingAnalysisPage() {
  const { accessToken } = useAuth()
  const { notify } = useToast()
  const [rangeDays, setRangeDays] = useState(30)
  const [analysis, setAnalysis] = useState<MarketingLiveAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [exportingEmployee, setExportingEmployee] = useState('')

  const load = useCallback(async (quiet = false) => {
    if (!accessToken) return
    if (!quiet) setRefreshing(true)
    try { setAnalysis(await api.marketingLeads.liveAnalysis(accessToken, rangeDays)) }
    catch (error) { if (!quiet) notify('error', error instanceof ApiError ? error.message : 'Unable to load Marketing Analysis.') }
    finally { setLoading(false); if (!quiet) setRefreshing(false) }
  }, [accessToken, notify, rangeDays])

  useEffect(() => {
    setLoading(true)
    void load()
    const timer = window.setInterval(() => void load(true), 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  const generatedLabel = useMemo(() => analysis ? new Date(analysis.generated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—', [analysis])

  async function exportEmployee(employeeId: string) {
    if (!accessToken) return
    setExportingEmployee(employeeId)
    try {
      const file = await api.marketingLeads.employeeAnalysisPdf(accessToken, employeeId, rangeDays)
      saveDownload(file.blob, file.filename)
      notify('success', 'Structured employee PDF downloaded.')
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to export this employee report.') }
    finally { setExportingEmployee('') }
  }

  return <AppLayout><div className="space-y-6 p-4 md:p-6">
    <PageHeader title="Marketing Analysis" description="A live Super Admin view of Marketing leads, Merchandising outcomes, customer samples and employee follow-through." actions={<div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
      <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 text-xs text-emerald-600 dark:text-emerald-400"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>Live · updated {generatedLabel}</span>
      <select aria-label="Reporting range" value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))} className="h-10 rounded-xl border border-border bg-card px-3 text-sm">{RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <Button variant="outline" onClick={() => void load()} disabled={refreshing}>{refreshing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh</Button>
    </div>} />

    {loading && !analysis ? <div className="grid min-h-[420px] place-items-center rounded-2xl border border-border bg-card"><div className="text-center"><LoaderCircle className="mx-auto h-7 w-7 animate-spin text-primary" /><p className="mt-3 text-sm text-muted-foreground">Preparing the live Marketing view…</p></div></div> : analysis ? <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Leads submitted" value={analysis.summary.total_leads.toLocaleString()} trend={`${analysis.summary.leads_today} added today`} positive={analysis.summary.leads_today > 0} />
        <MetricCard label="Accepted by Merchandising" value={analysis.summary.accepted.toLocaleString()} trend={`${analysis.summary.rejected} rejected · ${analysis.summary.acceptance_rate.toFixed(1)}% acceptance`} positive={analysis.summary.acceptance_rate >= 50} />
        <MetricCard label="Decision completion" value={`${analysis.summary.decision_rate.toFixed(1)}%`} trend={`${analysis.summary.pending_review} awaiting review`} positive={analysis.summary.pending_review === 0} />
        <MetricCard label="Average first response" value={analysis.summary.average_response_hours === null ? '—' : `${analysis.summary.average_response_hours.toFixed(1)}h`} trend={`${analysis.summary.clarification_required} need clarification`} positive={analysis.summary.clarification_required === 0} />
        <MetricCard label="Customer sample entries" value={analysis.summary.total_samples.toLocaleString()} trend={`${analysis.summary.samples_today} added today`} positive={analysis.summary.samples_today > 0} />
        <MetricCard label="Sample items" value={analysis.summary.sample_items.toLocaleString()} trend={`${analysis.summary.awaiting_feedback} awaiting feedback`} positive={analysis.summary.awaiting_feedback === 0} />
        <MetricCard label="Orders received" value={analysis.summary.orders_received.toLocaleString()} trend={`${analysis.summary.satisfied} satisfied samples`} positive={analysis.summary.orders_received > 0} />
        <MetricCard label="Sample-to-order" value={`${analysis.summary.sample_to_order_rate.toFixed(1)}%`} trend={`Across ${analysis.period_label.toLowerCase()}`} positive={analysis.summary.sample_to_order_rate > 0} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Users className="h-4 w-4" /></span><div><h2 className="text-sm font-semibold">Employee performance</h2><p className="mt-0.5 text-xs text-muted-foreground">All active Marketing team members are shown, including employees with no activity. Export uses the selected range.</p></div></div>
          <span className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">{analysis.employees.length} active team member{analysis.employees.length === 1 ? '' : 's'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Employee</th><th className="px-3 py-3 font-medium">Lead movement</th><th className="px-3 py-3 font-medium">Decision rate</th><th className="px-3 py-3 font-medium">Acceptance</th><th className="px-3 py-3 font-medium">Samples</th><th className="px-3 py-3 font-medium">Orders</th><th className="px-3 py-3 font-medium">Last activity</th><th className="px-5 py-3 text-right font-medium">Report</th></tr></thead>
            <tbody className="divide-y divide-border">{analysis.employees.map((employee) => <tr key={employee.employee_id} className="transition hover:bg-muted/25">
              <td className="px-5 py-4"><p className="font-semibold">{employee.employee_name}</p><p className="mt-1 text-[11px] text-muted-foreground">{employee.total_leads} submitted · {employee.accepted} accepted</p></td>
              <td className="px-3 py-4"><p>{employee.pending} pending</p><p className="mt-1 text-[11px] text-muted-foreground">{employee.clarification_required} clarification · {employee.rejected} rejected</p></td>
              <td className="px-3 py-4 font-semibold">{employee.decision_rate.toFixed(1)}%</td>
              <td className="px-3 py-4 font-semibold">{employee.acceptance_rate.toFixed(1)}%</td>
              <td className="px-3 py-4"><p>{employee.sample_batches} entries</p><p className="mt-1 text-[11px] text-muted-foreground">{employee.sample_items} fragrance items</p></td>
              <td className="px-3 py-4"><p className="font-semibold">{employee.orders_received}</p><p className="mt-1 text-[11px] text-muted-foreground">{employee.sample_to_order_rate.toFixed(1)}% conversion</p></td>
              <td className="px-3 py-4 text-muted-foreground">{shortDate(employee.last_activity_at)}</td>
              <td className="px-5 py-4 text-right"><Button size="sm" variant="outline" onClick={() => void exportEmployee(employee.employee_id)} disabled={Boolean(exportingEmployee)}>{exportingEmployee === employee.employee_id ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}Export PDF</Button></td>
            </tr>)}</tbody>
          </table>
          {analysis.employees.length === 0 ? <p className="px-5 py-14 text-center text-sm text-muted-foreground">No active Marketing employees were found.</p> : null}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-start gap-3 border-b border-border p-5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Activity className="h-4 w-4" /></span><div><h2 className="text-sm font-semibold">Live activity feed</h2><p className="mt-0.5 text-xs text-muted-foreground">Lead submissions, questions, replies, decisions and sample updates in one feed. Refreshes every minute.</p></div></div>
          <div className="max-h-[660px] divide-y divide-border overflow-y-auto">{analysis.recent_activity.map((item) => <div key={item.id} className="flex gap-3 px-5 py-4">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-primary"><FeedIcon item={item} /></span>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{item.title}</p><span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{readableStatus(item.status)}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p><p className="mt-1.5 text-[11px] text-muted-foreground"><span className="font-medium text-foreground/75">{item.actor_name}</span> · Marketing owner: {item.employee_name}</p></div>
            <span className="shrink-0 text-[10px] text-muted-foreground">{shortDate(item.occurred_at)}</span>
          </div>)}{analysis.recent_activity.length === 0 ? <p className="px-5 py-16 text-center text-sm text-muted-foreground">No Marketing activity in this range.</p> : null}</div>
        </section>

        <div className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <BreakdownList title="Lead sources" description="Where new opportunities are coming from." rows={analysis.lead_sources} icon={Target} />
          <BreakdownList title="Products in demand" description="Most requested product categories." rows={analysis.product_interests} icon={TrendingUp} />
          <BreakdownList title="Sample applications" description="How customer fragrance samples will be used." rows={analysis.sample_applications} icon={FlaskConical} />
        </div>
      </div>

      <RegionTable rows={analysis.regions} />

      <section className="grid gap-3 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 text-xs text-muted-foreground md:grid-cols-3">
        <div className="flex gap-2"><PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p><span className="font-semibold text-foreground">Separate measures:</span> lead acceptance and sample-to-order conversion are not blended into an unclear score.</p></div>
        <div className="flex gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p><span className="font-semibold text-foreground">Live reporting:</span> the screen refreshes automatically every minute and can be refreshed manually.</p></div>
        <div className="flex gap-2"><Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p><span className="font-semibold text-foreground">Structured PDFs:</span> each employee export includes summary metrics, lead details and customer sample follow-through.</p></div>
      </section>
    </> : null}
  </div></AppLayout>
}
