'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { CurrentUser, LoginRequest } from '@/lib/api/types'

type AuthContextValue = {
  user: CurrentUser | null
  accessToken: string | null
  isLoading: boolean
  signIn: (payload: LoginRequest) => Promise<void>
  signOut: () => Promise<void>
  hasPermission: (permission: string) => boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    void api.auth.refresh()
      .then((session) => { if (active) { setUser(session.user); setAccessToken(session.access_token) } })
      .catch((error) => { if (!(error instanceof ApiError && error.status === 401)) console.error('Unable to restore session.', error) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [])

  const signIn = useCallback(async (payload: LoginRequest) => {
    const session = await api.auth.login(payload)
    setUser(session.user)
    setAccessToken(session.access_token)
  }, [])

  const signOut = useCallback(async () => {
    try { await api.auth.logout() } finally { setUser(null); setAccessToken(null) }
  }, [])

  const value = useMemo(() => ({
    user, accessToken, isLoading, signIn, signOut,
    hasPermission: (permission: string) => user?.permission_keys.includes(permission) ?? false,
  }), [accessToken, isLoading, signIn, signOut, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}

const routePermissions: Record<string, string | undefined> = {
  '/workspace': 'ai.workspace.use', '/knowledge': 'knowledge.read',
  '/rnd/documents': 'ai.workspace.use',
  '/admin/usage': 'usage.read', '/admin/users': 'users.manage', '/admin/access': 'roles.manage',
}

export function RequireAuthenticatedApp({ children }: { children: React.ReactNode }) {
  const { user, isLoading, hasPermission } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  useEffect(() => { if (!isLoading && !user) router.replace('/login') }, [isLoading, router, user])
  if (isLoading || !user) return <div className="min-h-screen bg-background" />
  const permission = Object.entries(routePermissions).find(([route]) => pathname === route || pathname.startsWith(`${route}/`))?.[1]
  if (permission && !hasPermission(permission)) return <main className="min-h-screen bg-background grid place-items-center p-6"><div className="max-w-md text-center space-y-3"><h1 className="text-2xl font-semibold text-foreground">Access restricted</h1><p className="text-muted-foreground">Your role does not include permission to view this area.</p></div></main>
  return <>{children}</>
}
