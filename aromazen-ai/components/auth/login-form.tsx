'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { ApiError } from '@/lib/api/client'
import { useToast } from '@/components/ui/toast-provider'

export function LoginForm() {
  const router = useRouter()
  const { signIn } = useAuth()
  const { notify } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function onSubmit(formData: FormData) {
    setError(null)
    setIsSubmitting(true)
    try {
      await signIn({
        email: String(formData.get('email') ?? ''),
        phone_number: String(formData.get('phone_number') ?? '') || null,
        password: String(formData.get('password') ?? ''),
        remember_me: formData.get('remember_me') === 'on',
      })
      router.replace('/workspace')
      router.refresh()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Unable to sign in. Please try again.'
      setError(message); notify('error', message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return <form action={onSubmit} className="space-y-5">
    <div><label htmlFor="email" className="mb-2 block text-xs font-medium text-foreground">Work email</label><input id="email" name="email" type="email" autoComplete="email" required placeholder="you@aromazen.com" className="h-12 w-full rounded-xl border border-input bg-muted/55 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-muted focus:outline-none" /></div>
    <div><label htmlFor="password" className="mb-2 block text-xs font-medium text-foreground">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Enter your password" className="h-12 w-full rounded-xl border border-input bg-muted/55 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-muted focus:outline-none" /></div>
    <div><label htmlFor="phone_number" className="mb-2 block text-xs font-medium text-foreground">Phone number <span className="font-normal text-muted-foreground">— for shared emails only</span></label><input id="phone_number" name="phone_number" type="tel" autoComplete="tel" placeholder="Country code and phone number" className="h-12 w-full rounded-xl border border-input bg-muted/55 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-muted focus:outline-none" /></div>
    <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground"><input name="remember_me" type="checkbox" className="h-4 w-4 rounded border-input focus:ring-2 focus:ring-primary/20" />Keep me signed in for 30 days</label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={isSubmitting} className="h-12 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">{isSubmitting ? 'Signing in…' : 'Continue to workspace'}</Button>
    <p className="border-t border-border pt-5 text-center text-[11px] text-muted-foreground">Protected access for Aromazen employees</p>
  </form>
}
