'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Crown, LockKeyhole, ShieldCheck } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { PageHeader } from '@/components/ui/page-header'
import { buttonVariants } from '@/components/ui/button'
import { api } from '@/lib/api/services'
import { ApiError } from '@/lib/api/client'
import type { AdminKnowledgeCollection, AdminRole } from '@/lib/api/types'

const permissionNames: Record<string, string> = {
  'platform.manage': 'Platform',
  'users.manage': 'Users',
  'roles.manage': 'Roles',
  'knowledge.read': 'Read knowledge',
  'knowledge.write': 'Manage knowledge',
  'ai.workspace.use': 'AI assistance',
  'usage.read': 'Analytics',
  'departments.manage': 'Departments',
  'audit.read': 'Audit log',
  'settings.manage': 'Settings',
}

export default function AdminAccessPage() {
  const { accessToken, user } = useAuth()
  const { notify } = useToast()
  const [roles, setRoles] = useState<AdminRole[]>([])
  const [collections, setCollections] = useState<AdminKnowledgeCollection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!accessToken) return
    let active = true
    Promise.all([api.admin.roles(accessToken), api.admin.knowledgeCollections(accessToken)])
      .then(([nextRoles, nextCollections]) => {
        if (!active) return
        setRoles(nextRoles)
        setCollections(nextCollections.filter((collection) => collection.status === 'active'))
      })
      .catch((reason) => notify('error', reason instanceof ApiError ? reason.message : 'Unable to load live access data.'))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accessToken, notify])

  const permissions = useMemo(() => Array.from(new Set(roles.flatMap((role) => role.permission_keys))).sort(), [roles])

  return <AppLayout><div className="space-y-6 p-6">
    <PageHeader title="Access & Permissions" description="Clear administrative levels with a small, protected boundary for platform controls" actions={<Link href="/admin/knowledge" className={buttonVariants()}>Manage knowledge access</Link>} />

    <section className="grid gap-4 lg:grid-cols-2">
      <AccessLevelCard
        icon={<Crown />}
        title="Super Admin"
        scope="Platform authority"
        active={user?.role_names.includes('Super Admin') ?? false}
        features={["Everything available to Admin", "Create and manage Admin accounts", "Organization identity and platform branding", "AI provider routing and session security"]}
      />
      <AccessLevelCard
        icon={<ShieldCheck />}
        title="Admin"
        scope="Organization operations"
        active={user?.role_names.includes('Admin') ?? false}
        features={["Manage employees, Department Admins, and departments", "Manage knowledge, usage, and audit activity", "Configure appearance, timezone, and usage limits", "Cannot manage Admins or protected platform controls"]}
      />
    </section>

    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-6 py-4"><h2 className="font-semibold">Role permission matrix</h2><p className="mt-1 text-xs text-muted-foreground">Reflects the permissions currently enforced by the API.</p></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border bg-muted/50"><th className="px-6 py-3 text-left font-medium text-muted-foreground">Role</th>{permissions.map((permission) => <th key={permission} className="whitespace-nowrap px-4 py-3 text-center text-xs font-medium text-muted-foreground">{permissionNames[permission] ?? permission}</th>)}</tr></thead><tbody>
        {roles.map((role) => <tr key={role.id} className="border-b border-border last:border-0"><td className="px-6 py-3"><p className="font-medium">{role.name}</p><p className="text-xs text-muted-foreground">{role.description}</p></td>{permissions.map((permission) => <td key={permission} className="px-4 py-3 text-center">{role.permission_keys.includes(permission) ? <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-500" /> : <span className="text-muted-foreground">—</span>}</td>)}</tr>)}
        {!loading && roles.length === 0 && <tr><td colSpan={permissions.length + 1} className="px-6 py-10 text-center text-muted-foreground">No roles are available in your administrative scope.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="space-y-4"><div><h2 className="text-lg font-semibold">Knowledge Base groups</h2><p className="text-sm text-muted-foreground">Each group is available only to its mapped departments and platform administrators.</p></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {collections.map((collection) => <article key={collection.id} className="rounded-lg border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{collection.name}</h3><p className="mt-1 text-xs text-muted-foreground">{collection.document_count} {collection.document_count === 1 ? 'document' : 'documents'}</p></div><LockKeyhole className="h-4 w-4 text-primary" /></div><p className="mt-3 min-h-10 text-sm text-muted-foreground">{collection.description}</p><div className="mt-4 flex flex-wrap gap-2">{collection.department_names.map((department) => <span key={department} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{department}</span>)}</div></article>)}
    </div></section>
  </div></AppLayout>
}

function AccessLevelCard({ icon, title, scope, active, features }: { icon: React.ReactNode; title: string; scope: string; active: boolean; features: string[] }) {
  return <article className={`rounded-lg border bg-card p-5 ${active ? 'border-primary/60 ring-1 ring-primary/20' : 'border-border'}`}><div className="flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{title}</h2>{active && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Your role</span>}</div><p className="text-xs text-muted-foreground">{scope}</p></div></div><ul className="mt-4 space-y-2 text-sm text-muted-foreground">{features.map((feature) => <li key={feature} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><span>{feature}</span></li>)}</ul></article>
}
