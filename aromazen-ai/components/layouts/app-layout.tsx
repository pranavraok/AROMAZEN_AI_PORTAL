'use client'

import { useState } from 'react'
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

  return (
    <RequireAuthenticatedApp><div className="app-shell flex h-screen bg-background">
      {showSidebar && <Sidebar open={sidebarOpen} onToggle={setSidebarOpen} />}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showTopBar && <TopBar sidebarOpen={sidebarOpen} onSidebarToggle={setSidebarOpen} />}
        <main className="app-main flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div></RequireAuthenticatedApp>
  )
}
