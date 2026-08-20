'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, ExternalLink, FileText, Lock, LockKeyhole, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { KnowledgeCollection, KnowledgeDocument } from '@/lib/api/types'

interface Props { params: Promise<{ collection: string }> }

/** Document enriched with its parent collection info for cross-collection views. */
interface DocWithCollection {
  document: KnowledgeDocument
  collection: KnowledgeCollection
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function CollectionDetailPage({ params }: Props) {
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
  const [docsWithCollection, setDocsWithCollection] = useState<DocWithCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null)

  useEffect(() => { void params.then(({ collection }) => setSlug(collection)) }, [params])

  useEffect(() => {
    if (!accessToken || !slug) return
    void api.knowledge.collections(accessToken).then(async (collections) => {
      setAllCollections(collections)
      const found = collections.find((item) => item.slug === slug)
      if (!found) { setLoading(false); return }
      setCollectionFilter(found.id)

      // Load documents from ALL accessible collections
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
    return items
  }, [docsWithCollection, collectionFilter, categories])

  const totalDocs = filteredDocs.length
  const totalReady = filteredDocs.filter((d) => d.document.status === 'ready').length

  async function processDocument(item: DocWithCollection) {
    if (!accessToken) return
    try {
      const result = await api.knowledge.processDocument(accessToken, item.collection.id, item.document.id)
      setDocsWithCollection((current) => current.map((pair) => pair.document.id === item.document.id ? { ...pair, document: { ...pair.document, status: 'ready', extracted_characters: result.extracted_characters, processed_at: new Date().toISOString() } } : pair))
      notify('success', `${item.document.name} is ready to use.`)
    } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to process this document.') }
  }

  async function viewDocument(item: DocWithCollection) {
    if (!accessToken) return
    try {
      const response = await fetch(api.knowledge.documentContentUrl(item.collection.id, item.document.id), { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw new Error('Unable to open document.')
      window.open(URL.createObjectURL(await response.blob()), '_blank', 'noopener,noreferrer')
    } catch { notify('error', 'Unable to open document.') }
  }

  return <AppLayout><div className="space-y-6 p-6">
    <Link href="/knowledge" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" />Back to Knowledge</Link>
    {loading ? <p className="text-sm text-muted-foreground">Loading collections…</p> : <>
      <PageHeader title="Rules & Reminders" description={categories ? `Showing ${categories.join(', ')} documents across all accessible collections` : 'Documents across all accessible collections'} />

      {/* Collection filter pills */}
      {allCollections.length > 0 && <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Collection:</span>
        <button type="button" onClick={() => setCollectionFilter(null)} className={`rounded-full px-3 py-1.5 text-xs transition ${collectionFilter === null ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>All collections</button>
        {allCollections.map((col) => (
          <button type="button" key={col.id} onClick={() => setCollectionFilter(col.id)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition ${collectionFilter === col.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
            {col.is_shared ? <Users className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {col.name}
          </button>
        ))}
      </div>}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Documents</p><p className="mt-1 text-2xl font-semibold">{totalDocs}</p></div>
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Collections</p><p className="mt-1 text-2xl font-semibold">{new Set(filteredDocs.map((d) => d.collection.id)).size}</p></div>
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
                {item.collection.name} · {formatSize(item.document.size_bytes)} · v{item.document.version} · {protectedCashFlow ? 'Password required to open' : `${item.document.extracted_characters.toLocaleString()} chars`}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${protectedCashFlow || item.document.status === 'ready' ? 'bg-emerald-500/15 text-emerald-600' : item.document.status === 'failed' ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-700'}`}>{protectedCashFlow ? 'Protected' : item.document.status === 'ready' ? 'Ready' : item.document.status === 'failed' ? 'Failed' : item.document.status === 'uploaded' ? 'Needs processing' : 'Processing'}</span>
            <Button variant="outline" size="sm" onClick={() => void viewDocument(item)}>View <ExternalLink className="ml-1 h-3 w-3" /></Button>
            {!protectedCashFlow && item.document.status !== 'ready' && hasPermission('knowledge.write') && <Button variant="outline" size="sm" onClick={() => void processDocument(item)}>Process now</Button>}
          </div> })}
        </div>}
      </div>
    </>}
  </div></AppLayout>
}
