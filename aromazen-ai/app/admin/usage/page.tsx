import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable } from '@/components/ui/data-table'
import { MetricCard } from '@/components/ui/metric-card'
import { mockUsageData } from '@/lib/mock-data'

export default function AdminUsagePage() {
  const employeeColumns = [
    { header: 'Employee', key: 'name' as const },
    { header: 'Department', key: 'department' as const },
    { header: 'Model', key: 'model' as const },
    { header: 'Requests', key: 'requests' as const },
    { header: 'Estimated Cost', key: 'cost' as const },
  ]

  const departmentColumns = [
    { header: 'Department', key: 'department' as const },
    { header: 'Requests', key: 'requests' as const },
    { header: 'Cost', key: 'cost' as const },
  ]

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Analytics & Usage"
          description="Monitor AI platform usage and costs"
        />

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Current Month Cost"
            value={mockUsageData.currentMonth.cost}
            trend="+$2,847 vs last month"
            positive={false}
          />
          <MetricCard
            label="Total Requests"
            value={mockUsageData.currentMonth.requests.toLocaleString()}
            trend="+23% vs last month"
            positive={true}
          />
          <MetricCard
            label="Input Tokens"
            value={`${(mockUsageData.currentMonth.inputTokens / 1000000).toFixed(2)}M`}
            trend="2.8M average daily"
            positive={true}
          />
          <MetricCard
            label="Output Tokens"
            value={`${(mockUsageData.currentMonth.outputTokens / 1000000).toFixed(2)}M`}
            trend="1.5M average daily"
            positive={true}
          />
        </div>

        {/* Department Breakdown */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Cost by Department</h2>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 p-6">
              {mockUsageData.costByDepartment.map((dept) => (
                <div key={dept.department} className="rounded-lg bg-muted/50 p-4">
                  <p className="text-sm font-medium text-muted-foreground mb-2">{dept.department}</p>
                  <p className="text-2xl font-semibold text-foreground mb-1">
                    ${(dept.cost / 100).toFixed(0)}
                  </p>
                  <p className="text-xs text-muted-foreground">{dept.requests.toLocaleString()} requests</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Employee Usage */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Top Users</h2>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <DataTable columns={employeeColumns} data={mockUsageData.employeeUsage} />
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
