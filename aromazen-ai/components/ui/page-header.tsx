import { InfoTip } from '@/components/ui/info-tip'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="page-header min-w-0 border-b border-border/70 pb-5 sm:pb-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground md:text-[30px]">{title}</h1>
            {description && <InfoTip label={`About ${title}`}>{description}</InfoTip>}
          </div>
        </div>
        {actions && <div className="page-header-actions flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div>}
      </div>
    </div>
  )
}
