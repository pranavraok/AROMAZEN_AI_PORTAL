'use client'

import { LogOut, Settings, User } from 'lucide-react'
import { mockUser } from '@/lib/mock-data'

export function UserMenu() {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right hidden sm:block">
        <div className="text-sm font-medium text-foreground">{mockUser.name}</div>
        <div className="text-xs text-muted-foreground">{mockUser.department}</div>
      </div>
      <button className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-xs font-bold text-primary hover:bg-primary/30 transition-colors">
        {mockUser.avatar}
      </button>
    </div>
  )
}
