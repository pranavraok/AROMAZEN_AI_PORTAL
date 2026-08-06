interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="border-b border-border/70 pb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Aromazen AI</p>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground md:text-[30px]">{title}</h1>
          {description && <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
