'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, LoaderCircle, Mic, MicOff, ShieldCheck, Smartphone } from 'lucide-react'
import { useParams } from 'next/navigation'
import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'

type RecognitionEvent = { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }
type RecognitionErrorEvent = { error: string }
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
type RecognitionConstructor = new () => Recognition
interface VoiceWindow extends Window { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
type PageState = 'checking' | 'ready' | 'listening' | 'processing' | 'done' | 'cancelled' | 'error'

export function QaMobileVoice() {
  const params = useParams<{ pairingId: string }>()
  const pairingId = params.pairingId
  const tokenRef = useRef('')
  const recognitionRef = useRef<Recognition | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const transcriptRef = useRef('')
  const shouldListenRef = useRef(false)
  const finishRequestedRef = useRef(false)
  const [state, setState] = useState<PageState>('checking')
  const [pairingCode, setPairingCode] = useState('')
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')

  function stopHardware() {
    shouldListenRef.current = false
    try { recognitionRef.current?.stop() } catch { /* recognition is already stopped */ }
    recognitionRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  useEffect(() => {
    const url = new URL(window.location.href)
    const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
    const token = hashParams.get('token') ?? url.searchParams.get('token') ?? ''
    tokenRef.current = token
    if (token) {
      url.searchParams.delete('token')
      url.hash = ''
      window.history.replaceState({}, '', `${url.pathname}${url.search}`)
    }
    if (!token) {
      setError('This pairing link is incomplete. Scan the QR code on the QC desktop again.')
      setState('error')
      return
    }
    let active = true
    void api.voicePairing.mobileStatus(pairingId, token)
      .then((session) => { if (active) { setPairingCode(session.pairing_code); setState(session.status === 'cancelled' ? 'cancelled' : 'ready') } })
      .catch((reason) => { if (active) { setError(reason instanceof ApiError ? reason.message : 'This pairing link is no longer available.'); setState('error') } })
    return () => { active = false; stopHardware() }
  }, [pairingId])

  async function sendTranscript(text: string, listening: boolean) {
    if (!tokenRef.current) return
    try { await api.voicePairing.updateTranscript(pairingId, tokenRef.current, text, listening) }
    catch { /* The final submission will surface any expired-session error. */ }
  }

  async function startListening() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data) }
      recorder.onstop = () => {
        const chunks = chunksRef.current
        chunksRef.current = []
        const file = chunks.length ? new File(chunks, 'qa-mobile-voice.webm', { type: recorder.mimeType || 'audio/webm' }) : null
        if (finishRequestedRef.current) void complete(file)
      }
      recorderRef.current = recorder
      recorder.start(1000)

      const voiceWindow = window as VoiceWindow
      const RecognitionClass = voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition
      if (RecognitionClass) {
        const recognition = new RecognitionClass()
        recognition.lang = 'en-IN'
        recognition.continuous = true
        recognition.interimResults = true
        recognition.onresult = (event) => {
          let live = ''
          let changed = false
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index]
            const text = result?.[0]?.transcript?.trim()
            if (!text) continue
            if (result.isFinal) {
              transcriptRef.current = `${transcriptRef.current}${transcriptRef.current ? ' ' : ''}${text}`.trim()
              changed = true
            } else live = `${live}${live ? ' ' : ''}${text}`
          }
          setTranscript(transcriptRef.current)
          setInterim(live)
          if (changed) void sendTranscript(transcriptRef.current, true)
        }
        recognition.onerror = (event) => {
          if (event.error === 'not-allowed') setError('Microphone permission was denied. Allow microphone access and try again.')
        }
        recognition.onend = () => {
          if (shouldListenRef.current) {
            window.setTimeout(() => { try { recognition.start() } catch { /* recorder remains active */ } }, 250)
          }
        }
        recognitionRef.current = recognition
        recognition.start()
      }
      shouldListenRef.current = true
      setState('listening')
      await sendTranscript(transcriptRef.current, true)
    } catch {
      stopHardware()
      setError('The microphone could not start. Allow microphone access in the browser and try again.')
      setState('ready')
    }
  }

  function finish() {
    finishRequestedRef.current = true
    shouldListenRef.current = false
    setInterim('')
    setState('processing')
    try { recognitionRef.current?.stop() } catch { /* already stopped */ }
    recognitionRef.current = null
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
    else void complete(null)
  }

  async function complete(file: File | null) {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    finishRequestedRef.current = false
    try {
      await api.voicePairing.complete(pairingId, tokenRef.current, transcriptRef.current, file)
      transcriptRef.current = ''
      setTranscript('')
      setInterim('')
      setState('done')
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'The recording could not be sent to the QC desktop.')
      setState('ready')
    }
  }

  async function cancel() {
    stopHardware()
    try { await api.voicePairing.cancelMobile(pairingId, tokenRef.current) } catch { /* expiry has the same result */ }
    transcriptRef.current = ''
    chunksRef.current = []
    setTranscript('')
    setInterim('')
    setState('cancelled')
  }

  return <main className="min-h-dvh bg-background px-4 py-6 text-foreground">
    <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-md flex-col">
      <header className="flex items-center gap-3"><BrandMark size="md" /><div><p className="text-xs font-medium uppercase tracking-[.18em] text-primary">Aromazen QA/QC</p><h1 className="text-xl font-semibold">Phone microphone</h1></div></header>
      <section className="mt-6 flex flex-1 flex-col rounded-3xl border border-border bg-card p-5 shadow-sm">
        {state === 'checking' && <div className="grid flex-1 place-items-center text-center"><div><LoaderCircle className="mx-auto h-8 w-8 animate-spin text-primary" /><p className="mt-3 text-sm text-muted-foreground">Checking the desktop pairing…</p></div></div>}
        {state === 'error' && <div className="grid flex-1 place-items-center text-center"><div><Smartphone className="mx-auto h-10 w-10 text-destructive" /><h2 className="mt-4 text-lg font-semibold">Pairing unavailable</h2><p className="mt-2 text-sm text-muted-foreground">{error}</p></div></div>}
        {state === 'done' && <div className="grid flex-1 place-items-center text-center"><div><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-emerald-400"><CheckCircle2 className="h-8 w-8" /></span><h2 className="mt-4 text-xl font-semibold">Sent to the QC desktop</h2><p className="mt-2 text-sm text-muted-foreground">The recording has been released from this phone. Review and save the COA on the desktop.</p></div></div>}
        {state === 'cancelled' && <div className="grid flex-1 place-items-center text-center"><div><MicOff className="mx-auto h-10 w-10 text-muted-foreground" /><h2 className="mt-4 text-lg font-semibold">Pairing ended</h2><p className="mt-2 text-sm text-muted-foreground">No recording or COA file was saved on this phone.</p></div></div>}
        {['ready', 'listening', 'processing'].includes(state) && <>
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">Confirm the code shown on the desktop</p><p className="mt-1 font-mono text-2xl font-semibold tracking-[.22em]">{pairingCode}</p></div><span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400"><ShieldCheck className="h-3.5 w-3.5" />Private</span></div>
          <div className="grid flex-1 place-items-center py-8 text-center"><div><button type="button" onClick={state === 'ready' ? startListening : undefined} disabled={state !== 'ready'} className={`mx-auto grid h-28 w-28 place-items-center rounded-full transition ${state === 'listening' ? 'animate-pulse bg-red-500 text-white shadow-[0_0_0_14px_rgba(239,68,68,.12)]' : state === 'processing' ? 'bg-primary/15 text-primary' : 'bg-primary text-primary-foreground shadow-lg'}`} aria-label={state === 'ready' ? 'Start speaking' : state === 'listening' ? 'Listening' : 'Processing'}>{state === 'processing' ? <LoaderCircle className="h-10 w-10 animate-spin" /> : state === 'listening' ? <MicOff className="h-10 w-10" /> : <Mic className="h-10 w-10" />}</button><h2 className="mt-6 text-xl font-semibold">{state === 'ready' ? 'Tap to start speaking' : state === 'listening' ? 'Listening…' : 'Sending to desktop…'}</h2><p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">{state === 'ready' ? 'Your phone is only being used as a temporary microphone.' : state === 'listening' ? 'Speak naturally. Corrections such as “change that to” are supported.' : 'Keep this page open until the transfer completes.'}</p></div></div>
          {(transcript || interim) && <div className="mb-4 rounded-2xl border border-border bg-background p-4"><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Live transcript</p><p className="mt-2 text-sm leading-6">{transcript}{interim && <span className="text-muted-foreground"> {interim}</span>}</p></div>}
          {error && <p role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <div className="grid gap-3"><Button className="h-12" disabled={state !== 'listening'} onClick={finish}>{state === 'listening' ? 'Done — Send to desktop' : state === 'processing' ? 'Sending…' : 'Start speaking above'}</Button><Button className="h-11" variant="outline" disabled={state === 'processing'} onClick={() => void cancel()}>Cancel pairing</Button></div>
        </>}
      </section>
      <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">No COA, audio file or downloaded document is retained on this phone.</p>
    </div>
  </main>
}
