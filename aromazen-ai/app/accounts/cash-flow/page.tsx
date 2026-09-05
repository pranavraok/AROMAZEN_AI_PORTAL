'use client'

import { InfoTip } from '@/components/ui/info-tip'

import { useRef, useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, FileText, History, LoaderCircle, ShieldCheck, WalletCards } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import { ApiError } from '@/lib/api/client'

type Key = 'bob' | 'axis' | 'indusind' | 'cashFlow' | 'fixedAssets'
const details: Array<{ key: Key; label: string; note: string; accept: string; required: boolean }> = [
  { key: 'bob', label: 'Bank of Baroda', note: 'Statement PDF', accept: '.pdf', required: true },
  { key: 'axis', label: 'Axis Bank', note: 'Statement PDF', accept: '.pdf', required: true },
  { key: 'indusind', label: 'IndusInd Bank', note: 'Statement PDF', accept: '.pdf', required: true },
  { key: 'cashFlow', label: 'Monthly cash flow', note: 'Six-sheet Excel', accept: '.xlsx,.xlsm', required: true },
  { key: 'fixedAssets', label: 'Fixed assets', note: 'Optional Excel', accept: '.xlsx,.xlsm', required: false },
]

function save(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }

export default function CashFlowPage() {
  const { accessToken, user, hasPermission } = useAuth(); const { notify } = useToast()
  const refs = useRef<Partial<Record<Key, HTMLInputElement | null>>>({})
  const [files, setFiles] = useState<Partial<Record<Key, File>>>({})
  const [includePreviousComparison, setIncludePreviousComparison] = useState(false)
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
  const [password, setPassword] = useState(() => { const [year, value] = month.split('-'); const label = new Date(Number(year), Number(value) - 1).toLocaleString('en', { month: 'short' }); return `AromaZen#${label}${year}` }); const [busy, setBusy] = useState<string | null>(null)
  const canUse = hasPermission('users.manage') && (user?.role_names.some((role) => role === 'Admin' || role === 'Super Admin') || user?.department_name === 'Accounts' && user?.role_names.includes('Department Admin'))
  const complete = details.filter((item) => item.required).every((item) => files[item.key]) && month && password.length >= 8
  const uploadedCount = details.filter((item) => files[item.key]).length

  async function template(kind: 'cash' | 'assets') { if (!accessToken) return; setBusy(kind); try { const file = kind === 'cash' ? await api.cashFlow.cashFlowTemplate(accessToken) : await api.cashFlow.fixedAssetsTemplate(accessToken); save(file.blob, file.filename) } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to download the template.') } finally { setBusy(null) } }
  async function generate() {
    if (!accessToken || !complete) return; setBusy('generate')
    try {
      const file = await api.cashFlow.generate(accessToken, { reportMonth: month, password, bob: files.bob!, axis: files.axis!, indusind: files.indusind!, cashFlow: files.cashFlow!, fixedAssets: files.fixedAssets, includePreviousComparison })
      save(file.blob, file.filename); notify('success', 'Protected PDF generated and downloaded. The uploaded source files were not stored in the Knowledge Base.')
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to generate the cash-flow PDF.') } finally { setBusy(null) }
  }
  if (!canUse) return <AppLayout><main className="grid min-h-[70vh] place-items-center p-6 text-center"><div><ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" /><h1 className="mt-3 text-xl font-semibold">Accounts administrator access required</h1></div></main></AppLayout>
  return <AppLayout><main className="mx-auto w-full max-w-6xl space-y-5 p-5 md:p-6">
    <PageHeader title="Monthly Cash Flow" description="Generate and download the protected monthly PDF." actions={<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy !== null} onClick={() => void template('cash')}><Download className="mr-1 h-4 w-4" />Cash-flow template</Button><Button variant="outline" disabled={busy !== null} onClick={() => void template('assets')}><Download className="mr-1 h-4 w-4" />Asset template</Button></div>} />

    <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 lg:grid-cols-[1fr_1fr_1.25fr]">
      <label><span className="mb-1.5 block text-xs font-medium text-muted-foreground">REPORT MONTH</span><input type="month" value={month} onChange={(e) => { setMonth(e.target.value); const [year,value] = e.target.value.split('-'); setPassword(`AromaZen#${new Date(Number(year),Number(value)-1).toLocaleString('en',{month:'short'})}${year}`) }} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label>
      <label><span className="mb-1.5 block text-xs font-medium text-muted-foreground">PDF PASSWORD</span><PasswordInput value={password} minLength={8} onChange={(e) => setPassword(e.target.value)} containerClassName="w-full" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary/40" /></label>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-background px-4 py-2.5"><input type="checkbox" checked={includePreviousComparison} onChange={(event) => setIncludePreviousComparison(event.target.checked)} className="h-5 w-5 accent-primary" /><History className="h-5 w-5 shrink-0 text-primary" /><span className="min-w-0"><span className="block text-sm font-semibold">Previous-month comparison</span><span className="block truncate text-xs text-muted-foreground">Adds comparison and AI insights</span></span></label>
    </section>

    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold">Upload monthly files</h2><p className="mt-1 text-xs text-muted-foreground">Three bank PDFs and the cash-flow Excel are required.</p></div><span className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">{uploadedCount}/5 uploaded</span></div>
      <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-5">{details.map((item) => <div key={item.key} className="bg-card p-4"><div className="flex items-center gap-2.5">{item.accept === '.pdf' ? <FileText className="h-5 w-5 shrink-0 text-red-400" /> : <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-400" />}<div className="min-w-0"><p className="truncate text-sm font-semibold">{item.label}</p><p className="text-xs text-muted-foreground">{item.note}</p></div></div><Button className="mt-4 w-full" variant={files[item.key] ? 'secondary' : 'outline'} onClick={() => refs.current[item.key]?.click()}>{files[item.key] ? <><CheckCircle2 className="mr-1 h-4 w-4 text-emerald-500" /><span className="truncate">{files[item.key]!.name}</span></> : item.required ? 'Choose file' : 'Add if needed'}</Button><input ref={(node) => { refs.current[item.key] = node }} hidden type="file" accept={item.accept} onChange={(e) => setFiles((current) => ({ ...current, [item.key]: e.target.files?.[0] }))} /></div>)}</div>
      <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /><InfoTip label="Report validation">Files are validated and totals are reconciled before the PDF is created.</InfoTip></div>
    </section>

    <section className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-primary/[0.04] p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><WalletCards className="h-5 w-5" /></span><div><p className="font-semibold">Protected cash-flow PDF</p><InfoTip label="Report download and storage">Downloads immediately; source files and the generated report are not added to the Knowledge Base.</InfoTip></div></div><Button disabled={!complete || busy !== null} onClick={() => void generate()}>{busy === 'generate' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{busy === 'generate' ? 'Generating PDF' : 'Generate & download'}</Button></section>
  </main></AppLayout>
}
