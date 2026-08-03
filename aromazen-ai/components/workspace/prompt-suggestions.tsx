import { FileText, ClipboardList, Sparkles, Scale, ChevronRight } from 'lucide-react'

const suggestionIcons: Record<string, React.ReactNode> = {
  FileText: <FileText className="w-5 h-5" />,
  ClipboardList: <ClipboardList className="w-5 h-5" />,
  Sparkles: <Sparkles className="w-5 h-5" />,
  Scale: <Scale className="w-5 h-5" />,
}

interface PromptSuggestionsProps {
  suggestions: Array<{ icon: string; text: string }>
  onSelect?: (text: string) => void
}

export function PromptSuggestions({ suggestions, onSelect }: PromptSuggestionsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {suggestions.map((suggestion, idx) => (
        <button
          key={idx}
          onClick={() => onSelect?.(suggestion.text)}
          className="group flex items-start gap-3 p-4 rounded-lg border border-border bg-card hover:bg-card hover:border-primary/50 transition-all text-left"
        >
          <div className="text-primary/60 group-hover:text-primary transition-colors flex-shrink-0 mt-0.5">
            {suggestionIcons[suggestion.icon]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
              {suggestion.text}
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
        </button>
      ))}
    </div>
  )
}
