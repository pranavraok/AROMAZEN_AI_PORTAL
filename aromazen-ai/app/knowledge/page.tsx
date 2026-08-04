'use client'

import { ChangeEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import { ApiError } from '@/lib/api/client'
import type { KnowledgeCollection } from '@/lib/api/types'
import { BookOpen, Lock, Settings2, Upload, Users } from 'lucide-react'

export default function KnowledgePage() {
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const [collections, setCollections] = useState<KnowledgeCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    if (!accessToken) return
    void api.knowledge.collections(accessToken).then(setCollections).catch((reason) => notify('error', reason instanceof ApiError ? reason.message : 'Unable to load knowledge collections.')).finally(() => setLoading(false))
  }, [accessToken, notify])

  async function upload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; const collectionId = event.target.dataset.collectionId; if (!file || !collectionId || !accessToken) return; setIsUploading(true); try { const result = await api.knowledge.uploadDocument(accessToken, collectionId, file); notify('success', `${result.name} is ready to use.`); setCollections((current) => current.map((collection) => collection.id === collectionId ? { ...collection, document_count: collection.document_count + 1 } : collection)) } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to upload document.') } finally { setIsUploading(false); event.target.value = '' } }

  return <AppLayout><div className="space-y-6 p-6"><PageHeader title="Knowledge Base" description="Collections are automatically filtered to the knowledge you are allowed to access." actions={hasPermission('settings.manage') ? <Link href="/knowledge/manage"><Button variant="outline"><Settings2 className="mr-2 h-4 w-4" />Manage knowledge</Button></Link> : undefined} />
    {loading ? <p className="text-sm text-muted-foreground">Loading collections…</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{collections.map((collection) => <div key={collection.id} className="rounded-lg border border-border bg-card p-5"><Link href={`/knowledge/${collection.slug}`} className="block transition hover:text-primary"><div className="mb-4 flex items-start justify-between"><div className="rounded-lg bg-primary/15 p-2 text-primary"><BookOpen className="h-5 w-5" /></div>{collection.is_shared ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" />Shared</span> : <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />Restricted</span>}</div><h2 className="font-semibold text-foreground">{collection.name}</h2><p className="mt-1 min-h-10 text-sm text-muted-foreground">{collection.description}</p><div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">{collection.is_shared ? 'Available company-wide' : collection.department_names.join(' · ')} · {collection.document_count} documents</div></Link>{hasPermission('knowledge.write') && <label className="mt-4 block"><span className="sr-only">Upload to {collection.name}</span><input data-collection-id={collection.id} onChange={upload} disabled={isUploading} type="file" accept=".pdf,.docx,.xlsx,.pptx" className="hidden" /><span className="flex cursor-pointer items-center justify-center rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"><Upload className="mr-2 h-3 w-3" />{isUploading ? 'Uploading…' : 'Upload document'}</span></label>}</div>)}</div>}
    {!loading && collections.length === 0 && <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">No knowledge collections are available for your role yet.</div>}
  </div></AppLayout>
}
