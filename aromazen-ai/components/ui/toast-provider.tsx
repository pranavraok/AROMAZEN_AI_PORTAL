'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

type ToastKind = 'success' | 'error' | 'warning'
type Toast = { id: number; kind: ToastKind; message: string }
type ToastContextValue = { notify: (kind: ToastKind, message: string) => void }
const ToastContext = createContext<ToastContextValue | undefined>(undefined)

const styles: Record<ToastKind, string> = {
  success: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100',
  error: 'border-destructive/50 bg-destructive/15 text-destructive',
  warning: 'border-amber-500/40 bg-amber-500/15 text-amber-100',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const notify = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((current) => [...current, { id, kind, message }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 5000)
  }, [])
  const value = useMemo(() => ({ notify }), [notify])
  return <ToastContext.Provider value={value}>{children}<div aria-live="polite" className="viewport-toast pointer-events-none fixed left-1/2 top-1/2 z-[120] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-2">{toasts.map((toast) => <div key={toast.id} role="alert" className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg border p-4 shadow-xl backdrop-blur ${styles[toast.kind]}`}><p className="text-sm font-medium">{toast.message}</p><button aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} className="text-current/80 hover:text-current">×</button></div>)}</div></ToastContext.Provider>
}

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider.')
  return value
}
