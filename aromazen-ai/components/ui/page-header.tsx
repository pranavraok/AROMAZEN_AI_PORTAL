interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="border-b border-border">
      <div className="px-6 py-6 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
