'use client'

import { Paperclip, Send, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

interface ChatComposerProps {
  disabled?: boolean
  onSend: (message: string) => Promise<void>
}

export function ChatComposer({ disabled = false, onSend }: ChatComposerProps) {
  const [message, setMessage] = useState('')

  async function handleSend() {
    const value = message.trim()
    if (!value || disabled) return
    await onSend(value)
    setMessage('')
  }

  return <div className="border-t border-border bg-card/50 backdrop-blur-sm p-4 space-y-3">
    <div className="flex items-center gap-2 px-4"><Zap className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-medium text-primary">Sources enabled</span><span className="text-xs text-muted-foreground">Searches only collections you can access</span></div>
    <div className="flex gap-3 px-4"><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSend() } }} disabled={disabled} placeholder="Ask about documents, processes, ingredients…" className="flex-1 bg-muted text-foreground placeholder:text-muted-foreground rounded-lg px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 max-h-32 disabled:opacity-60" rows={1} /><div className="flex items-end gap-2"><Button type="button" size="icon" variant="ghost" disabled className="text-muted-foreground"><Paperclip className="w-5 h-5" /></Button><Button type="button" size="icon" onClick={() => void handleSend()} disabled={disabled || !message.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground"><Send className="w-4 h-4" /></Button></div></div>
  </div>
}
