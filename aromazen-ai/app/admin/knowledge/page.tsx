'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { AdminKnowledgeCollection, AdminKnowledgeDocument, Department } from '@/lib/api/types'
import { Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

type Tab = 'collections' | 'documents'

export default function KnowledgeAdminPage() {
  const router = useRouter()
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const [tab, setTab] = useState<Tab>('collections')
  const [collections, setCollections] = useState<AdminKnowledgeCollection[]>([])
  const [documents, setDocuments] = useState<AdminKnowledgeDocument[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [editing, setEditing] = useState<AdminKnowledgeCollection | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accessToken || !hasPermission('settings.manage')) return
    try { const [nextCollections, nextDocuments, nextDepartments] = await Promise.all([api.admin.knowledgeCollections(accessToken), api.admin.knowledgeDocuments(accessToken), api.admin.departments(accessToken)]); setCollections(nextCollections); setDocuments(nextDocuments); setDepartments(nextDepartments) } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to load knowledge administration.') }
  }, [accessToken, hasPermission, notify])
  useEffect(() => { void load() }, [load])

  const filteredDocuments = selectedCollectionId
    ? documents.filter((d) => d.collection_id === selectedCollectionId)
    : documents

  const selectedCollection = selectedCollectionId
    ? collections.find((c) => c.id === selectedCollectionId)
    : null

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!accessToken) return
    const form = new FormData(event.currentTarget); const payload = { name: String(form.get('name')).trim(), description: String(form.get('description')).trim() || null, is_shared: form.get('is_shared') === 'on', department_ids: form.getAll('department_ids').map(String) }
    setBusy(true)
    try { if (editing === 'new') await api.admin.createKnowledgeCollection(accessToken, payload); else if (editing) await api.admin.updateKnowledgeCollection(accessToken, editing.id, payload); notify('success', editing === 'new' ? 'Knowledge collection created.' : 'Knowledge collection updated.'); setEditing(null); await load() } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to save collection.') } finally { setBusy(false) }
  }
  async function archive(collection: AdminKnowledgeCollection) { if (!accessToken || !window.confirm(`Archive ${collection.name}? It will disappear from employee knowledge, but documents stay preserved.`)) return; try { await api.admin.archiveKnowledgeCollection(accessToken, collection.id); notify('success', 'Collection archived.'); await load() } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to archive collection.') } }
  async function removeCollection(collection: AdminKnowledgeCollection) { if (!accessToken || !window.confirm(`Permanently delete ${collection.name}? All documents in this collection will be removed. This cannot be undone.`)) return; try { await api.admin.deleteKnowledgeCollection(accessToken, collection.id); notify('success', 'Collection deleted.'); await load() } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to delete collection.') } }
  async function removeDocument(document: AdminKnowledgeDocument) { if (!accessToken || !window.confirm(`Permanently remove ${document.name}? This cannot be undone.`)) return; try { await api.admin.deleteKnowledgeDocument(accessToken, document.id); notify('success', 'Document removed.'); await load() } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to remove document.') } }

  // Count documents per collection
  const docCountByCollection = documents.reduce<Record<string, number>>((acc, d) => {
    acc[d.collection_id] = (acc[d.collection_id] || 0) + 1
    return acc
  }, {})

  if (!hasPermission('settings.manage')) return <AppLayout><div className="p-6 text-sm text-muted-foreground">Knowledge administration is available to the Super Admin and Admin only.</div></AppLayout>
  return <AppLayout><div className="space-y-6 p-6"><PageHeader title="Manage Knowledge" description="Control collections, access, and every document without developer support." actions={<div className="flex gap-2"><Button variant="outline" onClick={() => router.push('/knowledge')}>Back to Knowledge</Button>{tab === 'collections' && <Button onClick={() => setEditing('new')}><Plus className="mr-1 h-4 w-4" />New collection</Button>}</div>} />
    <div className="flex gap-2 border-b border-border pb-3"><Button variant={tab === 'collections' ? 'default' : 'ghost'} onClick={() => { setTab('collections'); setSelectedCollectionId(null) }}>Collections</Button><Button variant={tab === 'documents' ? 'default' : 'ghost'} onClick={() => setTab('documents')}>Documents</Button></div>
    {tab === 'collections' ? <div className="grid gap-4 md:grid-cols-2">{collections.map((collection) => <div key={collection.id} className="rounded-lg border border-border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{collection.name}</h2><p className="mt-1 text-sm text-muted-foreground">{collection.description || 'No description'}</p></div><span className={`rounded-full px-2 py-1 text-xs ${collection.status === 'active' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>{collection.status}</span></div><p className="mt-4 text-xs text-muted-foreground">{collection.is_shared ? 'Company-wide access' : collection.department_names.join(' · ')} · {collection.document_count} documents</p><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(collection)}>Edit</Button>{collection.status === 'active' && <Button size="sm" variant="secondary" onClick={() => void archive(collection)}>Archive</Button>}<Button size="sm" variant="destructive" onClick={() => void removeCollection(collection)}><Trash2 className="mr-1 h-3 w-3" />Delete</Button></div></div>)}</div> : <div className="flex gap-4" style={{ minHeight: '60vh' }}>
      {/* Left: Collection list */}
      <div className="w-64 shrink-0 space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-3">
        <button onClick={() => setSelectedCollectionId(null)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${selectedCollectionId === null ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'}`}>
          All documents
          <span className="ml-1.5 text-xs text-muted-foreground">({documents.length})</span>
        </button>
        {collections.filter((c) => docCountByCollection[c.id]).map((collection) => (
          <button key={collection.id} onClick={() => setSelectedCollectionId(collection.id)} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${selectedCollectionId === collection.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'}`}>
            {collection.name}
            <span className="ml-1.5 text-xs text-muted-foreground">({docCountByCollection[collection.id]})</span>
          </button>
        ))}
      </div>
      {/* Right: Document list */}
      <div className="flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {selectedCollection && <div className="border-b border-border px-4 py-3"><p className="text-sm text-muted-foreground">Showing documents in <span className="font-medium text-foreground">{selectedCollection.name}</span></p></div>}
        <table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="p-4 text-left">Document</th><th className="p-4 text-left">Collection</th><th className="p-4 text-left">Status</th><th className="p-4 text-right">Action</th></tr></thead><tbody>{filteredDocuments.map((document) => <tr key={document.id} className="border-t border-border"><td className="p-4"><p className="font-medium">{document.name}</p><p className="text-xs text-muted-foreground">{document.extracted_characters.toLocaleString()} characters · v{document.version}</p></td><td className="p-4">{document.collection_name}</td><td className="p-4 capitalize">{document.status}</td><td className="p-4 text-right"><Button size="sm" variant="destructive" onClick={() => void removeDocument(document)}>Remove</Button></td></tr>)}</tbody></table>
        {filteredDocuments.length === 0 && <p className="p-6 text-sm text-muted-foreground">{selectedCollectionId ? 'No documents in this collection.' : 'No documents uploaded yet.'}</p>}
      </div>
    </div>}
    {editing && <CollectionModal collection={editing === 'new' ? null : editing} departments={departments} busy={busy} onClose={() => setEditing(null)} onSubmit={save} />}
  </div></AppLayout>
}

function CollectionModal({ collection, departments, busy, onClose, onSubmit }: { collection: AdminKnowledgeCollection | null; departments: Department[]; busy: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const title = collection ? 'Edit collection' : 'New collection'
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title}><form onSubmit={(event) => void onSubmit(event)} className="w-full max-w-lg rounded-lg border border-border bg-card p-6"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="min-w-0 break-words text-lg font-semibold">{title}</h2><Button type="button" variant="ghost" size="sm" onClick={onClose} className="shrink-0">Close</Button></div><div className="space-y-3"><input name="name" required defaultValue={collection?.name} placeholder="Collection name" className="w-full rounded border border-input bg-muted p-2" /><textarea name="description" defaultValue={collection?.description ?? ''} placeholder="What belongs in this collection?" className="min-h-20 w-full rounded border border-input bg-muted p-2" /><label className="flex items-center gap-2 text-sm"><input name="is_shared" type="checkbox" defaultChecked={collection?.is_shared} />Company-wide access</label><div className="rounded border border-border p-3"><p className="mb-2 text-sm font-medium">Department access</p>{departments.map((department) => <label key={department.id} className="flex items-center gap-2 py-1 text-sm"><input name="department_ids" type="checkbox" value={department.id} defaultChecked={collection?.department_ids.includes(department.id)} /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{department.name}</span></label>)}</div><Button type="submit" disabled={busy} className="w-full">{busy ? 'Saving…' : 'Save collection'}</Button></div></form></div>
}
