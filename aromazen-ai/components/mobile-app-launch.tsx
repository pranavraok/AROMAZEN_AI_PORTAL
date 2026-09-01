'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { BrandMark } from '@/components/brand-mark'

const REOPEN_SPLASH_AFTER_MS = 30 * 60 * 1000
const SPLASH_DURATION_MS = 1400
const ACTIVE_SESSION_KEY = 'aromazen:mobile-app-active'
const BACKGROUNDED_AT_KEY = 'aromazen:mobile-app-backgrounded-at'

function isInstalledMobileApp() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  const mobileLayout = window.matchMedia('(max-width: 767px)').matches
  return standalone && mobileLayout
}

export function MobileAppLaunch() {
  const pathname = usePathname()
  const router = useRouter()
  const [showSplash, setShowSplash] = useState(false)
  const hideTimerRef = useRef<number | null>(null)
  const pathnameRef = useRef(pathname)

  useEffect(() => { pathnameRef.current = pathname }, [pathname])

  useEffect(() => {
    if (!isInstalledMobileApp()) return

    function hideSplashLater() {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = window.setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS)
    }

    function openWorkspaceWithSplash() {
      setShowSplash(true)
      if (pathnameRef.current !== '/workspace') router.replace('/workspace')
      hideSplashLater()
    }

    if (sessionStorage.getItem(ACTIVE_SESSION_KEY) !== '1') {
      sessionStorage.setItem(ACTIVE_SESSION_KEY, '1')
      openWorkspaceWithSplash()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        sessionStorage.setItem(BACKGROUNDED_AT_KEY, String(Date.now()))
        return
      }

      const backgroundedAt = Number(sessionStorage.getItem(BACKGROUNDED_AT_KEY) || 0)
      sessionStorage.removeItem(BACKGROUNDED_AT_KEY)
      if (backgroundedAt > 0 && Date.now() - backgroundedAt >= REOPEN_SPLASH_AFTER_MS) {
        openWorkspaceWithSplash()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    }
  }, [router])

  useEffect(() => {
    document.documentElement.classList.toggle('mobile-splash-open', showSplash)
    if (showSplash) document.documentElement.classList.remove('mobile-app-launch-pending')
    return () => document.documentElement.classList.remove('mobile-splash-open')
  }, [showSplash])

  return <div className={`mobile-app-splash fixed inset-0 z-[100] place-items-center bg-background px-8 text-foreground ${showSplash ? 'mobile-app-splash-visible' : ''}`} role="status" aria-live="polite" aria-label="Opening Aromazen AI" aria-hidden={!showSplash}>
    <div className="flex flex-col items-center text-center">
      <div className="mobile-splash-mark grid h-24 w-24 place-items-center rounded-[28px] border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,.38)]">
        <BrandMark size="lg" />
      </div>
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[.24em] text-muted-foreground">Aromazen</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-.04em]">AI Workspace</h1>
      <div className="mt-7 h-1 w-24 overflow-hidden rounded-full bg-muted"><span className="mobile-splash-progress block h-full rounded-full bg-primary" /></div>
    </div>
  </div>
}
