'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, LoaderCircle, Radio, Smartphone, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { VoicePairingSession } from '@/lib/api/types'

export function QaPhonePairing({ onTranscript, onComplete }: { onTranscript: (text: string) => void; onComplete: (text: string) => Promise<void> }) {
  const { accessToken } = useAuth()
  const { notify } = useToast()
  const completedRevisionRef = useRef<number | null>(null)
  const lastRevisionRef = useRef(0)
  const onTranscriptRef = useRef(onTranscript)
  const onCompleteRef = useRef(onComplete)
  const [session, setSession] = useState<VoicePairingSession | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const activePairingId = session?.id
  const mobileUrl = useMemo(() => session?.token && typeof window !== 'undefined' ? `${window.location.origin}/voice/qc/${session.id}#token=${encodeURIComponent(session.token)}` : '', [session])

  useEffect(() => { onTranscriptRef.current = onTranscript }, [onTranscript])
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  async function startPairing() {
    if (!accessToken) return
    setCreating(true)
    try {
      completedRevisionRef.current = null
      lastRevisionRef.current = 0
      setSession(await api.voicePairing.create(accessToken))
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to start phone pairing.')
    } finally { setCreating(false) }
  }

  async function closePairing(silent = false) {
    const current = session
    setSession(null)
    if (!accessToken || !current) return
    try { await api.voicePairing.close(accessToken, current.id) }
    catch (error) { if (!silent) notify('warning', error instanceof ApiError ? error.message : 'The pairing had already expired.') }
  }

  useEffect(() => {
    if (!accessToken || !activePairingId) return
    const pairingId = activePairingId
    let active = true
    let timer: number | undefined
    async function poll() {
      try {
        const next = await api.voicePairing.status(accessToken!, pairingId)
        if (!active) return
        setSession((current) => current ? { ...current, ...next, token: current.token } : current)
        if ((next.revision ?? 0) > lastRevisionRef.current && next.transcript) {
          lastRevisionRef.current = next.revision ?? 0
          onTranscriptRef.current(next.transcript)
        }
        if (next.status === 'ready' && next.transcript && completedRevisionRef.current !== next.revision) {
          completedRevisionRef.current = next.revision ?? 0
          const text = next.transcript
          setSession(null)
          await api.voicePairing.close(accessToken!, next.id).catch(() => undefined)
          await onCompleteRef.current(text)
          notify('success', 'Phone voice entry was received and filled into the COA draft.')
          return
        }
        if (next.status === 'cancelled') {
          setSession(null)
          notify('warning', 'The phone pairing was cancelled.')
          return
        }
        if (next.status === 'error' && next.error) notify('error', next.error)
      } catch (error) {
        if (!active) return
        setSession(null)
        notify('warning', error instanceof ApiError ? error.message : 'The phone pairing ended.')
        return
      }
      timer = window.setTimeout(poll, 1200)
    }
    timer = window.setTimeout(poll, 500)
    return () => { active = false; if (timer) window.clearTimeout(timer) }
  }, [accessToken, activePairingId, notify])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(mobileUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { notify('warning', 'The secure link could not be copied. Please scan the QR code instead.') }
  }

  if (!session) return <Button type="button" variant="outline" disabled={creating} onClick={() => void startPairing()}>{creating ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Smartphone className="mr-2 h-4 w-4" />}{creating ? 'Creating pairing…' : 'Use phone as microphone'}</Button>

  const statusLabel = session.status === 'waiting' ? 'Waiting for phone' : session.status === 'connected' ? 'Phone connected' : session.status === 'listening' ? 'Listening on phone' : session.status === 'processing' ? 'Processing recording' : session.status === 'error' ? 'Needs attention' : 'Connected'
  return <div className="w-full rounded-2xl border border-primary/30 bg-background p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Smartphone className="h-5 w-5" /></span><div><h3 className="font-semibold">Use your phone as the microphone</h3><p className="mt-1 text-xs text-muted-foreground">Scan once. The phone can send voice only; preview and downloads stay on this desktop.</p></div></div><button type="button" onClick={() => void closePairing()} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="End phone pairing"><X className="h-4 w-4" /></button></div>
    <div className="mt-5 grid items-center gap-5 sm:grid-cols-[auto_1fr]"><div className="mx-auto rounded-xl bg-white p-3"><QRCodeSVG value={mobileUrl} size={172} level="M" marginSize={0} /></div><div className="min-w-0"><div className="flex items-center gap-2 text-sm font-medium"><span className={`relative flex h-2.5 w-2.5 ${session.status === 'listening' ? 'text-red-500' : 'text-emerald-500'}`}><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-current" /></span>{statusLabel}</div><p className="mt-4 text-xs text-muted-foreground">Confirm this code on the phone</p><p className="mt-1 font-mono text-2xl font-semibold tracking-[.22em]">{session.pairing_code}</p><p className="mt-4 text-xs leading-5 text-muted-foreground">The link expires automatically in 10 minutes. Audio is used for transcription and is not retained.</p><div className="mt-4 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => void copyLink()}>{copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}{copied ? 'Copied' : 'Copy secure link'}</Button><Button type="button" size="sm" variant="ghost" onClick={() => void closePairing()}><Radio className="mr-1.5 h-4 w-4" />End pairing</Button></div></div></div>
  </div>
}
