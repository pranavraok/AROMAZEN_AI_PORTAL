'use client'

import { Building2, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/components/auth/auth-provider'

export default function ProfilePage() {
  const { user } = useAuth()
  const details = [
    { icon: <UserRound />, label: 'Full name', value: user?.full_name ?? '—' },
    { icon: <Mail />, label: 'Work email', value: user?.email ?? '—' },
    { icon: <Building2 />, label: 'Department', value: user?.department_name ?? 'General' },
    { icon: <ShieldCheck />, label: 'Access role', value: user?.role_names.join(', ') || 'Employee' },
  ]
  return <AppLayout><div className="space-y-6 p-6">
    <PageHeader title="Your Profile" description="Your Aromazen identity, department, and assigned access." />
    <section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border bg-muted/35 px-6 py-8"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground text-lg font-semibold text-background">{user?.full_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><h2 className="mt-4 text-xl font-semibold">{user?.full_name}</h2><p className="mt-1 text-sm text-muted-foreground">{user?.organization_name}</p></div><div className="grid gap-px bg-border sm:grid-cols-2">{details.map((item) => <div key={item.label} className="flex gap-3 bg-card p-5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span><div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p><p className="mt-1 text-sm font-medium">{item.value}</p></div></div>)}</div></section>
    <p className="text-xs text-muted-foreground">Profile information is managed by your administrator. Contact them if anything needs updating.</p>
  </div></AppLayout>
}
