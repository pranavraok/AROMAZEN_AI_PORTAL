import { ArrowUp, ArrowDown } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: string
  trend?: string
  positive?: boolean
}

export function MetricCard({ label, value, trend, positive }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
        </div>
      </div>
      {trend && <div className="flex items-center gap-1">
        {positive ? (
          <ArrowUp className="w-4 h-4 text-emerald-500" />
        ) : (
          <ArrowDown className="w-4 h-4 text-orange-500" />
        )}
        <span className={`text-xs font-medium ${positive ? 'text-emerald-500' : 'text-orange-500'}`}>
          {trend}
        </span>
      </div>}
    </div>
  )
}
