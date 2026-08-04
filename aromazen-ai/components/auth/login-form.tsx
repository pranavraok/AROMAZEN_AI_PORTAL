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
      router.replace('/dashboard')
      router.refresh()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Unable to sign in. Please try again.'
      setError(message); notify('error', message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return <form action={onSubmit} className="space-y-6 bg-card rounded-lg border border-border p-8">
    <div><label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">Email</label><input id="email" name="email" type="email" autoComplete="email" required placeholder="you@aromazen.com" className="w-full px-4 py-2 rounded-lg bg-muted border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
    <div><label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Password" className="w-full px-4 py-2 rounded-lg bg-muted border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
    <div><label htmlFor="phone_number" className="block text-sm font-medium text-foreground mb-2">Phone number <span className="text-muted-foreground">(only if this email is shared)</span></label><input id="phone_number" name="phone_number" type="tel" autoComplete="tel" placeholder="With country code, e.g. 919876543210" className="w-full px-4 py-2 rounded-lg bg-muted border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" /></div>
    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer"><input name="remember_me" type="checkbox" className="w-4 h-4 rounded border-input focus:ring-2 focus:ring-primary/50" />Remember me for 30 days</label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={isSubmitting} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2 rounded-lg">{isSubmitting ? 'Signing in...' : 'Sign In'}</Button>
    <p className="text-center text-xs text-muted-foreground border-t border-border pt-4">Internal employee access only</p>
  </form>
}
