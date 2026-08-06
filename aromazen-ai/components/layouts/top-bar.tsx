'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bell, BookOpen, LayoutDashboard, Menu, MessageSquare, Search, Settings, Shield, TrendingUp, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth/auth-provider'
import { api } from '@/lib/api/services'
import type { ChatConversation, KnowledgeCollection, UsageNotification } from '@/lib/api/types'

interface TopBarProps { sidebarOpen: boolean; onSidebarToggle: (open: boolean) => void }
type SearchItem = { title: string; subtitle: string; href: string; icon: React.ReactNode }

export function TopBar({ sidebarOpen, onSidebarToggle }: TopBarProps) {
  const router = useRouter()
  const { accessToken, hasPermission } = useAuth()
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [collections, setCollections] = useState<KnowledgeCollection[]>([])
  const [notifications, setNotifications] = useState<UsageNotification[]>([])
  const shellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!accessToken) return
    if (hasPermission('ai.workspace.use')) void api.workspace.conversations(accessToken).then(setConversations).catch(() => undefined)
    if (hasPermission('knowledge.read')) void api.knowledge.collections(accessToken).then(setCollections).catch(() => undefined)
    if (hasPermission('ai.workspace.use')) void api.workspace.notifications(accessToken).then((result) => setNotifications(result.notifications)).catch(() => undefined)
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
      ...(hasPermission('settings.manage') ? [{ title: 'Settings', subtitle: 'Organization controls', href: '/settings', icon: <Settings /> }] : []),
    ]
    const items = [
      ...navigation,
      ...conversations.map((item) => ({ title: item.title, subtitle: 'Conversation', href: `/workspace?conversation=${item.id}`, icon: <MessageSquare /> })),
      ...collections.map((item) => ({ title: item.name, subtitle: `${item.document_count} documents`, href: `/knowledge/${item.slug}`, icon: <BookOpen /> })),
    ]
    const needle = query.trim().toLowerCase()
    return (needle ? items.filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(needle)) : navigation).slice(0, 8)
  }, [collections, conversations, hasPermission, query])

  function go(href: string) { setQuery(''); setSearchOpen(false); router.push(href) }

  return <header className="top-bar relative z-20 flex h-[68px] items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-xl md:px-7" ref={shellRef}>
    <button onClick={() => onSidebarToggle(!sidebarOpen)} className="text-foreground transition-colors hover:text-primary lg:hidden" aria-label="Toggle navigation"><Menu className="h-5 w-5" /></button>
    <div className="hidden min-w-0 md:block"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Aromazen Workspace</p><p className="mt-0.5 truncate text-sm font-medium text-foreground">Secure company intelligence</p></div>

    <div className="relative ml-auto w-full max-w-md">
      <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setNotificationsOpen(false) }} onFocus={() => setSearchOpen(true)} onKeyDown={(event) => { if (event.key === 'Enter' && results[0]) go(results[0].href); if (event.key === 'Escape') setSearchOpen(false) }} placeholder="Search pages, chats, and knowledge" className="h-11 w-full rounded-2xl border border-border bg-card pl-10 pr-10 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10" />
      {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="h-4 w-4" /></button>}
      {searchOpen && <div className="absolute right-0 top-[calc(100%+10px)] w-full min-w-[320px] overflow-hidden rounded-2xl border border-border bg-popover p-2 shadow-2xl">
        <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{query ? 'Search results' : 'Quick navigation'}</p>
        {results.map((item) => <button key={`${item.href}-${item.title}`} onClick={() => go(item.href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span></span></button>)}
        {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matching pages, chats, or collections.</p>}
      </div>}
    </div>

    <div className="relative">
      <button onClick={() => { setNotificationsOpen((value) => !value); setSearchOpen(false) }} className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground" aria-label="Usage notifications"><Bell className="h-4 w-4" />{notifications.length > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">{notifications.length}</span>}</button>
      {notificationsOpen && <div className="absolute right-0 top-[calc(100%+10px)] w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl"><div className="border-b border-border px-4 py-3"><p className="text-sm font-semibold">Usage alerts</p><p className="text-xs text-muted-foreground">Daily and monthly AI thresholds</p></div><div className="max-h-80 overflow-y-auto p-2">{notifications.length ? notifications.map((item) => <div key={item.id} className="flex gap-3 rounded-xl p-3 hover:bg-muted"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.severity === 'critical' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-600'}`}><AlertTriangle className="h-4 w-4" /></span><div><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.message}</p></div></div>) : <div className="px-5 py-10 text-center"><Bell className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">All usage is within limits</p><p className="mt-1 text-xs text-muted-foreground">We’ll alert the right role when a threshold is reached.</p></div>}</div>{hasPermission('settings.manage') && <button onClick={() => go('/settings#usage-alerts')} className="w-full border-t border-border px-4 py-3 text-left text-xs font-medium text-primary hover:bg-muted">Manage alert limits</button>}</div>}
    </div>
  </header>
}
