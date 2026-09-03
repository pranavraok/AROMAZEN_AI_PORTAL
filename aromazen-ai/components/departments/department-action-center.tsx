'use client'

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  BookOpen,
  Boxes,
  CalendarCheck2,
  ClipboardCheck,
  FileText,
  GitCompareArrows,
  ShieldCheck,
  UserCog,
  WalletCards,
  WandSparkles,
} from 'lucide-react'
import type { Department } from '@/lib/api/types'

export type DepartmentAudience = 'admin' | 'department_admin' | 'employee'

type DepartmentAction = {
  key: string
  title: string
  description: string
  href: string
  icon: LucideIcon
  employeeAccess?: boolean
}

function departmentKind(department: Pick<Department, 'name' | 'slug'>) {
  const value = `${department.name} ${department.slug}`.toLowerCase()
  if (/human resources|human-resources|\bhr\b/.test(value)) return 'hr'
  if (/\bqa\b|quality assurance/.test(value)) return 'qa_qc'
  if (/regulatory/.test(value)) return 'regulatory'
  if (/accounts?/.test(value)) return 'accounts'
  if (/inventory/.test(value)) return 'inventory'
  return 'general'
}

const SPECIALIZED_ACTIONS: Record<'hr' | 'qa_qc' | 'regulatory' | 'accounts' | 'inventory', DepartmentAction[]> = {
  hr: [
    { key: 'attendance', title: 'Attendance', description: 'Upload attendance, review exceptions and export results.', href: '/department-tools/hr-attendance', icon: CalendarCheck2, employeeAccess: true },
    { key: 'leave', title: 'Leave Calculator', description: 'Calculate leave, LOP, paid days and overtime.', href: '/hr/leave-calculator', icon: ClipboardCheck },
    { key: 'letters', title: 'HR Letters', description: 'Prepare, review, download and email approved letters.', href: '/department-tools/hr-letters', icon: FileText, employeeAccess: true },
    { key: 'payroll', title: 'Payroll & Salary Slips', description: 'Prepare salary slips and manage delivery results.', href: '/hr/salary-slips', icon: WalletCards },
    { key: 'rules', title: 'Rules & Reminders', description: 'Review HR rules, licences and renewal reminders.', href: '/knowledge/rules-reminders', icon: BookOpen, employeeAccess: true },
    { key: 'custom-letters', title: 'Custom Letters', description: 'Upload occasional masters and map their {{fields}} automatically.', href: '/department-tools/hr-custom-letters', icon: WandSparkles, employeeAccess: true },
  ],
  qa_qc: [
    { key: 'coa', title: 'Certificate of Analysis (COA)', description: 'Use voice or manual entry to prepare, review, print and download the approved COA.', href: '/department-tools/qa-coa', icon: ClipboardCheck, employeeAccess: true },
  ],
  regulatory: [
    { key: 'documents', title: 'Regulatory Documents', description: 'Upload Regulatory Excel and Creation COA, approve the SDS, then generate IFRA, allergen and EU REACH documents.', href: '/department-tools/regulatory-documents', icon: ShieldCheck, employeeAccess: true },
  ],
  accounts: [
    { key: 'cash-flow', title: 'Cash Flow Report', description: 'Upload monthly files and generate the protected report.', href: '/accounts/cash-flow', icon: WalletCards },
    { key: 'gst', title: 'GST Reconciliation', description: 'Compare Tally registers with GST Portal GSTR-2B.', href: '/accounts/gst-reconciliation', icon: GitCompareArrows, employeeAccess: true },
  ],
  inventory: [
    { key: 'register', title: 'Asset Inventory', description: 'Open the approved IT and general asset workspace.', href: '/hr/assets', icon: Boxes },
  ],
}

export function departmentActions(department: Department, audience: DepartmentAudience) {
  const kind = departmentKind(department)
  const specialized = kind === 'general' ? [] : SPECIALIZED_ACTIONS[kind]
  return audience === 'employee' ? specialized.filter((action) => action.employeeAccess) : specialized
}

export function DepartmentDirectory({ departments }: { departments: Department[] }) {
  return <section className="overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm">
    <div className="border-b border-border bg-primary/[0.04] px-5 py-5">
      <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-primary">Admin control</p>
      <h2 className="mt-1 text-lg font-semibold">Admin Action Center</h2>
      <p className="mt-1 text-sm text-muted-foreground">Open a department to upload files, run its workflows and review results.</p>
    </div>
    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      {departments.map((department) => {
        const actions = departmentActions(department, 'admin')
        return <Link key={department.id} href={`/departments/${department.slug}`} className="group flex items-center gap-4 rounded-xl border border-border p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><UserCog className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{department.name}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{actions.length > 0 ? `${actions.length} approved ${actions.length === 1 ? 'feature' : 'features'}` : 'No features approved yet'}</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      })}
    </div>
  </section>
}

export function DepartmentActionCenter({ department, audience }: { department: Department; audience: DepartmentAudience }) {
  const actions = departmentActions(department, audience)
  return <section className="overflow-hidden rounded-2xl border border-primary/20 bg-card shadow-sm">
    <div className="border-b border-border bg-primary/[0.04] px-5 py-5">
      <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-primary">Department workspace</p>
      <h2 className="mt-1 text-lg font-semibold">{department.name} Action Center</h2>
      <p className="mt-1 text-sm text-muted-foreground">All permitted {department.name} work is available here.</p>
    </div>
    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      {actions.length === 0 ? <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">No department features have been approved for this department yet.</div> : null}
      {actions.map((action) => {
        const Icon = action.icon
        return <Link key={action.key} href={action.href} className="group flex items-center gap-4 rounded-xl border border-border p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{action.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{action.description}</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      })}
    </div>
  </section>
}
