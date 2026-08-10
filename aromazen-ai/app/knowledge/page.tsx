'use client'

import { ChangeEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen, Lock, Settings2, Upload, Users } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import { ApiError } from '@/lib/api/client'
import type { KnowledgeCollection } from '@/lib/api/types'

const DOCUMENT_CATEGORIES = [
  ['general', 'General document'], ['registration_certificate', 'Registration certificate'],
  ['license', 'Licence'], ['compliance_certificate', 'Compliance certificate'],
  ['attendance_rule', 'Attendance rule / letter'], ['leave_rule', 'Leave rule / letter'],
  ['hr_policy', 'HR policy'], ['other', 'Other'],
] as const

export default function KnowledgePage() {
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const [collections, setCollections] = useState<KnowledgeCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [pendingUpload, setPendingUpload] = useState<{ file: File; collectionId: string; collectionName: string } | null>(null)
  const [metadata, setMetadata] = useState({ document_category: 'general', expiry_date: '', reminder_days_before: '30', reminder_owner: '' })

  useEffect(() => {
    if (!accessToken) return
    void api.knowledge.collections(accessToken).then(setCollections).catch((reason) => notify('error', reason instanceof ApiError ? reason.message : 'Unable to load knowledge collections.')).finally(() => setLoading(false))
  }, [accessToken, notify])

  function chooseUpload(event: ChangeEvent<HTMLInputElement>, collection: KnowledgeCollection) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setMetadata({ document_category: 'general', expiry_date: '', reminder_days_before: '30', reminder_owner: '' })
    setPendingUpload({ file, collectionId: collection.id, collectionName: collection.name })
  }

  async function upload() {
    if (!pendingUpload || !accessToken) return
    setIsUploading(true)
    try {
      const result = await api.knowledge.uploadDocument(accessToken, pendingUpload.collectionId, pendingUpload.file, { ...metadata, reminder_days_before: Number(metadata.reminder_days_before) || 30 })
      notify('success', `${result.name} is ready to use.`)
      setCollections((current) => current.map((collection) => collection.id === pendingUpload.collectionId ? { ...collection, document_count: collection.document_count + 1 } : collection))
      setPendingUpload(null)
    } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to upload document.') }
    finally { setIsUploading(false) }
  }

  return <AppLayout><div className="space-y-6 p-6">
    <PageHeader title="Knowledge Base" description="Collections are automatically filtered to the knowledge you are allowed to access." actions={hasPermission('settings.manage') ? <Link href="/knowledge/manage"><Button variant="outline"><Settings2 className="mr-2 h-4 w-4" />Manage knowledge</Button></Link> : undefined} />
    {loading ? <p className="text-sm text-muted-foreground">Loading collections…</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{collections.map((collection) => <div key={collection.id} className="rounded-2xl border border-border bg-card p-5">
      <Link href={`/knowledge/${collection.slug}`} className="block transition hover:text-primary"><div className="mb-5 flex items-start justify-between"><div className="rounded-xl bg-primary/10 p-2.5 text-primary"><BookOpen className="h-5 w-5" /></div>{collection.is_shared ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" />Shared</span> : <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />Restricted</span>}</div><h2 className="font-semibold text-foreground">{collection.name}</h2><div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">{collection.is_shared ? 'Company-wide' : collection.department_names.join(' · ')} · {collection.document_count} documents</div></Link>
      {hasPermission('knowledge.write') && <label className="mt-4 block"><span className="sr-only">Upload to {collection.name}</span><input onChange={(event) => chooseUpload(event, collection)} disabled={isUploading} type="file" accept=".pdf,.docx,.xlsx,.pptx" className="hidden" /><span className="flex cursor-pointer items-center justify-center rounded-xl border border-border px-3 py-2.5 text-xs hover:bg-muted"><Upload className="mr-2 h-3 w-3" />Upload document</span></label>}
    </div>)}</div>}
    {!loading && collections.length === 0 && <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">No knowledge collections are available for your role yet.</div>}
    {pendingUpload && <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4"><div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"><h2 className="text-lg font-semibold">Add Knowledge document</h2><p className="mt-1 text-sm text-muted-foreground">{pendingUpload.file.name} · {pendingUpload.collectionName}</p><div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-muted-foreground">Document type</span><select value={metadata.document_category} onChange={(event) => setMetadata((current) => ({ ...current, document_category: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">{DOCUMENT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span className="mb-1.5 block text-xs text-muted-foreground">Expiry / renewal date (optional)</span><input type="date" value={metadata.expiry_date} onChange={(event) => setMetadata((current) => ({ ...current, expiry_date: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label>
      <label><span className="mb-1.5 block text-xs text-muted-foreground">Notify before</span><select disabled={!metadata.expiry_date} value={metadata.reminder_days_before} onChange={(event) => setMetadata((current) => ({ ...current, reminder_days_before: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"><option value="7">7 days</option><option value="15">15 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></label>
      <label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-muted-foreground">Responsible person (optional)</span><input value={metadata.reminder_owner} onChange={(event) => setMetadata((current) => ({ ...current, reminder_owner: event.target.value }))} placeholder="Person responsible for renewal" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label>
    </div><p className="mt-4 text-xs leading-5 text-muted-foreground">Attendance, leave and HR rule documents do not require an expiry date. Certificates and licences will appear in the notification bell when their reminder window begins.</p><div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={isUploading} onClick={() => setPendingUpload(null)}>Cancel</Button><Button disabled={isUploading} onClick={() => void upload()}>{isUploading ? 'Uploading…' : 'Upload and save'}</Button></div></div></div>}
  </div></AppLayout>
}
