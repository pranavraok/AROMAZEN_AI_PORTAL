import { ArrowUp, ArrowDown } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: string
  trend?: string
  positive?: boolean
}

export function MetricCard({ label, value, trend, positive }: MetricCardProps) {
  return (
    <div className="group relative space-y-4 overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/15 hover:shadow-xl">
      <span className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
          <p className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-foreground">{value}</p>
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
