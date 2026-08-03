type Status = 'Active' | 'Indexed' | 'Processing' | 'Failed' | 'Invited' | 'Disabled'

interface StatusBadgeProps {
  status: Status
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const baseClass = size === 'sm' ? 'text-xs px-2 py-1' : 'text-sm px-2.5 py-1'

  const statusConfig: Record<Status, { bg: string; text: string; dot: string }> = {
    Active: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
    Indexed: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
    Processing: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
    Failed: { bg: 'bg-destructive/10', text: 'text-destructive', dot: 'bg-destructive' },
    Invited: { bg: 'bg-yellow-500/10', text: 'text-yellow-600 dark:text-yellow-400', dot: 'bg-yellow-500' },
    Disabled: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  }

  const config = statusConfig[status]

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full ${config.bg} ${config.text} ${baseClass} font-medium`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {status}
    </div>
  )
}
