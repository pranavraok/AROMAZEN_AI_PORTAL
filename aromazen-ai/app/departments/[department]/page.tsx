'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ChevronLeft, LoaderCircle } from 'lucide-react'
import { useParams } from 'next/navigation'
import { AppLayout } from '@/components/layouts/app-layout'
import { DepartmentActionCenter } from '@/components/departments/department-action-center'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import { ApiError } from '@/lib/api/client'
import type { Department } from '@/lib/api/types'

export default function DepartmentCenterPage() {
  const { department: departmentSlug } = useParams<{ department: string }>()
  const { accessToken, user } = useAuth()
  const { notify } = useToast()
  const [department, setDepartment] = useState<Department | null>(null)
  const [loading, setLoading] = useState(true)
  const isAdmin = user?.role_names.includes('Admin') ?? false
  const isDepartmentAdmin = user?.role_names.includes('Department Admin') ?? false

  useEffect(() => {
    if (!accessToken || (!isAdmin && !isDepartmentAdmin)) {
      setLoading(false)
      return
    }
    let active = true
    void api.admin.departments(accessToken)
      .then((departments) => {
        if (active) setDepartment(departments.find((item) => item.slug === departmentSlug) ?? null)
      })
      .catch((error) => notify('error', error instanceof ApiError ? error.message : 'Unable to open this department.'))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accessToken, departmentSlug, isAdmin, isDepartmentAdmin, notify])

  if (loading) return <AppLayout><main className="grid min-h-[70vh] place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-primary" /></main></AppLayout>
  if (!department || (!isAdmin && !isDepartmentAdmin)) return <AppLayout><main className="grid min-h-[70vh] place-items-center p-6"><div className="max-w-md text-center"><h1 className="text-2xl font-semibold">Access restricted</h1><p className="mt-2 text-sm text-muted-foreground">This department workspace is available only to Admin and its Department Admin.</p></div></main></AppLayout>

  return <AppLayout><main className="space-y-6 p-6">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" />Back to Dashboard</Link>
    <PageHeader title={`${department.name} Dashboard`} description={`Upload files, run workflows and review results for ${department.name}.`} />
    <DepartmentActionCenter department={department} audience={isAdmin ? 'admin' : 'department_admin'} />
  </main></AppLayout>
}
