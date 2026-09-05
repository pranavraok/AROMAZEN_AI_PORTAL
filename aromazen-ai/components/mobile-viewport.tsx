'use client'

import { useEffect } from 'react'

export function MobileViewport() {
  useEffect(() => {
    let frame = 0
    const updateViewport = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const viewport = window.visualViewport
        document.documentElement.style.setProperty('--app-viewport-height', `${Math.round(viewport?.height ?? window.innerHeight)}px`)
        document.documentElement.style.setProperty('--app-viewport-offset-top', `${Math.round(viewport?.offsetTop ?? 0)}px`)
      })
    }
    updateViewport()
    window.addEventListener('resize', updateViewport)
    window.addEventListener('orientationchange', updateViewport)
    window.addEventListener('pageshow', updateViewport)
    window.visualViewport?.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('scroll', updateViewport)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateViewport)
      window.removeEventListener('orientationchange', updateViewport)
      window.removeEventListener('pageshow', updateViewport)
      window.visualViewport?.removeEventListener('resize', updateViewport)
      window.visualViewport?.removeEventListener('scroll', updateViewport)
      document.documentElement.style.removeProperty('--app-viewport-height')
      document.documentElement.style.removeProperty('--app-viewport-offset-top')
    }
  }, [])

  return null
}
