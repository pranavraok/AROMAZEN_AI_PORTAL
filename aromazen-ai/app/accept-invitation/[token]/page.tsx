'use client'

import { FormEvent, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/brand-mark'
import { ApiError, apiRequest } from '@/lib/api/client'
import { useToast } from '@/components/ui/toast-provider'
import { PasswordInput } from '@/components/ui/password-input'
import { AlertCircle, ArrowRight } from 'lucide-react'

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
    if (password !== confirmation) { setError('Passwords do not match. Please try again.'); notify('warning', 'Passwords do not match.'); return }
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

  return (
    <main className="ios-safe-page relative grid min-h-dvh place-items-center overflow-x-hidden bg-background px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_32rem)]" />

      <div className="relative w-full max-w-[460px]">
        <div className="mb-6 flex items-center justify-center gap-3">
          <BrandMark size="sm" />
          <div>
            <p className="text-sm font-semibold tracking-[0.12em]">AROMAZEN</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">AI workspace</p>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-[28px] border border-border bg-card p-6 shadow-[0_24px_70px_rgba(0,0,0,.18)] sm:p-9">
          <div className="mb-7 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Account invitation</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] sm:text-[28px]">Create your account</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Add your name and choose a password to join Aromazen AI.</p>
          </div>

          <div className="space-y-4">
            <label className="block" htmlFor="full-name">
              <span className="mb-1.5 block text-xs font-medium">Full name</span>
              <input id="full-name" name="full_name" autoComplete="name" required placeholder="Enter your full name" className="h-12 w-full rounded-xl border border-input bg-background px-4 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary" />
            </label>

            <label className="block" htmlFor="password">
              <span className="mb-1.5 flex items-center justify-between gap-3 text-xs font-medium">
                <span>Password</span>
                <span className="font-normal text-muted-foreground">12+ characters</span>
              </span>
              <PasswordInput id="password" name="password" autoComplete="new-password" minLength={12} required placeholder="Create a password" containerClassName="w-full" className="h-12 w-full rounded-xl border border-input bg-background px-4 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary" />
            </label>

            <label className="block" htmlFor="confirmation">
              <span className="mb-1.5 block text-xs font-medium">Confirm password</span>
              <PasswordInput id="confirmation" name="confirmation" autoComplete="new-password" minLength={12} required placeholder="Enter the same password again" containerClassName="w-full" className="h-12 w-full rounded-xl border border-input bg-background px-4 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary" />
            </label>
          </div>

          {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-destructive/10 px-3.5 py-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

          <Button type="submit" disabled={isSubmitting} className="mt-6 h-12 w-full">
            {isSubmitting ? 'Creating account…' : <><span>Create account</span><ArrowRight className="ml-1 h-4 w-4" /></>}
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-muted-foreground">Secure access for invited Aromazen team members</p>
      </div>
    </main>
  )
}
