'use client'

import { useMemo, useState } from 'react'
import { Download, Eye, FileText, LoaderCircle, Plus, Printer, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'

type ScoreRow = { parameter: string; weight: string; score: string; comments: string }

const INITIAL_ROWS: ScoreRow[] = [
  { parameter: 'Communication skills', weight: '', score: '', comments: '' },
  { parameter: 'Relevant work experience', weight: '', score: '', comments: '' },
  { parameter: 'Technical / functional knowledge', weight: '', score: '', comments: '' },
  { parameter: 'Problem solving and judgement', weight: '', score: '', comments: '' },
  { parameter: 'Culture and role fit', weight: '', score: '', comments: '' },
]

const FIELD_DEFINITIONS = [
  { key: 'candidate', label: 'Candidate name' },
  { key: 'role', label: 'Position' },
  { key: 'department', label: 'Department' },
  { key: 'date', label: 'Interview date', type: 'date' },
  { key: 'interviewer', label: 'Interviewer(s)' },
  { key: 'round', label: 'Interview round' },
  { key: 'present_salary', label: 'Present salary' },
  { key: 'expected_salary', label: 'Expected salary' },
  { key: 'work_experience', label: 'Work experience (if any)', placeholder: 'Example: 3 years 6 months' },
  { key: 'source_reference', label: 'Source / Reference', placeholder: 'How did the candidate hear about this opening?' },
] as const

export function HrInterviewTool() {
  const { accessToken } = useAuth()
  const { notify } = useToast()
  const [fields, setFields] = useState<Record<string, string>>({ date: new Date().toISOString().slice(0, 10), recommendation: 'Hire', summary: '' })
  const [rows, setRows] = useState<ScoreRow[]>(INITIAL_ROWS)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const completed = useMemo(() => FIELD_DEFINITIONS.filter((field) => fields[field.key]?.trim()).length, [fields])

  function invalidatePreview() {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
  }

  function changeField(key: string, value: string) {
    setFields((current) => ({ ...current, [key]: value }))
    invalidatePreview()
  }

  function changeRow(index: number, key: keyof ScoreRow, value: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
    invalidatePreview()
  }

  async function reviewPdf() {
    if (!accessToken) return
    setBusy(true)
    try {
      const response = await fetch('/api/v1/hr-letters/interview-preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, rows }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail ?? 'Unable to generate the interview checklist.')
      }
      const url = URL.createObjectURL(await response.blob())
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return url
      })
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Unable to generate the interview checklist.')
    } finally {
      setBusy(false)
    }
  }

  function downloadPdf() {
    if (!previewUrl) return
    const link = document.createElement('a')
    link.href = previewUrl
    link.download = `interview-checklist-${fields.candidate || 'candidate'}.pdf`
    link.click()
  }

  function printPdf() {
    const frame = document.getElementById('interview-checklist-preview') as HTMLIFrameElement | null
    frame?.contentWindow?.focus()
    frame?.contentWindow?.print()
  }

  return <main className="space-y-5 p-4 md:p-6">
    <PageHeader title="Interview Parameter Checklist" description="Record candidate details and interview scores, review the branded checklist, then download or print the PDF." />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(440px,.9fr)]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 1 · Candidate details</p><h2 className="mt-1 font-semibold">Interview information</h2><p className="mt-1 text-xs text-muted-foreground">{completed} of {FIELD_DEFINITIONS.length} details completed</p></div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">HR checklist</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {FIELD_DEFINITIONS.map((field) => <label key={field.key}><span className="mb-1.5 block text-xs text-muted-foreground">{field.label}</span><input type={'type' in field ? field.type : 'text'} value={fields[field.key] ?? ''} placeholder={'placeholder' in field ? field.placeholder : undefined} onChange={(event) => changeField(field.key, event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label>)}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
          <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 2 · Evaluation</p><h2 className="mt-1 font-semibold">Parameter scorecard</h2></div><Button variant="outline" onClick={() => { setRows((current) => [...current, { parameter: '', weight: '', score: '', comments: '' }]); invalidatePreview() }}><Plus className="mr-2 h-4 w-4" />Add parameter</Button></div>
          <div className="mt-4 space-y-3">{rows.map((row, index) => <div key={index} className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-2 xl:grid-cols-[1.2fr_.55fr_.55fr_1.5fr_auto]">
            <label><span className="mb-1 block text-[11px] text-muted-foreground">Parameter</span><input value={row.parameter} onChange={(event) => changeRow(index, 'parameter', event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm" /></label>
            <label><span className="mb-1 block text-[11px] text-muted-foreground">Weight %</span><input type="number" min="0" max="100" value={row.weight} onChange={(event) => changeRow(index, 'weight', event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm" /></label>
            <label><span className="mb-1 block text-[11px] text-muted-foreground">Score / 5</span><input type="number" min="0" max="5" step="0.5" value={row.score} onChange={(event) => changeRow(index, 'score', event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm" /></label>
            <label><span className="mb-1 block text-[11px] text-muted-foreground">Evidence / comments</span><input value={row.comments} onChange={(event) => changeRow(index, 'comments', event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm" /></label>
            <button type="button" aria-label="Remove parameter" onClick={() => { setRows((current) => current.filter((_, rowIndex) => rowIndex !== index)); invalidatePreview() }} className="self-end p-2 text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>)}</div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
          <p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 3 · Decision</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2"><label><span className="mb-1.5 block text-xs text-muted-foreground">Final recommendation</span><select value={fields.recommendation} onChange={(event) => changeField('recommendation', event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"><option>Strong hire</option><option>Hire</option><option>Hold</option><option>No hire</option></select></label><label className="md:col-span-2"><span className="mb-1.5 block text-xs text-muted-foreground">Overall comments</span><textarea rows={4} value={fields.summary} onChange={(event) => changeField('summary', event.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></label></div>
          <div className="mt-5 flex justify-end"><Button onClick={() => void reviewPdf()} disabled={busy}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}{busy ? 'Preparing PDF' : 'Review branded PDF'}</Button></div>
        </section>
      </div>

      <section className="sticky top-4 h-fit overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Final document</p><h2 className="mt-1 font-semibold">Aromazen PDF preview</h2></div>{previewUrl && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={downloadPdf}><Download className="mr-1.5 h-4 w-4" />Download PDF</Button><Button size="sm" onClick={printPdf}><Printer className="mr-1.5 h-4 w-4" />Print</Button></div>}</div>
        {previewUrl ? <iframe id="interview-checklist-preview" title="Interview checklist preview" src={previewUrl} className="h-[76vh] w-full bg-white" /> : <div className="grid h-[66vh] place-items-center p-8 text-center"><div><FileText className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-3 font-medium">The branded checklist appears here</p><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Complete the checklist and select Review branded PDF. The official logo and company address are added automatically.</p></div></div>}
      </section>
    </div>
  </main>
}