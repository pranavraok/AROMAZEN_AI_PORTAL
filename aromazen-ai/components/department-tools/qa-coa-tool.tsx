'use client'

import { InfoTip } from '@/components/ui/info-tip'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, ExternalLink, Eye, FileText, LoaderCircle, Plus, Printer, Sparkles, Trash2, Upload } from 'lucide-react'
import { VoiceInputButton } from '@/components/voice-input-button'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { DocumentTemplate, DocumentTemplateSchema, GeneratedDocument } from '@/lib/api/types'
import { canvaEditUrlForQaCoa } from '@/lib/template-canva-links'

const MASTER_SOURCE = 'qa-coa-master'
type CustomDetailField = { id: string; label: string; value: string }

function normalized(value: string | undefined) { return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function saveFile(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url) }

export function QaCoaTool() {
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const uploadRef = useRef<HTMLInputElement>(null)
  const notesRef = useRef('')
  const draftSequence = useRef(0)
  const finishRequestedRef = useRef(false)
  const [template, setTemplate] = useState<DocumentTemplate | null>(null)
  const [schema, setSchema] = useState<DocumentTemplateSchema | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [columnLabels, setColumnLabels] = useState<Record<string, string>>({ parameter: 'Parameter', specification: 'Specification', result: 'Result' })
  const [visibleFieldKeys, setVisibleFieldKeys] = useState<string[]>([])
  const [customFields, setCustomFields] = useState<CustomDetailField[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [loading, setLoading] = useState(true)
  const [replacing, setReplacing] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [draftNotes, setDraftNotes] = useState('')
  const [liveSpeech, setLiveSpeech] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [voiceStopSignal, setVoiceStopSignal] = useState(0)
  const [unassignedNotes, setUnassignedNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [generated, setGenerated] = useState<GeneratedDocument | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const canvaUrl = template?.external_edit_url || canvaEditUrlForQaCoa()
  const completedFields = useMemo(() => (schema?.fields.filter((field) => visibleFieldKeys.includes(field.key) && fields[field.key]?.trim()).length ?? 0) + customFields.filter((field) => field.label.trim() && field.value.trim()).length, [customFields, fields, schema, visibleFieldKeys])
  const requiredMissing = useMemo(() => schema?.fields.filter((field) => visibleFieldKeys.includes(field.key) && field.required && !fields[field.key]?.trim()) ?? [], [fields, schema, visibleFieldKeys])

  function clearPreview() {
    setGenerated(null)
    setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return null })
  }

  const loadMaster = useCallback(async (preferred?: DocumentTemplate) => {
    if (!accessToken) return
    setLoading(true)
    try {
      const templates = await api.documentGenerator.templates(accessToken)
      const master = preferred ?? templates.find((item) => item.source_key === MASTER_SOURCE) ?? templates.find((item) => item.document_type === 'coa') ?? null
      setTemplate(master)
      if (!master) { setSchema(null); return }
      const nextSchema = await api.documentGenerator.schema(accessToken, master.id)
      setSchema(nextSchema)
      setFields((current) => Object.keys(current).length ? current : { date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) })
      setFieldLabels(Object.fromEntries(nextSchema.fields.map((field) => [field.key, field.label])))
      setVisibleFieldKeys(nextSchema.fields.map((field) => field.key))
      setCustomFields([])
      setRows(nextSchema.default_rows)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to load the QA COA master.')
    } finally {
      setLoading(false)
    }
  }, [accessToken, notify])

  useEffect(() => { void loadMaster() }, [loadMaster])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  function mergeRowUpdates(updates: Record<string, string>[]) {
    if (!updates.length) return
    setRows((current) => current.map((row) => {
      const update = updates.find((item) => normalized(item.parameter) === normalized(row.parameter))
      return update ? { ...row, ...update } : row
    }))
  }

  async function organizeNotes(notes: string) {
    if (!accessToken || !template || notes.trim().length < 2) return
    const sequence = ++draftSequence.current
    setDrafting(true)
    try {
      const result = await api.documentGenerator.draftFromNotes(accessToken, { templateId: template.id, notes, currentFields: fields, currentRows: rows, fieldLabels })
      if (sequence !== draftSequence.current) return
      setFields((current) => ({ ...current, ...result.field_updates }))
      mergeRowUpdates(result.row_updates)
      setUnassignedNotes(result.unassigned_notes)
      clearPreview()
      notify('success', 'Voice and notes have been mapped into the COA draft.')
    } catch (error) {
      if (sequence === draftSequence.current) notify('error', error instanceof ApiError ? error.message : 'The AI Draft Assistant could not organize those notes.')
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
    if (!listening && finishRequestedRef.current) window.setTimeout(() => {
      if (!finishRequestedRef.current) return
      finishRequestedRef.current = false
      void organizeNotes(notesRef.current)
    }, 1500)
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
      const combined = browserTranscript && normalized(browserTranscript) !== normalized(result.text)
        ? `Professional audio transcript:\n${result.text}\n\nBrowser transcript of the same speech:\n${browserTranscript}`
        : result.text
      await organizeNotes(combined)
    } catch (error) {
      notify('warning', error instanceof ApiError ? `${error.message} Using the visible transcript instead.` : 'Full voice check was unavailable. Using the visible transcript instead.')
      await organizeNotes(notesRef.current)
    }
  }

  function finishAndFillDraft() {
    setLiveSpeech('')
    if (isListening) {
      finishRequestedRef.current = true
      setVoiceStopSignal((current) => current + 1)
    } else void organizeNotes(notesRef.current)
  }

  async function viewTemplate() {
    if (!accessToken || !template) return
    try {
      const file = await api.documentGenerator.templateContent(accessToken, template.id)
      const url = URL.createObjectURL(file.blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to open this template.') }
  }

  async function replaceMaster(file: File | null) {
    if (!accessToken || !file) return
    setReplacing(true)
    try {
      const next = await api.documentGenerator.replaceCoaMaster(accessToken, file)
      clearPreview()
      setFields({ date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) })
      await loadMaster(next)
      notify('success', `COA master v${next.version ?? 1} is active for the complete Quality Assurance department.`)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to replace the COA master.')
    } finally {
      setReplacing(false)
      if (uploadRef.current) uploadRef.current.value = ''
    }
  }

  async function generatePreview() {
    if (!accessToken || !template || !schema) return
    setBusy(true)
    try {
      const hiddenFieldKeys = schema.fields.filter((field) => !visibleFieldKeys.includes(field.key)).map((field) => field.key)
      const result = await api.documentGenerator.generate(accessToken, { templateId: template.id, documentType: 'coa', fields, rows, fieldLabels, columnLabels, hiddenFieldKeys, customFields: customFields.map(({ label, value }) => ({ label, value })) })
      setGenerated(result)
      const file = await api.documentGenerator.preview(accessToken, result.id)
      const url = URL.createObjectURL(file.blob)
      setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return url })
      notify(result.warnings.length ? 'warning' : 'success', result.warnings.length ? `COA preview is ready with ${result.warnings.length} review item(s).` : 'COA preview is ready.')
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to create the COA preview.')
    } finally { setBusy(false) }
  }

  async function downloadWord() {
    if (!accessToken || !generated) return
    try { const file = await api.documentGenerator.download(accessToken, generated.id); saveFile(file.blob, file.filename) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to download the COA Word file.') }
  }

  function downloadPdf() { if (previewUrl) saveFileUrl(previewUrl, `${fields.product_name || 'Product'}-COA-DRAFT.pdf`) }
  function print() { const frame = document.getElementById('qa-coa-preview') as HTMLIFrameElement | null; frame?.contentWindow?.focus(); frame?.contentWindow?.print() }
  function changeField(key: string, value: string) { setFields((current) => ({ ...current, [key]: value })); clearPreview() }
  function changeFieldLabel(key: string, value: string) { setFieldLabels((current) => ({ ...current, [key]: value })); clearPreview() }
  function changeColumnLabel(key: string, value: string) { setColumnLabels((current) => ({ ...current, [key]: value })); clearPreview() }
  function addDetailField() { setCustomFields((current) => [...current, { id: `custom-${Date.now()}-${current.length}`, label: '', value: '' }]); clearPreview() }
  function removeDetailField(key: string) { setVisibleFieldKeys((current) => current.filter((item) => item !== key)); clearPreview() }
  function removeCustomField(id: string) { setCustomFields((current) => current.filter((field) => field.id !== id)); clearPreview() }
  function updateCustomField(id: string, property: 'label' | 'value', value: string) { setCustomFields((current) => current.map((field) => field.id === id ? { ...field, [property]: value } : field)); clearPreview() }
  function updateRow(index: number, key: string, value: string) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row)); clearPreview() }
  function addRow() { setRows((current) => [...current, { parameter: '', specification: '', result: '' }]); clearPreview() }
  function removeRow(index: number) { setRows((current) => current.filter((_, rowIndex) => rowIndex !== index)); clearPreview() }

  if (loading) return <main className="grid min-h-[50vh] place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-primary" /></main>
  if (!template || !schema) return <main className="grid min-h-[50vh] place-items-center p-6 text-center"><div><FileText className="mx-auto h-10 w-10 text-muted-foreground" /><h1 className="mt-3 text-xl font-semibold">COA master is not available</h1><p className="mt-2 text-sm text-muted-foreground">Run the latest database update and restart the portal to seed the approved QA master.</p></div></main>

  return <main className="space-y-5 p-4 md:p-6"><PageHeader title="QA · Certificate of Analysis" description="Prepare, review, print and download the approved COA. Use voice or type the details manually." />
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><button type="button" className="flex items-center gap-3 rounded-xl border border-primary bg-primary/5 px-4 py-3 text-left ring-1 ring-primary/30"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Check className="h-4 w-4" /></span><div><p className="text-sm font-semibold">COA</p><p className="mt-0.5 text-[11px] text-muted-foreground">Certificate of Analysis</p></div></button></section>
    <section className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-4 md:flex-row md:items-center md:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><FileText className="h-5 w-5" /></span><div className="min-w-0"><h2 className="font-semibold">Current COA master</h2><p className="truncate text-sm text-muted-foreground">{template.name} · Version {template.version ?? 1} · Quality Assurance Knowledge</p><InfoTip label="COA master help">The approved product fields and six test parameters are mapped automatically. Uploading a new DOCX replaces this master for the whole QA department.</InfoTip></div></div><div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" onClick={() => void viewTemplate()}><Eye className="mr-2 h-4 w-4" />View template</Button><Button variant="outline" onClick={() => window.open(canvaUrl, '_blank', 'noopener,noreferrer')}><ExternalLink className="mr-2 h-4 w-4" />Edit in Canva</Button>{hasPermission('knowledge.write') && <><input ref={uploadRef} hidden type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void replaceMaster(event.target.files?.[0] ?? null)} /><Button disabled={replacing} onClick={() => uploadRef.current?.click()}>{replacing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{replacing ? 'Mapping fields' : 'Upload master template'}</Button></>}</div></section>
    <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4 md:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">Smart fill from voice or notes</h2></div><InfoTip label="Voice entry help">Speak naturally and correct yourself when needed. Press Done when finished; the complete recording is rechecked and mapped into the approved fields.</InfoTip></div><div className="flex items-center gap-2"><VoiceInputButton continuous stopSignal={voiceStopSignal} label="Start speaking" onTranscript={acceptSpeech} onInterim={setLiveSpeech} onListeningChange={handleListeningChange} onRecordingReady={(file) => void processCompleteRecording(file)} /><span className={`text-xs font-medium ${isListening ? 'text-red-400' : 'text-muted-foreground'}`}>{isListening ? 'Listening…' : 'Start speaking'}</span></div></div><textarea rows={5} value={draftNotes} onChange={(event) => { notesRef.current = event.target.value; setDraftNotes(event.target.value) }} placeholder="Example: Product Rose Absolute, code RA 101, batch B25, manufacturing date 3 September 2026, appearance result passes…" className="mt-4 w-full rounded-xl border border-border bg-background p-3 text-sm" />{liveSpeech && <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300"><span className="mr-2 text-xs font-semibold uppercase tracking-wide">Hearing</span>{liveSpeech}</div>}<div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{drafting ? 'Formatting and filling the COA…' : isListening ? 'Keep speaking. Press Done only when finished.' : 'Review the transcript, then fill the draft.'}</span><Button disabled={drafting || (!draftNotes.trim() && !isListening)} onClick={finishAndFillDraft}><Sparkles className="mr-2 h-4 w-4" />{drafting ? 'Filling draft…' : 'Done — Fill Draft'}</Button></div>{unassignedNotes && <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-400">Not placed automatically: {unassignedNotes}</p>}</section>
    <div className={`grid gap-5 ${previewUrl ? 'xl:grid-cols-[minmax(0,1fr)_minmax(440px,.9fr)]' : 'mx-auto w-full max-w-4xl'}`}><div className="space-y-5"><section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 1 · Enter details</p><h2 className="mt-1 text-lg font-semibold">Product and batch details</h2><p className="mt-1 text-xs text-muted-foreground">{completedFields} fields completed. <InfoTip label="Editing product fields">Add, rename, complete or delete any field.</InfoTip></p></div><Button type="button" variant="outline" onClick={addDetailField}><Plus className="mr-2 h-4 w-4" />Add field</Button></div><div className="grid gap-4 md:grid-cols-2">{schema.fields.filter((field) => visibleFieldKeys.includes(field.key)).map((field) => <div key={field.key}><div className="mb-1 flex items-center gap-1"><input aria-label={`Edit ${field.label} heading`} value={fieldLabels[field.key] ?? field.label} onChange={(event) => changeFieldLabel(field.key, event.target.value)} className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted-foreground outline-none transition hover:border-border focus:border-primary focus:bg-background focus:text-foreground" />{field.required && <span className="text-xs text-amber-500">*</span>}</div><div className="flex items-center gap-2"><input aria-label={`${fieldLabels[field.key] ?? field.label} value`} value={fields[field.key] ?? ''} onChange={(event) => changeField(field.key, event.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm" /><button type="button" onClick={() => removeDetailField(field.key)} aria-label={`Delete ${fieldLabels[field.key] ?? field.label} field`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button></div></div>)}{customFields.map((field, index) => <div key={field.id}><input aria-label={`Custom field ${index + 1} heading`} value={field.label} onChange={(event) => updateCustomField(field.id, 'label', event.target.value)} placeholder="Enter field name" className="mb-1 min-w-0 w-full rounded-md border border-border bg-background px-2 py-1 text-xs" /><div className="flex items-center gap-2"><input aria-label={`${field.label || `Custom field ${index + 1}`} value`} value={field.value} onChange={(event) => updateCustomField(field.id, 'value', event.target.value)} placeholder="Enter value" className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm" /><button type="button" onClick={() => removeCustomField(field.id)} aria-label={`Delete custom field ${index + 1}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button></div></div>)}{visibleFieldKeys.length === 0 && customFields.length === 0 && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2">No product fields. Select Add field to create one.</div>}</div></section>
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 2 · Test results</p><div className="flex items-center gap-1"><h2 className="mt-1 text-lg font-semibold">COA parameters</h2><InfoTip label="COA table help">Column headings and every table cell are editable. Add or remove rows as required.</InfoTip></div></div><Button type="button" variant="outline" onClick={addRow}><Plus className="mr-2 h-4 w-4" />Add parameter</Button></div><div className="mt-4 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[48rem] text-sm"><thead className="bg-muted/70"><tr>{(['parameter', 'specification', 'result'] as const).map((key) => <th key={key} className="w-[30%] p-2"><input aria-label={`Edit ${key} column heading`} value={columnLabels[key]} onChange={(event) => changeColumnLabel(key, event.target.value)} className="h-9 w-full rounded-lg border border-transparent bg-transparent px-2 text-left font-semibold uppercase outline-none hover:border-border focus:border-primary focus:bg-background" /></th>)}<th className="w-[10%] px-3 py-3 text-center">Action</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-border"><td className="p-2"><input aria-label={`Parameter ${index + 1}`} value={row.parameter ?? ''} onChange={(event) => updateRow(index, 'parameter', event.target.value)} placeholder="Enter parameter" className="h-10 w-full rounded-lg border border-border bg-background px-3 font-medium" /></td><td className="p-2"><input aria-label={`${row.parameter || `Row ${index + 1}`} specification`} value={row.specification ?? ''} onChange={(event) => updateRow(index, 'specification', event.target.value)} placeholder="Enter specification" className="h-10 w-full rounded-lg border border-border bg-background px-3" /></td><td className="p-2"><input aria-label={`${row.parameter || `Row ${index + 1}`} result`} value={row.result ?? ''} onChange={(event) => updateRow(index, 'result', event.target.value)} placeholder="Enter result" className="h-10 w-full rounded-lg border border-border bg-background px-3" /></td><td className="p-2 text-center"><button type="button" onClick={() => removeRow(index)} aria-label={`Remove parameter row ${index + 1}`} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button></td></tr>)}{rows.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-sm text-muted-foreground">No parameter rows. Select Add parameter to create one.</td></tr>}</tbody></table></div></section>
      {requiredMissing.length > 0 && <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-400">Still required: {requiredMissing.map((field) => field.label).join(', ')}</p>}
      <section className="flex justify-end rounded-2xl border border-border bg-card p-4"><Button onClick={() => void generatePreview()} disabled={busy || drafting}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}{busy ? 'Preparing review' : 'Review final COA'}</Button></section></div>
      {previewUrl && <section className="sticky top-4 h-fit overflow-hidden rounded-2xl border border-border bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 3 · Review</p><h2 className="mt-1 font-semibold">Final print preview</h2></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void downloadWord()}><Download className="mr-1.5 h-4 w-4" />Word</Button><Button size="sm" variant="outline" onClick={downloadPdf}><Download className="mr-1.5 h-4 w-4" />PDF</Button><Button size="sm" onClick={print}><Printer className="mr-1.5 h-4 w-4" />Print</Button></div></div>{generated?.warnings.length ? <div className="border-b border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-400">{generated.warnings.join(' ')}</div> : null}<iframe id="qa-coa-preview" title="COA preview" src={previewUrl} className="h-[72vh] w-full bg-white" /></section>}</div>
  </main>
}

function saveFileUrl(url: string, filename: string) { const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click() }
