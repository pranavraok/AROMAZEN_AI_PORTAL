'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

interface InstallPromptState {
  canInstall: boolean
  installed: boolean
  install: () => Promise<void>
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const InstallPromptContext = createContext<InstallPromptState>({
  canInstall: false,
  installed: false,
  install: async () => {},
})

export function useInstallPrompt() {
  return useContext(InstallPromptContext)
}

// Capture beforeinstallprompt GLOBALLY before React mounts.
// Chrome fires this very early — if we only listen in useEffect, we miss it.
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null
let globalPromptListeners: Array<(prompt: BeforeInstallPromptEvent) => void> = []

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    const promptEvent = e as BeforeInstallPromptEvent
    globalDeferredPrompt = promptEvent
    console.log('[PWA] beforeinstallprompt captured globally — ready to install')
    globalPromptListeners.forEach((fn) => fn(promptEvent))
  })
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed successfully')
  })
}

export function InstallPromptProvider({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(globalDeferredPrompt)
  const [installed, setInstalled] = useState(false)
  const promptRef = useRef(deferredPrompt)

  useEffect(() => {
    // If the global already captured it, use that
    if (globalDeferredPrompt && !promptRef.current) {
      promptRef.current = globalDeferredPrompt
      setDeferredPrompt(globalDeferredPrompt)
    }

    // Listen for future captures (e.g. on page reload after interaction)
    function onPrompt(e: BeforeInstallPromptEvent) {
      promptRef.current = e
      setDeferredPrompt(e)
    }
    globalPromptListeners.push(onPrompt)

    function onInstalled() {
      setInstalled(true)
    }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      globalPromptListeners = globalPromptListeners.filter((fn) => fn !== onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    const prompt = promptRef.current || globalDeferredPrompt
    if (!prompt) {
      console.warn('[PWA] beforeinstallprompt not available')
      return
    }
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setInstalled(true)
  }, [])

  return (
    <InstallPromptContext.Provider value={{ canInstall: !!deferredPrompt, installed, install }}>
      {children}
    </InstallPromptContext.Provider>
  )
}
