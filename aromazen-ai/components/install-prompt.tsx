'use client'

import { Monitor, Smartphone, Globe } from 'lucide-react'
import { useInstallPrompt } from '@/components/install-prompt-provider'

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">{n}</span>
      <span className="text-xs leading-5 text-muted-foreground">{children}</span>
    </li>
  )
}

function ManualSteps({ browser }: { browser: 'chrome' | 'edge' | 'safari' | 'ios' | 'unknown' }) {
  if (browser === 'safari') {
    return (
      <ol className="mt-3 space-y-2 border-t border-border pt-3 pl-1">
        <Step n={1}>Click the <strong className="text-foreground">Share button</strong> in the Safari toolbar</Step>
        <Step n={2}>Select <strong className="text-foreground">Add to Dock</strong></Step>
        <Step n={3}>Click <strong className="text-foreground">Add</strong> — the app appears in your Dock</Step>
      </ol>
    )
  }
  if (browser === 'ios') {
    return (
      <ol className="mt-3 space-y-2 border-t border-border pt-3 pl-1">
        <Step n={1}>Tap the <strong className="text-foreground">Share button</strong> (square with arrow) at the bottom</Step>
        <Step n={2}>Scroll down and tap <strong className="text-foreground">Add to Home Screen</strong></Step>
        <Step n={3}>Tap <strong className="text-foreground">Add</strong> — the icon appears on your home screen</Step>
      </ol>
    )
  }
  if (browser === 'edge') {
    return (
      <ol className="mt-3 space-y-2 border-t border-border pt-3 pl-1">
        <Step n={1}>Click the <strong className="text-foreground">three-dot menu</strong> in the top-right corner</Step>
        <Step n={2}>Select <strong className="text-foreground">Apps</strong> → <strong className="text-foreground">Install this site as an app</strong></Step>
        <Step n={3}>Confirm — the app appears in your Start menu and taskbar</Step>
      </ol>
    )
  }
  // Chrome / Brave / Unknown
  return (
    <ol className="mt-3 space-y-2 border-t border-border pt-3 pl-1">
      <Step n={1}>Click the <strong className="text-foreground">install icon</strong> (⊕) in the address bar, or open the <strong className="text-foreground">three-dot menu</strong></Step>
      <Step n={2}>Select <strong className="text-foreground">Install Aromazen AI</strong></Step>
      <Step n={3}>Confirm — the app opens in its own window without browser chrome</Step>
    </ol>
  )
}

function detectBrowser(): 'chrome' | 'edge' | 'safari' | 'ios' | 'unknown' {
  if (typeof window === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isEdg = /Edg\//i.test(ua)
  const isChrome = /Chrome\//i.test(ua) && !isEdg
  const isSafari = /Safari\//i.test(ua) && !isChrome && !isEdg && !/Firefox\//i.test(ua)

  if (isIOS) return 'ios'
  if (isEdg) return 'edge'
  if (isChrome) return 'chrome'
  if (isSafari) return 'safari'
  return 'unknown'
}

export function QuickAccessCard() {
  const { install, canInstall } = useInstallPrompt()
  const browser = detectBrowser()

  const isMobile = browser === 'ios' || /android/i.test(navigator.userAgent)
  const icon = isMobile ? <Smartphone className="h-5 w-5" /> : <Monitor className="h-5 w-5" />
  const label = browser === 'ios' ? 'Add to Home Screen' : 'Install to desktop'
  const subtitle = browser === 'ios'
    ? 'Open Safari, then follow these steps:'
    : 'Pin Aromazen AI for one-tap access:'
  const buttonLabel = canInstall ? (browser === 'ios' ? 'Add' : 'Install') : null

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {buttonLabel && (
          <button
            type="button"
            onClick={() => void install()}
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {buttonLabel}
          </button>
        )}
      </div>
      {!canInstall && <ManualSteps browser={browser} />}
    </div>
  )
}
