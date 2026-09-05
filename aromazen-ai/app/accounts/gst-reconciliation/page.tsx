'use client'

import { InfoTip } from '@/components/ui/info-tip'

import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, GitCompareArrows, LoaderCircle, RotateCcw } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { GstReconciliationResult, GstReconciliationRow, GstReconciliationStatus } from '@/lib/api/types'

const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
const statusLabels: Record<GstReconciliationStatus, string> = { matched: 'Matched', mismatch: 'Mismatch', books_only: 'Tally only', portal_only: 'Portal only', incomplete_books: 'Incomplete Tally row', duplicate: 'Duplicate' }
const statusClasses: Record<GstReconciliationStatus, string> = { matched: 'bg-emerald-500/10 text-emerald-600', mismatch: 'bg-red-500/10 text-red-600', books_only: 'bg-amber-500/10 text-amber-600', portal_only: 'bg-blue-500/10 text-blue-600', incomplete_books: 'bg-orange-500/10 text-orange-600', duplicate: 'bg-purple-500/10 text-purple-600' }

function FileInput({ label, hint, file, onChange }: { label: string; hint: string; file: File | null; onChange: (file: File | null) => void }) {
  return <label className="group flex min-h-32 cursor-pointer flex-col justify-between rounded-2xl border border-dashed border-border bg-card p-4 transition hover:border-primary/50 hover:bg-primary/[0.02]">
    <input className="sr-only" type="file" accept=".xlsx,.xlsm" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    <span className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FileSpreadsheet className="h-5 w-5" /></span><span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{hint}</span></span></span>
    <span className={`mt-3 truncate rounded-lg px-3 py-2 text-xs ${file ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>{file?.name ?? 'Choose Excel file'}</span>
  </label>
}

function csvCell(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"` }

export default function GstReconciliationPage() {
  const { accessToken } = useAuth()
  const [purchase, setPurchase] = useState<File | null>(null)
  const [journal, setJournal] = useState<File | null>(null)
  const [portal, setPortal] = useState<File | null>(null)
  const [result, setResult] = useState<GstReconciliationResult | null>(null)
  const [filter, setFilter] = useState<'issues' | GstReconciliationStatus>('issues')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const filteredRows = useMemo(() => {
    if (!result) return []
    const query = search.trim().toLowerCase()
    return result.rows.filter((row) => (filter === 'issues' ? row.status !== 'matched' : row.status === filter) && (!query || [row.supplier, row.gstin, row.invoice_number, row.books_source, ...row.issues].join(' ').toLowerCase().includes(query)))
  }, [filter, result, search])

  async function analyze() {
    if (!accessToken || !purchase || !journal || !portal) return
    setBusy(true); setError(''); setResult(null)
    try { setResult(await api.gstReconciliation.analyze(accessToken, { purchaseRegister: purchase, journalRegister: journal, gstr2bPortal: portal })) }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : 'The files could not be reconciled. Please try again.') }
    finally { setBusy(false) }
  }

  function downloadCsv() {
    if (!result) return
    const headers = ['Status', 'Issues', 'Supplier', 'GSTIN', 'Invoice number', 'Tally source', 'Tally row', 'Tally date', 'Portal date', 'Tally invoice value', 'Portal invoice value', 'Difference', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess', 'ITC availability', 'Portal reason']
    const rows = filteredRows.map((row) => [statusLabels[row.status], row.issues.join('; '), row.supplier, row.gstin, row.invoice_number, row.books_source, row.books_row, row.books_date, row.portal_date, row.books_invoice_value, row.portal_invoice_value, row.difference, row.portal_taxable_value, row.igst, row.cgst, row.sgst, row.cess, row.itc_availability, row.portal_reason])
    const blob = new Blob([[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `GST_Reconciliation_${result.period.replaceAll(' ', '_')}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }

  function reset() { setPurchase(null); setJournal(null); setPortal(null); setResult(null); setError(''); setSearch(''); setFilter('issues') }

  return <AppLayout><div className="mx-auto max-w-[1500px] space-y-6 p-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-primary">Accounts team</p><h1 className="mt-2 text-2xl font-semibold tracking-[-.035em] md:text-3xl">GST Reconciliation</h1><InfoTip label="Required reconciliation files">Upload the two Tally registers and the monthly GSTR-2B portal Excel. No values are estimated.</InfoTip></div>{result ? <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" />New check</Button> : null}</header>
    {!result ? <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="grid gap-4 lg:grid-cols-3"><FileInput label="Tally Purchase Register" hint="Purchase Register exported from Tally" file={purchase} onChange={setPurchase} /><FileInput label="Tally Journal Register" hint="Journal Register exported from Tally" file={journal} onChange={setJournal} /><FileInput label="GST Portal GSTR-2B" hint="Original GSTR-2B Excel portal download" file={portal} onChange={setPortal} /></div><div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Matching key: GSTIN + invoice number · amount tolerance: ₹1</p><Button className="sm:min-w-48" disabled={!purchase || !journal || !portal || busy} onClick={() => void analyze()}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <GitCompareArrows className="mr-2 h-4 w-4" />}{busy ? 'Checking invoices…' : 'Run reconciliation'}</Button></div></section> : null}
    {error ? <div role="alert" className="flex gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">Reconciliation stopped</p><p className="mt-1">{error}</p></div></div> : null}
    {result ? <>
      <section className="rounded-2xl border border-border bg-card p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">{result.period}</p><h2 className="mt-1 text-xl font-semibold">{result.company_name || 'GST reconciliation result'}</h2><p className="mt-1 text-xs text-muted-foreground">GSTIN {result.company_gstin || '—'}</p></div><div className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" />Check completed</div></div></section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{[
        ['Matched', result.summary.matched, 'text-emerald-600'], ['Mismatch', result.summary.mismatched, 'text-red-600'], ['Tally only', result.summary.books_only, 'text-amber-600'], ['Portal only', result.summary.portal_only, 'text-blue-600'], ['Incomplete', result.summary.incomplete_books, 'text-orange-600'], ['Duplicates', result.summary.duplicates, 'text-purple-600'],
      ].map(([label, value, tone]) => <div key={String(label)} className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p></div>)}</section>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Tally invoice value</p><p className="mt-1 font-semibold">{money(result.summary.book_invoice_value)}</p></div><div className="rounded-xl bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Portal invoice value</p><p className="mt-1 font-semibold">{money(result.summary.portal_invoice_value)}</p></div><div className="rounded-xl bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Portal credit/debit notes</p><p className="mt-1 font-semibold">{result.summary.portal_credit_notes}</p></div><div className="rounded-xl bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Portal import records</p><p className="mt-1 font-semibold">{result.summary.portal_imports}</p></div></section>
      {result.warnings.length ? <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs text-amber-800"><ul className="space-y-1">{result.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></div> : null}
      <section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap gap-2">{(['issues', 'mismatch', 'books_only', 'portal_only', 'incomplete_books', 'duplicate', 'matched'] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-medium transition ${filter === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{value === 'issues' ? 'All issues' : statusLabels[value]}</button>)}</div><div className="flex gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search supplier, GSTIN or invoice" className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary sm:w-72" /><Button size="sm" variant="outline" onClick={downloadCsv}><Download className="mr-1 h-4 w-4" />Download CSV</Button></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-xs"><thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Supplier / GSTIN</th><th className="px-4 py-3 font-medium">Invoice</th><th className="px-4 py-3 font-medium">Tally</th><th className="px-4 py-3 font-medium">GSTR-2B</th><th className="px-4 py-3 font-medium">Difference</th><th className="px-4 py-3 font-medium">Reason</th></tr></thead><tbody>{filteredRows.map((row: GstReconciliationRow) => <tr key={row.id} className="border-t border-border align-top"><td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 font-semibold ${statusClasses[row.status]}`}>{statusLabels[row.status]}</span></td><td className="px-4 py-3"><p className="max-w-56 font-medium">{row.supplier || '—'}</p><p className="mt-1 text-muted-foreground">{row.gstin || 'GSTIN missing'}</p></td><td className="px-4 py-3"><p className="font-medium">{row.invoice_number || 'Missing'}</p><p className="mt-1 text-muted-foreground">Tally {row.books_date || '—'} · Portal {row.portal_date || '—'}</p></td><td className="px-4 py-3"><p className="font-medium">{money(row.books_invoice_value)}</p><p className="mt-1 text-muted-foreground">{row.books_source || 'Not found'}{row.books_row ? ` · row ${row.books_row}` : ''}</p></td><td className="px-4 py-3"><p className="font-medium">{money(row.portal_invoice_value)}</p><p className="mt-1 text-muted-foreground">Taxable {money(row.portal_taxable_value)}</p></td><td className={`px-4 py-3 font-semibold ${row.difference && Math.abs(row.difference) > result.amount_tolerance ? 'text-red-600' : ''}`}>{money(row.difference)}</td><td className="max-w-72 px-4 py-3"><p>{row.issues.join(' · ') || 'No mismatch'}</p>{row.portal_reason ? <p className="mt-1 text-muted-foreground">Portal: {row.portal_reason}</p> : null}</td></tr>)}{filteredRows.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No records in this view.</td></tr> : null}</tbody></table></div>
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Showing {filteredRows.length.toLocaleString('en-IN')} records</div>
      </section>
    </> : null}
  </div></AppLayout>
}
