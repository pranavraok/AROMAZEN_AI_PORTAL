'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { useToast } from '@/components/ui/toast-provider'

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

export function VoiceInputButton({ onTranscript, onInterim, onListeningChange, onRecordingReady, stopSignal = 0, label = 'Use voice input', disabled = false, continuous = false, className = '' }: { onTranscript: (text: string) => void; onInterim?: (text: string) => void; onListeningChange?: (listening: boolean) => void; onRecordingReady?: (file: File) => void; stopSignal?: number; label?: string; disabled?: boolean; continuous?: boolean; className?: string }) {
  const { notify } = useToast()
  const recognitionRef = useRef<Recognition | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const shouldListenRef = useRef(false)
  const stopSignalRef = useRef(stopSignal)
  const [listening, setListening] = useState(false)

  function stopRecording() {
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    recordingStreamRef.current = null
  }

  useEffect(() => () => { shouldListenRef.current = false; recognitionRef.current?.stop(); stopRecording() }, [])
  useEffect(() => {
    if (stopSignal === stopSignalRef.current) return
    stopSignalRef.current = stopSignal
    shouldListenRef.current = false
    recognitionRef.current?.stop()
    stopRecording()
  }, [stopSignal])

  async function toggle() {
    if (listening) { shouldListenRef.current = false; recognitionRef.current?.stop(); stopRecording(); return }
    const voiceWindow = window as VoiceWindow
    const RecognitionClass = voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition
    if (!RecognitionClass) { notify('warning', 'Voice input is not supported in this browser. Please use the latest Chrome or Edge.'); return }
    const recognition = new RecognitionClass()
    if (onRecordingReady && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        recordingStreamRef.current = stream
        audioChunksRef.current = []
        const recorder = new MediaRecorder(stream)
        recorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data) }
        recorder.onstop = () => {
          const chunks = audioChunksRef.current
          audioChunksRef.current = []
          if (chunks.length > 0) onRecordingReady(new File(chunks, 'rnd-draft.webm', { type: recorder.mimeType || 'audio/webm' }))
        }
        recorderRef.current = recorder
        recorder.start(1000)
      } catch {
        notify('warning', 'Full recording check could not start. Live voice input will still work; please review the transcript before filling.')
      }
    }
    recognition.lang = 'en-IN'
    recognition.continuous = continuous
    recognition.interimResults = continuous
    recognition.onresult = (event) => { let interim = ''; for (let index = event.resultIndex; index < event.results.length; index += 1) { const result = event.results[index]; const transcript = result?.[0]?.transcript?.trim(); if (result?.isFinal && transcript) onTranscript(transcript); else if (transcript) interim += `${interim ? ' ' : ''}${transcript}` } onInterim?.(interim) }
    recognition.onerror = (event) => { if (!['aborted', 'no-speech'].includes(event.error)) { shouldListenRef.current = false; stopRecording(); notify('error', event.error === 'not-allowed' ? 'Microphone access was denied. Please allow it in your browser settings.' : 'Voice input could not understand that. Please try again.') } }
    recognition.onend = () => { onInterim?.(''); if (continuous && shouldListenRef.current) { window.setTimeout(() => { try { recognition.start() } catch { shouldListenRef.current = false; setListening(false); onListeningChange?.(false) } }, 250) } else { setListening(false); recognitionRef.current = null; onListeningChange?.(false) } }
    recognitionRef.current = recognition
    shouldListenRef.current = true
    setListening(true)
    onListeningChange?.(true)
    try { recognition.start() } catch { shouldListenRef.current = false; stopRecording(); setListening(false); notify('error', 'Voice input could not start. Please try again.') }
  }

  return <button type="button" onClick={toggle} disabled={disabled} aria-label={listening ? 'Stop listening' : label} title={listening ? 'Stop listening' : label} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition ${listening ? 'animate-pulse border-red-500 bg-red-500/15 text-red-400' : 'border-border text-muted-foreground hover:border-primary/60 hover:text-primary'} disabled:opacity-50 ${className}`}>{listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</button>
}
