'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, Download, ExternalLink, FileText, Folder, Lock, LockKeyhole, Shield, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { KnowledgeCollection, KnowledgeDocument } from '@/lib/api/types'

interface Props { params: Promise<{ collection: string }> }

const FOLDER_DEFINITIONS = [
  { key: 'general', label: 'General document', icon: Folder },
  { key: 'registration_certificate', label: 'Registration certificate', icon: Folder },
  { key: 'license', label: 'Licence', icon: Folder },
  { key: 'compliance_certificate', label: 'Compliance certificate', icon: Folder },
  { key: 'attendance_rule', label: 'Attendance rule / letter', icon: Shield },
  { key: 'leave_rule', label: 'Leave rule / letter', icon: Shield },
  { key: 'hr_policy', label: 'HR policy', icon: Shield },
  { key: 'other', label: 'Other', icon: Folder },
  { key: 'department_upload', label: 'Department uploads', icon: Folder },
] as const

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function folderLabel(doc: KnowledgeDocument) {
  const cat = doc.document_category ?? 'general'
  if (cat.startsWith('other:')) return cat.slice(6)
  if (cat.startsWith('hr_letter_template:')) return `HR letter template · ${cat.slice('hr_letter_template:'.length).replaceAll('_', ' ')}`
  if (cat === 'salary_slip_template') return 'Salary-slip template'
  if (cat === 'document_template') return 'Document template'
  if (cat === 'department_upload') return doc.source_key ? `Department upload · ${doc.source_key.replaceAll(':', ' · ').replaceAll('-', ' ')}` : 'Department upload'
  return FOLDER_DEFINITIONS.find((f) => f.key === cat)?.label ?? cat
}

export default function CollectionDetailPage({ params }: Props) {
  const router = useRouter()
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const searchParams = useSearchParams()
  const categories = useMemo(() => {
    const raw = searchParams.get('categories')
    if (!raw) return null
    const parsed = raw.split(',').map((c) => c.trim()).filter(Boolean)
    return parsed.length > 0 ? parsed : null
  }, [searchParams])

  const [slug, setSlug] = useState<string | null>(null)
  const [allCollections, setAllCollections] = useState<KnowledgeCollection[]>([])
  const [docsWithCollection, setDocsWithCollection] = useState<{ document: KnowledgeDocument; collection: KnowledgeCollection }[]>([])
  const [loading, setLoading] = useState(true)
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null)
  const [activeFolder, setActiveFolder] = useState<string | null>(null)

  useEffect(() => { void params.then(({ collection }) => setSlug(collection)) }, [params])

  useEffect(() => {
    if (!accessToken || !slug) return
    void api.knowledge.collections(accessToken).then(async (collections) => {
      setAllCollections(collections)
      const found = collections.find((item) => item.slug === slug)
      if (found) setCollectionFilter(found.id)

      const allPairs = await Promise.all(
        collections.map(async (col) => {
          const docs = await api.knowledge.documents(accessToken, col.id)
          return docs.map((document) => ({ document, collection: col }))
        })
      )
      setDocsWithCollection(allPairs.flat())
    }).catch((reason) => notify('error', reason instanceof ApiError ? reason.message : 'Unable to load knowledge collections.')).finally(() => setLoading(false))
  }, [accessToken, notify, slug])

  const filteredDocs = useMemo(() => {
    let items = docsWithCollection
    if (collectionFilter) {
      items = items.filter((item) => item.collection.id === collectionFilter)
    }
    if (categories) {
      items = items.filter((item) => item.document.document_category && categories.includes(item.document.document_category))
    }
    if (activeFolder) {
      items = items.filter((item) => {
        const cat = item.document.document_category ?? 'general'
        if (activeFolder === 'other') return cat === 'other' || cat.startsWith('other:')
        return cat === activeFolder
      })
    }
    return items
  }, [docsWithCollection, collectionFilter, categories, activeFolder])

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    const scopedDocs = collectionFilter ? docsWithCollection.filter((item) => item.collection.id === collectionFilter) : docsWithCollection
    for (const item of scopedDocs) {
      const cat = item.document.document_category ?? 'general'
      counts[cat] = (counts[cat] || 0) + 1
    }
    return counts
  }, [docsWithCollection, collectionFilter])

  const totalDocs = filteredDocs.length
  const totalReady = filteredDocs.filter((d) => d.document.status === 'ready').length

  async function processDocument(item: { document: KnowledgeDocument; collection: KnowledgeCollection }) {
    if (!accessToken) return
    try {
      const result = await api.knowledge.processDocument(accessToken, item.collection.id, item.document.id)
      setDocsWithCollection((current) => current.map((pair) => pair.document.id === item.document.id ? { ...pair, document: { ...pair.document, status: 'ready', extracted_characters: result.extracted_characters, processed_at: new Date().toISOString() } } : pair))
      notify('success', `${item.document.name} is ready to use.`)
    } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to process this document.') }
  }

  function viewDocument(item: { document: KnowledgeDocument; collection: KnowledgeCollection }) {
    const params = new URLSearchParams({ collectionId: item.collection.id, documentId: item.document.id, name: item.document.name })
    router.push(`/knowledge/viewer?${params.toString()}`)
  }

  async function downloadDocument(item: { document: KnowledgeDocument; collection: KnowledgeCollection }) {
    if (!accessToken) return
    try {
      const response = await fetch(api.knowledge.documentContentUrl(item.collection.id, item.document.id), { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw new Error('Unable to download document.')
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = item.document.name
      a.click()
      URL.revokeObjectURL(blobUrl)
    } catch { notify('error', 'Unable to download document.') }
  }

  const currentCollection = allCollections.find((c) => c.id === collectionFilter)

  return <AppLayout><div className="space-y-6 p-6">
    <Link href="/knowledge" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" />Back to Knowledge</Link>
    {loading ? <p className="text-sm text-muted-foreground">Loading collections…</p> : <>
      <PageHeader
        title={currentCollection?.name ?? 'Collection'}
        description={currentCollection ? (currentCollection.is_shared ? 'Company-wide collection' : `Department collection · ${currentCollection.department_names.join(', ')}`) : 'Documents across all accessible collections'}
      />

      {/* Folder tabs */}
      {currentCollection && <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Folder:</span>
        <button type="button" onClick={() => setActiveFolder(null)} className={`rounded-full px-3 py-1.5 text-xs transition ${activeFolder === null ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>All folders</button>
        {FOLDER_DEFINITIONS.map((folder) => {
          const count = folderCounts[folder.key] ?? 0
          if (count === 0 && activeFolder !== folder.key) return null
          const Icon = folder.icon
          return <button type="button" key={folder.key} onClick={() => setActiveFolder(activeFolder === folder.key ? null : folder.key)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition ${activeFolder === folder.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
            <Icon className="h-3 w-3" />
            {folder.label}
            <span className="ml-0.5 rounded-full bg-background/20 px-1.5 py-0.5 text-[10px]">{count}</span>
          </button>
        })}
      </div>}

      {/* Collection filter pills (only if multiple collections) */}
      {allCollections.length > 1 && <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Collection:</span>
        <button type="button" onClick={() => setCollectionFilter(null)} className={`rounded-full px-3 py-1.5 text-xs transition ${collectionFilter === null ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>All collections</button>
        {allCollections.map((col) => (
          <button type="button" key={col.id} onClick={() => { setCollectionFilter(col.id); setActiveFolder(null) }} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition ${collectionFilter === col.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
            {col.is_shared ? <Users className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {col.name}
          </button>
        ))}
      </div>}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Documents</p><p className="mt-1 text-2xl font-semibold">{totalDocs}</p></div>
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Folders</p><p className="mt-1 text-2xl font-semibold">{new Set(filteredDocs.map((d) => d.document.document_category ?? 'general')).size}</p></div>
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Ready</p><p className="mt-1 text-2xl font-semibold">{totalReady}</p></div>
      </div>

      {/* Document list */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Documents</h2></div>
        {filteredDocs.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No documents found for this filter.</p> : <div className="divide-y divide-border">
          {filteredDocs.map((item) => { const protectedCashFlow = item.document.document_category === 'cash_flow_report'; return <div key={item.document.id} className="flex items-center gap-3 p-4">
            {protectedCashFlow ? <LockKeyhole className="h-5 w-5 shrink-0 text-primary" /> : <FileText className="h-5 w-5 shrink-0 text-primary" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.document.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {collectionFilter === null && <><span className="font-medium text-foreground/70">{item.collection.name}</span> · </>}{folderLabel(item.document)} · {formatSize(item.document.size_bytes)} · v{item.document.version} · {protectedCashFlow ? 'Password required to open' : `${item.document.extracted_characters.toLocaleString()} chars`}
                {item.document.is_company_wide && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"><Shield className="h-2.5 w-2.5" />Company-wide</span>}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${protectedCashFlow || item.document.status === 'ready' ? 'bg-emerald-500/15 text-emerald-600' : item.document.status === 'failed' ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-700'}`}>{protectedCashFlow ? 'Protected' : item.document.status === 'ready' ? 'Ready' : item.document.status === 'failed' ? 'Failed' : item.document.status === 'uploaded' ? 'Needs processing' : 'Processing'}</span>
            <Button variant="outline" size="sm" onClick={() => void viewDocument(item)}>View <ExternalLink className="ml-1 h-3 w-3" /></Button>
            <Button variant="outline" size="sm" onClick={() => void downloadDocument(item)} title="Download"><Download className="h-3 w-3" /></Button>
            {!protectedCashFlow && item.document.status !== 'ready' && hasPermission('knowledge.write') && <Button variant="outline" size="sm" onClick={() => void processDocument(item)}>Process now</Button>}
            {hasPermission('knowledge.write') && !item.document.is_company_wide && <Button variant="outline" size="sm" onClick={async () => {
              if (!accessToken) return
              try {
                await api.knowledge.updateDocumentReminder(accessToken, item.collection.id, item.document.id, { document_category: item.document.document_category, expiry_date: item.document.expiry_date, reminder_days_before: item.document.reminder_days_before, is_company_wide: true })
                setDocsWithCollection((current) => current.map((pair) => pair.document.id === item.document.id ? { ...pair, document: { ...pair.document, is_company_wide: true } } : pair))
                notify('success', 'Made company-wide.')
              } catch { notify('error', 'Unable to update document.') }
            }}><Shield className="mr-1 h-3 w-3" />Make company-wide</Button>}
          </div> })}
        </div>}
      </div>
    </>}
  </div></AppLayout>
}
