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
  Sparkles,
  Boxes,
} from 'lucide-react'
import { BrandMark } from '@/components/brand-mark'
import { useAuth } from '@/components/auth/auth-provider'
import { api } from '@/lib/api/services'
import type { ChatConversation } from '@/lib/api/types'
import { ApiError } from '@/lib/api/client'
import { useToast } from '@/components/ui/toast-provider'

const navItems = [
  { name: 'AI Workspace', href: '/workspace', icon: MessageSquare },
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Knowledge', href: '/knowledge', icon: BookOpen },
  { name: 'Asset Inventory', href: '/hr/assets', icon: Boxes },
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
    if (item.href === '/hr/assets') return user?.role_names.includes('Department Admin') && ['HR', 'Human Resources', 'Accounts'].includes(user.department_name ?? '')
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
          className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={() => onToggle(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed bottom-0 left-0 top-0 z-40 flex w-[min(280px,88vw)] flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 lg:relative lg:w-[280px] lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="px-4 pb-3 pt-4">
          <div className="flex items-center gap-3 rounded-2xl px-2 py-2">
            <BrandMark size="md" className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold tracking-[0.08em] text-sidebar-foreground">{user?.organization_name ?? 'AROMAZEN'}</div>
              <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-sidebar-foreground/50"><Sparkles className="h-3 w-3" />{user?.platform_name ?? 'AI Assistant'}</div>
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
        <nav className="space-y-1 px-4 py-2">
          {visibleNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all ${
                    isActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_8px_24px_rgba(0,0,0,0.18)]'
                      : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{item.name}</span>
              </Link>
            )
          })}
        </nav>

        {hasPermission('ai.workspace.use') && <div className="mx-4 flex min-h-0 flex-1 flex-col border-t border-sidebar-border/70 pt-3">
          <button type="button" onClick={() => { router.push(`/workspace?new=${Date.now()}`); onToggle(false) }} className="flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/45 px-3 py-2.5 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"><Plus className="h-4 w-4" /><span>New conversation</span></button>
          <p className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/35">Recent conversations</p>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {conversations.length === 0 ? <p className="px-3 py-3 text-xs leading-5 text-sidebar-foreground/40">Your recent work will appear here.</p> : conversations.slice(0, 30).map((conversation) => <div key={conversation.id} className="group flex items-center rounded-xl hover:bg-sidebar-accent">
              <button type="button" onClick={() => { router.push(`/workspace?conversation=${conversation.id}`); onToggle(false) }} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px] text-sidebar-foreground">{conversation.title}</button>
              <div className="mr-1 hidden shrink-0 items-center group-hover:flex"><button type="button" onClick={() => void renameConversation(conversation)} aria-label="Rename chat" className="rounded p-1 text-sidebar-foreground/50 hover:bg-sidebar hover:text-sidebar-foreground"><Pencil className="h-3 w-3" /></button><button type="button" onClick={() => void removeConversation(conversation)} aria-label="Delete chat" className="rounded p-1 text-sidebar-foreground/50 hover:bg-sidebar hover:text-destructive"><Trash2 className="h-3 w-3" /></button></div>
            </div>)}
          </div>
        </div>}

        {/* User Menu */}
        <div className="space-y-2 border-t border-sidebar-border/70 p-4">
          <Link href="/profile" className="block rounded-xl bg-sidebar-accent/45 px-3 py-3 transition-colors hover:bg-sidebar-accent" onClick={() => onToggle(false)}>
            <div className="text-xs font-medium text-sidebar-foreground">{user?.full_name}</div>
            <div className="mt-0.5 text-[11px] text-sidebar-foreground/45">{user?.department_name ?? user?.role_names[0] ?? 'Employee'}</div>
          </Link>
          <button onClick={() => void handleSignOut()} className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md transition-colors">
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  )
}
