'use client'

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileOutput, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { VoiceInputButton } from '@/components/voice-input-button'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { DocumentTemplate, DocumentTemplateSchema, GeneratedDocument } from '@/lib/api/types'

function saveFile(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url) }
function normalized(value: string | undefined) { return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }

export default function RndDocumentsPage() {
  const { accessToken, user } = useAuth()
  const { notify } = useToast()
  const [templates, setTemplates] = useState<DocumentTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
  const [schema, setSchema] = useState<DocumentTemplateSchema | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [excel, setExcel] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [draftNotes, setDraftNotes] = useState('')
  const [liveSpeech, setLiveSpeech] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [voiceStopSignal, setVoiceStopSignal] = useState(0)
  const [unassignedNotes, setUnassignedNotes] = useState('')
  const [outputFilename, setOutputFilename] = useState('')
  const [generated, setGenerated] = useState<GeneratedDocument | null>(null)
  const notesRef = useRef('')
  const draftSequence = useRef(0)
  const finishRequestedRef = useRef(false)
  const selected = useMemo(() => templates.find((item) => item.id === templateId), [templateId, templates])
  const canUseGenerator = user?.department_name === 'R&D' || user?.role_names.some((role) => role === 'Super Admin' || role === 'Admin')

  useEffect(() => {
    if (!accessToken || !canUseGenerator) return
    void api.documentGenerator.templates(accessToken).then((items) => { setTemplates(items); if (items[0]) setTemplateId(items[0].id) }).catch((reason) => notify('error', reason instanceof ApiError ? reason.message : 'Unable to load Word templates.'))
  }, [accessToken, canUseGenerator, notify])

  useEffect(() => {
    if (!accessToken || !templateId || !canUseGenerator) return
    setGenerated(null); setFields({}); setExcel(null); setDraftNotes(''); notesRef.current = ''; setLiveSpeech(''); setVoiceStopSignal((current) => current + 1); setUnassignedNotes(''); setOutputFilename('')
    void api.documentGenerator.schema(accessToken, templateId).then((value) => { setSchema(value); setRows(value.default_rows) }).catch((reason) => notify('error', reason instanceof ApiError ? reason.message : 'Unable to read this template.'))
  }, [accessToken, canUseGenerator, notify, templateId])

  function mergeRowUpdates(updates: Record<string, string>[]) {
    if (!schema || updates.length === 0) return
    setRows((current) => {
      const next = current.map((row) => ({ ...row }))
      for (const update of updates) {
        const identity = schema.document_type === 'coa' ? normalized(update.parameter) : normalized(update.cas_number || update.name)
        const index = next.findIndex((row) => (schema.document_type === 'coa' ? normalized(row.parameter) : normalized(row.cas_number || row.name)) === identity)
        if (index >= 0) next[index] = { ...next[index], ...update }
        else if (schema.document_type === 'sds') next.push(update)
      }
      return next
    })
  }

  async function organizeNotes(notes: string) {
    if (!accessToken || !templateId || notes.trim().length < 2) return
    const sequence = ++draftSequence.current
    setDrafting(true)
    try {
      const result = await api.documentGenerator.draftFromNotes(accessToken, { templateId, notes, currentFields: fields, currentRows: rows })
      if (sequence !== draftSequence.current) return
      setFields((current) => ({ ...current, ...result.field_updates }))
      mergeRowUpdates(result.row_updates)
      setUnassignedNotes(result.unassigned_notes)
    } catch (reason) {
      if (sequence === draftSequence.current) notify('error', reason instanceof ApiError ? reason.message : 'The AI Draft Assistant could not organize those notes.')
    } finally {
      if (sequence === draftSequence.current) setDrafting(false)
    }
  }

  function acceptSpeech(text: string) {
    const next = notesRef.current.trim() ? `${notesRef.current.trim()}\n${text}` : text
    notesRef.current = next
    setDraftNotes(next)
  }

  function handleListeningChange(listening: boolean) {
    setIsListening(listening)
    if (!listening && finishRequestedRef.current) {
      window.setTimeout(() => {
        if (!finishRequestedRef.current) return
        finishRequestedRef.current = false
        void organizeNotes(notesRef.current)
      }, 1500)
    }
  }

  async function processCompleteRecording(file: File) {
    if (!finishRequestedRef.current || !accessToken) return
    finishRequestedRef.current = false
    setDrafting(true)
    try {
      const browserTranscript = notesRef.current.trim()
      const result = await api.documentGenerator.transcribe(accessToken, file)
      notesRef.current = result.text
      setDraftNotes(result.text)
      const notesForDraft = browserTranscript && normalized(browserTranscript) !== normalized(result.text)
        ? `Professional audio transcript:\n${result.text}\n\nBrowser transcript of the same speech:\n${browserTranscript}`
        : result.text
      await organizeNotes(notesForDraft)
    } catch (reason) {
      notify('warning', reason instanceof ApiError ? `${reason.message} Using the visible transcript instead.` : 'Full voice check was unavailable. Using the visible transcript instead.')
      await organizeNotes(notesRef.current)
    }
  }

  function finishAndFillDraft() {
    setLiveSpeech('')
    if (isListening) {
      finishRequestedRef.current = true
      setVoiceStopSignal((current) => current + 1)
    } else {
      void organizeNotes(notesRef.current)
    }
  }

  function addRow() { if (!schema || schema.document_type === 'coa') return; setRows((current) => [...current, Object.fromEntries(schema.row_fields.map((key) => [key, '']))]) }
  function updateRow(index: number, key: string, value: string) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row)) }
  async function downloadExcel() { if (!accessToken || !templateId) return; try { const file = await api.documentGenerator.excelTemplate(accessToken, templateId); saveFile(file.blob, file.filename) } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to download the Excel format.') } }
  async function generate() {
    if (!accessToken || !templateId || !schema) return
    setBusy(true)
    try {
      const result = await api.documentGenerator.generate(accessToken, { templateId, documentType: schema.document_type, fields, rows, outputFilename, excel })
      setGenerated(result)
      notify(result.warnings.length ? 'warning' : 'success', result.warnings.length ? `Word draft created with ${result.warnings.length} review item(s).` : 'Word document created successfully.')
      const file = await api.documentGenerator.download(accessToken, result.id); saveFile(file.blob, file.filename)
    } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to generate the Word document.') } finally { setBusy(false) }
  }
  async function downloadGenerated() { if (!accessToken || !generated) return; try { const file = await api.documentGenerator.download(accessToken, generated.id); saveFile(file.blob, file.filename) } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to download the Word document.') } }

  if (!canUseGenerator) return <AppLayout><main className="grid min-h-[70vh] place-items-center p-6"><div className="max-w-md text-center"><h1 className="text-2xl font-semibold">Access restricted</h1><p className="mt-2 text-muted-foreground">Ready-Made R&D Documents are available only to the R&D department, Super Admin, and Admin.</p></div></main></AppLayout>

  return <AppLayout><div className="space-y-6 p-6"><PageHeader title="AI Draft Assistant" description="Speak naturally or type your notes. The assistant progressively fills the authorized COA or SDS template." />
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-6 rounded-lg border border-border bg-card p-5">
        <div><label className="mb-2 block text-sm font-medium">Word template</label><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="">Select a template</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.document_type.toUpperCase()})</option>)}</select>{selected && <p className="mt-2 text-xs text-muted-foreground">From {selected.collection_name}. The original file will not be changed.</p>}</div>

        {schema && <>
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">AI Draft Assistant</h2></div><p className="mt-1 text-sm text-muted-foreground">Speak naturally, pause, and correct yourself whenever needed. Your words appear below; when you press Done, the complete recording is professionally rechecked before any field is filled.</p></div><div className="flex items-center gap-2"><VoiceInputButton continuous stopSignal={voiceStopSignal} label="Start speaking" onTranscript={acceptSpeech} onInterim={setLiveSpeech} onListeningChange={handleListeningChange} onRecordingReady={(file) => void processCompleteRecording(file)} /><span className={`text-xs font-medium ${isListening ? 'text-red-400' : 'text-muted-foreground'}`}>{isListening ? 'Listening…' : 'Start speaking'}</span></div></div>
            <textarea rows={6} value={draftNotes} onChange={(event) => { notesRef.current = event.target.value; setDraftNotes(event.target.value) }} placeholder="Example: Name Rose. Code R-101. Batch number B-25. Customer name ABC Traders…" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            {liveSpeech && <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300"><span className="mr-2 text-xs font-semibold uppercase tracking-wide">Hearing</span>{liveSpeech}</div>}
            <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{drafting ? 'Professionally formatting dates and filling the draft…' : isListening ? 'Keep speaking or take a pause. Press Done only when finished.' : 'Review the transcript, then fill the draft when ready.'}</span><Button type="button" disabled={drafting || (!draftNotes.trim() && !isListening)} onClick={finishAndFillDraft}><Sparkles className="mr-2 h-4 w-4" />{drafting ? 'Filling draft…' : 'Done — Fill Draft'}</Button></div>
            {unassignedNotes && <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-400">Not placed automatically: {unassignedNotes}</p>}
          </div>

          <div><h2 className="font-semibold">Review and edit the filled draft</h2><p className="text-sm text-muted-foreground">AI-filled information remains editable. Excel can also be combined with it.</p></div>
          <div className="grid gap-4 md:grid-cols-2">{schema.fields.map((field) => <label key={field.key} className={['hazard_statements','precautionary_statements','supplier_address'].includes(field.key) ? 'md:col-span-2' : ''}><span className="mb-1.5 block text-sm">{field.label}{field.required && <span className="text-amber-500"> *</span>}</span>{['hazard_statements','precautionary_statements','supplier_address'].includes(field.key) ? <textarea rows={3} value={fields[field.key] ?? ''} onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /> : <input value={fields[field.key] ?? ''} onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />}</label>)}</div>

          <div className="space-y-3 border-t border-border pt-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">{schema.document_type === 'coa' ? 'COA Test Results' : 'Composition'}</h2><p className="text-xs text-muted-foreground">{schema.document_type === 'coa' ? 'The Parameter column is fixed exactly from the approved COA template. Enter or dictate only Specification and Result.' : 'Add only composition information applicable to this SDS.'}</p></div>{schema.document_type === 'sds' && <Button type="button" variant="outline" onClick={addRow}><Plus className="mr-2 h-4 w-4" />Add row</Button>}</div>
            {schema.document_type === 'coa' ? <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[42rem] text-sm"><thead className="bg-muted/70"><tr><th className="w-1/3 px-4 py-3 text-left font-semibold">Parameter</th><th className="w-1/3 px-4 py-3 text-left font-semibold">Specification</th><th className="w-1/3 px-4 py-3 text-left font-semibold">Result</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.parameter}-${index}`} className="border-t border-border"><td className="bg-muted/30 px-4 py-3 font-medium text-foreground">{row.parameter}</td><td className="p-2"><input aria-label={`${row.parameter} specification`} value={row.specification ?? ''} onChange={(event) => updateRow(index, 'specification', event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" placeholder="Enter specification" /></td><td className="p-2"><input aria-label={`${row.parameter} result`} value={row.result ?? ''} onChange={(event) => updateRow(index, 'result', event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" placeholder="Enter result" /></td></tr>)}</tbody></table></div> : rows.map((row, index) => <div key={`${row.name || 'row'}-${index}`} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-3">{schema.row_fields.map((key) => <input key={key} placeholder={key.replaceAll('_', ' ')} value={row[key] ?? ''} onChange={(event) => updateRow(index, key, event.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm" />)}<button type="button" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="flex items-center gap-1 text-xs text-destructive"><Trash2 className="h-3 w-3" />Remove</button></div>)}
          </div>
        </>}
      </section>

      <aside className="space-y-4">
        {schema?.can_edit_filename && <div className="rounded-lg border border-border bg-card p-5"><label className="text-sm font-semibold">Document filename</label><p className="mt-1 text-xs text-muted-foreground">Available to the Super Admin and administrators.</p><div className="mt-3 flex items-center gap-2"><input value={outputFilename} onChange={(event) => setOutputFilename(event.target.value)} placeholder="Example: Orange Blossom COA" className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm" /><span className="text-xs text-muted-foreground">.docx</span></div></div>}
        <div className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">Excel entry</h2><p className="mt-1 text-sm text-muted-foreground">The COA Excel format already contains all constant test parameters.</p><Button variant="outline" onClick={() => void downloadExcel()} disabled={!templateId} className="mt-4 w-full"><Download className="mr-2 h-4 w-4" />Download Excel format</Button><label className="mt-3 flex cursor-pointer items-center justify-center rounded-md border border-dashed border-border p-5 text-center text-sm hover:bg-muted"><input type="file" accept=".xlsx" className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => setExcel(event.target.files?.[0] ?? null)} /><span><Upload className="mx-auto mb-2 h-5 w-5" />{excel?.name ?? 'Choose filled XLSX file'}</span></label></div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><p className="font-medium">Review before issue</p><p className="mt-1 text-muted-foreground">The AI only organizes stated facts. Missing information remains blank, and SDS regulatory information still requires qualified review.</p></div>
        <Button onClick={() => void generate()} disabled={busy || drafting || !schema} className="w-full"><FileOutput className="mr-2 h-4 w-4" />{busy ? 'Creating Word file…' : 'Generate Word document'}</Button>
        {generated && <div className="rounded-lg border border-border bg-card p-4"><p className="text-sm font-medium">{generated.filename}</p>{generated.warnings.length > 0 && <ul className="mt-2 space-y-1 text-xs text-amber-500">{generated.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>}<Button variant="outline" className="mt-3 w-full" onClick={() => void downloadGenerated()}><Download className="mr-2 h-4 w-4" />Download again</Button></div>}
      </aside>
    </div>
  </div></AppLayout>
}
