'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface ViewportOverlayProps {
  label: string
  children: React.ReactNode
  onClose?: () => void
  className?: string
  closeOnBackdrop?: boolean
}

export function ViewportOverlay({ label, children, onClose, className, closeOnBackdrop = false }: ViewportOverlayProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!mounted) return
    const appMain = document.querySelector<HTMLElement>('.app-main')
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    const previousMainOverflow = appMain?.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    if (appMain) appMain.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
      if (appMain) appMain.style.overflow = previousMainOverflow ?? ''
    }
  }, [mounted, onClose])

  if (!mounted) return null

  return createPortal(
    <div
      data-viewport-overlay
      className={cn('fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-black/65 p-4 backdrop-blur-sm', className)}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
