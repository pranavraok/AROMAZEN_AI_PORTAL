'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ExternalLink, FileText, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { KnowledgeDocument } from '@/lib/api/types'

type RuleDocument = KnowledgeDocument & { collection_name: string }

const CATEGORY_LABELS: Record<string, string> = {
  attendance_rule: 'Attendance rule / letter',
  leave_rule: 'Leave rule / letter',
  hr_policy: 'HR policy',
}

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All rules' },
  { key: 'attendance_rule', label: 'Attendance rule / letter' },
  { key: 'leave_rule', label: 'Leave rule / letter' },
  { key: 'hr_policy', label: 'HR policy' },
] as const

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function RulesRemindersPage() {
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const [documents, setDocuments] = useState<RuleDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  useEffect(() => {
    if (!accessToken) return
    void api.knowledge.rulesAndReminders(accessToken)
      .then(setDocuments)
      .catch((reason) => notify('error', reason instanceof ApiError ? reason.message : 'Unable to load rules and reminders.'))
      .finally(() => setLoading(false))
  }, [accessToken, notify])

  const filteredDocs = useMemo(() => {
    if (categoryFilter === 'all') return documents
    return documents.filter((d) => d.document_category === categoryFilter)
  }, [documents, categoryFilter])

  const stats = useMemo(() => ({
    total: documents.length,
    attendance: documents.filter((d) => d.document_category === 'attendance_rule').length,
    leave: documents.filter((d) => d.document_category === 'leave_rule').length,
    hrPolicy: documents.filter((d) => d.document_category === 'hr_policy').length,
    companyWide: documents.filter((d) => d.is_company_wide).length,
  }), [documents])

  async function viewDocument(doc: RuleDocument) {
    if (!accessToken) return
    try {
      const response = await fetch(api.knowledge.documentContentUrl(doc.collection_id, doc.id), { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw new Error('Unable to open document.')
      window.open(URL.createObjectURL(await response.blob()), '_blank', 'noopener,noreferrer')
    } catch { notify('error', 'Unable to open document.') }
  }

  return <AppLayout><div className="space-y-6 p-6">
    <Link href="/knowledge" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" />Back to Knowledge</Link>
    <PageHeader title="Rules & Reminders" description="Attendance rules, leave policies, and HR policy documents across all your accessible collections." />

    {loading ? <p className="text-sm text-muted-foreground">Loading documents…</p> : <>
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Total rule documents</p><p className="mt-1 text-2xl font-semibold">{stats.total}</p></div>
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Attendance rules</p><p className="mt-1 text-2xl font-semibold">{stats.attendance}</p></div>
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Leave rules</p><p className="mt-1 text-2xl font-semibold">{stats.leave}</p></div>
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">HR policies</p><p className="mt-1 text-2xl font-semibold">{stats.hrPolicy}</p></div>
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Category:</span>
        {CATEGORY_FILTERS.map((filter) => (
          <button type="button" key={filter.key} onClick={() => setCategoryFilter(filter.key)} className={`rounded-full px-3 py-1.5 text-xs transition ${categoryFilter === filter.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{filter.label}</button>
        ))}
      </div>

      {/* Document list */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Documents</h2></div>
        {filteredDocs.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No rule documents found. Upload attendance, leave, or HR policy documents from the Knowledge Base to see them here.</p> : <div className="divide-y divide-border">
          {filteredDocs.map((doc) => <div key={doc.id} className="flex items-center gap-3 p-4">
            <FileText className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{doc.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {doc.collection_name} · {CATEGORY_LABELS[doc.document_category ?? ''] ?? doc.document_category} · {formatSize(doc.size_bytes)}
                {doc.is_company_wide && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"><Shield className="h-2.5 w-2.5" />Company-wide</span>}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${doc.status === 'ready' ? 'bg-emerald-500/15 text-emerald-600' : doc.status === 'failed' ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-700'}`}>{doc.status === 'ready' ? 'Ready' : doc.status === 'failed' ? 'Failed' : 'Processing'}</span>
            <Button variant="outline" size="sm" onClick={() => void viewDocument(doc)}>View <ExternalLink className="ml-1 h-3 w-3" /></Button>
          </div>)}
        </div>}
      </div>
    </>}
  </div></AppLayout>
}
