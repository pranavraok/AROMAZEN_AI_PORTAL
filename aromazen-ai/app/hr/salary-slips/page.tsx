'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Download, Eye, FileSpreadsheet, FileText, LoaderCircle, RefreshCw, Send, ShieldCheck, Upload, X, XCircle } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import type { PayrollBatch, PayrollRecipient, PayrollTemplate } from '@/lib/api/types'
import { ApiError } from '@/lib/api/client'

function monthLabel(value: string) { const [year, month] = value.split('-').map(Number); return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1)) }
function money(value: string | number) { const amount = Number(value); return Number.isFinite(amount) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount) : String(value) }
function tone(status: string) { return status === 'sent' || status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : status === 'failed' ? 'bg-red-500/10 text-red-400' : status === 'partial' ? 'bg-amber-500/10 text-amber-400' : status === 'sending' ? 'bg-blue-500/10 text-blue-400' : 'bg-muted text-muted-foreground' }
function statusIcon(status: string) { return status === 'sent' ? <CheckCircle2 className="h-3.5 w-3.5" /> : status === 'failed' ? <XCircle className="h-3.5 w-3.5" /> : status === 'sending' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null }
function openBlob(blob: Blob) { const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener,noreferrer'); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }

export default function SalarySlipsPage() {
  const { accessToken, user, hasPermission } = useAuth()
  const { notify } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [payrollMonth, setPayrollMonth] = useState(() => { const today = new Date(); return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}` })
  const [excel, setExcel] = useState<File | null>(null)
  const [templates, setTemplates] = useState<PayrollTemplate[]>([])
  const [history, setHistory] = useState<PayrollBatch[]>([])
  const [batch, setBatch] = useState<PayrollBatch | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'upload' | 'save' | 'send' | 'retry' | null>(null)
  const [templateUploadUnit, setTemplateUploadUnit] = useState<number | null>(null)
  const canUse = ['HR', 'Human Resources'].includes(user?.department_name ?? '') || user?.role_names.some((role) => role === 'Super Admin' || role === 'Admin')
  const recipients = useMemo(() => batch?.recipients ?? [], [batch?.recipients])
  const finished = (batch?.sent_count ?? 0) + (batch?.failed_count ?? 0)
  const progress = batch?.total_count ? Math.round((finished / batch.total_count) * 100) : 0
  const netPayroll = useMemo(() => recipients.reduce((sum, item) => sum + Number(item.net_wages || 0), 0), [recipients])

  const loadPage = useCallback(async () => {
    if (!accessToken || !canUse) return
    try { const [unitTemplates, batches] = await Promise.all([api.payroll.templates(accessToken), api.payroll.batches(accessToken)]); setTemplates(unitTemplates); setHistory(batches) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to load salary slips.') }
  }, [accessToken, canUse, notify])

  const refreshBatch = useCallback(async (id: string, quiet = false) => {
    if (!accessToken) return
    try {
      const next = await api.payroll.batch(accessToken, id)
      setBatch(next); setSubject(next.email_subject); setBody(next.email_body)
      setHistory((items) => items.map((item) => item.id === next.id ? { ...next, recipients: undefined } : item))
    } catch (error) { if (!quiet) notify('error', error instanceof ApiError ? error.message : 'Unable to refresh delivery.') }
  }, [accessToken, notify])

  useEffect(() => { void loadPage() }, [loadPage])
  useEffect(() => {
    if (!batch || batch.status !== 'sending') return
    const timer = window.setInterval(() => void refreshBatch(batch.id, true), 2000)
    return () => window.clearInterval(timer)
  }, [batch, refreshBatch])

  async function viewTemplate(template: PayrollTemplate) {
    if (!accessToken) return
    try { const result = await api.payroll.templateContent(accessToken, template.id); openBlob(result.blob) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to open template.') }
  }

  async function replaceTemplate(unit: number, file: File | null) {
    if (!accessToken || !file) return
    setTemplateUploadUnit(unit)
    try {
      const next = await api.payroll.uploadTemplate(accessToken, unit, file)
      setTemplates((items) => [...items.filter((item) => item.unit_number !== unit), next].sort((left, right) => Number(left.unit_number) - Number(right.unit_number)))
      notify('success', `Unit ${unit} salary-slip template is active and saved in Human Resources Knowledge.`)
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to replace this salary-slip template.') }
    finally { setTemplateUploadUnit(null) }
  }

  async function downloadSalaryTemplate() {
    if (!accessToken) return
    try { const file = await api.payroll.template(accessToken); const url = URL.createObjectURL(file.blob); const link = document.createElement('a'); link.href = url; link.download = file.filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to download the final salary template.') }
  }

  async function prepare() {
    if (!accessToken || !excel || !payrollMonth) return
    setBusy('upload')
    try {
      const next = await api.payroll.upload(accessToken, payrollMonth, excel)
      setBatch(next); setSubject(next.email_subject); setBody(next.email_body)
      setHistory((items) => [{ ...next, recipients: undefined }, ...items])
      notify('success', `${next.total_count} salary slips are ready.`)
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to prepare salary slips.') }
    finally { setBusy(null) }
  }

  async function saveEmail(quiet = false) {
    if (!accessToken || !batch) return null
    setBusy('save')
    try { const next = await api.payroll.updateEmail(accessToken, batch.id, subject, body); setBatch(next); if (!quiet) notify('success', 'Email draft saved.'); return next }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to save email draft.'); return null }
    finally { setBusy(null) }
  }

  async function sendAll() {
    if (!accessToken || !batch) return
    const saved = await saveEmail(true)
    if (!saved) return
    setConfirming(false); setBusy('send')
    try { setBatch(await api.payroll.send(accessToken, batch.id)); notify('success', 'Delivery started.') }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to start delivery.') }
    finally { setBusy(null) }
  }

  async function retryFailed() {
    if (!accessToken || !batch) return
    setBusy('retry')
    try { setBatch(await api.payroll.retryFailed(accessToken, batch.id)); notify('success', 'Retry started.') }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to retry failed emails.') }
    finally { setBusy(null) }
  }

  async function viewSlip(item: PayrollRecipient) {
    if (!accessToken || !batch) return
    try { const result = await api.payroll.pdf(accessToken, batch.id, item.id); openBlob(result.blob) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to open salary slip.') }
  }

  if (!canUse) return <AppLayout><main className="grid min-h-[70vh] place-items-center p-6"><div className="text-center"><ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" /><h1 className="mt-3 text-xl font-semibold">Access restricted</h1></div></main></AppLayout>

  return <AppLayout><main className="space-y-5 p-4 md:p-6">
    <PageHeader title="Salary slips" description="Upload the reviewed salary-ready Excel, prepare every PDF and send through HR email." actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void downloadSalaryTemplate()}><Download className="mr-2 h-4 w-4" />Final salary template</Button><Link href="/hr/leave-calculator" className={buttonVariants({ variant: 'outline' })}><FileSpreadsheet className="mr-2 h-4 w-4" />Leave calculator</Link></div>} />

    <section className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Need to calculate Present Days and LOP?</h2><p className="mt-1 text-sm text-muted-foreground">Merge salary details with attendance and shifts first, review the leave calculation, then upload that downloaded Excel here.</p></div><Link href="/hr/leave-calculator" className={buttonVariants()}>Open Leave Calculator</Link></section>

    <details className="rounded-2xl border border-border bg-card" open>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Payslip template library <span className="ml-1 text-xs font-normal text-muted-foreground">{templates.length}/3 ready · stored in Human Resources Knowledge</span></summary>
      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-3">
      {[1, 2, 3].map((unit) => {
        const template = templates.find((item) => item.unit_number === unit)
        return <div key={unit} className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><FileText className="h-5 w-5" /></span><div><p className="font-semibold">Unit {unit}</p><p className="text-xs text-muted-foreground">{template ? `${template.original_filename} · ${template.supports_dynamic_fields ? `${template.detected_fields.length} mapped PDF fields` : 'fixed-layout compatibility'}` : 'Template missing'}</p></div></div>{template ? <Check className="h-4 w-4 text-emerald-400" /> : <X className="h-4 w-4 text-red-400" />}</div><div className="mt-4 flex gap-2">{template && <Button size="sm" variant="outline" onClick={() => void viewTemplate(template)}><Eye className="mr-1.5 h-4 w-4" />View</Button>}{hasPermission('knowledge.write') && <label className={buttonVariants({ size: 'sm', variant: template ? 'outline' : 'default' })}><input hidden type="file" accept=".pdf,application/pdf" disabled={templateUploadUnit !== null} onChange={(event) => { void replaceTemplate(unit, event.target.files?.[0] ?? null); event.target.value = '' }} />{templateUploadUnit === unit ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}{template ? 'Replace' : 'Upload'}</label>}</div>{template && !template.supports_dynamic_fields && <p className="mt-3 text-[11px] leading-4 text-amber-400">For automatic field remapping after layout changes, upload a fillable PDF whose field names match the salary Excel headings.</p>}</div>
      })}
      </div>
    </details>

    <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
      <div className="grid gap-3 md:grid-cols-[12rem_1fr_auto]">
        <label className="space-y-1.5"><span className="text-xs text-muted-foreground">Payroll month</span><input type="month" value={payrollMonth} onChange={(event) => setPayrollMonth(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label>
        <label className="space-y-1.5"><span className="text-xs text-muted-foreground">Salary Excel</span><button type="button" onClick={() => inputRef.current?.click()} className="flex h-11 w-full items-center rounded-xl border border-dashed border-border bg-background px-3 text-left text-sm hover:border-primary/50"><FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-400" /><span className="truncate">{excel?.name ?? 'Choose .xlsx file'}</span></button><input ref={inputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setExcel(event.target.files?.[0] ?? null)} /></label>
        <Button className="self-end" disabled={!excel || !payrollMonth || templates.length < 3 || busy !== null} onClick={() => void prepare()}>{busy === 'upload' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{busy === 'upload' ? 'Preparing' : 'Prepare'}</Button>
      </div>
    </section>

    {batch && <>
      <details className="rounded-2xl border border-border bg-card"><summary className="cursor-pointer p-4 text-sm font-medium">Email message <span className="ml-1 text-xs font-normal text-muted-foreground">Optional edit</span></summary><div className="border-t border-border p-4 md:p-5">
        <div className="mb-3 flex items-center justify-end"><Button size="sm" variant="outline" disabled={busy !== null || batch.status === 'sending'} onClick={() => void saveEmail()}>{busy === 'save' ? 'Saving' : 'Save changes'}</Button></div>
        <input value={subject} maxLength={240} onChange={(event) => setSubject(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" aria-label="Email subject" />
        <textarea value={body} maxLength={8000} onChange={(event) => setBody(event.target.value)} rows={7} className="mt-3 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-6" aria-label="Email body" />
        <p className="mt-2 text-xs text-muted-foreground">Use {'{employee_name}'} and {'{month}'}.</p>
      </div></details>

      <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-semibold">{monthLabel(batch.payroll_month)}</h2><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs capitalize ${tone(batch.status)}`}>{statusIcon(batch.status)}{batch.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{batch.total_count} employees · {money(netPayroll)} net</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void refreshBatch(batch.id)}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>{batch.failed_count > 0 && batch.status !== 'sending' && <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void retryFailed()}>Retry {batch.failed_count}</Button>}{batch.pending_count > 0 && batch.status !== 'sending' && <Button size="sm" disabled={busy !== null || !subject.trim() || !body.trim()} onClick={() => setConfirming(true)}><Send className="mr-1.5 h-4 w-4" />Send {batch.pending_count}</Button>}</div></div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all duration-700 ease-out" style={{ width: `${progress}%` }} /></div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">{[['Total', batch.total_count], ['Pending', batch.pending_count], ['Sent', batch.sent_count], ['Failed', batch.failed_count]].map(([label, value]) => <div key={label} className="rounded-xl bg-muted/50 p-2"><p className="text-lg font-semibold tabular-nums">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>)}</div>

        <details className="mt-4 rounded-xl border border-border"><summary className="flex cursor-pointer list-none items-center justify-between p-3 text-sm font-medium">Employee review <ChevronDown className="h-4 w-4" /></summary><div className="max-h-[28rem] overflow-auto border-t border-border"><table className="w-full min-w-[850px] text-sm"><thead className="sticky top-0 bg-card text-xs text-muted-foreground"><tr><th className="p-3 text-left">Employee</th><th className="p-3 text-left">Unit</th><th className="p-3 text-left">Email</th><th className="p-3 text-right">Net</th><th className="p-3 text-left">Status</th><th /></tr></thead><tbody>{recipients.map((item) => <tr key={item.id} className="border-t border-border"><td className="p-3"><p className="font-medium">{item.employee_name}</p><p className="text-xs text-muted-foreground">{item.employee_code}</p></td><td className="p-3">Unit {item.unit}</td><td className="p-3">{item.personal_email}</td><td className="p-3 text-right font-medium">{money(item.net_wages)}</td><td className="p-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs capitalize ${tone(item.status)}`}>{statusIcon(item.status)}{item.status}</span>{item.error_message && <p className="mt-1 max-w-xs text-xs text-red-400">{item.error_message}</p>}</td><td className="p-3 text-right"><Button size="sm" variant="ghost" onClick={() => void viewSlip(item)}><Eye className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div></details>
      </section>
    </>}

    <details className="rounded-2xl border border-border bg-card"><summary className="cursor-pointer p-4 text-sm font-medium">Previous batches <span className="ml-1 text-xs font-normal text-muted-foreground">{history.length}</span></summary><div className="border-t border-border p-4">{history.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No batches yet.</p> : <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{history.map((item) => <button key={item.id} type="button" onClick={() => void refreshBatch(item.id)} className="flex items-center justify-between rounded-xl border border-border p-3 text-left hover:bg-muted/40"><div><p className="font-medium">{monthLabel(item.payroll_month)}</p><p className="text-xs text-muted-foreground">{item.sent_count} sent · {item.failed_count} failed</p></div><span className={`rounded-full px-2 py-1 text-[11px] capitalize ${tone(item.status)}`}>{item.status}</span></button>)}</div>}</div></details>

    {confirming && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"><div className="flex items-start gap-3"><span className="rounded-xl bg-amber-500/10 p-2 text-amber-400"><AlertTriangle className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold">Send {batch?.pending_count} salary slips?</h2><p className="mt-1 text-sm text-muted-foreground">From AROMAZEN HR · {batch && monthLabel(batch.payroll_month)}</p></div></div>{Boolean(batch?.duplicate_email_count) && <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300">{batch?.duplicate_email_count} duplicate email {batch?.duplicate_email_count === 1 ? 'entry' : 'entries'} found. Each employee row will still be sent separately.</div>}<div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button><Button disabled={busy !== null} onClick={() => void sendAll()}><Send className="mr-2 h-4 w-4" />Confirm & send</Button></div></div></div>}
  </main></AppLayout>
}
