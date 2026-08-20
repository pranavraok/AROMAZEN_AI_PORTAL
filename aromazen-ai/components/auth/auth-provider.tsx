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
  refreshProfile: () => Promise<void>
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

  useEffect(() => {
    if (!user) return
    const dark = user.theme === 'dark' || (user.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.classList.toggle('light', !dark)
  }, [user])

  const signIn = useCallback(async (payload: LoginRequest) => {
    const session = await api.auth.login(payload)
    setUser(session.user)
    setAccessToken(session.access_token)
  }, [])

  const signOut = useCallback(async () => {
    try { await api.auth.logout() } finally { setUser(null); setAccessToken(null) }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!accessToken) return
    setUser(await api.auth.me(accessToken))
  }, [accessToken])

  const value = useMemo(() => ({
    user, accessToken, isLoading, signIn, signOut, refreshProfile,
    hasPermission: (permission: string) => user?.permission_keys.includes(permission) ?? false,
  }), [accessToken, isLoading, refreshProfile, signIn, signOut, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}

const routePermissions: Array<[route: string, permission: string]> = [
  ['/knowledge/manage', 'settings.manage'],
  ['/admin/knowledge', 'settings.manage'],
  ['/admin/usage', 'usage.read'],
  ['/admin/users', 'users.manage'],
  ['/admin/access', 'roles.manage'],
  ['/hr/salary-slips', 'users.manage'],
  ['/hr/leave-calculator', 'users.manage'],
  ['/hr/assets', 'users.manage'],
  ['/accounts/cash-flow', 'users.manage'],
  ['/accounts/gst-reconciliation', 'ai.workspace.use'],
  ['/rnd/documents', 'ai.workspace.use'],
  ['/department-tools', 'ai.workspace.use'],
  ['/workspace', 'ai.workspace.use'],
  ['/knowledge', 'knowledge.read'],
  ['/settings', 'settings.manage'],
]

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export function RequireAuthenticatedApp({ children }: { children: React.ReactNode }) {
  const { user, isLoading, hasPermission } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  useEffect(() => { if (!isLoading && !user) router.replace('/login') }, [isLoading, router, user])
  if (isLoading || !user) return <div className="min-h-screen bg-background" />
  const permission = routePermissions.find(([route]) => matchesRoute(pathname, route))?.[1]
  if (permission && !hasPermission(permission)) return <main className="min-h-screen bg-background grid place-items-center p-6"><div className="max-w-md text-center space-y-3"><h1 className="text-2xl font-semibold text-foreground">Access restricted</h1><p className="text-muted-foreground">Your role does not include permission to view this area.</p></div></main>
  const isPlatformAdmin = user.role_names.some((role) => role === 'Super Admin' || role === 'Admin')
  const isHrOnlyRoute = matchesRoute(pathname, '/hr/salary-slips')
    || matchesRoute(pathname, '/hr/leave-calculator')
    || matchesRoute(pathname, '/department-tools/hr-letters')
    || matchesRoute(pathname, '/department-tools/hr-interview')
    || matchesRoute(pathname, '/department-tools/hr-attendance')
  const isRndOnlyRoute = matchesRoute(pathname, '/rnd/documents')
    || pathname.startsWith('/department-tools/rnd-')
  const isAccountsCashFlow = matchesRoute(pathname, '/accounts/cash-flow')
  const isAccountsGst = matchesRoute(pathname, '/accounts/gst-reconciliation')
  if (isHrOnlyRoute && !isPlatformAdmin && !['HR', 'Human Resources'].includes(user.department_name ?? '')) return <main className="min-h-screen bg-background grid place-items-center p-6"><div className="max-w-md text-center space-y-3"><h1 className="text-2xl font-semibold text-foreground">Access restricted</h1><p className="text-muted-foreground">This tool is available only to the Human Resources department.</p></div></main>
  if (isRndOnlyRoute && !isPlatformAdmin && user.department_name !== 'R&D') return <main className="min-h-screen bg-background grid place-items-center p-6"><div className="max-w-md text-center space-y-3"><h1 className="text-2xl font-semibold text-foreground">Access restricted</h1><p className="text-muted-foreground">This tool is available only to the R&amp;D department.</p></div></main>
  if (isAccountsCashFlow && !isPlatformAdmin && !(user.department_name === 'Accounts' && user.role_names.includes('Department Admin'))) return <main className="min-h-screen bg-background grid place-items-center p-6"><div className="max-w-md text-center space-y-3"><h1 className="text-2xl font-semibold text-foreground">Access restricted</h1><p className="text-muted-foreground">This tool is available only to the Accounts Department Admin, Admin and Super Admin.</p></div></main>
  if (isAccountsGst && !(user.department_name === 'Accounts' && user.role_names.some((role) => role === 'Department Admin' || role === 'Employee'))) return <main className="min-h-screen bg-background grid place-items-center p-6"><div className="max-w-md text-center space-y-3"><h1 className="text-2xl font-semibold text-foreground">Access restricted</h1><p className="text-muted-foreground">GST Reconciliation is available only to Accounts Department Admin and Accounts Department Employee.</p></div></main>
  return <>{children}</>
}
