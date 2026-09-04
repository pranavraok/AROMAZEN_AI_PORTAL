'use client'

import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Eye, FileSpreadsheet, FileText, LoaderCircle, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { VoiceInputButton } from '@/components/voice-input-button'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
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
  ['storage_condition', 'Storage condition'], ['classification', 'Mixture classification'], ['signal_word', 'Signal word'],
  ['hazard_statements', 'Hazard statements'], ['supplemental_information', 'Supplemental information'],
  ['precautionary_statements', 'Precautionary statements'], ['pictograms', 'Pictograms'], ['other_hazards', 'Other hazards'],
  ['version', 'SDS version'], ['revision_date', 'SDS revision date'],
] as const
const DETAILS: { key: keyof RegulatoryIngredient; label: string }[] = [
  { key: 'hazard_statements', label: 'H-statements' }, { key: 'precautionary_statements', label: 'P-statements' },
  { key: 'signal_word', label: 'Signal word' }, { key: 'pictograms', label: 'Pictograms' },
  { key: 'toxicology', label: 'Toxicology data' }, { key: 'ecology', label: 'Ecological data' },
  { key: 'transport', label: 'Transport classification' }, { key: 'allergen_identity', label: 'Allergen identity' },
  { key: 'svhc_identity', label: 'REACH / SVHC identity' }, { key: 'ifra_limits', label: 'IFRA limits by category' },
]

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a')
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url)
}
function reservePreviewWindow() {
  const previewWindow = window.open('about:blank', '_blank')
  if (!previewWindow) return null
  previewWindow.opener = null
  previewWindow.document.title = 'Preparing document preview'
  previewWindow.document.body.textContent = 'Preparing document preview…'
  previewWindow.document.body.style.cssText = 'margin:0;display:grid;min-height:100vh;place-items:center;background:#101512;color:#d7e2dc;font:500 16px system-ui,sans-serif'
  return previewWindow
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
  const [researchSummary, setResearchSummary] = useState<RegulatoryWorkflow['research_summary']>()
  const [sourceWarningsAcknowledged, setSourceWarningsAcknowledged] = useState(false)
  const [voiceNotes, setVoiceNotes] = useState(''); const [liveSpeech, setLiveSpeech] = useState(''); const [isListening, setIsListening] = useState(false); const [voiceStopSignal, setVoiceStopSignal] = useState(0)
  const uploadRefs = useRef<Partial<Record<RegulatoryDocumentType, HTMLInputElement | null>>>({})
  const templateMap = useMemo(() => Object.fromEntries(templates.map((item) => [item.document_type, item])), [templates])
  const payload = { product_name: product, product_code: code, market, sds_fields: properties, ingredients: rows }
  const locked = workflow?.status === 'approved'

  useEffect(() => { if (accessToken) void api.regulatory.templates(accessToken).then(setTemplates).catch(() => undefined) }, [accessToken])
  function applyWorkflow(value: RegulatoryWorkflow) { setWorkflow(value); setProduct(value.product_name); setCode(value.product_code); setMarket(value.market); setProperties(value.sds_fields); setRows(value.ingredients); if (value.research_summary) setResearchSummary(value.research_summary) }
  function errorMessage(error: unknown, fallback: string) { return error instanceof ApiError ? error.message : fallback }
  function updateRow(index: number, key: keyof RegulatoryIngredient, value: string | string[]) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value, provenance: 'employee_approved' } : row)) }
  function reportResearch(result: RegulatoryWorkflow) {
    const summary = result.research_summary
    if (!summary) return notify('warning', 'The source check finished without a completion summary. Please retry.')
    if (summary.mode === 'ai') {
      return summary.populated
        ? notify('success', 'The optional identity lookup found an official match. Review the highlighted row.')
        : notify('warning', 'The optional identity lookup found no verified official match. The row was left unchanged.')
    }
    if (summary.populated) notify('success', `Official databases filled ${summary.populated} ingredient${summary.populated === 1 ? '' : 's'}. No paid AI searches were used.`)
    else notify('success', `Official source checks completed. ${summary.cached} ingredient${summary.cached === 1 ? '' : 's'} came from the saved master/cache. No paid AI searches were used.`)
  }

  async function start() {
    if (!accessToken || !formula || !coa) return notify('error', 'Upload both the Regulatory Excel and Creation COA.')
    setBusy('intake')
    try {
      const created = await api.regulatory.createWorkflow(accessToken, formula, coa)
      applyWorkflow(created); setSourceWarningsAcknowledged(false)
      notify('success', 'Files processed. Review the values or check official sources.')
    } catch (error) { notify('error', errorMessage(error, 'Unable to process the uploaded files.')) } finally { setBusy('') }
  }
  async function enrich() {
    if (!accessToken || !workflow) return
    if (!window.confirm('Check official regulatory sources now?')) return
    setBusy('enrich')
    try { await api.regulatory.updateWorkflow(accessToken, workflow.id, payload); const researched = await api.regulatory.enrich(accessToken, workflow.id, true); applyWorkflow(researched); reportResearch(researched) }
    catch (error) { notify('error', errorMessage(error, 'Official ingredient sources are temporarily unavailable.')) } finally { setBusy('') }
  }
  async function aiIdentityFallback(index: number) {
    if (!accessToken || !workflow) return
    const ingredient = rows[index]
    if (!window.confirm(`Run one optional paid AI identity search for ${ingredient.name || 'this ingredient'}? It will use only official-source results.`)) return
    setBusy(`ai-${index}`)
    try {
      await api.regulatory.updateWorkflow(accessToken, workflow.id, payload)
      const researched = await api.regulatory.aiIdentityFallback(accessToken, workflow.id, index)
      applyWorkflow(researched); reportResearch(researched)
    } catch (error) { notify('error', errorMessage(error, 'The optional AI identity lookup is unavailable.')) } finally { setBusy('') }
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
    try { applyWorkflow(await api.regulatory.approve(accessToken, workflow.id, { ...payload, source_warnings_acknowledged: sourceWarningsAcknowledged })); notify('success', 'SDS approved. All applicable documents are unlocked.') }
    catch (error) { notify('error', errorMessage(error, 'Unable to approve the SDS.')) } finally { setBusy('') }
  }
  async function uploadMaster(type: RegulatoryDocumentType, file: File | null) {
    if (!accessToken || !file) return; setBusy(`template-${type}`)
    try { const next = await api.regulatory.uploadTemplate(accessToken, type, file); setTemplates((current) => [...current.filter((item) => item.document_type !== type), next]); notify('success', `${next.name} is now the active master.`) }
    catch (error) { notify('error', errorMessage(error, 'Unable to replace the master.')) } finally { setBusy('') }
  }
  async function viewMaster(type: RegulatoryDocumentType) {
    if (!accessToken) return
    const previewWindow = reservePreviewWindow()
    if (!previewWindow) return notify('error', 'The browser blocked the preview window. Allow pop-ups for this site and try again.')
    try { const file = await api.regulatory.templateContent(accessToken, type); const url = URL.createObjectURL(file.blob); previewWindow.location.replace(url); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }
    catch (error) { previewWindow.close(); notify('error', errorMessage(error, 'Unable to open the master.')) }
  }
  async function generate(type: RegulatoryDocumentType, format: 'preview' | 'pdf' | 'word') {
    if (!accessToken || !workflow) return
    const previewWindow = format === 'preview' ? reservePreviewWindow() : null
    if (format === 'preview' && !previewWindow) return notify('error', 'The browser blocked the preview window. Allow pop-ups for this site and try again.')
    setBusy(`${format}-${type}`)
    try {
      let generationId = workflow.generated[type]
      if (!generationId) { const result = await api.regulatory.generate(accessToken, workflow.id, type); generationId = result.id; setWorkflow((current) => current ? { ...current, generated: { ...current.generated, [type]: result.id } } : current) }
      const file = format === 'word' ? await api.regulatory.download(accessToken, generationId) : format === 'pdf' ? await api.regulatory.pdf(accessToken, generationId) : await api.regulatory.preview(accessToken, generationId)
      if (format === 'preview' && previewWindow) { const url = URL.createObjectURL(file.blob); previewWindow.location.replace(url); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) } else saveBlob(file.blob, file.filename)
    } catch (error) { previewWindow?.close(); notify('error', errorMessage(error, 'Unable to generate this document.')) } finally { setBusy('') }
  }

  return <main className="space-y-5 p-4 md:p-6">
    <PageHeader title="Regulatory Affairs · Document Centre" description="Prepare, review and issue Regulatory documents." />
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{DOCUMENTS.map((document) => {
      const master = templateMap[document.key]; const unavailable = document.key === 'reach_declaration' && market !== 'eu'; const unlocked = document.key === 'sds' || locked
      return <div key={document.key} className={`rounded-xl border p-4 ${document.key === 'sds' ? 'border-primary bg-primary/5' : unlocked && !unavailable ? 'border-emerald-500/30' : 'border-border'}`}>
        <FileText className="h-5 w-5 text-primary" /><div className="mt-2 flex min-h-8 items-start gap-1"><p className="text-sm font-semibold">{document.title}</p><InfoTip label={`About ${document.title}`} align="right">{unavailable ? 'Select Europe / EU to enable this document.' : document.note}</InfoTip></div><p className="mt-2 truncate text-[11px] text-muted-foreground">{master ? `${master.name} · v${master.version}` : 'Master not available'}</p>
        <div className="mt-3 flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={!master} onClick={() => void viewMaster(document.key)}><Eye className="mr-1 h-3 w-3" />Master</Button>{hasPermission('knowledge.write') ? <><input ref={(node) => { uploadRefs.current[document.key] = node }} hidden type="file" accept=".docx" onChange={(event) => void uploadMaster(document.key, event.target.files?.[0] ?? null)} /><Button size="sm" variant="outline" disabled={busy === `template-${document.key}`} onClick={() => uploadRefs.current[document.key]?.click()}><Upload className="mr-1 h-3 w-3" />Upload</Button></> : null}</div>
        {locked && !unavailable ? <div className="mt-2 flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => void generate(document.key, 'preview')}><Eye className="mr-1 h-3 w-3" />Preview</Button><Button size="sm" variant="outline" onClick={() => void generate(document.key, 'pdf')}><Download className="mr-1 h-3 w-3" />PDF</Button><Button size="sm" onClick={() => void generate(document.key, 'word')}><Download className="mr-1 h-3 w-3" />Word</Button></div> : null}
      </div>
    })}</section>
    {!workflow ? <><section className="grid gap-4 rounded-2xl border border-border bg-card p-4 md:grid-cols-2"><UploadBox title="Regulatory Excel" file={formula} accept=".xlsx,.xlsm" onChange={setFormula} /><UploadBox title="Creation COA" file={coa} accept=".pdf,.docx,.xlsx" onChange={setCoa} /></section><div className="flex justify-end"><Button disabled={!formula || !coa || busy === 'intake'} onClick={() => void start()}>{busy === 'intake' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}Process files</Button></div></> : <>
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="grid gap-4 md:grid-cols-3"><Field label="Product name" value={product} disabled={locked} onChange={setProduct} /><Field label="Product code" value={code} disabled={locked} onChange={setCode} /><label><span className="mb-1.5 block text-xs text-muted-foreground">Destination market</span><select value={market} disabled={locked} onChange={(event) => setMarket(event.target.value as 'other' | 'eu')} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"><option value="other">Other markets</option><option value="eu">Europe / EU</option></select></label></div></section>
      {workflow.intake_warnings?.length ? <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-100"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" /><div><p className="font-semibold">The uploaded files describe different products</p><div className="mt-1 space-y-1 text-sm text-amber-100/90">{workflow.intake_warnings.map((warning) => <p key={warning.code}>{warning.message}</p>)}</div>{!locked ? <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={sourceWarningsAcknowledged} onChange={(event) => setSourceWarningsAcknowledged(event.target.checked)} /><span>I have checked these source files and want to continue with the extracted COA values.</span></label> : null}</div></div></section> : null}
      {!locked ? <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">Smart corrections from voice or notes</h2><InfoTip label="How voice corrections work">Speak or type product, SDS or ingredient corrections, then select Apply corrections. Example: “Change flash point to 82 degrees Celsius.”</InfoTip></div><div className="flex items-center gap-2"><VoiceInputButton continuous stopSignal={voiceStopSignal} label="Start speaking" onTranscript={(text) => setVoiceNotes((current) => `${current}${current ? ' ' : ''}${text}`)} onInterim={setLiveSpeech} onListeningChange={setIsListening} onRecordingReady={(file) => void processRecording(file)} /><span className={`text-xs font-medium ${isListening ? 'text-red-400' : 'text-muted-foreground'}`}>{isListening ? 'Listening…' : 'Start speaking'}</span></div></div><textarea aria-label="Voice or typed corrections" rows={4} value={voiceNotes} onChange={(event) => setVoiceNotes(event.target.value)} className="mt-4 w-full rounded-xl border border-border bg-background p-3 text-sm" />{liveSpeech ? <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300"><span className="mr-2 text-xs font-semibold uppercase tracking-wide">Hearing</span>{liveSpeech}</div> : null}<div className="mt-3 flex justify-end"><Button disabled={busy === 'voice' || !voiceNotes.trim()} onClick={() => void applyVoiceNotes()}>{busy === 'voice' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Apply corrections</Button></div></section> : null}
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="flex items-center gap-1"><h2 className="font-semibold">SDS product properties</h2><InfoTip label="About SDS product properties">Values are extracted from the Creation COA when available. Every field remains editable before approval; unavailable values stay blank for the employee to complete.</InfoTip></div><div className="mt-4 grid gap-4 md:grid-cols-2">{PROPERTIES.map(([key, label]) => <Field key={key} label={label} value={properties[key] ?? ''} disabled={locked} onChange={(value) => setProperties((current) => ({ ...current, [key]: value }))} />)}</div></section>
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-1"><h2 className="font-semibold">SDS composition and regulatory review</h2><InfoTip label="About official regulatory checks">Checks PubChem with strict throttling, EPA CompTox when its free key is configured, and versioned local ECHA, IFRA and NITE reference packs. Only ingredient identity is sent; formula percentages are not. Source and review details stay on this screen and are never printed.</InfoTip></div>{!locked ? <div className="flex gap-2"><Button variant="outline" disabled={busy === 'enrich'} onClick={() => void enrich()}>{busy === 'enrich' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}{busy === 'enrich' ? 'Checking official sources…' : researchSummary ? 'Check missing data again' : 'Check official data'}</Button><Button variant="outline" disabled={busy === 'enrich'} onClick={() => setRows((current) => [...current, blankIngredient()])}><Plus className="mr-2 h-4 w-4" />Add ingredient</Button></div> : null}</div>
        {busy === 'enrich' ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-primary"><LoaderCircle className="h-4 w-4 animate-spin" />Checking official sources…</div> : researchSummary ? <div className={`mt-4 flex items-center gap-1 rounded-xl border p-3 text-sm ${researchSummary.failed ? 'border-amber-500/30 bg-amber-500/5 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'}`}><span>{researchSummary.attempted} checked · {researchSummary.populated} filled · {researchSummary.unresolved} unresolved</span><InfoTip label="Source check summary" align="right">{researchSummary.mode === 'official' ? `${researchSummary.cached} ingredient(s) used saved data. No paid AI request was used. ${researchSummary.failed} source check(s) can be retried.` : `One optional AI identity lookup ran. ${researchSummary.populated ? 'An official match was verified.' : 'No official match was verified.'}`}</InfoTip></div> : null}
        <div className="mt-4 overflow-auto rounded-xl border border-border"><table className="w-full min-w-[1240px] text-sm"><thead className="bg-muted/60"><tr>{['Ingredient', '% / band', 'CAS', 'EC', 'Classification', 'Review status', 'Sources', 'Action'].map((heading) => <th key={heading} className="p-3 text-left"><span className="inline-flex items-center gap-1">{heading}{heading === 'Sources' ? <InfoTip label="About sources">Links and match details are shown only for review and are excluded from generated documents.</InfoTip> : null}</span></th>)}</tr></thead><tbody>{rows.map((row, index) => <Fragment key={`${row.name}-${index}`}><tr className="border-t border-border">{(['name', 'concentration', 'cas', 'ec', 'classification'] as const).map((key) => <td key={key} className="p-2"><input aria-label={`${key} for ${row.name || `ingredient ${index + 1}`}`} value={String(row[key] ?? '')} disabled={locked} onChange={(event) => updateRow(index, key, event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-2 disabled:opacity-70" /></td>)}<td className="p-2"><span className={`rounded-full px-2 py-1 text-[10px] ${row.provenance === 'ai_suggested' ? 'bg-amber-500/10 text-amber-400' : row.provenance === 'official_database' || row.provenance === 'approved_master' || row.provenance === 'employee_approved' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>{row.provenance?.replaceAll('_', ' ') ?? 'excel'}</span></td><td className="max-w-52 p-2">{row.sources?.length ? <details><summary className="cursor-pointer text-xs text-primary">{row.sources.length} official source(s)</summary><div className="mt-1 space-y-1">{row.sources.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-primary underline">{url}</a>)}</div></details> : <span className="text-xs text-muted-foreground">None</span>}</td><td className="p-2">{!locked ? <div className="flex items-center gap-2">{!row.cas && !row.ec ? <Button size="sm" variant="outline" disabled={busy === `ai-${index}`} onClick={() => void aiIdentityFallback(index)}>{busy === `ai-${index}` ? <LoaderCircle className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}AI fallback</Button> : null}<button type="button" aria-label={`Remove ${row.name || 'ingredient'}`} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-destructive"><Trash2 className="h-4 w-4" /></button></div> : null}</td></tr>
          <tr className="border-t border-border bg-muted/20"><td colSpan={8} className="p-3"><details><summary className="cursor-pointer text-xs font-medium text-primary">More details</summary><div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Field label="Alternative names (comma separated)" value={(row.aliases ?? []).join(', ')} disabled={locked} onChange={(value) => updateRow(index, 'aliases', value.split(',').map((item) => item.trim()).filter(Boolean))} />{DETAILS.map((field) => <TextAreaField key={field.key} label={field.label} value={String(row[field.key] ?? '')} disabled={locked} onChange={(value) => updateRow(index, field.key, value)} />)}</div>{Object.keys(row.source_checks ?? {}).length ? <div className="mt-3 flex flex-wrap gap-2">{Object.entries(row.source_checks ?? {}).map(([key, check]) => <span key={key} title={check.details || check.checked_at} className="rounded-full border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">{key.toUpperCase()}: {check.status.replaceAll('_', ' ')} · {check.source}</span>)}</div> : null}</details></td></tr></Fragment>)}</tbody></table></div>
      </section>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4"><div className="flex items-center gap-3">{locked ? <CheckCircle2 className="text-emerald-400" /> : <ShieldCheck className="text-primary" />}<div className="flex items-center gap-1"><p className="font-semibold">{locked ? 'SDS approved and locked' : 'Employee approval required'}</p><InfoTip label="About SDS approval" align="right">{locked ? 'The approved snapshot is locked. Generate its clean Word or PDF documents above.' : 'Review every value before approval. Unavailable fields remain blank unless an employee completes them.'}</InfoTip></div></div>{!locked ? <Button disabled={busy === 'approve' || Boolean(workflow.intake_warnings?.length && !sourceWarningsAcknowledged)} onClick={() => void approve()}>{busy === 'approve' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Approve SDS</Button> : null}</section>
    </>}
  </main>
}

function UploadBox({ title, file, accept, onChange }: { title: string; file: File | null; accept: string; onChange: (file: File | null) => void }) {
  return <label className="cursor-pointer rounded-xl border border-dashed border-border p-5 text-center hover:bg-muted/30"><input hidden type="file" accept={accept} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.files?.[0] ?? null)} /><FileSpreadsheet className="mx-auto h-6 w-6 text-primary" /><p className="mt-2 text-sm font-semibold">{title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{file?.name ?? 'Choose file'}</p></label>
}
function Field({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <label><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm disabled:opacity-70" /></label>
}
function TextAreaField({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <label><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><textarea value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} rows={3} className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm disabled:opacity-70" /></label>
}
