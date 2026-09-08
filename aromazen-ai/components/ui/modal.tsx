'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders children into document.body. Modals must live at the body level: if any
 * ancestor has a transform (page-enter animations, swipe effects, hover
 * transitions), `position: fixed` overlays become anchored to that ancestor
 * instead of the viewport — the overlay then spans the whole page and its bottom
 * (submit buttons) is clipped and unreachable on phones.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(children, document.body)
}

/**
 * Centered dialog rendered through a body portal. The panel is capped to the
 * viewport and scrolls internally, so every field and button stays reachable on
 * small screens regardless of content height. Escape closes.
 */
export function ModalShell({
  label,
  onClose,
  width = 'max-w-md',
  children,
}: {
  label: string
  onClose?: () => void
  width?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!onClose) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <BodyPortal>
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div
          className={`max-h-[calc(100dvh-2rem)] w-full ${width} overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card shadow-2xl`}
        >
          {children}
        </div>
      </div>
    </BodyPortal>
  )
}
