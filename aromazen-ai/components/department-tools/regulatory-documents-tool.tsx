'use client'

import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, Eye, FileSpreadsheet, FileText, LoaderCircle, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { VoiceInputButton } from '@/components/voice-input-button'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { RegulatoryDocumentType, RegulatoryIngredient, RegulatoryTemplate, RegulatoryWorkflow } from '@/lib/api/types'

const DOCUMENTS: { key: RegulatoryDocumentType; title: string; note: string }[] = [
  { key: 'sds', title: 'Safety Data Sheet (SDS)', note: 'Review and approve first' },
  { key: 'ifra_certificate', title: 'IFRA Certificate', note: 'Uses approved SDS and IFRA master limits' },
  { key: 'ifra_amendment', title: 'IFRA Amendment', note: 'Maps approved ingredients' },
  { key: 'allergen_report', title: 'Allergen Report', note: 'Maps allergens and concentrations' },
  { key: 'reach_declaration', title: 'REACH Declaration', note: 'Europe / EU only' },
]
const PROPERTIES = [
  ['appearance', 'Appearance'], ['colour', 'Colour'], ['odour', 'Odour'], ['relative_density', 'Specific gravity / density'],
  ['flash_point', 'Flash point'], ['refractive_index', 'Refractive index'], ['solubility', 'Solubility'],
  ['storage_condition', 'Storage condition'], ['signal_word', 'Signal word'], ['hazard_statements', 'Hazard statements'],
  ['precautionary_statements', 'Precautionary statements'], ['other_hazards', 'Other hazards'],
] as const
const DETAILS: { key: keyof RegulatoryIngredient; label: string }[] = [
  { key: 'hazard_statements', label: 'H-statements' }, { key: 'precautionary_statements', label: 'P-statements' },
  { key: 'signal_word', label: 'Signal word' }, { key: 'pictograms', label: 'Pictograms' },
  { key: 'toxicology', label: 'Toxicology data' }, { key: 'ecology', label: 'Ecological data' },
  { key: 'transport', label: 'Transport classification' }, { key: 'allergen_identity', label: 'Allergen identity' },
  { key: 'svhc_identity', label: 'REACH / SVHC identity' },
]

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a')
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url)
}
function blankIngredient(): RegulatoryIngredient {
  return { name: '', concentration: '', cas: '', ec: '', classification: '', aliases: [], provenance: 'employee_approved', sources: [] }
}

export function RegulatoryDocumentsTool() {
  const { accessToken, hasPermission } = useAuth(); const { notify } = useToast()
  const [templates, setTemplates] = useState<RegulatoryTemplate[]>([])
  const [formula, setFormula] = useState<File | null>(null); const [coa, setCoa] = useState<File | null>(null)
  const [workflow, setWorkflow] = useState<RegulatoryWorkflow | null>(null)
  const [product, setProduct] = useState(''); const [code, setCode] = useState(''); const [market, setMarket] = useState<'other' | 'eu'>('other')
  const [rows, setRows] = useState<RegulatoryIngredient[]>([]); const [properties, setProperties] = useState<Record<string, string>>({}); const [busy, setBusy] = useState('')
  const [voiceNotes, setVoiceNotes] = useState(''); const [liveSpeech, setLiveSpeech] = useState(''); const [isListening, setIsListening] = useState(false); const [voiceStopSignal, setVoiceStopSignal] = useState(0)
  const uploadRefs = useRef<Partial<Record<RegulatoryDocumentType, HTMLInputElement | null>>>({})
  const templateMap = useMemo(() => Object.fromEntries(templates.map((item) => [item.document_type, item])), [templates])
  const payload = { product_name: product, product_code: code, market, sds_fields: properties, ingredients: rows }
  const locked = workflow?.status === 'approved'

  useEffect(() => { if (accessToken) void api.regulatory.templates(accessToken).then(setTemplates).catch(() => undefined) }, [accessToken])
  function applyWorkflow(value: RegulatoryWorkflow) { setWorkflow(value); setProduct(value.product_name); setCode(value.product_code); setMarket(value.market); setProperties(value.sds_fields); setRows(value.ingredients) }
  function errorMessage(error: unknown, fallback: string) { return error instanceof ApiError ? error.message : fallback }
  function updateRow(index: number, key: keyof RegulatoryIngredient, value: string | string[]) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value, provenance: 'employee_approved' } : row)) }

  async function start() {
    if (!accessToken || !formula || !coa) return notify('error', 'Upload both the Regulatory Excel and Creation COA.')
    setBusy('intake')
    try { applyWorkflow(await api.regulatory.createWorkflow(accessToken, formula, coa)); notify('success', 'Files processed. Review the extracted SDS information.') }
    catch (error) { notify('error', errorMessage(error, 'Unable to process the files.')) } finally { setBusy('') }
  }
  async function enrich() {
    if (!accessToken || !workflow) return; setBusy('enrich')
    try { await api.regulatory.updateWorkflow(accessToken, workflow.id, payload); applyWorkflow(await api.regulatory.enrich(accessToken, workflow.id)); notify('success', 'Official-source research completed. Review every suggested value.') }
    catch (error) { notify('error', errorMessage(error, 'Ingredient research is unavailable.')) } finally { setBusy('') }
  }
  async function processRecording(file: File) {
    if (!accessToken) return
    try { const result = await api.documentGenerator.transcribe(accessToken, file); if (result.text.trim()) setVoiceNotes(result.text.trim()) }
    catch (error) { notify('warning', errorMessage(error, 'The full recording check was unavailable. You can still use the visible transcript.')) }
  }
  async function applyVoiceNotes() {
    if (!accessToken || !workflow || !voiceNotes.trim()) return
    setVoiceStopSignal((value) => value + 1); setBusy('voice')
    try { applyWorkflow(await api.regulatory.applyVoiceNotes(accessToken, workflow.id, voiceNotes)); setLiveSpeech(''); notify('success', 'Voice corrections were applied. Review them before approval.') }
    catch (error) { notify('error', errorMessage(error, 'Unable to apply the voice notes.')) } finally { setBusy('') }
  }
  async function approve() {
    if (!accessToken || !workflow) return; setBusy('approve')
    try { const ingredients = rows.map((row) => ({ ...row, provenance: 'employee_approved' as const })); applyWorkflow(await api.regulatory.approve(accessToken, workflow.id, { ...payload, ingredients })); notify('success', 'SDS approved. All applicable documents are unlocked.') }
    catch (error) { notify('error', errorMessage(error, 'Unable to approve the SDS.')) } finally { setBusy('') }
  }
  async function uploadMaster(type: RegulatoryDocumentType, file: File | null) {
    if (!accessToken || !file) return; setBusy(`template-${type}`)
    try { const next = await api.regulatory.uploadTemplate(accessToken, type, file); setTemplates((current) => [...current.filter((item) => item.document_type !== type), next]); notify('success', `${next.name} is now the active master.`) }
    catch (error) { notify('error', errorMessage(error, 'Unable to replace the master.')) } finally { setBusy('') }
  }
  async function viewMaster(type: RegulatoryDocumentType) {
    if (!accessToken) return
    try { const file = await api.regulatory.templateContent(accessToken, type); const url = URL.createObjectURL(file.blob); window.open(url, '_blank', 'noopener,noreferrer'); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }
    catch (error) { notify('error', errorMessage(error, 'Unable to open the master.')) }
  }
  async function generate(type: RegulatoryDocumentType, format: 'preview' | 'pdf' | 'word') {
    if (!accessToken || !workflow) return; setBusy(`${format}-${type}`)
    try {
      let generationId = workflow.generated[type]
      if (!generationId) { const result = await api.regulatory.generate(accessToken, workflow.id, type); generationId = result.id; setWorkflow((current) => current ? { ...current, generated: { ...current.generated, [type]: result.id } } : current) }
      const file = format === 'word' ? await api.regulatory.download(accessToken, generationId) : format === 'pdf' ? await api.regulatory.pdf(accessToken, generationId) : await api.regulatory.preview(accessToken, generationId)
      if (format === 'preview') { const url = URL.createObjectURL(file.blob); window.open(url, '_blank', 'noopener,noreferrer'); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) } else saveBlob(file.blob, file.filename)
    } catch (error) { notify('error', errorMessage(error, 'Unable to generate this document.')) } finally { setBusy('') }
  }

  return <main className="space-y-5 p-4 md:p-6">
    <PageHeader title="Regulatory Affairs · Document Centre" description="Upload Regulatory data and the Creation COA, approve the SDS, then issue the applicable documents." />
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{DOCUMENTS.map((document) => {
      const master = templateMap[document.key]; const unavailable = document.key === 'reach_declaration' && market !== 'eu'; const unlocked = document.key === 'sds' || locked
      return <div key={document.key} className={`rounded-xl border p-4 ${document.key === 'sds' ? 'border-primary bg-primary/5' : unlocked && !unavailable ? 'border-emerald-500/30' : 'border-border'}`}>
        <FileText className="h-5 w-5 text-primary" /><p className="mt-2 text-sm font-semibold">{document.title}</p><p className="mt-1 min-h-8 text-[11px] text-muted-foreground">{unavailable ? 'Select Europe / EU to enable' : document.note}</p><p className="mt-2 truncate text-[11px] text-muted-foreground">{master ? `${master.name} · v${master.version}` : 'Master not available'}</p>
        <div className="mt-3 flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={!master} onClick={() => void viewMaster(document.key)}><Eye className="mr-1 h-3 w-3" />Master</Button>{hasPermission('knowledge.write') ? <><input ref={(node) => { uploadRefs.current[document.key] = node }} hidden type="file" accept=".docx" onChange={(event) => void uploadMaster(document.key, event.target.files?.[0] ?? null)} /><Button size="sm" variant="outline" disabled={busy === `template-${document.key}`} onClick={() => uploadRefs.current[document.key]?.click()}><Upload className="mr-1 h-3 w-3" />Upload</Button></> : null}</div>
        {locked && !unavailable ? <div className="mt-2 flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => void generate(document.key, 'preview')}><Eye className="mr-1 h-3 w-3" />Preview</Button><Button size="sm" variant="outline" onClick={() => void generate(document.key, 'pdf')}><Download className="mr-1 h-3 w-3" />PDF</Button><Button size="sm" onClick={() => void generate(document.key, 'word')}><Download className="mr-1 h-3 w-3" />Word</Button></div> : null}
      </div>
    })}</section>
    {!workflow ? <><section className="grid gap-4 rounded-2xl border border-border bg-card p-4 md:grid-cols-2"><UploadBox title="Regulatory Excel" file={formula} accept=".xlsx,.xlsm" onChange={setFormula} /><UploadBox title="Creation COA" file={coa} accept=".pdf,.docx,.xlsx" onChange={setCoa} /></section><div className="flex justify-end"><Button disabled={!formula || !coa || busy === 'intake'} onClick={() => void start()}>{busy === 'intake' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}Process files</Button></div></> : <>
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="grid gap-4 md:grid-cols-3"><Field label="Product name" value={product} disabled={locked} onChange={setProduct} /><Field label="Product code" value={code} disabled={locked} onChange={setCode} /><label><span className="mb-1.5 block text-xs text-muted-foreground">Destination market</span><select value={market} disabled={locked} onChange={(event) => setMarket(event.target.value as 'other' | 'eu')} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"><option value="other">Other markets</option><option value="eu">Europe / EU</option></select></label></div></section>
      {!locked ? <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">Smart corrections from voice or notes</h2></div><p className="mt-1 text-sm text-muted-foreground">Speak product, SDS, or ingredient corrections. They are applied to this review screen only after you press Apply.</p></div><div className="flex items-center gap-2"><VoiceInputButton continuous stopSignal={voiceStopSignal} label="Start speaking" onTranscript={(text) => setVoiceNotes((current) => `${current}${current ? ' ' : ''}${text}`)} onInterim={setLiveSpeech} onListeningChange={setIsListening} onRecordingReady={(file) => void processRecording(file)} /><span className={`text-xs font-medium ${isListening ? 'text-red-400' : 'text-muted-foreground'}`}>{isListening ? 'Listening…' : 'Start speaking'}</span></div></div><textarea rows={4} value={voiceNotes} onChange={(event) => setVoiceNotes(event.target.value)} placeholder="Example: Change flash point to 82 degrees Celsius. Linalool CAS is 78-70-6 and classification is Skin Sensitisation Category 1B." className="mt-4 w-full rounded-xl border border-border bg-background p-3 text-sm" />{liveSpeech ? <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300"><span className="mr-2 text-xs font-semibold uppercase tracking-wide">Hearing</span>{liveSpeech}</div> : null}<div className="mt-3 flex justify-end"><Button disabled={busy === 'voice' || !voiceNotes.trim()} onClick={() => void applyVoiceNotes()}>{busy === 'voice' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Apply corrections</Button></div></section> : null}
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5"><h2 className="font-semibold">SDS product properties extracted from Creation COA</h2><p className="mt-1 text-xs text-muted-foreground">Every field is editable before approval. Empty values keep the master template wording.</p><div className="mt-4 grid gap-4 md:grid-cols-2">{PROPERTIES.map(([key, label]) => <Field key={key} label={label} value={properties[key] ?? ''} disabled={locked} placeholder="Leave blank if unavailable" onChange={(value) => setProperties((current) => ({ ...current, [key]: value }))} />)}</div></section>
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">SDS composition and regulatory review</h2><p className="text-xs text-muted-foreground">Source and review information stays in this screen only and is never printed.</p></div>{!locked ? <div className="flex gap-2"><Button variant="outline" disabled={busy === 'enrich'} onClick={() => void enrich()}>{busy === 'enrich' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Research missing data</Button><Button variant="outline" onClick={() => setRows((current) => [...current, blankIngredient()])}><Plus className="mr-2 h-4 w-4" />Add ingredient</Button></div> : null}</div>
        <div className="mt-4 overflow-auto rounded-xl border border-border"><table className="w-full min-w-[1120px] text-sm"><thead className="bg-muted/60"><tr>{['Ingredient', '% / band', 'CAS', 'EC', 'Classification', 'Review status', 'Sources', 'Action'].map((heading) => <th key={heading} className="p-3 text-left">{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <Fragment key={`${row.name}-${index}`}><tr className="border-t border-border">{(['name', 'concentration', 'cas', 'ec', 'classification'] as const).map((key) => <td key={key} className="p-2"><input value={String(row[key] ?? '')} disabled={locked} placeholder="Leave blank if unavailable" onChange={(event) => updateRow(index, key, event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-2 disabled:opacity-70" /></td>)}<td className="p-2"><span className={`rounded-full px-2 py-1 text-[10px] ${row.provenance === 'ai_suggested' ? 'bg-amber-500/10 text-amber-400' : row.provenance === 'approved_master' || row.provenance === 'employee_approved' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{row.provenance?.replaceAll('_', ' ') ?? 'excel'}</span></td><td className="max-w-52 p-2">{row.sources?.length ? <details><summary className="cursor-pointer text-xs text-primary">{row.sources.length} official source(s)</summary><div className="mt-1 space-y-1">{row.sources.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-primary underline">{url}</a>)}</div></details> : <span className="text-xs text-muted-foreground">None</span>}</td><td className="p-2">{!locked ? <button type="button" aria-label={`Remove ${row.name || 'ingredient'}`} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-destructive"><Trash2 className="h-4 w-4" /></button> : null}</td></tr>
          <tr className="border-t border-border bg-muted/20"><td colSpan={8} className="p-3"><details><summary className="cursor-pointer text-xs font-medium text-primary">Edit all regulatory details and alternative names</summary><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Field label="Alternative names (comma separated)" value={(row.aliases ?? []).join(', ')} disabled={locked} onChange={(value) => updateRow(index, 'aliases', value.split(',').map((item) => item.trim()).filter(Boolean))} />{DETAILS.map((field) => <TextAreaField key={field.key} label={field.label} value={String(row[field.key] ?? '')} disabled={locked} onChange={(value) => updateRow(index, field.key, value)} />)}</div></details></td></tr></Fragment>)}</tbody></table></div>
      </section>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4"><div className="flex items-center gap-3">{locked ? <CheckCircle2 className="text-emerald-400" /> : <ShieldCheck className="text-primary" />}<div><p className="font-semibold">{locked ? 'SDS approved and locked' : 'Employee approval required'}</p><p className="text-xs text-muted-foreground">{locked ? 'Generate clean Word or PDF documents above.' : 'Review every value. Empty fields remain empty or retain master wording.'}</p></div></div>{!locked ? <Button disabled={busy === 'approve'} onClick={() => void approve()}>{busy === 'approve' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Approve SDS</Button> : null}</section>
    </>}
  </main>
}

function UploadBox({ title, file, accept, onChange }: { title: string; file: File | null; accept: string; onChange: (file: File | null) => void }) {
  return <label className="cursor-pointer rounded-xl border border-dashed border-border p-5 text-center hover:bg-muted/30"><input hidden type="file" accept={accept} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.files?.[0] ?? null)} /><FileSpreadsheet className="mx-auto h-6 w-6 text-primary" /><p className="mt-2 text-sm font-semibold">{title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{file?.name ?? 'Choose file'}</p></label>
}
function Field({ label, value, placeholder, disabled, onChange }: { label: string; value: string; placeholder?: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <label><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><input value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm disabled:opacity-70" /></label>
}
function TextAreaField({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <label><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><textarea value={value} disabled={disabled} placeholder="Leave blank if unavailable" onChange={(event) => onChange(event.target.value)} rows={3} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm disabled:opacity-70" /></label>
}
