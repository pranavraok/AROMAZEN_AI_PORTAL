'use client'

import { FormEvent, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/brand-mark'
import { ApiError, apiRequest } from '@/lib/api/client'
import { useToast } from '@/components/ui/toast-provider'

export default function AcceptInvitationPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const { notify } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    const confirmation = String(form.get('confirmation') ?? '')
    if (password !== confirmation) { setError('Passwords do not match.'); notify('warning', 'Passcodes do not match.'); return }
    setError(null); setIsSubmitting(true)
    try {
      await apiRequest<void>(`/admin/invitations/${params.token}/accept`, { method: 'POST', body: { full_name: String(form.get('full_name') ?? ''), password } })
      notify('success', 'Account activated. You can now sign in.')
      router.replace('/login')
    } catch (reason) {
      const message = reason instanceof ApiError ? reason.message : 'Unable to accept this invitation.'
      setError(message); notify('error', message)
    } finally { setIsSubmitting(false) }
  }

  return <main className="grid min-h-screen place-items-center bg-background p-4"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(255,255,255,.05),transparent_35rem)]" /><form onSubmit={submit} className="relative w-full max-w-md space-y-5 rounded-[24px] border border-border bg-card p-7 shadow-[0_35px_90px_rgba(0,0,0,.35)] sm:p-9"><div><BrandMark size="lg" className="mb-5" /><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Your Aromazen workspace</p><h1 className="text-2xl font-semibold tracking-[-0.035em]">Activate your account</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Set your name and a private passcode to join Aromazen AI.</p></div><input name="full_name" required placeholder="Full name" className="h-12 w-full rounded-xl border border-input bg-muted/60 px-4 text-sm" /><input name="password" type="password" minLength={4} required placeholder="Create passcode (4+ characters)" className="h-12 w-full rounded-xl border border-input bg-muted/60 px-4 text-sm" /><input name="confirmation" type="password" minLength={4} required placeholder="Confirm passcode" className="h-12 w-full rounded-xl border border-input bg-muted/60 px-4 text-sm" />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={isSubmitting} className="h-12 w-full">{isSubmitting ? 'Activating…' : 'Activate account'}</Button></form></main>
}
