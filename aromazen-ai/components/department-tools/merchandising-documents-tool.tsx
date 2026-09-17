'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Eye, FileArchive, FileSpreadsheet, FileText, LoaderCircle, Pencil, RefreshCw, Upload } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { DocumentViewerModal } from '@/components/ui/document-viewer'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { PageHeader } from '@/components/ui/page-header'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { MerchandisingDocumentType, MerchandisingField, MerchandisingGeneration, MerchandisingSchema, MerchandisingTemplate } from '@/lib/api/types'

type ViewerFile = { blob: Blob; filename: string; title: string }

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function FieldInput({ field, value, onChange }: { field: MerchandisingField; value: string; onChange: (value: string) => void }) {
  return <label className={field.multiline ? 'md:col-span-2' : ''}>
    <span className="mb-1.5 block text-xs text-muted-foreground">{field.label}{field.required ? <span className="ml-1 text-red-400">*</span> : null}</span>
    {field.multiline
      ? <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" />
      : <input value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" />}
  </label>
}

export function MerchandisingDocumentsTool() {
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const sourceRef = useRef<HTMLInputElement>(null)
  const templateRefs = useRef<Partial<Record<MerchandisingDocumentType, HTMLInputElement | null>>>({})
  const [schema, setSchema] = useState<MerchandisingSchema | null>(null)
  const [templates, setTemplates] = useState<MerchandisingTemplate[]>([])
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [detectedType, setDetectedType] = useState<MerchandisingDocumentType | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [warnings, setWarnings] = useState<string[]>([])
  const [generated, setGenerated] = useState<Partial<Record<MerchandisingDocumentType, MerchandisingGeneration>>>({})
  const [viewing, setViewing] = useState<ViewerFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!accessToken) return
    let active = true
    Promise.all([api.merchandising.schema(accessToken), api.merchandising.templates(accessToken)])
      .then(([nextSchema, nextTemplates]) => { if (active) { setSchema(nextSchema); setTemplates(nextTemplates) } })
      .catch((error) => notify('error', error instanceof ApiError ? error.message : 'Unable to open the Merchandising document centre.'))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accessToken, notify])

  const templateMap = useMemo(() => Object.fromEntries(templates.map((item) => [item.document_type, item])) as Partial<Record<MerchandisingDocumentType, MerchandisingTemplate>>, [templates])
  const groups = useMemo(() => {
    if (!schema) return []
    return [...new Set(schema.fields.map((field) => field.group))].map((group) => ({ group, fields: schema.fields.filter((field) => field.group === group) }))
  }, [schema])
  const missing = useMemo(() => schema?.fields.filter((field) => field.required && !fields[field.key]?.trim()).map((field) => field.label) ?? [], [fields, schema])

  function message(error: unknown, fallback: string) { return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback }
  function change(key: string, value: string) { setFields((current) => ({ ...current, [key]: value })); setGenerated({}) }

  async function extract(file: File | null) {
    if (!accessToken || !file) return
    setSourceFile(file); setBusy('extract'); setGenerated({})
    try {
      const result = await api.merchandising.extract(accessToken, file)
      setDetectedType(result.detected_type); setFields(result.fields); setWarnings(result.warnings)
      notify(result.missing_required.length ? 'warning' : 'success', result.missing_required.length ? `Document read. Complete ${result.missing_required.length} required field${result.missing_required.length === 1 ? '' : 's'} before generating.` : 'Document read. Review the extracted details and generate the export pack.')
    } catch (error) {
      setSourceFile(null); setDetectedType(null); setFields({}); setWarnings([])
      notify('error', message(error, 'Unable to read this Merchandising document.'))
    } finally {
      setBusy(''); if (sourceRef.current) sourceRef.current.value = ''
    }
  }

  async function viewMaster(type: MerchandisingDocumentType) {
    if (!accessToken) return
    try {
      const file = await api.merchandising.templateContent(accessToken, type)
      const template = templateMap[type]
      setViewing({ blob: file.blob, filename: file.filename, title: template?.title ?? 'Merchandising master' })
    } catch (error) { notify('error', message(error, 'Unable to open this master.')) }
  }

  async function replaceMaster(type: MerchandisingDocumentType, file: File | null) {
    if (!accessToken || !file) return
    setBusy(`template-${type}`)
    try {
      const updated = await api.merchandising.replaceTemplate(accessToken, type, file)
      setTemplates((current) => [...current.filter((item) => item.document_type !== type), updated])
      setGenerated({})
      notify('success', `${updated.title} master v${updated.version} is now active.`)
    } catch (error) { notify('error', message(error, 'Unable to replace this master.')) }
    finally { setBusy(''); const input = templateRefs.current[type]; if (input) input.value = '' }
  }

  async function generateAll() {
    if (!accessToken || !schema) return
    if (missing.length) return notify('error', `Complete the required fields: ${missing.join(', ')}.`)
    const absent = schema.document_types.filter((item) => !templateMap[item.key])
    if (absent.length) return notify('error', `Upload the missing masters: ${absent.map((item) => item.title).join(', ')}.`)
    setBusy('generate')
    try {
      const results = await Promise.all(schema.document_types.map((item) => api.merchandising.generate(accessToken, item.key, fields)))
      setGenerated(Object.fromEntries(results.map((item) => [item.document_type, item])))
      notify('success', 'All four export documents are ready to view or download.')
    } catch (error) { notify('error', message(error, 'Unable to generate the export pack.')) }
    finally { setBusy('') }
  }

  async function openGeneration(item: MerchandisingGeneration, download = false) {
    if (!accessToken) return
    try {
      const file = await api.merchandising.generationContent(accessToken, item.id)
      if (download) saveBlob(file.blob, file.filename)
      else setViewing({ blob: file.blob, filename: file.filename, title: schema?.document_types.find((type) => type.key === item.document_type)?.title ?? item.filename })
    } catch (error) { notify('error', message(error, 'Unable to open the generated document.')) }
  }

  async function downloadPack() {
    if (!accessToken) return
    setBusy('pack')
    try { const file = await api.merchandising.pack(accessToken, fields); saveBlob(file.blob, file.filename); notify('success', 'Complete export pack downloaded.') }
    catch (error) { notify('error', message(error, 'Unable to download the export pack.')) }
    finally { setBusy('') }
  }

  if (loading) return <main className="grid min-h-[70vh] place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-primary" /></main>

  return <main className="space-y-5 p-4 md:p-6">
    <DocumentViewerModal file={viewing} onClose={() => setViewing(null)} />
    <PageHeader title="Merchandising · Export Document Centre" description="Upload one completed document, review the extracted details and generate the full export pack." />

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {schema?.document_types.map((document) => {
        const template = templateMap[document.key]
        const excel = document.key !== 'multimodal_form'
        return <div key={document.key} className="rounded-xl border border-border bg-card p-4">
          {excel ? <FileSpreadsheet className="h-5 w-5 text-primary" /> : <FileText className="h-5 w-5 text-primary" />}
          <p className="mt-2 min-h-10 text-sm font-semibold">{document.title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{template ? `${template.name} · v${template.version}` : 'Master not available'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!template} onClick={() => void viewMaster(document.key)}><Eye className="mr-1.5 h-3.5 w-3.5" />View</Button>
            {hasPermission('knowledge.write') ? <>
              <input ref={(node) => { templateRefs.current[document.key] = node }} hidden type="file" accept={excel ? '.xlsx,.xlsm,.xls' : '.docx'} onChange={(event) => void replaceMaster(document.key, event.target.files?.[0] ?? null)} />
              <Button size="sm" variant="outline" disabled={busy === `template-${document.key}`} onClick={() => templateRefs.current[document.key]?.click()}>{busy === `template-${document.key}` ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Replace</Button>
            </> : null}
          </div>
        </div>
      })}
    </section>

    <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4 md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-1"><h2 className="font-semibold">Upload one completed export document</h2><InfoTip label="Supported documents">Use any current Packing List, Hazardous Cargo Request, IMO Declaration or Multimodal DG Form. The Packing List normally provides the best shipment starting point.</InfoTip></div>
          <p className="mt-1 text-sm text-muted-foreground">Excel and Word files are accepted. Missing values remain editable before generation.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sourceFile ? <Button variant="outline" onClick={() => setViewing({ blob: sourceFile, filename: sourceFile.name, title: 'Uploaded source document' })}><Eye className="mr-2 h-4 w-4" />View uploaded file</Button> : null}
          <input ref={sourceRef} hidden type="file" accept=".xlsx,.xlsm,.xls,.docx" onChange={(event) => void extract(event.target.files?.[0] ?? null)} />
          <Button onClick={() => sourceRef.current?.click()} disabled={busy === 'extract'}>{busy === 'extract' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{sourceFile ? 'Replace uploaded file' : 'Choose document'}</Button>
        </div>
      </div>
      {sourceFile ? <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-500" /><span className="font-medium">{sourceFile.name}</span>{detectedType ? <span className="text-muted-foreground">Detected as {schema?.document_types.find((item) => item.key === detectedType)?.title}</span> : null}</div> : null}
    </section>

    {sourceFile && schema ? <>
      {warnings.map((warning) => <div key={warning} className="flex items-start gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><span>{warning}</span></div>)}

      <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Pencil className="h-4 w-4 text-primary" /><h2 className="font-semibold">Review and edit document details</h2></div><p className="mt-1 text-sm text-muted-foreground">Changes made here are applied to all four generated documents.</p></div><div className={`rounded-full px-3 py-1 text-xs font-medium ${missing.length ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'}`}>{missing.length ? `${missing.length} required field${missing.length === 1 ? '' : 's'} missing` : 'Required details complete'}</div></div>
        <div className="mt-5 space-y-3">
          {groups.map(({ group, fields: groupFields }, index) => <details key={group} open={index < 3 || group === 'Dangerous goods'} className="rounded-xl border border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{group}<span className="ml-2 text-xs font-normal text-muted-foreground">{groupFields.length} fields</span></summary>
            <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">{groupFields.map((field) => <FieldInput key={field.key} field={field} value={fields[field.key] ?? ''} onChange={(value) => change(field.key, value)} />)}</div>
          </details>)}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Generate the complete export set</h2><p className="mt-1 text-sm text-muted-foreground">One reviewed record fills every active master and keeps repeated values consistent.</p></div><Button onClick={() => void generateAll()} disabled={busy === 'generate' || missing.length > 0}>{busy === 'generate' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}{Object.keys(generated).length ? 'Regenerate all documents' : 'Generate all documents'}</Button></section>

      {Object.keys(generated).length ? <section className="rounded-2xl border border-emerald-500/30 bg-card p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Export pack ready</h2><p className="mt-1 text-sm text-muted-foreground">View individual files, download them separately or download the complete ZIP.</p></div><Button onClick={() => void downloadPack()} disabled={busy === 'pack'}>{busy === 'pack' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download complete pack</Button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{schema.document_types.map((document) => { const item = generated[document.key]; return <div key={document.key} className="rounded-xl border border-border p-3"><p className="min-h-10 text-sm font-semibold">{document.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item?.filename}</p><div className="mt-3 flex gap-2"><Button size="sm" variant="outline" disabled={!item} onClick={() => item && void openGeneration(item)}><Eye className="mr-1.5 h-3.5 w-3.5" />View</Button><Button size="sm" variant="outline" disabled={!item} onClick={() => item && void openGeneration(item, true)}><Download className="mr-1.5 h-3.5 w-3.5" />Download</Button></div></div> })}</div></section> : null}
    </> : null}
  </main>
}

