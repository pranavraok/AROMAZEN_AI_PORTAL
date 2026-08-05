'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { 
  LayoutDashboard, 
  MessageSquare, 
  BookOpen, 
  TrendingUp, 
  Settings, 
  Shield,
  LogOut,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { api } from '@/lib/api/services'
import type { ChatConversation } from '@/lib/api/types'
import { ApiError } from '@/lib/api/client'
import { useToast } from '@/components/ui/toast-provider'

const navItems = [
  { name: 'AI Workspace', href: '/workspace', icon: MessageSquare },
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
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
  const router = useRouter()
  const { user, accessToken, hasPermission, signOut } = useAuth()
  const { notify } = useToast()
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const visibleNavItems = navItems.filter((item) => {
    if (item.href === '/workspace') return hasPermission('ai.workspace.use')
    if (item.href === '/knowledge') return hasPermission('knowledge.read')
    if (item.href === '/admin/usage') return hasPermission('usage.read')
    if (item.href === '/admin/users') return hasPermission('users.manage')
    if (item.href === '/settings') return hasPermission('settings.manage')
    return true
  })

  const loadConversations = useCallback(async () => {
    if (!accessToken || !hasPermission('ai.workspace.use')) return
    try { setConversations(await api.workspace.conversations(accessToken)) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to load recent chats.') }
  }, [accessToken, hasPermission, notify])

  useEffect(() => {
    void loadConversations()
    const refresh = () => void loadConversations()
    window.addEventListener('aromazen:conversations-updated', refresh)
    return () => window.removeEventListener('aromazen:conversations-updated', refresh)
  }, [loadConversations])

  async function renameConversation(conversation: ChatConversation) {
    if (!accessToken) return
    const title = window.prompt('Rename chat', conversation.title)?.trim()
    if (!title || title === conversation.title) return
    try { await api.workspace.renameConversation(accessToken, conversation.id, title); await loadConversations() }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to rename this chat.') }
  }

  async function removeConversation(conversation: ChatConversation) {
    if (!accessToken || !window.confirm(`Delete "${conversation.title}"? This cannot be undone.`)) return
    try {
      await api.workspace.deleteConversation(accessToken, conversation.id)
      await loadConversations()
      window.dispatchEvent(new CustomEvent('aromazen:conversation-deleted', { detail: conversation.id }))
      notify('success', 'Chat deleted.')
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to delete this chat.') }
  }

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
              <div className="truncate text-sm font-semibold text-sidebar-foreground">{user?.organization_name ?? 'AROMAZEN'}</div>
              <div className="truncate text-xs text-sidebar-foreground/60">{user?.platform_name ?? 'AI Platform'}</div>
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
        <nav className="p-4 space-y-1">
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

        {hasPermission('ai.workspace.use') && <div className="mx-4 flex min-h-0 flex-1 flex-col border-t border-sidebar-border pt-3">
          <button type="button" onClick={() => { router.push(`/workspace?new=${Date.now()}`); onToggle(false) }} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><Plus className="h-4 w-4" /><span>New chat</span></button>
          <p className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/45">Recent chats</p>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {conversations.length === 0 ? <p className="px-3 py-3 text-xs leading-5 text-sidebar-foreground/45">Your conversations will appear here.</p> : conversations.slice(0, 30).map((conversation) => <div key={conversation.id} className="group flex items-center rounded-md hover:bg-sidebar-accent">
              <button type="button" onClick={() => { router.push(`/workspace?conversation=${conversation.id}`); onToggle(false) }} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px] text-sidebar-foreground">{conversation.title}</button>
              <div className="mr-1 hidden shrink-0 items-center group-hover:flex"><button type="button" onClick={() => void renameConversation(conversation)} aria-label="Rename chat" className="rounded p-1 text-sidebar-foreground/50 hover:bg-sidebar hover:text-sidebar-foreground"><Pencil className="h-3 w-3" /></button><button type="button" onClick={() => void removeConversation(conversation)} aria-label="Delete chat" className="rounded p-1 text-sidebar-foreground/50 hover:bg-sidebar hover:text-destructive"><Trash2 className="h-3 w-3" /></button></div>
            </div>)}
          </div>
        </div>}

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
