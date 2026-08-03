import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { MetricCard } from '@/components/ui/metric-card'
import { DataTable } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import { mockDashboard } from '@/lib/mock-data'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

export default function DashboardPage() {
  const recentUploadsColumns = [
    { header: 'Document', key: 'name' as const },
    { header: 'Collection', key: 'collection' as const },
    { header: 'Uploader', key: 'uploader' as const },
    {
      header: 'Status',
      key: 'status' as const,
      render: (value: string) => <StatusBadge status={value as any} />,
    },
    { header: 'Version', key: 'version' as const },
    { header: 'Date', key: 'date' as const },
  ]

  const departmentUsageColumns = [
    { header: 'Department', key: 'department' as const },
    { header: 'Requests', key: 'requests' as const },
    { header: 'Cost', key: 'cost' as const },
  ]

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-foreground">{mockDashboard.greeting}</h1>
          <p className="text-muted-foreground">Here&apos;s what&apos;s happening with your AI platform</p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {mockDashboard.metrics.map((metric) => (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              trend={metric.trend}
              positive={metric.positive}
            />
          ))}
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Department Usage */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="font-semibold text-foreground">Department Usage Summary</h2>
              </div>
              <DataTable
                columns={departmentUsageColumns}
                data={mockDashboard.departmentUsage}
                compact
              />
            </div>

            {/* Recent Uploads */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Recent Documents</h2>
                <Button variant="ghost" size="sm" className="text-primary">
                  View all <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
              <DataTable
                columns={recentUploadsColumns}
                data={mockDashboard.recentUploads}
                compact
              />
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Activity Feed */}
            <div className="rounded-lg border border-border bg-card p-6">
              <h2 className="font-semibold text-foreground mb-4">Recent Activity</h2>
              <div className="space-y-4">
                {mockDashboard.recentActivity.map((activity, idx) => (
                  <div key={idx} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
                      {activity.user.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{activity.user}</span>
                        {' '}
                        <span className="text-muted-foreground">{activity.action}</span>
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-muted-foreground">{activity.time}</p>
                        <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                          {activity.department}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
