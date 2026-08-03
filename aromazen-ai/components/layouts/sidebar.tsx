'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  LayoutDashboard, 
  MessageSquare, 
  BookOpen, 
  TrendingUp, 
  Settings, 
  Shield,
  LogOut,
  ChevronRight,
  Menu,
} from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { Button } from '@/components/ui/button'

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'AI Workspace', href: '/workspace', icon: MessageSquare },
  { name: 'Knowledge', href: '/knowledge', icon: BookOpen },
  { name: 'Analytics', href: '/admin/usage', icon: TrendingUp },
  { name: 'Administration', href: '/admin/users', icon: Shield },
  { name: 'Settings', href: '/settings', icon: Settings },
]

interface SidebarProps {
  open: boolean
  onToggle: (open: boolean) => void
}

export function Sidebar({ open, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const { user, hasPermission, signOut } = useAuth()
  const visibleNavItems = navItems.filter((item) => {
    if (item.href === '/workspace') return hasPermission('ai.workspace.use')
    if (item.href === '/knowledge') return hasPermission('knowledge.read')
    if (item.href === '/admin/usage') return hasPermission('usage.read')
    if (item.href === '/admin/users') return hasPermission('users.manage')
    return true
  })

  async function handleSignOut() {
    await signOut()
    window.location.assign('/login')
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 lg:hidden z-30"
          onClick={() => onToggle(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-200 z-40 lg:relative lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-sidebar-primary flex items-center justify-center">
              <span className="text-xs font-bold text-sidebar-primary-foreground">AZ</span>
            </div>
            <div className="flex-1 hidden sm:block">
              <div className="text-sm font-semibold text-sidebar-foreground">AROMAZEN</div>
              <div className="text-xs text-sidebar-foreground/60">AI Platform</div>
            </div>
            <button
              onClick={() => onToggle(false)}
              className="lg:hidden text-sidebar-foreground"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {visibleNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            const Icon = item.icon

            return (
              <Link key={item.href} href={item.href}>
                <button
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.name}</span>
                </button>
              </Link>
            )
          })}
        </nav>

        {/* User Menu */}
        <div className="p-4 border-t border-sidebar-border space-y-3">
          <div className="px-2 py-3 rounded-md bg-sidebar-accent/10">
            <div className="text-xs font-medium text-sidebar-foreground">{user?.full_name}</div>
            <div className="text-xs text-sidebar-foreground/60">{user?.department_name ?? user?.role_names[0] ?? 'Employee'}</div>
          </div>
          <button onClick={() => void handleSignOut()} className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md transition-colors">
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  )
}
