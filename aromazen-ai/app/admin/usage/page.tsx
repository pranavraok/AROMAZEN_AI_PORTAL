'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Coins, Loader2, MessageSquareText, TrendingUp, Users } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { MetricCard } from '@/components/ui/metric-card'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { UsageSummary } from '@/lib/api/types'

function money(value: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 4 : 2 }).format(value) }
function tokens(value: number) { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : value.toLocaleString() }
function dateInput(value: Date) { return value.toISOString().slice(0, 10) }

export default function AdminUsagePage() {
  const { accessToken } = useAuth()
  const { notify } = useToast()
  const now = useMemo(() => new Date(), [])
  const [dateFrom, setDateFrom] = useState(dateInput(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [dateTo, setDateTo] = useState(dateInput(now))
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!accessToken || !dateFrom || !dateTo) return
    setLoading(true)
    try { setSummary(await api.workspace.usageSummary(accessToken, { dateFrom, dateTo })) }
    catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to load usage analytics.') }
    finally { setLoading(false) }
  }, [accessToken, dateFrom, dateTo, notify])
  useEffect(() => { void load() }, [load])

  const maxRequests = Math.max(1, ...(summary?.timeseries.map((row) => row.requests) ?? [1]))
  const maxDepartment = Math.max(1, ...(summary?.departments.map((row) => row.requests) ?? [1]))
  const providerTotal = summary?.providers.reduce((sum, row) => sum + row.requests, 0) ?? 0
  const palette = ['#b96316', '#2e5845', '#718096', '#a28868']
  let angle = 0
  const providerGradient = summary?.providers.length ? `conic-gradient(${summary.providers.map((row, index) => { const start = angle; angle += providerTotal ? row.requests / providerTotal * 360 : 0; return `${palette[index % palette.length]} ${start}deg ${angle}deg` }).join(',')})` : '#eeece5'

  return <AppLayout><div className="space-y-6 p-6">
    <PageHeader title="AI Analytics" description="Trends, adoption, provider mix, and cost patterns—not another dashboard." actions={<div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-sm"><CalendarDays className="ml-1 h-4 w-4 text-muted-foreground" /><input aria-label="Start date" type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} className="rounded-lg bg-muted px-2 py-1.5 text-xs" /><span className="text-xs text-muted-foreground">to</span><input aria-label="End date" type="date" value={dateTo} min={dateFrom} max={dateInput(now)} onChange={(event) => setDateTo(event.target.value)} className="rounded-lg bg-muted px-2 py-1.5 text-xs" />{loading && <Loader2 className="mr-1 h-4 w-4 animate-spin text-muted-foreground" />}</div>} />

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><MetricCard label="Period cost" value={summary ? money(summary.totals.cost) : '—'} /><MetricCard label="AI requests" value={summary ? summary.totals.requests.toLocaleString() : '—'} /><MetricCard label="Input tokens" value={summary ? tokens(summary.totals.input_tokens) : '—'} /><MetricCard label="Output tokens" value={summary ? tokens(summary.totals.output_tokens) : '—'} /></div>

    <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
      <section className="rounded-2xl border border-border bg-card p-6"><div className="flex items-start justify-between"><div><p className="text-sm font-semibold">Request activity</p><p className="mt-1 text-xs text-muted-foreground">Daily AI requests across the selected period</p></div><TrendingUp className="h-5 w-5 text-primary" /></div><div className="mt-8 flex h-64 items-end gap-1.5 border-b border-border px-1">{summary?.timeseries.length ? summary.timeseries.map((row) => <div key={row.date} className="group relative flex h-full min-w-0 flex-1 items-end justify-center"><div className="min-h-1 w-full max-w-8 rounded-t-md bg-primary/80 transition-all hover:bg-primary" style={{ height: `${Math.max(4, row.requests / maxRequests * 100)}%` }} /><div className="pointer-events-none absolute bottom-[calc(100%+8px)] z-10 hidden w-32 rounded-lg bg-foreground px-2 py-1.5 text-center text-[10px] text-background shadow-xl group-hover:block">{new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}<br />{row.requests} requests · {money(row.cost)}</div></div>) : <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">No AI activity in this date range.</div>}</div><div className="mt-3 flex justify-between text-[10px] text-muted-foreground"><span>{dateFrom}</span><span>{dateTo}</span></div></section>

      <section className="rounded-2xl border border-border bg-card p-6"><div><p className="text-sm font-semibold">Provider mix</p><p className="mt-1 text-xs text-muted-foreground">Share of requests by provider and model</p></div><div className="mt-7 flex items-center gap-7"><div className="relative h-36 w-36 shrink-0 rounded-full" style={{ background: providerGradient }}><div className="absolute inset-5 grid place-items-center rounded-full bg-card text-center"><div><p className="text-2xl font-semibold">{providerTotal}</p><p className="text-[10px] text-muted-foreground">requests</p></div></div></div><div className="min-w-0 flex-1 space-y-3">{summary?.providers.map((row, index) => <div key={`${row.provider}-${row.model}`} className="flex items-center gap-2 text-xs"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} /><span className="min-w-0 flex-1 truncate capitalize">{row.provider} · {row.model}</span><span className="font-medium">{row.requests}</span></div>)}</div></div></section>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl border border-border bg-card p-6"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><p className="text-sm font-semibold">Department adoption</p></div><div className="mt-6 space-y-4">{summary?.departments.map((row) => <div key={row.department}><div className="mb-1.5 flex justify-between text-xs"><span>{row.department}</span><span className="text-muted-foreground">{row.requests} · {money(row.cost)}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${row.requests / maxDepartment * 100}%` }} /></div></div>)}{summary?.departments.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No department activity for this period.</p>}</div></section>
      <section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center gap-2 border-b border-border px-6 py-5"><MessageSquareText className="h-4 w-4 text-primary" /><div><p className="text-sm font-semibold">Highest usage</p><p className="text-xs text-muted-foreground">Employees with the most AI activity in this period</p></div></div><div className="divide-y divide-border">{summary?.users.slice(0, 8).map((row, index) => <div key={`${row.name}-${row.department}-${row.provider}-${row.model}-${index}`} className="flex items-center gap-3 px-6 py-3.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-xs font-semibold">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{row.name}</p><p className="truncate text-xs text-muted-foreground">{row.department} · {row.provider}</p></div><div className="text-right"><p className="text-sm font-semibold">{row.requests}</p><p className="text-[10px] text-muted-foreground">{money(row.cost)}</p></div></div>)}{summary?.users.length === 0 && <p className="px-6 py-14 text-center text-sm text-muted-foreground">No employee activity for this period.</p>}</div></section>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Coins className="h-3.5 w-3.5" />Costs are estimates in Indian rupees based on recorded provider usage.{summary && <span>Latest reference rate: ₹{summary.usd_to_inr_rate.toFixed(2)} · updated {new Date(summary.exchange_rate_updated_at).toLocaleDateString()}</span>}</div>
  </div></AppLayout>
}
