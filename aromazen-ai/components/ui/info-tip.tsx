'use client'

import type { ReactNode } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Info } from 'lucide-react'

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
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label={label}
        openOnHover
        delay={150}
        closeDelay={150}
        onClick={(event) => event.stopPropagation()}
        className="inline-grid size-7 shrink-0 place-items-center rounded-full align-middle text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Info aria-hidden="true" className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align={align === 'right' ? 'end' : 'start'} sideOffset={6} collisionPadding={12} className="z-[150]">
          <Popover.Popup aria-label={label} onClick={(event) => event.stopPropagation()} className="max-h-[min(24rem,70dvh)] w-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-popover px-3 py-2 text-left text-xs font-normal leading-5 text-popover-foreground shadow-xl outline-none">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
