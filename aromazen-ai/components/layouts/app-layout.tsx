'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'
import { RequireAuthenticatedApp } from '@/components/auth/auth-provider'

interface AppLayoutProps {
  children: React.ReactNode
  showSidebar?: boolean
  showTopBar?: boolean
}

export function AppLayout({
  children,
  showSidebar = true,
  showTopBar = true,
}: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!sidebarOpen) return
    const appMain = document.querySelector<HTMLElement>('.app-main')
    const previousOverflow = appMain?.style.overflow
    document.documentElement.classList.add('mobile-drawer-open')
    if (appMain) appMain.style.overflow = 'hidden'
    return () => {
      document.documentElement.classList.remove('mobile-drawer-open')
      if (appMain) appMain.style.overflow = previousOverflow ?? ''
    }
  }, [sidebarOpen])

  return (
    <RequireAuthenticatedApp><div className="app-shell flex h-dvh min-h-0 max-w-full overflow-hidden bg-background">
      {showSidebar && <Sidebar open={sidebarOpen} onToggle={setSidebarOpen} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {showTopBar && <TopBar sidebarOpen={sidebarOpen} onSidebarToggle={setSidebarOpen} />}
        <main className="app-main min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </main>
      </div>
    </div></RequireAuthenticatedApp>
  )
}
