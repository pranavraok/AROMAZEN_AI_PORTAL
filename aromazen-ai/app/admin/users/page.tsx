'use client'

import { FormEvent, useEffect, useState } from 'react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { AdminRole, AdminUser, Department } from '@/lib/api/types'
import { Plus } from 'lucide-react'

export default function AdminUsersPage() {
  const { accessToken } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [roles, setRoles] = useState<AdminRole[]>([])
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [invitePhone, setInvitePhone] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    void Promise.all([api.admin.users(accessToken), api.admin.departments(accessToken), api.admin.roles(accessToken)])
      .then(([nextUsers, nextDepartments, nextRoles]) => { setUsers(nextUsers); setDepartments(nextDepartments); setRoles(nextRoles) })
      .catch((reason) => setError(reason instanceof ApiError ? reason.message : 'Unable to load user administration.'))
  }, [accessToken])

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!accessToken) return
    const form = new FormData(event.currentTarget)
    const roleId = String(form.get('role_id') ?? '')
    setError(null); setInviteLink(null); setInvitePhone(String(form.get('phone') ?? '')); setIsSubmitting(true)
    try {
      const result = await api.admin.invite(accessToken, {
        full_name: String(form.get('full_name') ?? ''), email: String(form.get('email') ?? ''), phone_number: String(form.get('phone') ?? '') || null,
        department_id: String(form.get('department_id') ?? '') || null, role_ids: [roleId],
      })
      setUsers((current) => [result.user, ...current])
      setInviteLink(`${window.location.origin}/accept-invitation/${result.invitation_token}`)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to create invitation.')
    } finally { setIsSubmitting(false) }
  }

  async function toggleUser(user: AdminUser) {
    if (!accessToken) return
    try {
      const updated = await api.admin.updateUser(accessToken, user.id, { status: user.status === 'disabled' ? 'active' : 'disabled' })
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : 'Unable to update account.') }
  }

  function sendInvitationViaWhatsApp() {
    if (!inviteLink || !invitePhone) { setError('Enter a WhatsApp number before creating the invitation.'); return }
    const phone = invitePhone.replace(/[^0-9]/g, '')
    if (phone.length < 10) { setError('Enter the WhatsApp number with country code, for example 919876543210.'); return }
    const message = `You have been invited to AROMAZEN AI. Activate your account securely using this one-time link: ${inviteLink}`
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  return <AppLayout><div className="space-y-6 p-6">
    <PageHeader title="User Management" description="Invite employees and manage department-based access" actions={<Button onClick={() => { setIsInviteOpen(true); setInviteLink(null) }} className="bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-2"><Plus className="w-4 h-4" />Invite User</Button>} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="rounded-lg border border-border bg-card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border bg-muted/50"><th className="px-5 py-3 text-left">Employee</th><th className="px-5 py-3 text-left">Department</th><th className="px-5 py-3 text-left">Role</th><th className="px-5 py-3 text-left">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-b border-border"><td className="px-5 py-4"><p className="font-medium text-foreground">{user.full_name}</p><p className="text-xs text-muted-foreground">{user.email}</p></td><td className="px-5 py-4 text-muted-foreground">{user.department?.name ?? 'Unassigned'}</td><td className="px-5 py-4 text-muted-foreground">{user.roles.map((role) => role.name).join(', ')}</td><td className="px-5 py-4"><span className="capitalize text-muted-foreground">{user.status}</span></td><td className="px-5 py-4 text-right"><Button onClick={() => void toggleUser(user)} variant="outline" size="sm" disabled={user.status === 'invited'}>{user.status === 'disabled' ? 'Enable' : user.status === 'invited' ? 'Pending' : 'Disable'}</Button></td></tr>)}</tbody></table></div></div>
    <p className="text-sm text-muted-foreground">{users.length} user{users.length === 1 ? '' : 's'} in this organization.</p>
    {isInviteOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div className="w-full max-w-md rounded-lg border border-border bg-card p-6"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Invite employee</h2><Button variant="ghost" size="sm" onClick={() => setIsInviteOpen(false)}>Close</Button></div>{inviteLink ? <div className="space-y-3"><p className="text-sm text-muted-foreground">Invitation created. It expires in 7 days.</p><input readOnly value={inviteLink} className="w-full rounded border border-input bg-muted p-2 text-xs" /><Button className="w-full" onClick={() => void navigator.clipboard.writeText(inviteLink)}>Copy invitation link</Button><Button variant="outline" className="w-full" onClick={sendInvitationViaWhatsApp}>Send via WhatsApp</Button><p className="text-xs text-muted-foreground">WhatsApp opens with the secure invitation prefilled for the entered number.</p></div> : <form onSubmit={inviteUser} className="space-y-4"><input name="full_name" required placeholder="Full name" className="w-full rounded border border-input bg-muted p-2" /><input name="email" type="email" required placeholder="employee@aromazen.com" className="w-full rounded border border-input bg-muted p-2" /><input name="phone" type="tel" placeholder="WhatsApp number with country code (e.g. 919876543210)" className="w-full rounded border border-input bg-muted p-2" /><select name="department_id" className="w-full rounded border border-input bg-muted p-2"><option value="">No department yet</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select name="role_id" required className="w-full rounded border border-input bg-muted p-2"><option value="">Choose role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><Button type="submit" disabled={isSubmitting} className="w-full">{isSubmitting ? 'Creating invitation...' : 'Create invitation'}</Button></form>}</div></div>}
  </div></AppLayout>
}
