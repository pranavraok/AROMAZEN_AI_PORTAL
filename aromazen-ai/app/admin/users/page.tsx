import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { mockTeamUsers } from '@/lib/mock-data'
import { Plus } from 'lucide-react'

export default function AdminUsersPage() {
  const columns = [
    { header: 'Employee', key: 'name' as const },
    { header: 'Department', key: 'department' as const },
    { header: 'Role', key: 'role' as const },
    {
      header: 'Status',
      key: 'status' as const,
      render: (value: string) => <StatusBadge status={value as any} />,
    },
    { header: 'Last Active', key: 'lastActive' as const },
  ]

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <PageHeader
          title="User Management"
          description="Manage team members and their access"
          actions={
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Invite User
            </Button>
          }
        />

        {/* Users Table */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <DataTable columns={columns} data={mockTeamUsers} />
        </div>

        {/* Management Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-border bg-card p-6">
            <h3 className="font-semibold text-foreground mb-2">Total Users</h3>
            <p className="text-3xl font-bold text-primary">{mockTeamUsers.length}</p>
            <p className="text-sm text-muted-foreground mt-2">
              {mockTeamUsers.filter(u => u.status === 'Active').length} active
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <h3 className="font-semibold text-foreground mb-2">Quick Actions</h3>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start text-left">
                Manage Access Levels
              </Button>
              <Button variant="outline" className="w-full justify-start text-left">
                Export Users List
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
