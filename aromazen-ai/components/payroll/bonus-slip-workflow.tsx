'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ExternalLink, Eye, FileSpreadsheet, FileText, LoaderCircle, RefreshCw, Send, Upload, X, XCircle } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { DocumentViewerModal } from '@/components/ui/document-viewer'
import { api } from '@/lib/api/services'
import type { PayrollBatch, PayrollRecipient, PayrollTemplate } from '@/lib/api/types'
import { ApiError } from '@/lib/api/client'
import { canvaEditUrlForBonusSlip } from '@/lib/template-canva-links'
import { parseEmailList } from '@/lib/email-recipients'

function currentAccountingYear() {
  const today = new Date()
  const start = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
  return `${start}-${start + 1}`
}
function accountingYear(value: string) { const year = Number(value.slice(0, 4)); return `${year}-${year + 1}` }
function money(value: string | number) { const amount = Number(value); return Number.isFinite(amount) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount) : String(value) }
function tone(status: string) { return status === 'sent' || status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : status === 'failed' ? 'bg-red-500/10 text-red-400' : status === 'partial' ? 'bg-amber-500/10 text-amber-400' : status === 'sending' ? 'bg-blue-500/10 text-blue-400' : 'bg-muted text-muted-foreground' }
function statusIcon(status: string) { return status === 'sent' ? <CheckCircle2 className="h-3.5 w-3.5" /> : status === 'failed' ? <XCircle className="h-3.5 w-3.5" /> : status === 'sending' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null }

export function BonusSlipWorkflow() {
  const { accessToken, hasPermission } = useAuth()
  const { notify } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [year, setYear] = useState(currentAccountingYear)
  const [excel, setExcel] = useState<File | null>(null)
  const [templates, setTemplates] = useState<PayrollTemplate[]>([])
  const [history, setHistory] = useState<PayrollBatch[]>([])
  const [batch, setBatch] = useState<PayrollBatch | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [cc, setCc] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'upload' | 'save' | 'send' | 'retry' | null>(null)
  const [replacingTemplate, setReplacingTemplate] = useState(false)
  const [viewing, setViewing] = useState<{ blob: Blob; filename: string; title: string } | null>(null)
  const template = templates[0] ?? null
  const recipients = useMemo(() => batch?.recipients ?? [], [batch?.recipients])
  const ccEmails = useMemo(() => parseEmailList(cc), [cc])
  const finished = (batch?.sent_count ?? 0) + (batch?.failed_count ?? 0)
  const progress = batch?.total_count ? Math.round((finished / batch.total_count) * 100) : 0
  const totalBonus = useMemo(() => recipients.reduce((sum, item) => sum + Number(item.bonus_amount || 0), 0), [recipients])

  const loadPage = useCallback(async () => {
    if (!accessToken) return
    try { const [nextTemplates, batches] = await Promise.all([api.payroll.bonusTemplates(accessToken), api.payroll.bonusBatches(accessToken)]); setTemplates(nextTemplates); setHistory(batches) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to load bonus slips.') }
  }, [accessToken, notify])

  const refreshBatch = useCallback(async (id: string, quiet = false) => {
    if (!accessToken) return
    try {
      const next = await api.payroll.batch(accessToken, id)
      setBatch(next); setSubject(next.email_subject); setBody(next.email_body); setCc((next.cc_emails ?? []).join(', '))
      setHistory((items) => items.map((item) => item.id === next.id ? { ...next, recipients: undefined } : item))
    } catch (error) { if (!quiet) notify('error', error instanceof ApiError ? error.message : 'Unable to refresh delivery.') }
  }, [accessToken, notify])

  useEffect(() => { void loadPage() }, [loadPage])
  useEffect(() => {
    if (!batch || batch.status !== 'sending') return
    const timer = window.setInterval(() => void refreshBatch(batch.id, true), 2000)
    return () => window.clearInterval(timer)
  }, [batch, refreshBatch])

  async function viewTemplate(item: PayrollTemplate) {
    if (!accessToken) return
    try { const result = await api.payroll.bonusTemplateContent(accessToken, item.id); setViewing({ blob: result.blob, filename: result.filename, title: 'Bonus-slip template' }) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to open the bonus-slip template.') }
  }
  async function replaceTemplate(file: File | null) {
    if (!accessToken || !file) return
    setReplacingTemplate(true)
    try { const next = await api.payroll.uploadBonusTemplate(accessToken, file); setTemplates([next]); notify('success', 'The bonus-slip master is active and saved in Human Resources Knowledge.') }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to replace the bonus-slip template.') }
    finally { setReplacingTemplate(false) }
  }
  async function prepare() {
    if (!accessToken || !excel || !year) return
    setBusy('upload')
    try { const next = await api.payroll.uploadBonus(accessToken, year, excel); setBatch(next); setSubject(next.email_subject); setBody(next.email_body); setCc((next.cc_emails ?? []).join(', ')); setHistory((items) => [{ ...next, recipients: undefined }, ...items]); notify('success', `${next.total_count} bonus slips are ready for review.`) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to prepare bonus slips.') }
    finally { setBusy(null) }
  }
  async function saveEmail(quiet = false) {
    if (!accessToken || !batch) return null
    setBusy('save')
    try { const next = await api.payroll.updateEmail(accessToken, batch.id, subject, body, ccEmails); setBatch(next); if (!quiet) notify('success', 'Email draft saved.'); return next }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to save email draft.'); return null }
    finally { setBusy(null) }
  }
  async function sendAll() {
    if (!accessToken || !batch) return
    const saved = await saveEmail(true); if (!saved) return
    setConfirming(false); setBusy('send')
    try { setBatch(await api.payroll.send(accessToken, batch.id)); notify('success', 'Bonus-slip delivery started.') }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to start delivery.') }
    finally { setBusy(null) }
  }
  async function retryFailed() {
    if (!accessToken || !batch) return
    const saved = await saveEmail(true); if (!saved) return
    setBusy('retry')
    try { setBatch(await api.payroll.retryFailed(accessToken, saved.id)); notify('success', 'Retry started.') }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to retry failed emails.') }
    finally { setBusy(null) }
  }
  async function viewSlip(item: PayrollRecipient) {
    if (!accessToken || !batch) return
    try { const result = await api.payroll.pdf(accessToken, batch.id, item.id); setViewing({ blob: result.blob, filename: result.filename, title: `Bonus slip · ${item.employee_name} · ${accountingYear(batch.payroll_month)}` }) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to open bonus slip.') }
  }

  return <div className="space-y-4">
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-primary" /><p className="truncate text-sm font-medium">{template?.original_filename ?? 'Bonus slip master required'}</p>{template ? <Check className="size-4 shrink-0 text-emerald-400" /> : <X className="size-4 shrink-0 text-red-400" />}<InfoTip label="Bonus slip master details">The approved Form C Canva master uses visible {'{{FIELD_NAME}}'} placeholders. Unit 1, 2 or 3 from Excel automatically supplies the approved unit address.</InfoTip></div><div className="flex shrink-0 flex-wrap gap-2">{template && <Button size="sm" variant="outline" onClick={() => void viewTemplate(template)}><Eye className="mr-1.5 h-4 w-4" />View</Button>}{hasPermission('knowledge.write') && <><Button size="sm" variant="outline" onClick={() => window.open(canvaEditUrlForBonusSlip(), '_blank', 'noopener,noreferrer')}><ExternalLink className="mr-1.5 h-4 w-4" />Canva</Button><label className={buttonVariants({ size: 'sm', variant: 'outline' })}><input hidden type="file" accept=".pdf,application/pdf" disabled={replacingTemplate} onChange={(event) => { void replaceTemplate(event.target.files?.[0] ?? null); event.target.value = '' }} />{replacingTemplate ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}{replacingTemplate ? 'Mapping' : 'Replace'}</label></>}</div></section>
    <section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="grid gap-3 md:grid-cols-[12rem_1fr_auto]"><label className="space-y-1.5"><span className="text-xs text-muted-foreground">Accounting year</span><input value={year} onChange={(event) => setYear(event.target.value)} placeholder="2026-2027" pattern="\d{4}-\d{4}" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><label className="space-y-1.5"><span className="text-xs text-muted-foreground">Bonus Excel</span><button type="button" onClick={() => inputRef.current?.click()} className="flex h-11 w-full items-center rounded-xl border border-dashed border-border bg-background px-3 text-left text-sm hover:border-primary/50"><FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-400" /><span className="truncate">{excel?.name ?? 'Choose .xlsx file'}</span></button><input ref={inputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setExcel(event.target.files?.[0] ?? null)} /></label><Button className="self-end" disabled={!excel || !/^\d{4}-\d{4}$/.test(year) || !template || busy !== null} onClick={() => void prepare()}>{busy === 'upload' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{busy === 'upload' ? 'Preparing' : 'Prepare & review'}</Button></div></section>
    {batch && <>
      <details className="rounded-2xl border border-border bg-card"><summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium">Email message <InfoTip label="Email message help">Use {'{employee_name}'} and {'{period}'} in the message. The fixed HR signature and AROMAZEN logo are added automatically.</InfoTip></summary><div className="border-t border-border p-4 md:p-5"><div className="mb-3 flex items-center justify-end"><Button size="sm" variant="outline" disabled={busy !== null || batch.status === 'sending'} onClick={() => void saveEmail()}>{busy === 'save' ? 'Saving' : 'Save changes'}</Button></div><label className="mb-3 block"><span className="mb-1.5 block text-xs text-muted-foreground">CC <span className="font-normal">(optional)</span></span><input type="text" inputMode="email" value={cc} onChange={(event) => setCc(event.target.value)} placeholder="Separate multiple emails with commas" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><input value={subject} maxLength={240} onChange={(event) => setSubject(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" aria-label="Email subject" /><textarea value={body} maxLength={8000} onChange={(event) => setBody(event.target.value)} rows={7} className="mt-3 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-6" aria-label="Email body" /></div></details>
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-semibold">Accounting year {accountingYear(batch.payroll_month)}</h2><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs capitalize ${tone(batch.status)}`}>{statusIcon(batch.status)}{batch.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{batch.total_count} employees · {money(totalBonus)} total bonus</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void refreshBatch(batch.id)}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>{batch.failed_count > 0 && batch.status !== 'sending' && <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void retryFailed()}>Retry {batch.failed_count}</Button>}{batch.pending_count > 0 && batch.status !== 'sending' && <Button size="sm" disabled={busy !== null || !subject.trim() || !body.trim()} onClick={() => setConfirming(true)}><Send className="mr-1.5 h-4 w-4" />Send {batch.pending_count}</Button>}</div></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${progress}%` }} /></div><div className="mt-3 grid grid-cols-4 gap-2 text-center">{[['Total', batch.total_count], ['Pending', batch.pending_count], ['Sent', batch.sent_count], ['Failed', batch.failed_count]].map(([label, value]) => <div key={label} className="rounded-xl bg-muted/50 p-2"><p className="text-lg font-semibold tabular-nums">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>)}</div><details open className="mt-4 rounded-xl border border-border"><summary className="flex cursor-pointer list-none items-center justify-between p-3 text-sm font-medium">Employee review <ChevronDown className="h-4 w-4" /></summary><div className="max-h-[28rem] overflow-auto border-t border-border"><table className="w-full min-w-[1040px] text-sm"><thead className="sticky top-0 bg-card text-xs text-muted-foreground"><tr><th className="p-3 text-left">Employee</th><th className="p-3 text-left">Unit</th><th className="p-3 text-left">Email</th><th className="p-3 text-left">Account / transaction</th><th className="p-3 text-left">Payment date</th><th className="p-3 text-right">Bonus</th><th className="p-3 text-left">Status</th><th /></tr></thead><tbody>{recipients.map((item) => <tr key={item.id} className="border-t border-border"><td className="p-3"><p className="font-medium">{item.employee_name}</p><p className="text-xs text-muted-foreground">{item.employee_code}</p></td><td className="p-3">Unit {item.unit}</td><td className="p-3">{item.personal_email}</td><td className="p-3"><p>{item.account_number}</p><p className="text-xs text-muted-foreground">{item.transaction_id}</p></td><td className="p-3">{item.payment_date}</td><td className="p-3 text-right font-medium">{money(item.bonus_amount)}</td><td className="p-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs capitalize ${tone(item.status)}`}>{statusIcon(item.status)}{item.status}</span>{item.error_message && <p className="mt-1 max-w-xs text-xs text-red-400">{item.error_message}</p>}</td><td className="p-3 text-right"><Button size="sm" variant="ghost" onClick={() => void viewSlip(item)} aria-label={`Preview bonus slip for ${item.employee_name}`}><Eye className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div></details></section>
    </>}
    <details className="rounded-2xl border border-border bg-card"><summary className="cursor-pointer p-4 text-sm font-medium">Previous bonus batches <span className="ml-1 text-xs font-normal text-muted-foreground">{history.length}</span></summary><div className="border-t border-border p-4">{history.length === 0 ? <p className="text-sm text-muted-foreground">No bonus batches yet.</p> : <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{history.map((item) => <button key={item.id} type="button" onClick={() => void refreshBatch(item.id)} className="flex items-center justify-between rounded-xl border border-border p-3 text-left hover:bg-muted/40"><div><p className="font-medium">{accountingYear(item.payroll_month)}</p><p className="text-xs text-muted-foreground">{item.sent_count} sent · {item.failed_count} failed</p></div><span className={`rounded-full px-2 py-1 text-[11px] capitalize ${tone(item.status)}`}>{item.status}</span></button>)}</div>}</div></details>
    {confirming && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Confirm bonus slip delivery"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"><div className="flex items-start gap-3"><span className="rounded-xl bg-amber-500/10 p-2 text-amber-400"><AlertTriangle className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold">Send {batch?.pending_count} bonus slips?</h2><p className="mt-1 text-sm text-muted-foreground">Each employee receives their password-protected PDF at their personal email.</p></div></div>{ccEmails.length > 0 && <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300"><p className="font-medium">CC on every bonus slip</p><p className="mt-1 break-words text-xs">{ccEmails.join(', ')}</p></div>}{Boolean(batch?.duplicate_email_count) && <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300">{batch?.duplicate_email_count} duplicate email {batch?.duplicate_email_count === 1 ? 'entry' : 'entries'} found. Each employee row will still be sent separately.</div>}<div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button><Button disabled={busy !== null} onClick={() => void sendAll()}><Send className="mr-2 h-4 w-4" />Confirm & send</Button></div></div></div>}
    <DocumentViewerModal file={viewing} onClose={() => setViewing(null)} />
  </div>
}
