'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Download, ExternalLink, Eye, FileText, Languages, LoaderCircle, Mail, Printer, Send, Sparkles, Upload, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import type { HRTemplate, HRTemplateField } from '@/lib/api/types'
import { ApiError } from '@/lib/api/client'
import { canvaEditUrlForHrLetter } from '@/lib/template-canva-links'
import { parseEmailList } from '@/lib/email-recipients'
import { DocumentViewerModal } from '@/components/ui/document-viewer'

type SalaryColumn = 'existing' | 'revised' | 'monthly' | 'annual'
type UnitNumber = 1 | 2 | 3
type OfferSigner = 'swathi_nayak' | 'achyut_tendolkar' | 'deeksha_shettigar'

const UNIT_OPTIONS: UnitNumber[] = [1, 2, 3]
const OFFER_SIGNERS: { key: OfferSigner; name: string }[] = [
  { key: 'swathi_nayak', name: 'Swathi Nayak' },
  { key: 'achyut_tendolkar', name: 'Achyut Tendolkar' },
  { key: 'deeksha_shettigar', name: 'Deeksha Shettigar' },
]
const UNIT_ADDRESSES: Record<UnitNumber, string> = {
  1: 'Plot No. B 105/106, Baikampady Industrial Area, Mangalore, Dakshina Kannada, Karnataka - 575011',
  2: 'Ground Floor, Plot No. 42 & 43, Kallur, Mandli Kallur Industrial Area, Shivamogga, Karnataka - 577202',
  3: 'Plot 166A, Baikampady Industrial Road Area, Mangalore, Dakshina Kannada, Karnataka - 575011',
}
const AI_DRAFT_FIELD_MARKERS = ['reason', 'impact', 'message', 'statement', 'summary', 'remark', 'justification', 'performance', 'appreciation']

type SalaryFormula = { inputs: string[]; multiplier?: number }

const SALARY_FORMULAS: Record<string, Record<string, SalaryFormula>> = {
  appointment: {
    fixed_total: { inputs: ['basic', 'hra', 'conveyance', 'medical', 'special'] },
    gross_total: { inputs: ['fixed_total', 'variable'] },
    retiral_total: { inputs: ['pf', 'esi'] },
    benefits_total: { inputs: ['gmc', 'gpa'] },
    ctc_total: { inputs: ['gross_total', 'retiral_total', 'perquisites_total', 'benefits_total'] },
  },
  special_increment: {
    f: { inputs: ['b', 'h', 'c', 'm', 's'] },
    g: { inputs: ['f', 'v'] },
    r: { inputs: ['pf', 'esi'] },
    q: { inputs: ['ph', 'car'] },
    bn: { inputs: ['gmc', 'gpa'] },
    ctc: { inputs: ['g', 'r', 'q', 'bn'], multiplier: 12 },
  },
}

function salaryNumber(value: string): number | null {
  const normalized = value.replace(/[^0-9.-]/g, '')
  if (!normalized || normalized === '-' || normalized === '.') return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function calculatedSalaryValue(
  templateKey: string,
  rowKey: string,
  column: SalaryColumn,
  rawValue: (key: string) => string,
  manualOverwrite: boolean,
  resolving = new Set<string>(),
): string {
  const direct = rawValue(rowKey)
  const formula = SALARY_FORMULAS[templateKey]?.[rowKey]
  if (!formula || (manualOverwrite && direct.trim())) return direct
  const identity = `${rowKey}:${column}`
  if (resolving.has(identity)) return direct
  const nextResolving = new Set(resolving).add(identity)
  const inputs = formula.inputs.map((key) => calculatedSalaryValue(templateKey, key, column, rawValue, manualOverwrite, nextResolving))
  const numbers = inputs.map(salaryNumber)
  if (numbers.every((value) => value === null)) return ''
  const total = numbers.reduce<number>((sum, value) => sum + (value ?? 0), 0) * (formula.multiplier ?? 1)
  return total.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function LetterFields({ items, values, onChange, canGenerate, generatingKey, onGenerate }: { items: HRTemplateField[]; values: Record<string, string>; onChange: (key: string, value: string) => void; canGenerate: (field: HRTemplateField) => boolean; generatingKey: string | null; onGenerate: (field: HRTemplateField) => void }) {
  return <>{items.map((field) => {
    const inputId = `hr-letter-${field.key}`
    const supportsAi = canGenerate(field)
    const isGenerating = generatingKey === field.key
    return <div key={field.key} className={field.multiline ? 'md:col-span-2' : ''}><div className="mb-1.5 flex min-h-7 items-center justify-between gap-2"><label htmlFor={inputId} className="text-xs text-muted-foreground">{field.label}{field.required ? ' *' : ''}</label>{supportsAi && <button type="button" onClick={() => onGenerate(field)} disabled={!values[field.key]?.trim() || generatingKey !== null} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/30 px-2 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-45">{isGenerating ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}{isGenerating ? 'Writing' : 'AI draft'}</button>}</div>{field.multiline ? <textarea id={inputId} rows={3} value={values[field.key] ?? ''} onChange={(event) => onChange(field.key, event.target.value)} placeholder={supportsAi ? 'Enter a few keywords, then select AI draft' : undefined} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /> : <input id={inputId} value={values[field.key] ?? ''} onChange={(event) => onChange(field.key, event.target.value)} placeholder={supportsAi ? 'Enter keywords, then select AI draft' : undefined} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" />}</div>
  })}</>
}

export function HrLettersTool() {
  const { accessToken, hasPermission } = useAuth(); const { notify } = useToast()
  const uploadRef = useRef<HTMLInputElement>(null)
  const [selectedUnit, setSelectedUnit] = useState<UnitNumber>(1)
  const [selectedSigner, setSelectedSigner] = useState<OfferSigner>('swathi_nayak')
  const [templates, setTemplates] = useState<HRTemplate[]>([]); const [templateKey, setTemplateKey] = useState('offer')
  const template = templates.find((item) => item.key === templateKey) ?? templates[0]
  const canvaEditUrl = template ? canvaEditUrlForHrLetter(template.key) : null
  const activeKey = template?.key ?? templateKey
  const activeScope = activeKey
  const usesUnitAddress = activeKey === 'offer'
  const [values, setValues] = useState<Record<string, string>>({}); const [salaryValues, setSalaryValues] = useState<Record<string, string>>({})
  const [manualSalaryOverwrite, setManualSalaryOverwrite] = useState(false)
  const [busy, setBusy] = useState(false); const [previewUrl, setPreviewUrl] = useState<string | null>(null); const [showEmail, setShowEmail] = useState(false); const [email, setEmail] = useState({ recipient: '', cc: '', subject: '', message: '' }); const [sending, setSending] = useState(false)
  const [viewing, setViewing] = useState<{ blob: Blob; filename: string; title: string } | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [translatorText, setTranslatorText] = useState(''); const [translation, setTranslation] = useState(''); const [translating, setTranslating] = useState(false)
  const [translationTarget, setTranslationTarget] = useState('')
  const [generatingField, setGeneratingField] = useState<string | null>(null)
  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    void api.hrTemplates.list(accessToken).then((items) => { if (!cancelled) setTemplates(items) }).catch((error) => { if (!cancelled) notify('error', error instanceof ApiError ? error.message : 'Unable to load HR templates.') })
    return () => { cancelled = true }
  }, [accessToken, notify])
  const fields = useMemo(() => Object.fromEntries((template?.fields ?? []).map((field) => [field.key, values[`${activeScope}:${field.key}`] ?? field.default_value ?? ''])), [activeScope, template, values])
  const salaryColumns = useMemo(() => ([
    { key: 'existing' as SalaryColumn, label: 'Existing' }, { key: 'revised' as SalaryColumn, label: 'Revised' },
    { key: 'monthly' as SalaryColumn, label: 'Amount (per month)' }, { key: 'annual' as SalaryColumn, label: 'Amount (per annum)' },
  ]).filter((column) => template?.salary_rows.some((row) => row.columns.includes(column.key))), [template])
  const resolvedSalaryValues = useMemo(() => Object.fromEntries((template?.salary_rows ?? []).flatMap((row) => row.columns.map((column) => {
    const value = calculatedSalaryValue(activeKey, row.key, column, (key) => salaryValues[`${activeScope}:${key}:${column}`] ?? '', manualSalaryOverwrite)
    return [`${activeScope}:${row.key}:${column}`, value]
  }))), [activeKey, activeScope, manualSalaryOverwrite, salaryValues, template])
  const payloadFields = useMemo(() => ({ ...fields, ...(usesUnitAddress ? { signatory_name: OFFER_SIGNERS.find((signer) => signer.key === selectedSigner)?.name ?? 'Swathi Nayak' } : {}), ...Object.fromEntries((template?.salary_rows ?? []).flatMap((row) => row.columns.map((column) => [
    `salary_${row.key}_${column}`, resolvedSalaryValues[`${activeScope}:${row.key}:${column}`] ?? '',
  ]))) }), [activeScope, fields, resolvedSalaryValues, selectedSigner, template, usesUnitAddress])
  const visibleFields = useMemo(() => (template?.fields ?? []).filter((field) => !(usesUnitAddress && field.key === 'signatory_name')), [template, usesUnitAddress])
  const kannadaFields = useMemo(() => visibleFields.filter((field) => field.key.endsWith('_kannada')), [visibleFields])
  useEffect(() => {
    if (!kannadaFields.some((field) => field.key === translationTarget)) setTranslationTarget(kannadaFields[0]?.key ?? '')
  }, [kannadaFields, translationTarget])
  function clearPreview() { setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return null }) }
  function change(key: string, value: string) { if (!template) return; setValues((current) => ({ ...current, [`${activeScope}:${key}`]: value })); clearPreview() }
  function choose(key: string) { setTemplateKey(key); setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return null }) }
  function chooseUnit(unit: UnitNumber) { setSelectedUnit(unit); clearPreview() }
  function chooseSigner(signer: OfferSigner) { setSelectedSigner(signer); clearPreview() }
  function canGenerateField(field: HRTemplateField) { return (activeKey === 'spot_appreciation' || activeKey === 'special_increment') && AI_DRAFT_FIELD_MARKERS.some((marker) => field.key.toLowerCase().includes(marker)) }
  async function viewTemplate() { if (!accessToken || !template) return; try { const file = await api.hrTemplates.content(accessToken, template.key); setViewing({ blob: file.blob, filename: file.filename && file.filename !== 'download' ? file.filename : template.filename, title: template.title }) } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to open this template.') } }
  async function replaceTemplate(file: File | null) { if (!accessToken || !template || !file) return; setReplacing(true); try { const next = await api.hrTemplates.replace(accessToken, template.key, file); setTemplates((items) => items.map((item) => item.key === next.key ? next : item)); setValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${template.key}:`)))); setPreviewUrl(null); notify('success', `${next.title} master v${next.version} is active for all units and saved in Human Resources Knowledge.`) } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to replace this template.') } finally { setReplacing(false); if (uploadRef.current) uploadRef.current.value = '' } }
  async function generatePreview() { if (!accessToken || !template) return; const missing = visibleFields.filter((field) => field.required && !fields[field.key]?.trim()).map((field) => field.label); if (missing.length > 0) { notify('error', `Complete the required fields: ${missing.join(', ')}.`); return } setBusy(true); try { const response = await fetch('/api/v1/hr-letters/preview', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ template_key: template.key, unit_number: selectedUnit, signer_key: selectedSigner, fields: payloadFields }) }); if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.detail ?? 'Unable to generate this letter.') } const url = URL.createObjectURL(await response.blob()); setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return url }); setEmail((current) => ({ ...current, subject: current.subject || `${template.title} - ${fields.employee_name || 'Employee'}`, message: current.message || `Dear ${fields.employee_name || 'Employee'},\n\nPlease find your ${template.title.toLowerCase()} attached.` })); } catch (error) { notify('error', error instanceof Error ? error.message : 'Unable to generate this letter.') } finally { setBusy(false) } }
  async function translateToKannada() { if (!accessToken || !translatorText.trim()) return; setTranslating(true); try { const response = await fetch('/api/v1/hr-letters/translate-kannada', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: translatorText.trim() }) }); if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.detail ?? 'Unable to translate this text.') } const result = await response.json(); setTranslation(result.translation ?? '') } catch (error) { notify('error', error instanceof Error ? error.message : 'Unable to translate this text.') } finally { setTranslating(false) } }
  async function generateField(field: HRTemplateField) { if (!accessToken || !template) return; const keywords = fields[field.key]?.trim(); if (!keywords) return; setGeneratingField(field.key); try { const response = await fetch('/api/v1/hr-letters/field-suggestion', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ template_key: template.key, field_key: field.key, keywords, employee_name: fields.employee_name ?? '', designation: fields.designation ?? '' }) }); if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.detail ?? 'Unable to create an AI draft.') } const result = await response.json(); change(field.key, result.suggestion ?? keywords) } catch (error) { notify('error', error instanceof Error ? error.message : 'Unable to create an AI draft.') } finally { setGeneratingField(null) } }
  function applyTranslation() { if (!translation || !translationTarget) return; change(translationTarget, translation); const target = kannadaFields.find((field) => field.key === translationTarget); notify('success', `Kannada translation added to ${target?.label ?? 'the selected field'}.`) }
  async function copyTranslation() { if (!translation) return; try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(translation) } else { const textarea = document.createElement('textarea'); textarea.value = translation; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select(); const copied = document.execCommand('copy'); textarea.remove(); if (!copied) throw new Error('copy_failed') } notify('success', 'Kannada translation copied.') } catch { notify('error', 'Copy is blocked by this browser. Use Add to field instead.') } }
  function print() { const frame = document.getElementById('hr-letter-preview') as HTMLIFrameElement | null; frame?.contentWindow?.focus(); frame?.contentWindow?.print() }
  function download() { if (!previewUrl || !template) return; const link = document.createElement('a'); link.href = previewUrl; const unitPart = usesUnitAddress ? `-unit-${selectedUnit}` : ''; link.download = `${template.key}${unitPart}-${fields.employee_name || 'employee'}.pdf`; link.click() }
  async function sendEmail() { if (!accessToken || !template || !email.recipient.trim()) return; setSending(true); try { const response = await fetch('/api/v1/hr-letters/send', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ template_key: template.key, unit_number: selectedUnit, signer_key: selectedSigner, fields: payloadFields, recipient_email: email.recipient, cc_emails: parseEmailList(email.cc), subject: email.subject, message: email.message }) }); if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.detail ?? 'Unable to send this letter.') } notify('success', `${usesUnitAddress ? `Unit ${selectedUnit} ` : ''}${template.title} sent successfully through HR Zoho Mail.`); setShowEmail(false) } catch (error) { notify('error', error instanceof Error ? error.message : 'Unable to send this letter.') } finally { setSending(false) } }
  if (!template) return <main className="grid min-h-[50vh] place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-primary" /></main>
  return <main className="space-y-4 p-4 md:p-6"><PageHeader title="HR Letters" actions={<InfoTip label="About HR Letters" align="right">Offer Letters use the selected unit address, digital signature and company seal. The other letters are prepared with space for official letterhead printing.</InfoTip>} />
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{templates.map((item) => <button key={item.key} onClick={() => choose(item.key)} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${template.key === item.key ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card hover:border-primary/40'}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${template.key === item.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{template.key === item.key ? <Check className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span><p className="text-sm font-semibold">{item.short}</p></button>)}</section>
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 md:flex-row md:items-center md:justify-between"><div className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-primary" /><p className="truncate text-sm font-medium">{template.filename}</p><InfoTip label="Template details">Version {template.version} · {template.detected_field_count} mapped fields · {template.source === 'knowledge' ? 'Stored in Human Resources Knowledge' : 'Built-in starter'}. Placeholders in an uploaded master become portal fields automatically.</InfoTip></div><div className="flex shrink-0 flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void viewTemplate()}><Eye className="mr-1.5 h-4 w-4" />View</Button>{hasPermission('knowledge.write') && <>{canvaEditUrl && <Button size="sm" variant="outline" onClick={() => window.open(canvaEditUrl, '_blank', 'noopener,noreferrer')}><ExternalLink className="mr-1.5 h-4 w-4" />Canva</Button>}<input ref={uploadRef} hidden type="file" accept={template.key === 'offer' ? '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'} onChange={(event) => void replaceTemplate(event.target.files?.[0] ?? null)} /><Button size="sm" disabled={replacing} onClick={() => uploadRef.current?.click()}>{replacing ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}{replacing ? 'Mapping' : 'Replace'}</Button></>}</div></section>
    {usesUnitAddress && <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2"><div><div className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">Company unit <InfoTip label="Unit address">The selected address is used in the preview, PDF and email attachment.<br />{UNIT_ADDRESSES[selectedUnit]}</InfoTip></div><select aria-label="Company unit" value={selectedUnit} onChange={(event) => chooseUnit(Number(event.target.value) as UnitNumber)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium">{UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>Unit {unit}</option>)}</select></div><div><div className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">Authorized signatory <InfoTip label="Digital signature">The selected signature is added to the Offer Letter. The company seal is always included.</InfoTip></div><select aria-label="Authorized signatory" value={selectedSigner} onChange={(event) => chooseSigner(event.target.value as OfferSigner)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium">{OFFER_SIGNERS.map((signer) => <option key={signer.key} value={signer.key}>{signer.name}</option>)}</select></div></section>}
    {kannadaFields.length > 0 && <details className="rounded-2xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium">
        <Languages className="size-4 text-primary" />Kannada helper
        <InfoTip label="Kannada translation help">Translate English text and add it directly to the matching Kannada field.</InfoTip>
      </summary>
      <div className="border-t border-border p-4">
        <label className="mb-3 block">
          <span className="mb-1.5 block text-xs text-muted-foreground">Add translation to</span>
          <select value={translationTarget} onChange={(event) => setTranslationTarget(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm md:max-w-sm">
            {kannadaFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
          </select>
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <textarea rows={3} value={translatorText} onChange={(event) => { setTranslatorText(event.target.value); setTranslation('') }} placeholder="English text" className="w-full rounded-xl border border-border bg-background p-3 text-sm" />
          <textarea rows={3} value={translation} readOnly placeholder="Kannada translation" className="w-full rounded-xl border border-border bg-background p-3 text-sm" />
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void copyTranslation()} disabled={!translation}><Copy className="mr-1.5 h-4 w-4" />Copy</Button>
          <Button type="button" size="sm" variant="outline" onClick={applyTranslation} disabled={!translation || !translationTarget}><Check className="mr-1.5 h-4 w-4" />Add to field</Button>
          <Button type="button" size="sm" onClick={() => void translateToKannada()} disabled={translating || !translatorText.trim()}>{translating ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Languages className="mr-1.5 h-4 w-4" />}{translating ? 'Translating' : 'Translate'}</Button>
        </div>
      </div>
    </details>}
    <div className={`grid w-full gap-5 ${previewUrl ? 'xl:grid-cols-[minmax(0,1fr)_minmax(440px,.9fr)]' : 'mx-auto max-w-3xl'}`}><div className="space-y-4"><section className="rounded-2xl border border-border bg-card p-4 md:p-5"><div className="mb-4 flex items-center gap-2"><div className="flex items-center gap-1"><h2 className="text-lg font-semibold">{template.title}</h2><InfoTip label="About these fields">Only the mapped fields below change; approved wording in the master remains fixed.{(activeKey === 'spot_appreciation' || activeKey === 'special_increment') && <><br />For descriptive fields, enter keywords and select AI draft to create one short editable sentence.</>}</InfoTip></div></div><div className="grid gap-4 md:grid-cols-2"><LetterFields items={visibleFields.slice(0, 8)} values={fields} onChange={change} canGenerate={canGenerateField} generatingKey={generatingField} onGenerate={(field) => void generateField(field)} />{visibleFields.length > 8 && <details className="md:col-span-2 rounded-xl border border-border"><summary className="cursor-pointer p-3 text-sm font-medium">More fields <span className="ml-1 text-xs font-normal text-muted-foreground">{visibleFields.length - 8}</span></summary><div className="grid gap-4 border-t border-border p-3 md:grid-cols-2"><LetterFields items={visibleFields.slice(8)} values={fields} onChange={change} canGenerate={canGenerateField} generatingKey={generatingField} onGenerate={(field) => void generateField(field)} /></div></details>}</div></section>
      {template.salary_rows.length > 0 && <details className="rounded-2xl border border-border bg-card"><summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium">Compensation <span className="text-xs font-normal text-muted-foreground">{template.salary_rows.length}</span><InfoTip label="Compensation fields">CTC and total rows are calculated automatically. Enable Manual overwrite only when HR needs to replace a calculated amount. Clearing an overwritten total restores automatic calculation. Blank component cells count as zero and print as NIL.</InfoTip></summary><div className="border-t border-border p-4 md:p-5"><label className="mb-4 flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-3"><span><span className="block text-sm font-medium">Manual overwrite</span><span className="mt-0.5 block text-xs text-muted-foreground">Allow editing of automatically calculated CTC and total rows.</span></span><input type="checkbox" checked={manualSalaryOverwrite} onChange={(event) => { setManualSalaryOverwrite(event.target.checked); clearPreview() }} className="size-4 accent-primary" /></label><div className="max-h-[32rem] overflow-auto rounded-xl border border-border"><table className="w-full min-w-[600px] text-sm"><thead className="sticky top-0 bg-muted"><tr><th className="p-3 text-left">Salary component</th>{salaryColumns.map((column) => <th key={column.key} className="p-3 text-left">{column.label}</th>)}</tr></thead><tbody>{template.salary_rows.map((row) => { const calculated = Boolean(SALARY_FORMULAS[activeKey]?.[row.key]); return <tr key={row.key} className={`border-t border-border ${calculated ? 'bg-primary/[.04]' : ''}`}><td className="p-3 text-xs"><span>{row.label}</span>{calculated && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">AUTO</span>}</td>{salaryColumns.map((column) => <td key={column.key} className="p-2">{row.columns.includes(column.key) ? <input value={resolvedSalaryValues[`${activeScope}:${row.key}:${column.key}`] ?? ''} readOnly={calculated && !manualSalaryOverwrite} onChange={(event) => { setSalaryValues((current) => ({ ...current, [`${activeScope}:${row.key}:${column.key}`]: event.target.value })); clearPreview() }} className={`h-9 w-full rounded-lg border border-border px-2 text-sm ${calculated && !manualSalaryOverwrite ? 'cursor-not-allowed bg-muted font-semibold text-primary' : 'bg-background'}`} placeholder={calculated ? 'Auto-calculated' : 'NIL when blank'} /> : <span className="block text-center text-muted-foreground">—</span>}</td>)}</tr>})}</tbody></table></div></div></details>}
      <section className="flex flex-wrap justify-end gap-2 rounded-2xl border border-border bg-card p-4"><Button onClick={() => void generatePreview()} disabled={busy}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}{busy ? 'Preparing review' : previewUrl ? 'Refresh preview' : 'Review final letter'}</Button></section></div>
      {previewUrl && <section className="h-fit overflow-hidden rounded-2xl border border-border bg-card xl:sticky xl:top-4"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 2 · Review</p><h2 className="mt-1 font-semibold">{template.title} · Final preview</h2></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={download}><Download className="mr-1.5 h-4 w-4" />PDF</Button><Button size="sm" variant="outline" onClick={print}><Printer className="mr-1.5 h-4 w-4" />Print</Button><Button size="sm" onClick={() => setShowEmail(true)}><Mail className="mr-1.5 h-4 w-4" />Email through HR</Button></div></div><iframe id="hr-letter-preview" title="Letter preview" src={previewUrl} className="h-[72vh] min-h-[32rem] w-full bg-white" /></section>}</div>
    {showEmail && <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Email reviewed PDF"><div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.14em] text-primary">Step 3 · Send</p><h2 className="mt-1 text-lg font-semibold">Email reviewed PDF</h2></div><button type="button" onClick={() => setShowEmail(false)} className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close email dialog"><X className="h-4 w-4" /></button></div><div className="mt-5 space-y-3"><label><span className="mb-1 block text-xs text-muted-foreground">Recipient email</span><input type="email" value={email.recipient} onChange={(event) => setEmail((current) => ({ ...current, recipient: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><label><span className="mb-1 block text-xs text-muted-foreground">CC <span className="font-normal">(optional)</span></span><input type="text" inputMode="email" value={email.cc} onChange={(event) => setEmail((current) => ({ ...current, cc: event.target.value }))} placeholder="Separate multiple emails with commas" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><label><span className="mb-1 block text-xs text-muted-foreground">Subject</span><input value={email.subject} onChange={(event) => setEmail((current) => ({ ...current, subject: event.target.value }))} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label><label><span className="mb-1 block text-xs text-muted-foreground">Email message</span><textarea rows={6} value={email.message} onChange={(event) => setEmail((current) => ({ ...current, message: event.target.value }))} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></label></div><div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setShowEmail(false)} disabled={sending}>Cancel</Button><Button onClick={() => void sendEmail()} disabled={sending || !email.recipient || !email.subject || !email.message}>{sending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{sending ? 'Sending' : 'Send with PDF'}</Button></div></div></div>}
    <DocumentViewerModal file={viewing} onClose={() => setViewing(null)} />
  </main>
}
