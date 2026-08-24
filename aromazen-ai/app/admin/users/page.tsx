'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast-provider'
import { useAuth } from '@/components/auth/auth-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { AdminRole, AdminUser, AuditEvent, Department } from '@/lib/api/types'
import { Plus } from 'lucide-react'

type View = 'users' | 'departments' | 'audit'

export default function AdminUsersPage() {
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const [view, setView] = useState<View>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<AdminRole[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [auditFrom, setAuditFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [auditTo, setAuditTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [invitePhone, setInvitePhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filteredAudit = audit.filter((event) => { const value = event.created_at.slice(0, 10); return value >= auditFrom && value <= auditTo })

  const load = useCallback(async () => {
    if (!accessToken) return
    try {
      const [nextUsers, nextDepartments, nextRoles, nextAudit] = await Promise.all([api.admin.users(accessToken), api.admin.departments(accessToken), api.admin.roles(accessToken), api.admin.auditEvents(accessToken)])
      setUsers(nextUsers); setDepartments(nextDepartments); setRoles(nextRoles); setAudit(nextAudit)
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Unable to load administration.') }
  }, [accessToken])
  useEffect(() => { void load() }, [load])

  function report(reason: unknown, fallback: string) { const message = reason instanceof ApiError ? reason.message : fallback; setError(message); notify('error', message) }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!accessToken) return
    const form = new FormData(event.currentTarget); setBusy(true); setError(null)
    try {
      const result = await api.admin.invite(accessToken, { full_name: String(form.get('full_name')), email: String(form.get('email')), phone_number: String(form.get('phone_number')) || null, department_id: String(form.get('department_id')) || null, role_ids: [String(form.get('role_id'))] })
      setInvitePhone(String(form.get('phone_number'))); setInviteLink(`${window.location.origin}/accept-invitation/${result.invitation_token}`); notify('success', 'Invitation created successfully.'); await load()
    } catch (reason) { report(reason, 'Unable to create invitation.') } finally { setBusy(false) }
  }
  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!accessToken || !selectedUser) return
    const form = new FormData(event.currentTarget); setBusy(true); setError(null)
    try {
      await api.admin.updateUser(accessToken, selectedUser.id, { full_name: String(form.get('full_name')), phone_number: String(form.get('phone_number')) || null, department_id: String(form.get('department_id')) || null, ...(hasPermission('roles.manage') ? { role_ids: [String(form.get('role_id'))] } : {}), status: String(form.get('status')) as 'active' | 'disabled' })
      setSelectedUser(null); notify('success', 'User updated successfully.'); await load()
    } catch (reason) { report(reason, 'Unable to save user.') } finally { setBusy(false) }
  }
  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!accessToken) return
    const formElement = event.currentTarget
    const form = new FormData(formElement); setBusy(true); setError(null)
    try {
      const department = await api.admin.createDepartment(accessToken, String(form.get('name')))
      setDepartments((current) => [...current.filter((item) => item.id !== department.id), department].sort((a, b) => a.name.localeCompare(b.name)))
      formElement.reset()
      notify('success', 'Department added successfully.')
      void load()
    } catch (reason) { report(reason, 'Unable to add department.') } finally { setBusy(false) }
  }
  async function deleteUser(user: AdminUser) {
    if (!accessToken || !window.confirm(`Delete ${user.full_name}? This permanently removes their account and sessions.`)) return
    try { await api.admin.deleteUser(accessToken, user.id); setSelectedUser(null); await load() } catch (reason) { report(reason, 'Unable to delete user.') }
  }
  async function renameDepartment(id: string, name: string) { if (!accessToken || !name.trim()) { notify('warning', 'Department name cannot be empty.'); return }; try { await api.admin.updateDepartment(accessToken, id, name); notify('success', 'Department updated successfully.'); await load() } catch (reason) { report(reason, 'Unable to rename department.') } }
  async function removeDepartment(id: string) { if (!accessToken || !window.confirm('Remove this department? Departments with users cannot be removed.')) return; try { await api.admin.removeDepartment(accessToken, id); notify('success', 'Department removed successfully.'); await load() } catch (reason) { report(reason, 'Unable to remove department.') } }
  function whatsapp() { if (!inviteLink || !invitePhone) { notify('warning', 'A WhatsApp number is required to send this invitation.'); return }; const phone = invitePhone.replace(/[^0-9]/g, ''); if (phone.length < 10) { notify('warning', 'Use a WhatsApp number with country code.'); return }; window.open(`https://wa.me/${phone}?text=${encodeURIComponent(`You have been invited to AROMAZEN AI. Activate your account: ${inviteLink}`)}`, '_blank', 'noopener,noreferrer') }

  return <AppLayout><div className="space-y-6 p-6">
    <PageHeader title="Administration" description="Manage people, departments, access, and accountability" actions={<Button onClick={() => { setIsInviteOpen(true); setInviteLink(null) }} className="bg-primary"><Plus className="mr-1 w-4 h-4" />Invite user</Button>} />
    <div className="flex gap-2 border-b border-border pb-3">{(['users', 'departments', 'audit'] as View[]).map((item) => <Button key={item} variant={view === item ? 'default' : 'ghost'} onClick={() => setView(item)} className="capitalize">{item === 'audit' ? 'Audit log' : item}</Button>)}</div>
    {error && <p role="alert" className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {view === 'users' && <section className="rounded-lg border border-border bg-card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="p-4 text-left">Employee</th><th className="p-4 text-left">Department</th><th className="p-4 text-left">Role</th><th className="p-4 text-left">Status</th><th className="p-4 text-right">Manage</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t border-border"><td className="p-4"><div className="font-medium">{user.full_name}</div><div className="text-xs text-muted-foreground">{user.email}{user.phone_number ? ` · ${user.phone_number}` : ''}</div></td><td className="p-4">{user.department?.name ?? 'General'}</td><td className="p-4">{user.roles.map((role) => role.name).join(', ')}</td><td className="p-4 capitalize">{user.status}</td><td className="p-4 text-right"><Button variant="outline" size="sm" onClick={() => setSelectedUser(user)}>Edit user</Button></td></tr>)}</tbody></table></div></section>}
    {view === 'departments' && <section className="space-y-4">{hasPermission('departments.manage') && <form onSubmit={createDepartment} className="flex max-w-lg flex-col gap-2 sm:flex-row"><input name="name" required placeholder="New department name" className="min-w-0 flex-1 rounded border border-input bg-muted p-2" /><Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add department'}</Button></form>}<div className="grid gap-3 md:grid-cols-2">{departments.map((department) => <DepartmentCard key={department.id} department={department} canManage={hasPermission('departments.manage')} onSave={renameDepartment} onRemove={removeDepartment} />)}</div></section>}
    {view === 'audit' && <div className="space-y-3"><div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs"><span className="font-medium">Activity range</span><input aria-label="Audit start date" type="date" value={auditFrom} max={auditTo} onChange={(event) => setAuditFrom(event.target.value)} className="rounded-lg bg-muted px-2 py-1.5" /><span className="text-muted-foreground">to</span><input aria-label="Audit end date" type="date" value={auditTo} min={auditFrom} onChange={(event) => setAuditTo(event.target.value)} className="rounded-lg bg-muted px-2 py-1.5" /><span className="ml-auto text-muted-foreground">{filteredAudit.length} events</span></div><section className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">{filteredAudit.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No administration activity in this date range.</p> : filteredAudit.map((event) => <div key={event.id} className="p-4"><p className="font-medium capitalize">{event.action.replace('identity.', '').replaceAll('_', ' ')}</p><p className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()} · {event.target_type}</p></div>)}</section></div>}
    {isInviteOpen && <Modal title="Invite employee" onClose={() => setIsInviteOpen(false)}><>{inviteLink ? <div className="space-y-3"><p className="text-sm text-muted-foreground">The invitation is valid for 7 days.</p><input readOnly value={inviteLink} className="w-full rounded border border-input bg-muted p-2 text-xs" /><Button className="w-full" onClick={() => void navigator.clipboard.writeText(inviteLink)}>Copy invitation link</Button><Button className="w-full" variant="outline" onClick={whatsapp}>Send via WhatsApp</Button></div> : <form onSubmit={invite} className="space-y-3"><input name="full_name" required placeholder="Full name" className="w-full rounded border border-input bg-muted p-2" /><input name="email" type="email" required placeholder="Work or shared email" className="w-full rounded border border-input bg-muted p-2" /><input name="phone_number" type="tel" placeholder="Unique phone (optional unless email is shared)" className="w-full rounded border border-input bg-muted p-2" /><select name="department_id" className="w-full rounded border border-input bg-muted p-2"><option value="">No department</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select name="role_id" required className="w-full rounded border border-input bg-muted p-2"><option value="">Choose role</option>{roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button type="submit" disabled={busy} className="w-full">{busy ? 'Creating...' : 'Create invitation'}</Button></form>}</></Modal>}
    {selectedUser && <Modal title={`Edit ${selectedUser.full_name}`} onClose={() => setSelectedUser(null)}><form onSubmit={saveUser} className="space-y-3"><input name="full_name" required defaultValue={selectedUser.full_name} className="w-full rounded border border-input bg-muted p-2" /><input name="phone_number" type="tel" defaultValue={selectedUser.phone_number ?? ''} placeholder="Unique phone number" className="w-full rounded border border-input bg-muted p-2" /><select name="department_id" defaultValue={selectedUser.department?.id ?? ''} className="w-full rounded border border-input bg-muted p-2"><option value="">No department</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{hasPermission('roles.manage') && <select name="role_id" defaultValue={selectedUser.roles[0]?.id} className="w-full rounded border border-input bg-muted p-2">{roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<select name="status" defaultValue={selectedUser.status === 'disabled' ? 'disabled' : 'active'} className="w-full rounded border border-input bg-muted p-2"><option value="active">Active</option><option value="disabled">Disabled</option></select><Button type="submit" disabled={busy} className="w-full">{busy ? 'Saving...' : 'Save changes'}</Button></form><Button variant="destructive" className="mt-3 w-full" onClick={() => void deleteUser(selectedUser)}>Delete user permanently</Button></Modal>}
  </div></AppLayout>
}

function DepartmentCard({ department, canManage, onSave, onRemove }: { department: Department; canManage: boolean; onSave: (id: string, name: string) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const [name, setName] = useState(department.name)
  return <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row"><input value={name} readOnly={!canManage} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded border border-input bg-muted p-2" />{canManage && <div className="flex gap-2"><Button className="flex-1 sm:flex-none" variant="outline" size="sm" onClick={() => void onSave(department.id, name)}>Save</Button><Button className="flex-1 sm:flex-none" variant="destructive" size="sm" onClick={() => void onRemove(department.id)}>Remove</Button></div>}</div>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div className="w-full max-w-md rounded-lg border border-border bg-card p-6"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>{children}</div></div>
}
