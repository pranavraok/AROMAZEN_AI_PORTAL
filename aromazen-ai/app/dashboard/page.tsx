'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { DepartmentActionCenter, DepartmentDirectory, departmentActions } from '@/components/departments/department-action-center'
import { ExecutiveVisualizations } from '@/components/dashboard/executive-visualizations'
import { Button, buttonVariants } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { MetricCard } from '@/components/ui/metric-card'
import { StatusBadge } from '@/components/ui/status-badge'
import { useAuth } from '@/components/auth/auth-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { DashboardOverview, Department } from '@/lib/api/types'

function money(value: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 4 : 2 }).format(value) }
function dateTime(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function actionLabel(value: string) { return value.split('.').pop()?.replaceAll('_', ' ') ?? value }
function documentStatus(value: string): 'Indexed' | 'Processing' | 'Failed' { return value === 'ready' ? 'Indexed' : value === 'failed' ? 'Failed' : 'Processing' }
export default function DashboardPage() {
  const { accessToken, user } = useAuth()
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const load = useCallback(async (quiet = false) => {
    if (!accessToken) return
    if (!quiet) setRefreshing(true)
    const canLoadDepartments = user?.role_names.some((role) => role === 'Admin' || role === 'Department Admin') ?? false
    try {
      const [nextOverview, nextDepartments] = await Promise.all([
        api.dashboard.overview(accessToken),
        canLoadDepartments ? api.admin.departments(accessToken) : Promise.resolve([]),
      ])
      setOverview(nextOverview)
      setDepartments(nextDepartments)
      setError('')
    }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Unable to load the live dashboard.') }
    finally { if (!quiet) setRefreshing(false) }
  }, [accessToken, user?.role_names])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const departmentRows = (overview?.department_usage ?? []).map((row) => ({ ...row, cost: money(row.cost) }))
  const documentRows = (overview?.recent_documents ?? []).map((row) => ({ ...row, date: dateTime(row.created_at) }))
  const isAdmin = user?.role_names.includes('Admin') ?? false
  const isSuperAdmin = user?.role_names.includes('Super Admin') ?? false
  const isDepartmentAdmin = user?.role_names.includes('Department Admin') ?? false
  const isEmployee = user?.role_names.includes('Employee') ?? false
  const currentDepartment = departments[0] ?? (user?.department_name ? { id: user.department_name, name: user.department_name, slug: user.department_name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } : null)
  const hasEmployeeDepartmentActions = currentDepartment ? departmentActions(currentDepartment, 'employee').length > 0 : false

  return <AppLayout><div className="space-y-6 p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Operational overview</p><h1 className="text-2xl font-semibold tracking-[-0.035em] md:text-[30px]">Welcome back, {user?.full_name?.split(' ')[0]}</h1><p className="mt-2 text-sm text-muted-foreground">A live view of the knowledge, activity, and AI usage available to you.</p></div>
      <Button variant="outline" onClick={() => void load()} disabled={refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button>
    </div>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
    {isSuperAdmin && overview ? <ExecutiveVisualizations overview={overview} /> : null}
    {isAdmin && departments.length > 0 ? <DepartmentDirectory departments={departments} /> : null}
    {isDepartmentAdmin && currentDepartment ? <DepartmentActionCenter department={currentDepartment} audience="department_admin" /> : null}
    {isEmployee && currentDepartment && hasEmployeeDepartmentActions ? <DepartmentActionCenter department={currentDepartment} audience="employee" /> : null}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">{overview?.metrics.map((metric) => <MetricCard key={metric.key} label={metric.label} value={metric.format === 'currency' ? money(metric.value) : metric.value.toLocaleString()} />) ?? Array.from({ length: 4 }, (_, index) => <MetricCard key={index} label="Loading…" value="—" />)}</div>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3"><div className="space-y-6 lg:col-span-2">
      {overview && ['platform', 'organization'].includes(overview.scope) && <section className="overflow-hidden rounded-lg border border-border bg-card"><div className="border-b border-border px-6 py-4"><h2 className="font-semibold">Department Usage This Month</h2><p className="text-xs text-muted-foreground">Visible only to Super Admin and Admin</p></div><DataTable columns={[{ header: 'Department', key: 'department' as const }, { header: 'AI Requests', key: 'requests' as const }, { header: 'Estimated Cost', key: 'cost' as const }]} data={departmentRows} compact /></section>}
      <section className="overflow-hidden rounded-lg border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-6 py-4"><div><h2 className="font-semibold">Recent Documents</h2><p className="text-xs text-muted-foreground">Only documents within your access scope</p></div><Link href="/knowledge" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'text-primary' })}>View all <ArrowRight className="ml-1 h-4 w-4" /></Link></div><DataTable columns={[{ header: 'Document', key: 'name' as const }, { header: 'Collection', key: 'collection' as const }, { header: 'Uploader', key: 'uploader' as const }, { header: 'Status', key: 'status' as const, render: (value) => <StatusBadge status={documentStatus(String(value))} /> }, { header: 'Version', key: 'version' as const }, { header: 'Date', key: 'date' as const }]} data={documentRows} compact /></section>
    </div><aside className="rounded-lg border border-border bg-card p-6"><h2 className="font-semibold">Recent Activity</h2><p className="mb-4 text-xs text-muted-foreground">Filtered to {overview?.scope_label?.toLowerCase() ?? 'your scope'}</p><div className="space-y-4">{overview?.recent_activity.map((activity) => <div key={activity.id} className="flex gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{activity.actor.charAt(0)}</div><div className="min-w-0"><p className="text-sm"><span className="font-medium">{activity.actor}</span> <span className="capitalize text-muted-foreground">{actionLabel(activity.action)}</span></p><p className="mt-1 text-xs text-muted-foreground">{dateTime(activity.created_at)} · {activity.department}</p></div></div>)}{overview?.recent_activity.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No activity in this scope yet.</p>}</div></aside></div>
    {overview && <p className="text-right text-xs text-muted-foreground">Live data · refreshed {dateTime(overview.refreshed_at)} · costs in Indian rupees at ₹{overview.usd_to_inr_rate.toFixed(2)} · updates every 30 seconds</p>}
  </div></AppLayout>
}
