interface PromptSuggestionsProps {
  suggestions: Array<{ icon: string; text: string; description?: string; href?: string; mode?: 'chat' | 'image' | 'email' }>
  onSelect?: (text: string, mode: 'chat' | 'image' | 'email') => void
}

export function PromptSuggestions(_props: PromptSuggestionsProps) {
  return null
}
