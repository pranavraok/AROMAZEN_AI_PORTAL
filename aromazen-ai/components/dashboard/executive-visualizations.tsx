import type { DashboardOverview } from '@/lib/api/types'

function money(value: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

export function ExecutiveVisualizations({ overview }: { overview: DashboardOverview }) {
  const rows = overview.department_usage
  const maxRequests = Math.max(...rows.map((row) => row.requests), 1)
  const maxCost = Math.max(...rows.map((row) => row.cost), 1)
  const totalRequests = rows.reduce((sum, row) => sum + row.requests, 0)
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0)

  return <section className="overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm">
    <div className="border-b border-border bg-primary/[0.04] px-5 py-5">
      <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-primary">Super Admin only</p>
      <h2 className="mt-1 text-lg font-semibold">Executive Visualizations</h2>
      <p className="mt-1 text-sm text-muted-foreground">A visual comparison of department AI activity and estimated spend this month.</p>
    </div>
    {rows.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Department activity will appear here when usage begins.</p> : <div className="grid gap-px bg-border lg:grid-cols-2">
      <div className="bg-card p-5">
        <div className="mb-6 flex items-end justify-between"><div><h3 className="text-sm font-semibold">AI requests by department</h3><p className="mt-1 text-xs text-muted-foreground">Relative monthly activity</p></div><p className="text-2xl font-semibold">{totalRequests.toLocaleString()}</p></div>
        <div className="space-y-4">{rows.map((row) => <div key={row.department}><div className="mb-1.5 flex justify-between gap-4 text-xs"><span className="truncate">{row.department}</span><span className="font-medium">{row.requests.toLocaleString()}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(row.requests / maxRequests * 100, row.requests ? 4 : 0)}%` }} /></div></div>)}</div>
      </div>
      <div className="bg-card p-5">
        <div className="mb-6 flex items-end justify-between"><div><h3 className="text-sm font-semibold">Estimated AI spend</h3><p className="mt-1 text-xs text-muted-foreground">Department cost concentration</p></div><p className="text-2xl font-semibold">{money(totalCost)}</p></div>
        <div className="space-y-4">{rows.map((row) => <div key={row.department}><div className="mb-1.5 flex justify-between gap-4 text-xs"><span className="truncate">{row.department}</span><span className="font-medium">{money(row.cost)}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.max(row.cost / maxCost * 100, row.cost ? 4 : 0)}%` }} /></div></div>)}</div>
      </div>
    </div>}
  </section>
}
