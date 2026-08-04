import { FileText, ExternalLink } from 'lucide-react'

interface Source {
  documentId: string
  collectionId: string
  name: string
  page?: number
  collection: string
  relevance: number
}

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  timestamp?: Date
  status?: string | null
  onOpenSource?: (source: Source) => void
}

export function ChatMessage({ role, content, sources, timestamp, status, onOpenSource }: ChatMessageProps) {
  return (
    <div className={`flex gap-4 ${role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
      {role === 'assistant' && (
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
          AZ
        </div>
      )}

      <div
        className={`max-w-[70%] space-y-3 ${
          role === 'assistant'
            ? 'bg-muted/50 rounded-lg p-4 text-foreground'
            : 'bg-primary text-primary-foreground rounded-lg p-4'
        }`}
      >
        {status && !content && <div className="flex items-center gap-2 text-sm text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-primary" />{status}</div>}
        {content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>}

        {sources && sources.length > 0 && (
          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Sources</p>
            <div className="flex flex-wrap gap-2">
              {sources.map((source, idx) => (
                <button
                  type="button"
                  key={idx}
                  onClick={() => onOpenSource?.(source)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-card/50 border border-border hover:border-primary/50 transition-colors group cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      {source.name.split('/').pop()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {source.collection}
                      {source.page ? ` · p.${source.page}` : ''}
                      {source.relevance && ` · ${Math.round(source.relevance * 100)}%`}
                    </p>
                  </div>
                  <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        )}

        {timestamp && (
          <p className="text-xs text-muted-foreground">
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>

      {role === 'user' && (
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
          PR
        </div>
      )}
    </div>
  )
}
