'use client'

import { Paperclip, Send, Zap } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { VoiceInputButton } from '@/components/voice-input-button'

interface ChatComposerProps { disabled?: boolean; onSend: (message: string) => Promise<void> }

export function ChatComposer({ disabled = false, onSend }: ChatComposerProps) {
  const [message, setMessage] = useState('')
  async function handleSend() { const value = message.trim(); if (!value || disabled) return; setMessage(''); await onSend(value) }

  return <div className="space-y-3 border-t border-border bg-card/50 p-4 backdrop-blur-sm">
    <div className="flex items-center gap-2 px-4"><Zap className="h-3.5 w-3.5 text-primary" /><span className="text-xs font-medium text-primary">Sources enabled</span><span className="text-xs text-muted-foreground">Searches only collections you can access</span></div>
    <div className="flex gap-3 px-4"><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSend() } }} disabled={disabled} placeholder="Ask anything, or use the microphone…" className="max-h-32 flex-1 resize-none rounded-lg bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60" rows={1} /><div className="flex items-end gap-2"><VoiceInputButton disabled={disabled} label="Speak your question" onTranscript={(text) => setMessage((current) => current.trim() ? `${current.trim()} ${text}` : text)} /><Button type="button" size="icon" variant="ghost" disabled className="text-muted-foreground"><Paperclip className="h-5 w-5" /></Button><Button type="button" size="icon" onClick={() => void handleSend()} disabled={disabled || !message.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90"><Send className="h-4 w-4" /></Button></div></div>
  </div>
}
