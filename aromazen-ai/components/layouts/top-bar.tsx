'use client'

import { Menu, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TopBarProps {
  sidebarOpen: boolean
  onSidebarToggle: (open: boolean) => void
}

export function TopBar({ sidebarOpen, onSidebarToggle }: TopBarProps) {
  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm flex items-center gap-4 px-6">
      {/* Menu toggle */}
      <button
        onClick={() => onSidebarToggle(!sidebarOpen)}
        className="lg:hidden text-foreground hover:text-primary transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Search bar */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search documents, chats..."
            className="w-full bg-muted text-foreground placeholder:text-muted-foreground rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User avatar (placeholder) */}
      <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
        PR
      </div>
    </header>
  )
}
