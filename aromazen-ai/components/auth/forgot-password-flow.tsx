'use client'

import { useState } from 'react'
import { api } from '@/lib/api/services'
import { ApiError } from '@/lib/api/client'
import { useToast } from '@/components/ui/toast-provider'
import { ArrowLeft, CheckCircle, KeyRound, LoaderCircle, Mail, X } from 'lucide-react'
import { PasswordInput } from '@/components/ui/password-input'

type Step = 'email' | 'otp' | 'password' | 'done'

/** Only allow aromazenind.com domain or the specific test email */
function isAllowedEmail(email: string): boolean {
  const lower = email.toLowerCase().trim()
  return lower.endsWith('@aromazenind.com') || lower === 'arshad141024@gmail.com'
}

const inputClass = 'h-11 w-full rounded-xl border border-input bg-muted/55 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-muted focus:outline-none'


interface ForgotPasswordFlowProps {
  open: boolean
  onClose: () => void
}

export function ForgotPasswordFlow({ open, onClose }: ForgotPasswordFlowProps) {
  const { notify } = useToast()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)


  if (!open) return null

  async function handleSendOtp() {
    setError(null)
    const trimmed = email.toLowerCase().trim()
    if (!trimmed) {
      setError('Please enter your email address.')
      return
    }
    if (!isAllowedEmail(trimmed)) {
      setError('Only aromazenind.com email addresses are allowed.')
      return
    }
    setLoading(true)
    try {
      await api.auth.forgotPassword(trimmed)
      setStep('otp')
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to send OTP. Please try again.'
      setError(msg)
      notify('error', msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp() {
    setError(null)
    setLoading(true)
    try {
      await api.auth.verifyOtp(email.toLowerCase().trim(), otp)
      setStep('password')
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Verification failed.'
      setError(msg)
      notify('error', msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleResetPassword() {
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      await api.auth.resetPassword(email.toLowerCase().trim(), otp, newPassword)
      setStep('done')
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Password reset failed.'
      setError(msg)
      notify('error', msg)
    } finally {
      setLoading(false)
    }
  }

  function handleBack() {
    setError(null)
    if (step === 'otp') setStep('email')
    else if (step === 'password') setStep('otp')
  }

  function handleClose() {
    setStep('email')
    setEmail('')
    setOtp('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Reset password">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          {step !== 'done' && step !== 'email' ? (
            <button type="button" onClick={handleBack} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Go back">
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : <div />}
          <button type="button" onClick={handleClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close password reset">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step: Enter email */}
        {step === 'email' && (
          <div>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">Forgot your password?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter your work email address. We&apos;ll send a verification code to reset your password.
            </p>
            <div className="mt-5">
              <label htmlFor="fp-email" className="mb-2 block text-xs font-medium text-foreground">Work email</label>
              <input
                id="fp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSendOtp() } }}
                placeholder="you@aromazenind.com"
                required
                className={inputClass}
                autoFocus
              />
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            <Button disabled={loading} onClick={() => void handleSendOtp()} className="mt-5 w-full">
              {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              Send OTP
            </Button>
          </div>
        )}

        {/* Step: Enter OTP */}
        {step === 'otp' && (
          <div>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">Enter verification code</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              We&apos;ve sent a 6-digit code to <span className="font-medium text-foreground">{email.toLowerCase().trim()}</span>. Enter it below.
            </p>
            <div className="mt-5">
              <label htmlFor="fp-otp" className="mb-2 block text-xs font-medium text-foreground">OTP code</label>
              <input
                id="fp-otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]*"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleVerifyOtp() } }}
                placeholder="000000"
                required
                className={`${inputClass} text-center text-lg tracking-[0.4em]`}
                autoFocus
              />
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            <Button disabled={loading || otp.length !== 6} onClick={() => void handleVerifyOtp()} className="mt-5 w-full">
              {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Verify OTP
            </Button>
            <button type="button" onClick={() => { setError(null); void handleSendOtp() }} className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground" disabled={loading}>
              Resend OTP
            </button>
          </div>
        )}

        {/* Step: Set new password */}
        {step === 'password' && (
          <div>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">Set new password</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a strong new password for your account.
            </p>
            <div className="mt-5 space-y-4">
              <div>
                <label htmlFor="fp-new-pw" className="mb-2 block text-xs font-medium text-foreground">Set New Password</label>
                <PasswordInput
                  id="fp-new-pw"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="fp-confirm-pw" className="mb-2 block text-xs font-medium text-foreground">Re-enter New Password</label>
                <PasswordInput
                  id="fp-confirm-pw"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleResetPassword() } }}
                  placeholder="Re-enter your new password"
                  required
                  minLength={8}
                  className={inputClass}
                />
              </div>
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            <Button disabled={loading || !newPassword || !confirmPassword} onClick={() => void handleResetPassword()} className="mt-5 w-full">
              {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Reset Password
            </Button>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle className="h-8 w-8 text-emerald-500" />
            </div>
            <h2 className="text-lg font-semibold">Password reset successful</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your password has been updated. You can now sign in with your new password.
            </p>
            <Button onClick={handleClose} className="mt-6 w-full">
              Back to login
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function Button({ className = '', disabled, type = 'button', onClick, children }: {
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-12 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}
