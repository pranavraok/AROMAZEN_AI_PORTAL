'use client'

import { InfoTip } from '@/components/ui/info-tip'

import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, Eye, FilePlus2, FileText, LoaderCircle, Mail, Pencil, Printer, Send, Settings2, Trash2, Upload, X } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { Button } from '@/components/ui/button'
import { ModalShell } from '@/components/ui/modal'
import { PageHeader } from '@/components/ui/page-header'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { HRCustomTemplate, HRTemplateField } from '@/lib/api/types'
import { beginBlobPreview, showBlobPreview } from '@/lib/open-blob-preview'
import { parseEmailList } from '@/lib/email-recipients'

function FieldInputs({ items, values, isIncluded, onChange, onIncludeChange }: { items: HRTemplateField[]; values: Record<string, string>; isIncluded: (key: string) => boolean; onChange: (key: string, value: string) => void; onIncludeChange: (key: string, included: boolean) => void }) {
  return items.map((field) => {
    const included = isIncluded(field.key)
    return <div key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{field.label}</span>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-medium text-foreground">
          <input type="checkbox" checked={included} onChange={(event) => onIncludeChange(field.key, event.target.checked)} className="size-4 accent-primary" />
          Include in this document
        </label>
      </div>
      {field.multiline
        ? <textarea rows={3} value={values[field.key] ?? ''} disabled={!included} aria-label={field.label} onChange={(event) => onChange(field.key, event.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm disabled:cursor-not-allowed disabled:opacity-50" />
        : <input value={values[field.key] ?? ''} disabled={!included} aria-label={field.label} onChange={(event) => onChange(field.key, event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50" />}
    </div>
  })
}

export function HrCustomLettersTool() {
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const [templates, setTemplates] = useState<HRCustomTemplate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [salaryValues, setSalaryValues] = useState<Record<string, string>>({})
  const [includedFields, setIncludedFields] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [newFile, setNewFile] = useState<File | null>(null)
  const [newCanvaUrl, setNewCanvaUrl] = useState('')
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [editingTemplateName, setEditingTemplateName] = useState('')
  const [renamingTemplateId, setRenamingTemplateId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showEmail, setShowEmail] = useState(false)
  const [sending, setSending] = useState(false)
  const [email, setEmail] = useState({ recipient: '', cc: '', subject: '', message: '' })

  const template = templates.find((item) => item.id === selectedId) ?? templates[0] ?? null
  const fieldValues = useMemo(() => template ? Object.fromEntries(template.fields.map((field) => [field.key, values[`${template.id}:${field.key}`] ?? field.default_value])) : {}, [template, values])
  const salaryColumns = useMemo(() => template ? [...new Set(template.salary_rows.flatMap((row) => row.columns))] : [], [template])
  const templateFieldKeys = useMemo(() => template ? [
    ...template.fields.map((field) => field.key),
    ...template.salary_rows.flatMap((row) => row.columns.map((column) => `salary_${row.key}_${column}`)),
  ] : [], [template])
  const excludedFields = useMemo(() => template ? templateFieldKeys.filter((key) => includedFields[`${template.id}:${key}`] === false) : [], [includedFields, template, templateFieldKeys])
  const payloadFields = useMemo(() => {
    if (!template) return {}
    const salaryFields = Object.fromEntries(template.salary_rows.flatMap((row) => row.columns.map((column) => {
      const key = `salary_${row.key}_${column}`
      return [key, includedFields[`${template.id}:${key}`] === false ? '' : salaryValues[`${template.id}:${row.key}:${column}`] ?? '']
    })))
    return {
      ...Object.fromEntries(template.fields.map((field) => [field.key, includedFields[`${template.id}:${field.key}`] === false ? '' : fieldValues[field.key] ?? ''])),
      ...salaryFields,
    }
  }, [fieldValues, includedFields, salaryValues, template])

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

  function isIncluded(key: string) {
    return template ? includedFields[`${template.id}:${key}`] !== false : true
  }

  function changeInclusion(key: string, included: boolean) {
    if (!template) return
    setIncludedFields((current) => ({ ...current, [`${template.id}:${key}`]: included }))
    clearPreview()
  }

  function changeAllInclusions(included: boolean) {
    if (!template) return
    setIncludedFields((current) => ({
      ...current,
      ...Object.fromEntries(templateFieldKeys.map((key) => [`${template.id}:${key}`, included])),
    }))
    clearPreview()
  }

  function closeCreate() {
    if (replacing) return
    setShowCreate(false)
    setNewFile(null)
    setNewCanvaUrl('')
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
      setShowManage(false)
      notify('success', `${created.title} is active with ${created.detected_field_count} mapped fields and saved in the HR Knowledge Base.`)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to upload this custom template.')
    } finally {
      setReplacing(false)
    }
  }

  async function replaceTemplate(target: HRCustomTemplate, file: File | null) {
    if (!accessToken || !file) return
    setReplacing(true)
    try {
      const updated = await api.hrTemplates.customReplace(accessToken, target.id, file)
      setTemplates((current) => current.map((item) => item.id === target.id ? updated : item))
      setSelectedId((current) => current === target.id ? updated.id : current)
      setValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${target.id}:`))))
      setSalaryValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${target.id}:`))))
      setIncludedFields((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${target.id}:`))))
      clearPreview()
      notify('success', `${updated.title} v${updated.version} is active with ${updated.detected_field_count} mapped fields.`)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to replace this custom template.')
    } finally {
      setReplacing(false)
    }
  }

  async function viewTemplate(target: HRCustomTemplate) {
    if (!accessToken) return
    const preview = beginBlobPreview(target.filename)
    try {
      showBlobPreview(preview, (await api.hrTemplates.customContent(accessToken, target.id)).blob, target.filename)
    } catch (error) {
      preview?.close()
      notify('error', error instanceof ApiError ? error.message : 'Unable to open this template.')
    }
  }

  async function renameTemplate(target: HRCustomTemplate) {
    const name = editingTemplateName.trim()
    if (!accessToken || !name) return
    setRenamingTemplateId(target.id)
    try {
      const updated = await api.hrTemplates.customRename(accessToken, target.id, name)
      setTemplates((current) => current.map((item) => item.id === target.id ? updated : item))
      setEditingTemplateId(null)
      setEditingTemplateName('')
      notify('success', `Template renamed to ${updated.title}.`)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to rename this template.')
    } finally {
      setRenamingTemplateId(null)
    }
  }

  async function deleteTemplate(target: HRCustomTemplate) {
    if (!accessToken) return
    setDeletingTemplateId(target.id)
    try {
      await api.hrTemplates.customDelete(accessToken, target.id)
      const remaining = templates.filter((item) => item.id !== target.id)
      setTemplates(remaining)
      if (selectedId === target.id) setSelectedId(remaining[0]?.id ?? null)
      setValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${target.id}:`))))
      setSalaryValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${target.id}:`))))
      setIncludedFields((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${target.id}:`))))
      setPendingDeleteId(null)
      clearPreview()
      notify('success', `${target.title} was deleted.`)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to delete this template.')
    } finally {
      setDeletingTemplateId(null)
    }
  }

  async function generatePreview() {
    if (!accessToken || !template) return
    setBusy(true)
    try {
      const response = await fetch('/api/v1/hr-letters/custom-preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: template.id, fields: payloadFields, excluded_fields: excludedFields }),
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
        message: current.message || 'Dear Employee,\n\nPlease find the attached letter from Human Resources.',
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
        body: JSON.stringify({ template_id: template.id, fields: payloadFields, excluded_fields: excludedFields, recipient_email: email.recipient, cc_emails: parseEmailList(email.cc), subject: email.subject, message: email.message }),
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
    <PageHeader title="Custom Letters" description="Choose an occasional HR template, complete its detected fields and generate the letter." />

    <section className="rounded-2xl border border-primary/25 bg-primary/[.04] p-4 md:p-5">
      <div className="mb-4"><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 1 · Choose template</p><h2 className="mt-1 text-lg font-semibold">Generate a custom letter</h2><p className="mt-1 text-sm text-muted-foreground">Select one of the less frequently used HR templates.</p></div>
      {templates.length > 0 && template ? <>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label><span className="mb-1.5 block text-xs text-muted-foreground">Letter template</span><select value={template.id} onChange={(event) => choose(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium"><option disabled value="">Select a template</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.detected_field_count} fields</option>)}</select></label>
          {hasPermission('knowledge.write') && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setShowCreate(true)}><FilePlus2 className="mr-2 h-4 w-4" />Add new template</Button><Button variant="outline" onClick={() => setShowManage(true)}><Settings2 className="mr-2 h-4 w-4" />Manage templates</Button></div>}
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-sm font-semibold">{template.title}</p><p className="truncate text-xs text-muted-foreground">{template.filename} · Version {template.version} · {template.detected_field_count} detected fields</p></div><div className="flex shrink-0 flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void viewTemplate(template)}><Eye className="mr-1.5 h-4 w-4" />View master</Button>{template.canva_edit_url && <Button size="sm" variant="outline" onClick={() => window.open(template.canva_edit_url!, '_blank', 'noopener,noreferrer')}><ExternalLink className="mr-1.5 h-4 w-4" />Canva</Button>}</div></div>
      </> : <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center"><FileText className="mx-auto h-9 w-9 text-muted-foreground" /><h3 className="mt-3 font-semibold">No custom templates yet</h3><p className="mt-1 text-sm text-muted-foreground">Upload a DOCX containing placeholders such as {'{{employee_name}}'}.</p>{hasPermission('knowledge.write') && <Button className="mt-4" onClick={() => setShowCreate(true)}><FilePlus2 className="mr-2 h-4 w-4" />Add first template</Button>}</div>}
    </section>

    {template && <>
      <div className={`grid gap-5 ${previewUrl ? 'xl:grid-cols-[minmax(0,1fr)_minmax(440px,.9fr)]' : 'mx-auto w-full max-w-3xl'}`}><div className="space-y-5"><section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 2 · Enter details</p><div className="flex items-center gap-1"><h2 className="mt-1 text-lg font-semibold">{template.title}</h2><InfoTip label="About letter fields">These fields come directly from the placeholders in the uploaded master. Uncheck a field to leave it blank in this document only.</InfoTip></div><p className="mt-1 text-xs text-muted-foreground">{templateFieldKeys.length - excludedFields.length} of {templateFieldKeys.length} fields included</p></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => changeAllInclusions(true)}>Include all</Button><Button size="sm" variant="outline" onClick={() => changeAllInclusions(false)}>Clear optional</Button></div></div><div className="grid gap-4 md:grid-cols-2"><FieldInputs items={template.fields.slice(0, 8)} values={fieldValues} isIncluded={isIncluded} onChange={change} onIncludeChange={changeInclusion} />{template.fields.length > 8 && <details className="md:col-span-2 rounded-xl border border-border"><summary className="cursor-pointer p-3 text-sm font-medium">Additional details <span className="ml-1 text-xs font-normal text-muted-foreground">{template.fields.length - 8} fields</span></summary><div className="grid gap-4 border-t border-border p-3 md:grid-cols-2"><FieldInputs items={template.fields.slice(8)} values={fieldValues} isIncluded={isIncluded} onChange={change} onIncludeChange={changeInclusion} /></div></details>}</div></section>
        {template.salary_rows.length > 0 && <details className="rounded-2xl border border-border bg-card"><summary className="cursor-pointer p-4 text-sm font-medium">Compensation details <span className="ml-1 text-xs font-normal text-muted-foreground">{template.salary_rows.length} rows</span></summary><div className="overflow-auto border-t border-border p-4"><table className="w-full min-w-[600px] text-sm"><thead><tr><th className="p-3 text-left">Salary component</th>{salaryColumns.map((column) => <th key={column} className="p-3 text-left">{column.charAt(0).toUpperCase() + column.slice(1)}</th>)}</tr></thead><tbody>{template.salary_rows.map((row) => <tr key={row.key} className="border-t border-border"><td className="p-3 text-xs">{row.label}</td>{salaryColumns.map((column) => { const key = `salary_${row.key}_${column}`; const included = isIncluded(key); return <td key={column} className="p-2">{row.columns.includes(column) ? <div className="space-y-1.5"><label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium"><input type="checkbox" checked={included} onChange={(event) => changeInclusion(key, event.target.checked)} className="size-4 accent-primary" />Include</label><input value={salaryValues[`${template.id}:${row.key}:${column}`] ?? ''} disabled={!included} aria-label={`${row.label} ${column}`} onChange={(event) => { setSalaryValues((current) => ({ ...current, [`${template.id}:${row.key}:${column}`]: event.target.value })); clearPreview() }} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" /></div> : <span className="block text-center text-muted-foreground">—</span>}</td>})}</tr>)}</tbody></table></div></details>}
        <section className="flex justify-end rounded-2xl border border-border bg-card p-4"><Button onClick={() => void generatePreview()} disabled={busy}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}{busy ? 'Preparing review' : 'Review final letter'}</Button></section></div>
        {previewUrl && <section className="sticky top-4 h-fit overflow-hidden rounded-2xl border border-border bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 3 · Review</p><h2 className="mt-1 font-semibold">Final print preview</h2></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={download}><Download className="mr-1.5 h-4 w-4" />PDF</Button><Button size="sm" variant="outline" onClick={print}><Printer className="mr-1.5 h-4 w-4" />Print</Button><Button size="sm" onClick={() => setShowEmail(true)}><Mail className="mr-1.5 h-4 w-4" />Email</Button></div></div><iframe id="hr-custom-letter-preview" title="Custom letter preview" src={previewUrl} className="h-[72vh] w-full bg-white" /></section>}</div>
    </>}

    {showCreate && <ModalShell label="Add custom HR template" onClose={closeCreate} width="max-w-2xl"><div className="border-b border-border p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Template setup</p><h2 className="mt-1 text-lg font-semibold">Add a custom letter template</h2><p className="mt-1 text-sm text-muted-foreground">Upload a DOCX and the portal will automatically create one input for every unique placeholder.</p></div><button type="button" onClick={closeCreate} disabled={replacing} className="rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-50" aria-label="Close add template"><X className="h-4 w-4" /></button></div></div><div className="space-y-4 p-5"><label className="block"><span className="mb-1.5 block text-xs text-muted-foreground">DOCX template</span><input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setNewFile(event.target.files?.[0] ?? null)} className="block w-full rounded-xl border border-border bg-background p-2 text-sm" /></label><label className="block"><span className="mb-1.5 block text-xs text-muted-foreground">Editable Canva link <span className="font-normal">(optional)</span></span><input type="url" value={newCanvaUrl} onChange={(event) => setNewCanvaUrl(event.target.value)} placeholder="https://www.canva.com/..." className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><div className="rounded-xl border border-primary/20 bg-primary/[.05] p-4"><p className="text-sm font-medium">Automatic placeholder detection</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Use placeholders such as {'{{employee_name}}'}, {'{{bank_account_number}}'} or {'{{issue_date}}'}. Repeated placeholders become one input and use the same value throughout the letter.</p></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={closeCreate} disabled={replacing}>Cancel</Button><Button onClick={() => void createTemplate()} disabled={!newFile || replacing}>{replacing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{replacing ? 'Detecting placeholders' : 'Upload template'}</Button></div></div></ModalShell>}

    {showManage && <ModalShell label="Manage custom HR templates" onClose={() => setShowManage(false)} width="max-w-4xl"><div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card p-5"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Template library</p><h2 className="mt-1 text-lg font-semibold">Manage custom templates</h2><p className="mt-1 text-sm text-muted-foreground">View detected fields, rename, replace or delete a template.</p></div><button type="button" onClick={() => setShowManage(false)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Close template manager"><X className="h-4 w-4" /></button></div><div className="space-y-3 p-5">{templates.map((item) => <article key={item.id} className={`rounded-xl border p-4 ${item.id === template?.id ? 'border-primary/40 bg-primary/[.04]' : 'border-border'}`}><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1">{editingTemplateId === item.id ? <div className="flex max-w-lg gap-2"><input value={editingTemplateName} onChange={(event) => setEditingTemplateName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameTemplate(item) }} autoFocus aria-label={`New name for ${item.title}`} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm" /><Button size="sm" onClick={() => void renameTemplate(item)} disabled={!editingTemplateName.trim() || renamingTemplateId === item.id}>{renamingTemplateId === item.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Save'}</Button><Button size="sm" variant="ghost" onClick={() => setEditingTemplateId(null)}>Cancel</Button></div> : <><div className="flex items-center gap-2"><h3 className="truncate font-semibold">{item.title}</h3>{item.id === template?.id && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">SELECTED</span>}</div><p className="mt-1 truncate text-xs text-muted-foreground">{item.filename} · Version {item.version} · {item.detected_field_count} detected fields</p></>}<div className="mt-3 flex flex-wrap gap-1.5">{item.fields.slice(0, 6).map((field) => <span key={field.key} className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">{`{{${field.key}}}`}</span>)}{item.detected_field_count > 6 && <span className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">+{item.detected_field_count - 6} more</span>}</div></div><div className="flex shrink-0 flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { choose(item.id); setShowManage(false) }}>Use template</Button><Button size="sm" variant="outline" onClick={() => void viewTemplate(item)}><Eye className="mr-1.5 h-4 w-4" />View</Button><Button size="sm" variant="outline" onClick={() => { setEditingTemplateId(item.id); setEditingTemplateName(item.title); setPendingDeleteId(null) }}><Pencil className="mr-1.5 h-4 w-4" />Rename</Button><label className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted ${replacing ? 'pointer-events-none opacity-50' : ''}`}><input hidden type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { void replaceTemplate(item, event.target.files?.[0] ?? null); event.target.value = '' }} /><Upload className="mr-1.5 h-4 w-4" />Replace</label><Button size="sm" variant="outline" onClick={() => { setPendingDeleteId(item.id); setEditingTemplateId(null) }} className="text-destructive hover:text-destructive"><Trash2 className="mr-1.5 h-4 w-4" />Delete</Button></div></div>{pendingDeleteId === item.id && <div className="mt-4 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/[.06] p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-destructive">Delete {item.title}?</p><p className="text-xs text-muted-foreground">It will be removed from the dropdown and the stored master will be deleted.</p></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => setPendingDeleteId(null)} disabled={deletingTemplateId === item.id}>Cancel</Button><Button size="sm" onClick={() => void deleteTemplate(item)} disabled={deletingTemplateId === item.id} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deletingTemplateId === item.id ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}{deletingTemplateId === item.id ? 'Deleting' : 'Delete template'}</Button></div></div>}</article>)}<div className="flex justify-between border-t border-border pt-4"><Button variant="outline" onClick={() => setShowManage(false)}>Close</Button><Button onClick={() => { setShowManage(false); setShowCreate(true) }}><FilePlus2 className="mr-2 h-4 w-4" />Add new template</Button></div></div></ModalShell>}

    {showEmail && template && <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Email custom letter"><div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 4 · Send</p><h2 className="mt-1 text-lg font-semibold">Email reviewed PDF</h2></div><button type="button" onClick={() => setShowEmail(false)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Close email dialog"><X className="h-4 w-4" /></button></div><div className="mt-5 space-y-3"><label><span className="mb-1 block text-xs text-muted-foreground">Recipient email</span><input type="email" value={email.recipient} onChange={(event) => setEmail((current) => ({ ...current, recipient: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><label><span className="mb-1 block text-xs text-muted-foreground">CC <span className="font-normal">(optional)</span></span><input type="text" inputMode="email" value={email.cc} onChange={(event) => setEmail((current) => ({ ...current, cc: event.target.value }))} placeholder="Separate multiple emails with commas" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><label><span className="mb-1 block text-xs text-muted-foreground">Subject</span><input value={email.subject} onChange={(event) => setEmail((current) => ({ ...current, subject: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><label><span className="mb-1 block text-xs text-muted-foreground">Email message</span><textarea rows={6} value={email.message} onChange={(event) => setEmail((current) => ({ ...current, message: event.target.value }))} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></label></div><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setShowEmail(false)} disabled={sending}>Cancel</Button><Button onClick={() => void sendEmail()} disabled={sending || !email.recipient || !email.subject || !email.message}>{sending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{sending ? 'Sending' : 'Send with PDF'}</Button></div></div></div>}
  </main>
}
