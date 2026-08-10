import Link from 'next/link'
import { BarChart3, BookOpenCheck, Boxes, CalendarCheck2, ChevronRight, CircleDollarSign, ClipboardList, FileOutput, FileText, FlaskConical, Image, ListChecks, Mail, Megaphone, Scale, Sparkles, Users } from 'lucide-react'

const suggestionIcons: Record<string, React.ReactNode> = {
  FileText: <FileText className="h-5 w-5" />, ClipboardList: <ClipboardList className="h-5 w-5" />,
  Sparkles: <Sparkles className="h-5 w-5" />, Scale: <Scale className="h-5 w-5" />, FileOutput: <FileOutput className="h-5 w-5" />,
  BarChart3: <BarChart3 className="h-5 w-5" />, Users: <Users className="h-5 w-5" />, Megaphone: <Megaphone className="h-5 w-5" />,
  FlaskConical: <FlaskConical className="h-5 w-5" />, Image: <Image className="h-5 w-5" />, Boxes: <Boxes className="h-5 w-5" />,
  Mail: <Mail className="h-5 w-5" />, ListChecks: <ListChecks className="h-5 w-5" />, BookOpenCheck: <BookOpenCheck className="h-5 w-5" />,
  Payroll: <CircleDollarSign className="h-5 w-5" />, Attendance: <CalendarCheck2 className="h-5 w-5" />,
}

interface PromptSuggestionsProps {
  suggestions: Array<{ icon: string; text: string; description?: string; href?: string; mode?: 'chat' | 'image' | 'email' }>
  onSelect?: (text: string, mode: 'chat' | 'image' | 'email') => void
}

export function PromptSuggestions({ suggestions, onSelect }: PromptSuggestionsProps) {
  if (suggestions.length === 0) return null
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{suggestions.map((suggestion, index) => {
    const card = <button type="button" onClick={() => { if (!suggestion.href) onSelect?.(suggestion.text, suggestion.mode ?? 'chat') }} className="group flex h-full w-full items-start gap-3 rounded-2xl border border-border/80 bg-card/55 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-white/15 hover:bg-card hover:shadow-[0_16px_35px_rgba(0,0,0,.2)]">
      <div className="mt-0.5 shrink-0 rounded-lg bg-muted p-2 text-muted-foreground transition-colors group-hover:text-foreground">{suggestionIcons[suggestion.icon]}</div>
      <div className="min-w-0 flex-1"><p className="text-sm font-medium leading-5 text-foreground">{suggestion.text}</p>{suggestion.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{suggestion.description}</p>}</div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
    </button>
    return suggestion.href ? <Link key={suggestion.text} href={suggestion.href}>{card}</Link> : <div key={`${suggestion.text}-${index}`}>{card}</div>
  })}</div>
}
