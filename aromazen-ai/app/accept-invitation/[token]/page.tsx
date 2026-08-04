'use client'

import { FormEvent, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ApiError, apiRequest } from '@/lib/api/client'

export default function AcceptInvitationPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    const confirmation = String(form.get('confirmation') ?? '')
    if (password !== confirmation) { setError('Passwords do not match.'); return }
    setError(null); setIsSubmitting(true)
    try {
      await apiRequest<void>(`/admin/invitations/${params.token}/accept`, { method: 'POST', body: { full_name: String(form.get('full_name') ?? ''), password } })
      router.replace('/login')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to accept this invitation.')
    } finally { setIsSubmitting(false) }
  }

  return <main className="min-h-screen bg-background grid place-items-center p-4"><form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-lg border border-border bg-card p-8"><div><div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20 font-bold text-primary">AZ</div><h1 className="text-2xl font-semibold">Join AROMAZEN AI</h1><p className="mt-1 text-sm text-muted-foreground">Set your name and password to activate your account.</p></div><input name="full_name" required placeholder="Full name" className="w-full rounded border border-input bg-muted p-2" /><input name="password" type="password" minLength={12} required placeholder="Create a password (12+ characters)" className="w-full rounded border border-input bg-muted p-2" /><input name="confirmation" type="password" minLength={12} required placeholder="Confirm password" className="w-full rounded border border-input bg-muted p-2" />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={isSubmitting} className="w-full">{isSubmitting ? 'Activating...' : 'Activate account'}</Button></form></main>
}
