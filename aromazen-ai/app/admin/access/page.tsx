import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { mockRoles, mockCollections } from '@/lib/mock-data'
import { CheckCircle2, Circle } from 'lucide-react'

export default function AdminAccessPage() {
  const permissions = [
    'View Documents',
    'Upload Documents',
    'Manage Collections',
    'View Analytics',
    'Manage Users',
    'Manage Settings',
  ]

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Access & Permissions"
          description="Configure roles and access levels"
        />

        {/* Roles Matrix */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left font-medium text-muted-foreground">Role</th>
                  {permissions.map((perm) => (
                    <th key={perm} className="px-4 py-3 text-center font-medium text-muted-foreground text-xs whitespace-nowrap">
                      {perm}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mockRoles.map((role, idx) => (
                  <tr key={role.id} className={`border-b border-border ${idx % 2 === 0 ? '' : ''}`}>
                    <td className="px-6 py-3">
                      <div>
                        <p className="font-medium text-foreground">{role.name}</p>
                        <p className="text-xs text-muted-foreground">{role.description}</p>
                      </div>
                    </td>
                    {permissions.map((perm, pidx) => (
                      <td key={perm} className="px-4 py-3 text-center">
                        {/* Simple permission matrix - customize as needed */}
                        {(role.id === 'owner' || (role.id === 'super-admin' && pidx < 5) || (role.id === 'dept-admin' && pidx < 3) || (role.id === 'employee' && pidx < 2)) ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />
                        ) : (
                          <Circle className="w-5 h-5 text-muted-foreground mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Collection Access */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Collection Access</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mockCollections.map((collection) => (
              <div key={collection.id} className="rounded-lg border border-border bg-card p-4">
                <h3 className="font-semibold text-foreground mb-3">{collection.name}</h3>
                <div className="space-y-2">
                  {mockRoles.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        defaultChecked={role.id === 'owner' || role.id === 'super-admin'}
                        className="w-4 h-4 rounded border-input focus:ring-2 focus:ring-primary/50"
                      />
                      <span className="text-sm text-foreground">{role.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
            Save Changes
          </Button>
        </div>
      </div>
    </AppLayout>
  )
}
