'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { MetricCard } from '@/components/ui/metric-card'
import { StatusBadge } from '@/components/ui/status-badge'
import { useAuth } from '@/components/auth/auth-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { DashboardOverview } from '@/lib/api/types'

function money(value: number) { return `$${value.toFixed(value < 1 ? 4 : 2)}` }
function dateTime(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function actionLabel(value: string) { return value.split('.').pop()?.replaceAll('_', ' ') ?? value }
function documentStatus(value: string): 'Indexed' | 'Processing' | 'Failed' { return value === 'ready' ? 'Indexed' : value === 'failed' ? 'Failed' : 'Processing' }

export default function DashboardPage() {
  const { accessToken, user } = useAuth()
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const load = useCallback(async (quiet = false) => {
    if (!accessToken) return
    if (!quiet) setRefreshing(true)
    try { setOverview(await api.dashboard.overview(accessToken)); setError('') }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Unable to load the live dashboard.') }
    finally { if (!quiet) setRefreshing(false) }
  }, [accessToken])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const departmentRows = (overview?.department_usage ?? []).map((row) => ({ ...row, cost: money(row.cost) }))
  const documentRows = (overview?.recent_documents ?? []).map((row) => ({ ...row, date: dateTime(row.created_at) }))

  return <AppLayout><div className="space-y-6 p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="text-3xl font-semibold">Welcome, {user?.full_name?.split(' ')[0]}</h1><p className="mt-1 text-muted-foreground">Live operational data, filtered to your assigned access.</p></div>
      <Button variant="outline" onClick={() => void load()} disabled={refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button>
    </div>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
    <section className="rounded-xl border border-primary/25 bg-primary/5 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex gap-3"><div className="rounded-lg bg-primary/15 p-2 text-primary"><ShieldCheck className="h-5 w-5" /></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{overview?.role_label ?? 'Loading role…'}</h2>{overview && <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary capitalize">{overview.scope} scope</span>}</div><p className="mt-1 text-sm text-muted-foreground">{overview?.scope_label ?? 'Checking your data scope…'}</p></div></div>
      <div className="grid gap-2 text-sm sm:grid-cols-2">{overview?.capabilities.map((item) => <div key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /><span>{item}</span></div>)}</div>
    </div></section>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">{overview?.metrics.map((metric) => <MetricCard key={metric.key} label={metric.label} value={metric.format === 'currency' ? money(metric.value) : metric.value.toLocaleString()} />) ?? Array.from({ length: 4 }, (_, index) => <MetricCard key={index} label="Loading…" value="—" />)}</div>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3"><div className="space-y-6 lg:col-span-2">
      {overview && ['platform', 'organization'].includes(overview.scope) && <section className="overflow-hidden rounded-lg border border-border bg-card"><div className="border-b border-border px-6 py-4"><h2 className="font-semibold">Department Usage This Month</h2><p className="text-xs text-muted-foreground">Visible only to Super Admin and Admin</p></div><DataTable columns={[{ header: 'Department', key: 'department' as const }, { header: 'AI Requests', key: 'requests' as const }, { header: 'Estimated Cost', key: 'cost' as const }]} data={departmentRows} compact /></section>}
      <section className="overflow-hidden rounded-lg border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-6 py-4"><div><h2 className="font-semibold">Recent Documents</h2><p className="text-xs text-muted-foreground">Only documents within your access scope</p></div><Link href="/knowledge"><Button variant="ghost" size="sm" className="text-primary">View all <ArrowRight className="ml-1 h-4 w-4" /></Button></Link></div><DataTable columns={[{ header: 'Document', key: 'name' as const }, { header: 'Collection', key: 'collection' as const }, { header: 'Uploader', key: 'uploader' as const }, { header: 'Status', key: 'status' as const, render: (value) => <StatusBadge status={documentStatus(String(value))} /> }, { header: 'Version', key: 'version' as const }, { header: 'Date', key: 'date' as const }]} data={documentRows} compact /></section>
    </div><aside className="rounded-lg border border-border bg-card p-6"><h2 className="font-semibold">Recent Activity</h2><p className="mb-4 text-xs text-muted-foreground">Filtered to {overview?.scope_label?.toLowerCase() ?? 'your scope'}</p><div className="space-y-4">{overview?.recent_activity.map((activity) => <div key={activity.id} className="flex gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{activity.actor.charAt(0)}</div><div className="min-w-0"><p className="text-sm"><span className="font-medium">{activity.actor}</span> <span className="capitalize text-muted-foreground">{actionLabel(activity.action)}</span></p><p className="mt-1 text-xs text-muted-foreground">{dateTime(activity.created_at)} · {activity.department}</p></div></div>)}{overview?.recent_activity.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No activity in this scope yet.</p>}</div></aside></div>
    {overview && <p className="text-right text-xs text-muted-foreground">Live data · refreshed {dateTime(overview.refreshed_at)} · updates every 30 seconds</p>}
  </div></AppLayout>
}
