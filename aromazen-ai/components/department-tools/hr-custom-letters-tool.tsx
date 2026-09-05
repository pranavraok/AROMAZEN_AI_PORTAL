'use client'

import { InfoTip } from '@/components/ui/info-tip'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, ExternalLink, Eye, FilePlus2, FileText, LoaderCircle, Mail, Printer, Send, Upload, X } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { HRCustomTemplate, HRTemplateField } from '@/lib/api/types'

function FieldInputs({ items, values, onChange }: { items: HRTemplateField[]; values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  return items.map((field) => <label key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
    <span className="mb-1.5 block text-xs text-muted-foreground">{field.label}</span>
    {field.multiline
      ? <textarea rows={3} value={values[field.key] ?? ''} onChange={(event) => onChange(field.key, event.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" />
      : <input value={values[field.key] ?? ''} onChange={(event) => onChange(field.key, event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" />}
  </label>)
}

function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function HrCustomLettersTool() {
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const replaceRef = useRef<HTMLInputElement>(null)
  const [templates, setTemplates] = useState<HRCustomTemplate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [salaryValues, setSalaryValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newFile, setNewFile] = useState<File | null>(null)
  const [newCanvaUrl, setNewCanvaUrl] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showEmail, setShowEmail] = useState(false)
  const [sending, setSending] = useState(false)
  const [email, setEmail] = useState({ recipient: '', subject: '', message: '' })

  const template = templates.find((item) => item.id === selectedId) ?? templates[0] ?? null
  const fieldValues = useMemo(() => template ? Object.fromEntries(template.fields.map((field) => [field.key, values[`${template.id}:${field.key}`] ?? field.default_value])) : {}, [template, values])
  const salaryColumns = useMemo(() => template ? [...new Set(template.salary_rows.flatMap((row) => row.columns))] : [], [template])
  const payloadFields = useMemo(() => ({
    ...fieldValues,
    ...(template ? Object.fromEntries(template.salary_rows.flatMap((row) => row.columns.map((column) => [
      `salary_${row.key}_${column}`,
      salaryValues[`${template.id}:${row.key}:${column}`] ?? '',
    ]))) : {}),
  }), [fieldValues, salaryValues, template])

  useEffect(() => {
    if (!accessToken) return
    let active = true
    void api.hrTemplates.customList(accessToken)
      .then((items) => {
        if (!active) return
        setTemplates(items)
        setSelectedId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null)
      })
      .catch((error) => notify('error', error instanceof ApiError ? error.message : 'Unable to load custom HR templates.'))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accessToken, notify])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  function clearPreview() {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
  }

  function choose(id: string) {
    setSelectedId(id)
    clearPreview()
  }

  function change(key: string, value: string) {
    if (!template) return
    setValues((current) => ({ ...current, [`${template.id}:${key}`]: value }))
    clearPreview()
  }

  async function createTemplate() {
    if (!accessToken || !newFile) return
    setReplacing(true)
    try {
      const created = await api.hrTemplates.customCreate(accessToken, newFile, newCanvaUrl.trim())
      setTemplates((current) => [created, ...current])
      setSelectedId(created.id)
      setNewFile(null)
      setNewCanvaUrl('')
      setShowCreate(false)
      notify('success', `${created.title} is active with ${created.detected_field_count} mapped fields and saved in the HR Knowledge Base.`)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to upload this custom template.')
    } finally {
      setReplacing(false)
    }
  }

  async function replaceTemplate(file: File | null) {
    if (!accessToken || !template || !file) return
    setReplacing(true)
    try {
      const updated = await api.hrTemplates.customReplace(accessToken, template.id, file)
      setTemplates((current) => current.map((item) => item.id === updated.id ? updated : item))
      setValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${template.id}:`))))
      setSalaryValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${template.id}:`))))
      clearPreview()
      notify('success', `${updated.title} v${updated.version} is active with ${updated.detected_field_count} mapped fields.`)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to replace this custom template.')
    } finally {
      setReplacing(false)
      if (replaceRef.current) replaceRef.current.value = ''
    }
  }

  async function viewTemplate() {
    if (!accessToken || !template) return
    try {
      openBlob((await api.hrTemplates.customContent(accessToken, template.id)).blob)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to open this template.')
    }
  }

  async function generatePreview() {
    if (!accessToken || !template) return
    setBusy(true)
    try {
      const response = await fetch('/api/v1/hr-letters/custom-preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: template.id, fields: payloadFields }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail ?? 'Unable to generate this custom letter.')
      }
      const url = URL.createObjectURL(await response.blob())
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return url
      })
      setEmail((current) => ({
        ...current,
        subject: current.subject || template.title,
        message: current.message || 'Dear Employee,\n\nPlease find the attached letter from Human Resources.\n\nRegards,\nHuman Resources',
      }))
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Unable to generate this custom letter.')
    } finally {
      setBusy(false)
    }
  }

  function download() {
    if (!previewUrl || !template) return
    const link = document.createElement('a')
    link.href = previewUrl
    link.download = `${template.title}.pdf`
    link.click()
  }

  function print() {
    const frame = document.getElementById('hr-custom-letter-preview') as HTMLIFrameElement | null
    frame?.contentWindow?.focus()
    frame?.contentWindow?.print()
  }

  async function sendEmail() {
    if (!accessToken || !template || !email.recipient.trim()) return
    setSending(true)
    try {
      const response = await fetch('/api/v1/hr-letters/custom-send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: template.id, fields: payloadFields, recipient_email: email.recipient, subject: email.subject, message: email.message }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail ?? 'Unable to send this custom letter.')
      }
      notify('success', `${template.title} sent successfully through HR Zoho Mail.`)
      setShowEmail(false)
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Unable to send this custom letter.')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <main className="grid min-h-[50vh] place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-primary" /></main>

  return <main className="space-y-5 p-4 md:p-6">
    <PageHeader title="Custom HR Letters" description="Upload an occasional Word master and let its {{field_name}} placeholders build the portal form automatically." />

    <section className="rounded-2xl border border-primary/25 bg-primary/[.04] p-4 md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><div className="flex items-center gap-1"><h2 className="font-semibold">Custom template library</h2><InfoTip label="Custom master help">Each master is versioned in the HR Knowledge Base. Export the revised Canva design as DOCX and upload it again to refresh the mapped fields.</InfoTip></div></div>
        {hasPermission('knowledge.write') && <Button onClick={() => setShowCreate((current) => !current)}><FilePlus2 className="mr-2 h-4 w-4" />Add custom master</Button>}
      </div>
      {showCreate && <div className="mt-4 grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-2">
        <label><span className="mb-1.5 block text-xs text-muted-foreground">DOCX master</span><input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setNewFile(event.target.files?.[0] ?? null)} className="block w-full rounded-xl border border-border bg-background p-2 text-sm" /></label>
        <label><span className="mb-1.5 block text-xs text-muted-foreground">Editable Canva link (optional)</span><input type="url" value={newCanvaUrl} onChange={(event) => setNewCanvaUrl(event.target.value)} placeholder="https://www.canva.com/..." className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label>
        <InfoTip label="Template placeholder help">Use clear placeholders such as {'{{employee_name}}'}, {'{{issue_date}}'} and {'{{designation}}'}. Every unique placeholder becomes one form field.</InfoTip>
        <div className="flex justify-end gap-2 md:col-span-2"><Button variant="outline" onClick={() => setShowCreate(false)} disabled={replacing}>Cancel</Button><Button onClick={() => void createTemplate()} disabled={!newFile || replacing}>{replacing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{replacing ? 'Mapping fields' : 'Upload and map fields'}</Button></div>
      </div>}
    </section>

    {templates.length === 0 ? <section className="rounded-2xl border border-dashed border-border bg-card p-10 text-center"><FileText className="mx-auto h-10 w-10 text-muted-foreground" /><h2 className="mt-3 font-semibold">No custom masters yet</h2><p className="mt-1 text-sm text-muted-foreground">Add the first DOCX master when HR needs a new letter format.</p></section> : template && <>
      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{templates.map((item) => <button key={item.id} onClick={() => choose(item.id)} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${template.id === item.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card hover:border-primary/40'}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${template.id === item.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{template.id === item.id ? <Check className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.title}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">v{item.version} · {item.detected_field_count} mapped fields</span></span></button>)}</section>

      <section className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-4 md:flex-row md:items-center md:justify-between"><div className="min-w-0"><h2 className="font-semibold">Current custom master</h2><p className="truncate text-sm text-muted-foreground">{template.filename} · Version {template.version} · HR Knowledge Base</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void viewTemplate()}><Eye className="mr-2 h-4 w-4" />View master</Button>{template.canva_edit_url && <Button variant="outline" onClick={() => window.open(template.canva_edit_url!, '_blank', 'noopener,noreferrer')}><ExternalLink className="mr-2 h-4 w-4" />Edit in Canva</Button>}{hasPermission('knowledge.write') && <><input ref={replaceRef} hidden type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void replaceTemplate(event.target.files?.[0] ?? null)} /><Button onClick={() => replaceRef.current?.click()} disabled={replacing}>{replacing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{replacing ? 'Mapping fields' : 'Upload revised master'}</Button></>}</div></section>

      <div className={`grid gap-5 ${previewUrl ? 'xl:grid-cols-[minmax(0,1fr)_minmax(440px,.9fr)]' : 'mx-auto w-full max-w-3xl'}`}><div className="space-y-5"><section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="mb-5"><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 1 · Enter details</p><div className="flex items-center gap-1"><h2 className="mt-1 text-lg font-semibold">{template.title}</h2><InfoTip label="About letter fields">These fields come directly from the placeholders in the uploaded master.</InfoTip></div></div><div className="grid gap-4 md:grid-cols-2"><FieldInputs items={template.fields.slice(0, 8)} values={fieldValues} onChange={change} />{template.fields.length > 8 && <details className="md:col-span-2 rounded-xl border border-border"><summary className="cursor-pointer p-3 text-sm font-medium">Additional details <span className="ml-1 text-xs font-normal text-muted-foreground">{template.fields.length - 8} fields</span></summary><div className="grid gap-4 border-t border-border p-3 md:grid-cols-2"><FieldInputs items={template.fields.slice(8)} values={fieldValues} onChange={change} /></div></details>}</div></section>
        {template.salary_rows.length > 0 && <details className="rounded-2xl border border-border bg-card"><summary className="cursor-pointer p-4 text-sm font-medium">Compensation details <span className="ml-1 text-xs font-normal text-muted-foreground">{template.salary_rows.length} rows</span></summary><div className="overflow-auto border-t border-border p-4"><table className="w-full min-w-[600px] text-sm"><thead><tr><th className="p-3 text-left">Salary component</th>{salaryColumns.map((column) => <th key={column} className="p-3 text-left">{column.charAt(0).toUpperCase() + column.slice(1)}</th>)}</tr></thead><tbody>{template.salary_rows.map((row) => <tr key={row.key} className="border-t border-border"><td className="p-3 text-xs">{row.label}</td>{salaryColumns.map((column) => <td key={column} className="p-2">{row.columns.includes(column) ? <input value={salaryValues[`${template.id}:${row.key}:${column}`] ?? ''} onChange={(event) => { setSalaryValues((current) => ({ ...current, [`${template.id}:${row.key}:${column}`]: event.target.value })); clearPreview() }} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm" /> : <span className="block text-center text-muted-foreground">—</span>}</td>)}</tr>)}</tbody></table></div></details>}
        <section className="flex justify-end rounded-2xl border border-border bg-card p-4"><Button onClick={() => void generatePreview()} disabled={busy}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}{busy ? 'Preparing review' : 'Review final letter'}</Button></section></div>
        {previewUrl && <section className="sticky top-4 h-fit overflow-hidden rounded-2xl border border-border bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 2 · Review</p><h2 className="mt-1 font-semibold">Final print preview</h2></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={download}><Download className="mr-1.5 h-4 w-4" />PDF</Button><Button size="sm" variant="outline" onClick={print}><Printer className="mr-1.5 h-4 w-4" />Print</Button><Button size="sm" onClick={() => setShowEmail(true)}><Mail className="mr-1.5 h-4 w-4" />Email</Button></div></div><iframe id="hr-custom-letter-preview" title="Custom letter preview" src={previewUrl} className="h-[72vh] w-full bg-white" /></section>}</div>
    </>}

    {showEmail && template && <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Email custom letter"><div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 3 · Send</p><h2 className="mt-1 text-lg font-semibold">Email reviewed PDF</h2></div><button type="button" onClick={() => setShowEmail(false)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Close email dialog"><X className="h-4 w-4" /></button></div><div className="mt-5 space-y-3"><label><span className="mb-1 block text-xs text-muted-foreground">Recipient email</span><input type="email" value={email.recipient} onChange={(event) => setEmail((current) => ({ ...current, recipient: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><label><span className="mb-1 block text-xs text-muted-foreground">Subject</span><input value={email.subject} onChange={(event) => setEmail((current) => ({ ...current, subject: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><label><span className="mb-1 block text-xs text-muted-foreground">Email message</span><textarea rows={6} value={email.message} onChange={(event) => setEmail((current) => ({ ...current, message: event.target.value }))} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></label></div><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setShowEmail(false)} disabled={sending}>Cancel</Button><Button onClick={() => void sendEmail()} disabled={sending || !email.recipient || !email.subject || !email.message}>{sending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{sending ? 'Sending' : 'Send with PDF'}</Button></div></div></div>}
  </main>
}
