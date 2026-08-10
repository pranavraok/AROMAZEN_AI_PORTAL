'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Boxes, CalendarDays, CheckCircle2, Download, Edit3, FileSpreadsheet, LoaderCircle, Plus, Recycle, Search, Upload, Wrench, X } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import { ApiError } from '@/lib/api/client'
import type { AssetCondition, AssetListResponse, AssetMaintenanceEvent, AssetPayload, AssetStatus, ITAsset } from '@/lib/api/types'

const STATUSES: AssetStatus[] = ['Active', 'Spare', 'Under maintenance', 'Repair needed', 'Recovery required', 'Lost', 'Scrap proposed', 'Approved for scrap', 'Scrapped', 'Disposed']
const CONDITIONS: AssetCondition[] = ['Good', 'Fair', 'Poor', 'Damaged', 'Obsolete']
const SCRAP_STATUSES: AssetStatus[] = ['Scrap proposed', 'Approved for scrap', 'Scrapped', 'Disposed']

const blankAsset = (): AssetPayload => ({
  employee: null, physical_location: null, department_name: null, home_office: null, category: null, brand: null, model: null,
  serial_imei: null, sim_no: null, ups: null, label_no: null, invoice_date: null, invoice_no: null, supplier_name: null,
  price: null, warranty: null, status: 'Active', condition: 'Good', notes: null, last_maintenance_date: null,
  next_maintenance_date: null, maintenance_interval_months: null, maintenance_reminder_days: 30, maintenance_owner: null,
  maintenance_notes: null, scrap_reason: null, scrap_date: null, scrap_value: null,
})

function assetPayload(item: ITAsset): AssetPayload {
  const { id: _id, source_sn: _source, maintenance_state: _state, maintenance_days_remaining: _days, created_at: _created, updated_at: _updated, ...payload } = item
  return payload
}

function money(value: number | null) { return value === null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value) }
function displayDate(value: string | null) { return value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)) : 'Not scheduled' }
function emptyToNull(value: string) { return value.trim() || null }

function statusTone(status: AssetStatus) {
  if (['Scrapped', 'Disposed', 'Lost'].includes(status)) return 'bg-red-500/10 text-red-400'
  if (['Scrap proposed', 'Approved for scrap', 'Repair needed', 'Recovery required'].includes(status)) return 'bg-amber-500/10 text-amber-400'
  if (status === 'Under maintenance') return 'bg-sky-500/10 text-sky-400'
  if (status === 'Spare') return 'bg-violet-500/10 text-violet-400'
  return 'bg-emerald-500/10 text-emerald-400'
}

export default function AssetManagementPage() {
  const { accessToken, user, hasPermission } = useAuth()
  const { notify } = useToast()
  const importRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<AssetListResponse | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [category, setCategory] = useState('All')
  const [location, setLocation] = useState('All')
  const [department, setDepartment] = useState('All')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [busy, setBusy] = useState<'load' | 'save' | 'import' | 'export' | 'maintenance' | null>(null)
  const [editing, setEditing] = useState<ITAsset | 'new' | null>(null)
  const [form, setForm] = useState<AssetPayload>(blankAsset())
  const [servicing, setServicing] = useState<ITAsset | null>(null)
  const [serviceForm, setServiceForm] = useState({ service_date: new Date().toISOString().slice(0, 10), vendor: '', cost: '', notes: '', next_due_date: '' })
  const [history, setHistory] = useState<AssetMaintenanceEvent[]>([])
  const canUse = hasPermission('users.manage') && (user?.department_name === 'HR' || user?.role_names.some((role) => role === 'Super Admin' || role === 'Admin'))

  const load = useCallback(async (quiet = false) => {
    if (!accessToken || !canUse) return
    if (!quiet) setBusy('load')
    try { setData(await api.assets.list(accessToken, { search, status, category, location, department, attentionOnly })) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to load IT assets.') }
    finally { if (!quiet) setBusy(null) }
  }, [accessToken, attentionOnly, canUse, category, department, location, notify, search, status])

  useEffect(() => { if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('attention') === '1') setAttentionOnly(true) }, [])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer) }, [load])

  const filteredValue = useMemo(() => data?.items.reduce((sum, item) => sum + (item.price ?? 0), 0) ?? 0, [data])

  function openNew() { setForm(blankAsset()); setEditing('new') }
  function openEdit(item: ITAsset) { setForm(assetPayload(item)); setEditing(item) }
  function change<K extends keyof AssetPayload>(key: K, value: AssetPayload[K]) { setForm((current) => ({ ...current, [key]: value })) }

  async function save() {
    if (!accessToken || !editing || !form.category?.trim()) return notify('error', 'Category is required.')
    setBusy('save')
    try {
      if (editing === 'new') await api.assets.create(accessToken, form)
      else await api.assets.update(accessToken, editing.id, form)
      notify('success', editing === 'new' ? 'Device added to the asset register.' : 'Asset details updated.')
      setEditing(null); await load(true)
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to save this asset.') }
    finally { setBusy(null) }
  }

  async function importExcel(file: File | null) {
    if (!accessToken || !file) return
    setBusy('import')
    try { const result = await api.assets.importRegister(accessToken, file); notify('success', `${result.created} new and ${result.updated} existing assets processed.`); await load(true) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to import the asset register.') }
    finally { setBusy(null); if (importRef.current) importRef.current.value = '' }
  }

  async function exportExcel() {
    if (!accessToken) return
    setBusy('export')
    try { const file = await api.assets.exportRegister(accessToken); const url = URL.createObjectURL(file.blob); const link = document.createElement('a'); link.href = url; link.download = file.filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); notify('success', 'Current asset register downloaded in the original Excel format.') }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to download the asset register.') }
    finally { setBusy(null) }
  }

  async function openMaintenance(item: ITAsset) {
    setServicing(item); setServiceForm({ service_date: new Date().toISOString().slice(0, 10), vendor: '', cost: '', notes: '', next_due_date: item.next_maintenance_date ?? '' })
    if (accessToken) setHistory(await api.assets.maintenanceHistory(accessToken, item.id).catch(() => []))
  }

  async function recordMaintenance() {
    if (!accessToken || !servicing || !serviceForm.service_date) return
    setBusy('maintenance')
    try { await api.assets.recordMaintenance(accessToken, servicing.id, { service_date: serviceForm.service_date, vendor: emptyToNull(serviceForm.vendor), cost: serviceForm.cost ? Number(serviceForm.cost) : null, notes: emptyToNull(serviceForm.notes), next_due_date: emptyToNull(serviceForm.next_due_date) }); notify('success', 'Maintenance recorded and the next reminder date updated.'); setServicing(null); await load(true) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to record maintenance.') }
    finally { setBusy(null) }
  }

  if (!canUse) return <AppLayout><main className="grid min-h-[70vh] place-items-center p-6"><div className="text-center"><Boxes className="mx-auto h-10 w-10 text-muted-foreground" /><h1 className="mt-3 text-xl font-semibold">HR administrator access required</h1></div></main></AppLayout>

  return <AppLayout><main className="space-y-5 p-4 md:p-6">
    <PageHeader title="IT Asset Management" description="Maintain one live device register, schedule service reminders and control every recovery, repair and scrap decision." actions={<div className="flex flex-wrap gap-2"><input ref={importRef} hidden type="file" accept=".xlsx,.xlsm" onChange={(event) => void importExcel(event.target.files?.[0] ?? null)} /><Button variant="outline" disabled={busy !== null} onClick={() => importRef.current?.click()}>{busy === 'import' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Import Excel</Button><Button variant="outline" disabled={busy !== null} onClick={() => void exportExcel()}>{busy === 'export' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download same-format Excel</Button><Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add device</Button></div>} />

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Kpi label="Total assets" value={data?.summary.total ?? '—'} icon={<Boxes />} /><Kpi label="Active / spare" value={data ? `${data.summary.active} / ${data.summary.spare}` : '—'} icon={<CheckCircle2 />} /><Kpi label="Maintenance due" value={data?.summary.maintenance_due ?? '—'} icon={<CalendarDays />} tone={data?.summary.maintenance_overdue ? 'text-red-400' : 'text-amber-400'} /><Kpi label="Repair / recovery" value={data ? data.summary.repair_needed + data.summary.recovery_required : '—'} icon={<Wrench />} tone="text-amber-400" /><Kpi label="Scrap queue" value={data?.summary.scrap_queue ?? '—'} icon={<Recycle />} tone={data?.summary.scrap_queue ? 'text-red-400' : ''} /></section>

    <section className="rounded-2xl border border-border bg-card p-4"><div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_repeat(4,minmax(130px,.45fr))_auto]"><label className="relative"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employee, device, label, serial or SIM" className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm" /></label><Filter value={status} onChange={setStatus} options={STATUSES} label="All statuses" /><Filter value={category} onChange={setCategory} options={data?.categories ?? []} label="All categories" /><Filter value={location} onChange={setLocation} options={data?.locations ?? []} label="All locations" /><Filter value={department} onChange={setDepartment} options={data?.departments ?? []} label="All departments" /><button type="button" onClick={() => setAttentionOnly((value) => !value)} className={`h-11 rounded-xl border px-4 text-sm font-medium ${attentionOnly ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-border bg-background text-muted-foreground'}`}>Needs attention</button></div><div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{data?.items.length ?? 0} shown · {money(filteredValue)} shown value</span><span>{data ? money(data.summary.total_value) : '—'} recorded purchase value</span></div></section>

    <section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="max-h-[62vh] overflow-auto"><table className="w-full min-w-[1180px] text-sm"><thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground"><tr><th className="p-3 text-left">Device</th><th className="text-left">Assigned to</th><th className="text-left">Location</th><th className="text-left">Identifiers</th><th>Status</th><th>Condition</th><th>Next maintenance</th><th className="pr-3 text-right">Actions</th></tr></thead><tbody>{data?.items.map((item) => <tr key={item.id} className={`border-t border-border ${item.maintenance_state === 'overdue' ? 'bg-red-500/[0.04]' : item.maintenance_state === 'due' ? 'bg-amber-500/[0.03]' : ''}`}><td className="p-3"><p className="font-medium">{item.category || 'Uncategorised'}</p><p className="mt-1 text-xs text-muted-foreground">{[item.brand, item.model].filter(Boolean).join(' · ') || 'Brand/model not recorded'}</p></td><td><p>{item.employee || 'Unassigned'}</p><p className="text-xs text-muted-foreground">{item.department_name || 'No department'}</p></td><td><p>{item.physical_location || 'Not recorded'}</p><p className="text-xs text-muted-foreground">{item.home_office || ''}</p></td><td><p>{item.label_no && !/^nil$/i.test(item.label_no) ? item.label_no : 'No label'}</p><p className="max-w-52 truncate text-xs text-muted-foreground">{item.serial_imei || item.sim_no || 'No serial/IMEI'}</p></td><td className="text-center"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${statusTone(item.status)}`}>{item.status}</span></td><td className="text-center">{item.condition}</td><td className="text-center"><p className={item.maintenance_state === 'overdue' ? 'font-medium text-red-400' : item.maintenance_state === 'due' ? 'font-medium text-amber-400' : ''}>{displayDate(item.next_maintenance_date)}</p>{item.maintenance_days_remaining !== null && <p className="text-xs text-muted-foreground">{item.maintenance_days_remaining < 0 ? `${Math.abs(item.maintenance_days_remaining)} days overdue` : `${item.maintenance_days_remaining} days remaining`}</p>}</td><td className="pr-3"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => void openMaintenance(item)}><Wrench className="mr-1.5 h-3.5 w-3.5" />Service</Button><Button size="sm" variant="outline" onClick={() => openEdit(item)}><Edit3 className="mr-1.5 h-3.5 w-3.5" />Edit</Button></div></td></tr>)}{busy === 'load' && !data && <tr><td colSpan={8} className="p-12 text-center text-muted-foreground"><LoaderCircle className="mx-auto h-5 w-5 animate-spin" /><p className="mt-2">Loading assets…</p></td></tr>}{data?.items.length === 0 && <tr><td colSpan={8} className="p-12 text-center text-muted-foreground"><Boxes className="mx-auto h-7 w-7" /><p className="mt-3 font-medium text-foreground">No matching assets</p><p className="mt-1 text-xs">Change the filters or add a device.</p></td></tr>}</tbody></table></div></section>

    {editing && <Modal title={editing === 'new' ? 'Add a device' : `Edit ${editing.category || 'asset'}`} onClose={() => setEditing(null)}><div className="grid gap-4 sm:grid-cols-2"><TextField label="Category *" value={form.category ?? ''} onChange={(value) => change('category', emptyToNull(value))} /><TextField label="Assigned employee" value={form.employee ?? ''} onChange={(value) => change('employee', emptyToNull(value))} /><TextField label="Physical location" value={form.physical_location ?? ''} onChange={(value) => change('physical_location', emptyToNull(value))} /><TextField label="Department" value={form.department_name ?? ''} onChange={(value) => change('department_name', emptyToNull(value))} /><TextField label="Brand" value={form.brand ?? ''} onChange={(value) => change('brand', emptyToNull(value))} /><TextField label="Model" value={form.model ?? ''} onChange={(value) => change('model', emptyToNull(value))} /><TextField label="Serial / IMEI" value={form.serial_imei ?? ''} onChange={(value) => change('serial_imei', emptyToNull(value))} /><TextField label="Asset label number" value={form.label_no ?? ''} onChange={(value) => change('label_no', emptyToNull(value))} /></div><details className="mt-5 rounded-xl border border-border"><summary className="cursor-pointer p-3 text-sm font-medium">SIM, UPS and purchase details</summary><div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2"><TextField label="SIM number" value={form.sim_no ?? ''} onChange={(value) => change('sim_no', emptyToNull(value))} /><TextField label="UPS" value={form.ups ?? ''} onChange={(value) => change('ups', emptyToNull(value))} /><TextField label="Home / office note" value={form.home_office ?? ''} onChange={(value) => change('home_office', emptyToNull(value))} /><TextField label="Invoice date" type="date" value={form.invoice_date ?? ''} onChange={(value) => change('invoice_date', emptyToNull(value))} /><TextField label="Invoice number" value={form.invoice_no ?? ''} onChange={(value) => change('invoice_no', emptyToNull(value))} /><TextField label="Supplier" value={form.supplier_name ?? ''} onChange={(value) => change('supplier_name', emptyToNull(value))} /><TextField label="Price" type="number" value={form.price?.toString() ?? ''} onChange={(value) => change('price', value ? Number(value) : null)} /><TextField label="Warranty" value={form.warranty ?? ''} onChange={(value) => change('warranty', emptyToNull(value))} /></div></details><details open className="mt-4 rounded-xl border border-border"><summary className="cursor-pointer p-3 text-sm font-medium">Lifecycle and maintenance</summary><div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2"><SelectField label="Status" value={form.status} options={STATUSES} onChange={(value) => change('status', value as AssetStatus)} /><SelectField label="Condition" value={form.condition} options={CONDITIONS} onChange={(value) => change('condition', value as AssetCondition)} /><TextField label="Next maintenance date" type="date" value={form.next_maintenance_date ?? ''} onChange={(value) => change('next_maintenance_date', emptyToNull(value))} /><SelectField label="Notify before" value={String(form.maintenance_reminder_days)} options={['7', '15', '30', '60', '90']} labels={{ '7': '7 days', '15': '15 days', '30': '30 days', '60': '60 days', '90': '90 days' }} onChange={(value) => change('maintenance_reminder_days', Number(value))} /><TextField label="Responsible person" value={form.maintenance_owner ?? ''} onChange={(value) => change('maintenance_owner', emptyToNull(value))} /><TextField label="Maintenance interval (months)" type="number" value={form.maintenance_interval_months?.toString() ?? ''} onChange={(value) => change('maintenance_interval_months', value ? Number(value) : null)} /><label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-muted-foreground">Notes</span><textarea rows={3} value={form.notes ?? ''} onChange={(event) => change('notes', emptyToNull(event.target.value))} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></label>{SCRAP_STATUSES.includes(form.status) && <><label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-muted-foreground">Scrap / disposal reason</span><textarea rows={3} value={form.scrap_reason ?? ''} onChange={(event) => change('scrap_reason', emptyToNull(event.target.value))} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></label><TextField label="Scrap / disposal date" type="date" value={form.scrap_date ?? ''} onChange={(value) => change('scrap_date', emptyToNull(value))} /><TextField label="Recovered scrap value" type="number" value={form.scrap_value?.toString() ?? ''} onChange={(value) => change('scrap_value', value ? Number(value) : null)} /></>}</div></details><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{editing === 'new' ? 'Add device' : 'Save changes'}</Button></div></Modal>}

    {servicing && <Modal title={`Record maintenance · ${servicing.category || 'Asset'}`} onClose={() => setServicing(null)}><div className="rounded-xl bg-muted/30 p-3 text-sm"><p className="font-medium">{servicing.label_no || servicing.serial_imei || `Asset ${servicing.source_sn}`}</p><p className="mt-1 text-xs text-muted-foreground">{servicing.employee || 'Unassigned'} · {servicing.physical_location || 'Location not recorded'}</p></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><TextField label="Service date *" type="date" value={serviceForm.service_date} onChange={(value) => setServiceForm((current) => ({ ...current, service_date: value }))} /><TextField label="Next maintenance date" type="date" value={serviceForm.next_due_date} onChange={(value) => setServiceForm((current) => ({ ...current, next_due_date: value }))} /><TextField label="Service vendor" value={serviceForm.vendor} onChange={(value) => setServiceForm((current) => ({ ...current, vendor: value }))} /><TextField label="Service cost" type="number" value={serviceForm.cost} onChange={(value) => setServiceForm((current) => ({ ...current, cost: value }))} /><label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-muted-foreground">Work completed / remarks</span><textarea rows={3} value={serviceForm.notes} onChange={(event) => setServiceForm((current) => ({ ...current, notes: event.target.value }))} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></label></div>{history.length > 0 && <details className="mt-4 rounded-xl border border-border"><summary className="cursor-pointer p-3 text-sm font-medium">Previous maintenance ({history.length})</summary><div className="divide-y divide-border border-t border-border">{history.map((item) => <div key={item.id} className="p-3 text-sm"><div className="flex justify-between"><span className="font-medium">{displayDate(item.service_date)}</span><span>{money(item.cost)}</span></div><p className="mt-1 text-xs text-muted-foreground">{item.vendor || 'Vendor not recorded'} · Next: {displayDate(item.next_due_date)}</p>{item.notes && <p className="mt-2 text-xs">{item.notes}</p>}</div>)}</div></details>}<div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setServicing(null)}>Cancel</Button><Button disabled={busy !== null || !serviceForm.service_date} onClick={() => void recordMaintenance()}>{busy === 'maintenance' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}Save maintenance</Button></div></Modal>}
  </main></AppLayout>
}

function Kpi({ label, value, icon, tone = '' }: { label: string; value: string | number; icon: React.ReactNode; tone?: string }) { return <div className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between"><p className={`text-2xl font-semibold ${tone}`}>{value}</p><span className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span></div><p className="mt-1 text-xs text-muted-foreground">{label}</p></div> }
function Filter({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl border border-border bg-background px-3 text-sm"><option value="All">{label}</option>{options.map((option) => <option key={option}>{option}</option>)}</select> }
function TextField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><input type={type} min={type === 'number' ? 0 : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label> }
function SelectField({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) { return <label><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">{options.map((option) => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}</select></label> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"><section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"><header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button></header><div className="p-5">{children}</div></section></div> }
