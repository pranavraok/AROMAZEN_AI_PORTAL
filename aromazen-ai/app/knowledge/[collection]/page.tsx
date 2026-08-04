'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { KnowledgeCollection, KnowledgeDocument } from '@/lib/api/types'

interface Props { params: Promise<{ collection: string }> }

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function CollectionDetailPage({ params }: Props) {
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const [slug, setSlug] = useState<string | null>(null)
  const [collection, setCollection] = useState<KnowledgeCollection | null>(null)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { void params.then(({ collection }) => setSlug(collection)) }, [params])
  useEffect(() => {
    if (!accessToken || !slug) return
    void api.knowledge.collections(accessToken).then(async (collections) => {
      const found = collections.find((item) => item.slug === slug)
      if (!found) return
      setCollection(found)
      setDocuments(await api.knowledge.documents(accessToken, found.id))
    }).catch((reason) => notify('error', reason instanceof ApiError ? reason.message : 'Unable to load this collection.')).finally(() => setLoading(false))
  }, [accessToken, notify, slug])
  async function processDocument(document: KnowledgeDocument) {
    if (!accessToken || !collection) return
    try {
      const result = await api.knowledge.processDocument(accessToken, collection.id, document.id)
      setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, status: 'ready', extracted_characters: result.extracted_characters, processed_at: new Date().toISOString() } : item))
      notify('success', `${document.name} is ready to use.`)
    } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to process this document.') }
  }

  return <AppLayout><div className="space-y-6 p-6">
    <Link href="/knowledge" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" />Back to Knowledge</Link>
    {loading ? <p className="text-sm text-muted-foreground">Loading collection…</p> : !collection ? <p className="text-sm text-muted-foreground">Collection not found or unavailable for your role.</p> : <>
      <PageHeader title={collection.name} description={collection.description || 'Company knowledge collection'} />
      <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Documents</p><p className="mt-1 text-2xl font-semibold">{documents.length}</p></div><div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Access</p><p className="mt-1 text-sm font-medium">{collection.is_shared ? 'Company-wide' : collection.department_names.join(' · ')}</p></div><div className="rounded-lg border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Ready</p><p className="mt-1 text-2xl font-semibold">{documents.filter((document) => document.status === 'ready').length}</p></div></div>
      <div className="overflow-hidden rounded-lg border border-border bg-card"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Documents</h2></div>{documents.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No documents yet. Upload one from the Knowledge page.</p> : <div className="divide-y divide-border">{documents.map((document) => <div key={document.id} className="flex items-center gap-3 p-4"><FileText className="h-5 w-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatSize(document.size_bytes)} · Version {document.version} · {document.extracted_characters.toLocaleString()} characters read</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${document.status === 'ready' ? 'bg-emerald-500/15 text-emerald-600' : document.status === 'failed' ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-700'}`}>{document.status === 'ready' ? 'Ready' : document.status === 'failed' ? 'Failed' : document.status === 'uploaded' ? 'Needs processing' : 'Processing'}</span>{document.status !== 'ready' && hasPermission('knowledge.write') && <Button variant="outline" size="sm" onClick={() => void processDocument(document)}>Process now</Button>}</div>)}</div>}</div>
    </>}
  </div></AppLayout>
}
