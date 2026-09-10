'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let updateTimer: number | null = null
    let registration: ServiceWorkerRegistration | null = null
    const update = () => { if (document.visibilityState === 'visible') void registration?.update() }
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((value) => {
      registration = value
      updateTimer = window.setInterval(update, 15 * 60 * 1000)
      document.addEventListener('visibilitychange', update)
      window.addEventListener('pageshow', update)
      update()
    }).catch((error) => console.warn('Service worker registration failed:', error))
    return () => {
      if (updateTimer !== null) window.clearInterval(updateTimer)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('pageshow', update)
    }
  }, [])

  return null
}
