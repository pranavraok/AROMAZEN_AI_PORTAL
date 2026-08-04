'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable } from '@/components/ui/data-table'
import { MetricCard } from '@/components/ui/metric-card'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { UsageSummary } from '@/lib/api/types'

function money(value: number) { return `$${value.toFixed(value < 1 ? 4 : 2)}` }
function tokens(value: number) { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : value.toLocaleString() }

export default function AdminUsagePage() {
  const { accessToken } = useAuth()
  const { notify } = useToast()
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const load = useCallback(async () => {
    if (!accessToken) return
    try { setSummary(await api.workspace.usageSummary(accessToken)) }
    catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to load usage analytics.') }
  }, [accessToken, notify])
  useEffect(() => { void load() }, [load])

  const providerRows = (summary?.providers ?? []).map((row) => ({ provider: row.provider === 'openai' ? 'OpenAI' : row.provider === 'anthropic' ? 'Anthropic' : row.provider, model: row.model, requests: row.requests, tokens: `${tokens(row.input_tokens)} in / ${tokens(row.output_tokens)} out`, cost: money(row.cost) }))
  const departmentRows = (summary?.departments ?? []).map((row) => ({ ...row, cost: money(row.cost) }))
  const userRows = (summary?.users ?? []).map((row) => ({ name: row.name, department: row.department, provider: row.provider, model: row.model, requests: row.requests, cost: money(row.cost) }))

  return <AppLayout><div className="space-y-6 p-6">
    <PageHeader title="Analytics & Usage" description="Live provider, model, department, and employee usage for the current month" />
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="Current Month Cost" value={summary ? money(summary.totals.cost) : 'Loading...'} />
      <MetricCard label="AI Requests" value={summary ? summary.totals.requests.toLocaleString() : 'Loading...'} />
      <MetricCard label="Input Tokens" value={summary ? tokens(summary.totals.input_tokens) : 'Loading...'} />
      <MetricCard label="Output Tokens" value={summary ? tokens(summary.totals.output_tokens) : 'Loading...'} />
    </div>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Provider & Model</h2><div className="overflow-hidden rounded-lg border border-border bg-card"><DataTable columns={[{ header: 'Provider', key: 'provider' as const }, { header: 'Model', key: 'model' as const }, { header: 'Requests', key: 'requests' as const }, { header: 'Tokens', key: 'tokens' as const }, { header: 'Estimated Cost', key: 'cost' as const }]} data={providerRows} /></div></section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Cost by Department</h2><div className="overflow-hidden rounded-lg border border-border bg-card"><DataTable columns={[{ header: 'Department', key: 'department' as const }, { header: 'Requests', key: 'requests' as const }, { header: 'Estimated Cost', key: 'cost' as const }]} data={departmentRows} /></div></section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Usage by Employee</h2><div className="overflow-hidden rounded-lg border border-border bg-card"><DataTable columns={[{ header: 'Employee', key: 'name' as const }, { header: 'Department', key: 'department' as const }, { header: 'Provider', key: 'provider' as const }, { header: 'Model', key: 'model' as const }, { header: 'Requests', key: 'requests' as const }, { header: 'Estimated Cost', key: 'cost' as const }]} data={userRows} /></div></section>
  </div></AppLayout>
}
