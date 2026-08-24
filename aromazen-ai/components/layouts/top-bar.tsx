'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Bell, BookOpen, Boxes, Check, CheckCheck, LayoutDashboard, Menu, MessageSquare, Search, Settings, Shield, TrendingUp, Wrench, X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth/auth-provider'
import { api } from '@/lib/api/services'
import type { ChatConversation, KnowledgeCollection, UsageNotification } from '@/lib/api/types'

interface TopBarProps { sidebarOpen: boolean; onSidebarToggle: (open: boolean) => void }
type SearchItem = { title: string; subtitle: string; href: string; icon: React.ReactNode }

export function TopBar({ sidebarOpen, onSidebarToggle }: TopBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { accessToken, hasPermission, user } = useAuth()
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [collections, setCollections] = useState<KnowledgeCollection[]>([])
  const [notifications, setNotifications] = useState<UsageNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const shellRef = useRef<HTMLDivElement>(null)
  const isDepartmentFeature = pathname.startsWith('/department-tools/') || pathname.startsWith('/departments/') || pathname.startsWith('/hr/') || pathname.startsWith('/accounts/') || pathname === '/knowledge/rules-reminders'
  const showDepartmentBack = user?.role_names.includes('Department Admin') && isDepartmentFeature

  useEffect(() => {
    if (!accessToken) return
    if (hasPermission('ai.workspace.use')) void api.workspace.conversations(accessToken).then(setConversations).catch(() => undefined)
    if (hasPermission('knowledge.read')) void api.knowledge.collections(accessToken).then(setCollections).catch(() => undefined)
    const loadNotifications = () => { if (hasPermission('ai.workspace.use')) void api.workspace.notifications(accessToken).then((result) => { setNotifications(result.notifications); setUnreadCount(result.unread_count) }).catch(() => undefined) }
    loadNotifications()
    const timer = window.setInterval(loadNotifications, 60_000)
    return () => window.clearInterval(timer)
  }, [accessToken, hasPermission])

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!shellRef.current?.contains(event.target as Node)) { setSearchOpen(false); setNotificationsOpen(false) } }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const results = useMemo(() => {
    const navigation: SearchItem[] = [
      { title: 'AI Workspace', subtitle: 'Start or continue a conversation', href: '/workspace', icon: <MessageSquare /> },
      { title: 'Dashboard', subtitle: 'Operational overview', href: '/dashboard', icon: <LayoutDashboard /> },
      ...(hasPermission('knowledge.read') ? [{ title: 'Knowledge', subtitle: 'Company collections', href: '/knowledge', icon: <BookOpen /> }] : []),
      ...(hasPermission('usage.read') ? [{ title: 'Analytics', subtitle: 'Usage trends and costs', href: '/admin/usage', icon: <TrendingUp /> }] : []),
      ...(hasPermission('users.manage') ? [{ title: 'Administration', subtitle: 'People and access', href: '/admin/users', icon: <Shield /> }] : []),
      ...(user?.role_names.includes('Department Admin') && ['HR', 'Human Resources', 'Accounts'].includes(user.department_name ?? '') ? [{ title: 'Asset Management', subtitle: 'Devices, maintenance and scrap decisions', href: '/hr/assets', icon: <Boxes /> }] : []),
      ...(hasPermission('settings.manage') ? [{ title: 'Settings', subtitle: 'Organization controls', href: '/settings', icon: <Settings /> }] : []),
    ]
    const items = [...navigation, ...conversations.map((item) => ({ title: item.title, subtitle: 'Conversation', href: `/workspace?conversation=${item.id}`, icon: <MessageSquare /> })), ...collections.map((item) => ({ title: item.name, subtitle: `${item.document_count} documents`, href: `/knowledge/${item.slug}`, icon: <BookOpen /> }))]
    const needle = query.trim().toLowerCase()
    return (needle ? items.filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(needle)) : navigation).slice(0, 8)
  }, [collections, conversations, hasPermission, query, user])

  function go(href: string) { setQuery(''); setSearchOpen(false); setNotificationsOpen(false); router.push(href) }

  async function markRead(item: UsageNotification) {
    if (item.is_read || !accessToken) return
    await api.workspace.markNotificationRead(accessToken, item.id)
    setNotifications((current) => current.map((notification) => notification.id === item.id ? { ...notification, is_read: true, read_at: new Date().toISOString() } : notification))
    setUnreadCount((current) => Math.max(0, current - 1))
  }

  async function openNotification(item: UsageNotification) {
    try { await markRead(item) } catch { /* Navigation should still work if the read update fails. */ }
    if (item.href) go(item.href)
  }

  async function markAllRead() {
    if (!accessToken || unreadCount === 0) return
    await api.workspace.markAllNotificationsRead(accessToken)
    const now = new Date().toISOString()
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true, read_at: item.read_at ?? now })))
    setUnreadCount(0)
  }

  return <header className="top-bar relative z-20 flex h-[60px] items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-xl sm:h-[68px] sm:gap-4 sm:px-4 md:px-7" ref={shellRef}>
    <button onClick={() => onSidebarToggle(!sidebarOpen)} className="text-foreground transition-colors hover:text-primary lg:hidden" aria-label="Toggle navigation"><Menu className="h-5 w-5" /></button>
    {showDepartmentBack ? <button type="button" onClick={() => router.push('/dashboard')} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm hover:bg-muted"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Back to Dashboard</span></button> : null}
    <div className="hidden min-w-0 md:block"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Aromazen Workspace</p><p className="mt-0.5 truncate text-sm font-medium text-foreground">Secure company intelligence</p></div>
    <div className="relative ml-auto w-full max-w-md">
      <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setNotificationsOpen(false) }} onFocus={() => setSearchOpen(true)} onKeyDown={(event) => { if (event.key === 'Enter' && results[0]) go(results[0].href); if (event.key === 'Escape') setSearchOpen(false) }} placeholder="Search" aria-label="Search pages, chats, and knowledge" className="h-10 w-full rounded-2xl border border-border bg-card pl-10 pr-8 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 sm:h-11 sm:pr-10" />
      {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="h-4 w-4" /></button>}
      {searchOpen && <div className="absolute right-0 top-[calc(100%+10px)] w-full min-w-[320px] overflow-hidden rounded-2xl border border-border bg-popover p-2 shadow-2xl"><p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{query ? 'Search results' : 'Quick navigation'}</p>{results.map((item) => <button key={`${item.href}-${item.title}`} onClick={() => go(item.href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span></span></button>)}{results.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matching pages, chats, or collections.</p>}</div>}
    </div>
    <div className="relative">
      <button onClick={() => { setNotificationsOpen((value) => !value); setSearchOpen(false) }} className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}><Bell className="h-4 w-4" />{unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
      {notificationsOpen && <div className="absolute right-0 top-[calc(100%+10px)] w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl"><div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3"><div><p className="text-sm font-semibold">Notifications</p><p className="text-xs text-muted-foreground">Knowledge, document, asset and usage updates</p></div>{unreadCount > 0 ? <button type="button" onClick={() => void markAllRead()} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-muted"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button> : null}</div><div className="max-h-96 overflow-y-auto p-2">{notifications.length ? notifications.map((item) => <div key={item.id} className={`flex gap-2 rounded-xl p-2 transition-colors hover:bg-muted ${item.is_read ? 'opacity-65' : 'bg-primary/[0.04]'}`}><button type="button" onClick={() => void openNotification(item)} className="flex min-w-0 flex-1 gap-3 p-1 text-left"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.severity === 'critical' ? 'bg-destructive/10 text-destructive' : item.severity === 'warning' ? 'bg-amber-500/10 text-amber-600' : 'bg-primary/10 text-primary'}`}>{item.kind === 'document_reminder' || item.kind === 'knowledge_document_added' ? <BookOpen className="h-4 w-4" /> : item.kind === 'asset_maintenance' ? <Wrench className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}</span><span className="min-w-0"><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.message}</span></span></button>{!item.is_read ? <button type="button" onClick={() => void markRead(item)} className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-primary" aria-label={`Mark ${item.title} as read`} title="Mark as read"><Check className="h-4 w-4" /></button> : null}</div>) : <div className="px-5 py-10 text-center"><Bell className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No notifications yet</p><p className="mt-1 text-xs text-muted-foreground">Knowledge, maintenance and usage updates will appear here.</p></div>}</div>{hasPermission('settings.manage') && <button onClick={() => go('/settings#usage-alerts')} className="w-full border-t border-border px-4 py-3 text-left text-xs font-medium text-primary hover:bg-muted">Manage usage alert limits</button>}</div>}
    </div>
  </header>
}
