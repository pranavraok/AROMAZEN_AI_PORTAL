import Link from 'next/link'
import { ChevronRight, ClipboardList, FileOutput, FileText, Scale, Sparkles } from 'lucide-react'

const suggestionIcons: Record<string, React.ReactNode> = {
  FileText: <FileText className="h-5 w-5" />, ClipboardList: <ClipboardList className="h-5 w-5" />,
  Sparkles: <Sparkles className="h-5 w-5" />, Scale: <Scale className="h-5 w-5" />, FileOutput: <FileOutput className="h-5 w-5" />,
}

interface PromptSuggestionsProps {
  suggestions: Array<{ icon: string; text: string; description?: string; href?: string }>
  onSelect?: (text: string) => void
}

export function PromptSuggestions({ suggestions, onSelect }: PromptSuggestionsProps) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{suggestions.map((suggestion, index) => {
    const card = <button type="button" onClick={() => { if (!suggestion.href) onSelect?.(suggestion.text) }} className="group flex h-full w-full items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary/50 hover:bg-card">
      <div className="mt-0.5 shrink-0 text-primary/60 transition-colors group-hover:text-primary">{suggestionIcons[suggestion.icon]}</div>
      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">{suggestion.text}</p>{suggestion.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{suggestion.description}</p>}</div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
    </button>
    return suggestion.href ? <Link key={suggestion.text} href={suggestion.href}>{card}</Link> : <div key={`${suggestion.text}-${index}`}>{card}</div>
  })}</div>
}
