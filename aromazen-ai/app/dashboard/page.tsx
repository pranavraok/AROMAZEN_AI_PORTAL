'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, BellRing, CalendarCheck2, FileText, GitCompareArrows, RefreshCw, WalletCards } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { Button, buttonVariants } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { MetricCard } from '@/components/ui/metric-card'
import { StatusBadge } from '@/components/ui/status-badge'
import { useAuth } from '@/components/auth/auth-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { DashboardOverview } from '@/lib/api/types'

function money(value: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 4 : 2 }).format(value) }
function dateTime(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function actionLabel(value: string) { return value.split('.').pop()?.replaceAll('_', ' ') ?? value }
function documentStatus(value: string): 'Indexed' | 'Processing' | 'Failed' { return value === 'ready' ? 'Indexed' : value === 'failed' ? 'Failed' : 'Processing' }
const hrIcons = { attendance: CalendarCheck2, leaves: CalendarCheck2, letters: FileText, payroll: WalletCards, knowledge: BellRing }

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
  const isPlatformAdmin = user?.role_names.some((role) => role === 'Admin' || role === 'Super Admin') ?? false
  const isAccountsAdmin = !isPlatformAdmin && user?.department_name === 'Accounts' && user.role_names.includes('Department Admin')
  const showAccountsActionCenter = !isPlatformAdmin && user?.department_name === 'Accounts' && user.role_names.some((role) => role === 'Department Admin' || role === 'Employee')

  return <AppLayout><div className="space-y-6 p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Operational overview</p><h1 className="text-2xl font-semibold tracking-[-0.035em] md:text-[30px]">Welcome back, {user?.full_name?.split(' ')[0]}</h1><p className="mt-2 text-sm text-muted-foreground">A live view of the knowledge, activity, and AI usage available to you.</p></div>
      <Button variant="outline" onClick={() => void load()} disabled={refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button>
    </div>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
    {showAccountsActionCenter ? <section className="overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm">
      <div className="border-b border-border bg-primary/[0.04] px-5 py-5"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-primary">Accounts team only</p><h2 className="mt-1 text-lg font-semibold">Accounts Action Center</h2><p className="mt-1 text-sm text-muted-foreground">Monthly reporting and GST checks for the Accounts team.</p></div>
      <div className="grid gap-3 p-4 md:grid-cols-2">{isAccountsAdmin ? <Link href="/accounts/cash-flow" className="flex items-center gap-4 rounded-xl border border-border p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><WalletCards className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Monthly Cash Flow Report</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Generate and download the protected cash-flow PDF.</span></span><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /></Link> : null}<Link href="/accounts/gst-reconciliation" className="flex items-center gap-4 rounded-xl border border-border p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><GitCompareArrows className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">GST Reconciliation</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Compare Tally invoices with GST Portal GSTR-2B.</span></span><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /></Link></div>
    </section> : null}
    {overview?.hr_action_center && <section className="overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm">
      <div className="flex flex-col gap-4 border-b border-border bg-primary/[0.04] px-5 py-5 md:flex-row md:items-center md:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-primary">HR Admin only</p><h2 className="mt-1 text-lg font-semibold">HR Action Center</h2><p className="mt-1 text-sm text-muted-foreground">The important work and exceptions that need HR attention.</p></div><div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4"><div className="rounded-xl bg-background px-3 py-2"><p className="font-semibold text-amber-500">{overview.hr_action_center.due_reminders}</p><p className="text-[10px] text-muted-foreground">Due reminders</p></div><div className="rounded-xl bg-background px-3 py-2"><p className="font-semibold text-destructive">{overview.hr_action_center.overdue_documents}</p><p className="text-[10px] text-muted-foreground">Overdue</p></div><div className="rounded-xl bg-background px-3 py-2"><p className="font-semibold">{overview.hr_action_center.rule_documents}</p><p className="text-[10px] text-muted-foreground">HR rules</p></div><div className="rounded-xl bg-background px-3 py-2"><p className="font-semibold">{overview.hr_action_center.open_payroll_batches}</p><p className="text-[10px] text-muted-foreground">Payroll actions</p></div></div></div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">{overview.hr_action_center.items.map((item) => { const Icon = hrIcons[item.key as keyof typeof hrIcons] ?? FileText; const body = <><div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${item.tone === 'disabled' ? 'bg-muted text-muted-foreground' : item.tone === 'danger' ? 'bg-destructive/10 text-destructive' : item.tone === 'warning' ? 'bg-amber-500/10 text-amber-500' : 'bg-primary/10 text-primary'}`}><Icon className="h-5 w-5" /></div><div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold">{item.title}</h3>{item.count !== null && item.count > 0 && <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-white">{item.count}</span>}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>{item.tone === 'disabled' && <span className="mt-3 inline-flex rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">Space reserved</span>}</>; return item.tone === 'disabled' ? <div id="asset-management" key={item.key} className="rounded-xl border border-dashed border-border bg-muted/20 p-4 opacity-80">{body}</div> : <Link key={item.key} href={item.href} className="rounded-xl border border-border p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30">{body}</Link> })}</div>
    </section>}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">{overview?.metrics.map((metric) => <MetricCard key={metric.key} label={metric.label} value={metric.format === 'currency' ? money(metric.value) : metric.value.toLocaleString()} />) ?? Array.from({ length: 4 }, (_, index) => <MetricCard key={index} label="Loading…" value="—" />)}</div>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3"><div className="space-y-6 lg:col-span-2">
      {overview && ['platform', 'organization'].includes(overview.scope) && <section className="overflow-hidden rounded-lg border border-border bg-card"><div className="border-b border-border px-6 py-4"><h2 className="font-semibold">Department Usage This Month</h2><p className="text-xs text-muted-foreground">Visible only to Super Admin and Admin</p></div><DataTable columns={[{ header: 'Department', key: 'department' as const }, { header: 'AI Requests', key: 'requests' as const }, { header: 'Estimated Cost', key: 'cost' as const }]} data={departmentRows} compact /></section>}
      <section className="overflow-hidden rounded-lg border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-6 py-4"><div><h2 className="font-semibold">Recent Documents</h2><p className="text-xs text-muted-foreground">Only documents within your access scope</p></div><Link href="/knowledge" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'text-primary' })}>View all <ArrowRight className="ml-1 h-4 w-4" /></Link></div><DataTable columns={[{ header: 'Document', key: 'name' as const }, { header: 'Collection', key: 'collection' as const }, { header: 'Uploader', key: 'uploader' as const }, { header: 'Status', key: 'status' as const, render: (value) => <StatusBadge status={documentStatus(String(value))} /> }, { header: 'Version', key: 'version' as const }, { header: 'Date', key: 'date' as const }]} data={documentRows} compact /></section>
    </div><aside className="rounded-lg border border-border bg-card p-6"><h2 className="font-semibold">Recent Activity</h2><p className="mb-4 text-xs text-muted-foreground">Filtered to {overview?.scope_label?.toLowerCase() ?? 'your scope'}</p><div className="space-y-4">{overview?.recent_activity.map((activity) => <div key={activity.id} className="flex gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{activity.actor.charAt(0)}</div><div className="min-w-0"><p className="text-sm"><span className="font-medium">{activity.actor}</span> <span className="capitalize text-muted-foreground">{actionLabel(activity.action)}</span></p><p className="mt-1 text-xs text-muted-foreground">{dateTime(activity.created_at)} · {activity.department}</p></div></div>)}{overview?.recent_activity.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No activity in this scope yet.</p>}</div></aside></div>
    {overview && <p className="text-right text-xs text-muted-foreground">Live data · refreshed {dateTime(overview.refreshed_at)} · costs in Indian rupees at ₹{overview.usd_to_inr_rate.toFixed(2)} · updates every 30 seconds</p>}
  </div></AppLayout>
}
