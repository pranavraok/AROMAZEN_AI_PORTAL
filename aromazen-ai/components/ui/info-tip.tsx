'use client'

import type { ReactNode } from 'react'
import { Info } from 'lucide-react'

import { cn } from '@/lib/utils'

export function InfoTip({
  label,
  children,
  align = 'left',
}: {
  label: string
  children: ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <span className="group relative inline-flex shrink-0 align-middle">
      <button
        type="button"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        className="grid size-6 place-items-center rounded-full text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Info className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none invisible absolute top-8 z-50 w-72 rounded-xl border border-border bg-popover px-3 py-2 text-left text-xs font-normal leading-5 text-popover-foreground opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        {children}
      </span>
    </span>
  )
}
