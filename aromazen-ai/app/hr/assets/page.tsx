'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BellOff, BellRing, Boxes, CalendarDays, CheckCircle2, ChevronDown, Clock3, Download,
  Edit3, FileSpreadsheet, Laptop, LoaderCircle, MapPin, Plus, Recycle, Search, Settings2,
  Tag, Trash2, Upload, UserRound, Wrench, X,
} from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { api } from '@/lib/api/services'
import { ApiError } from '@/lib/api/client'
import type {
  AssetCondition, AssetGroup, AssetListResponse, AssetMaintenanceEvent, AssetNotificationSettings,
  AssetPayload, AssetStatus, ITAsset,
} from '@/lib/api/types'

const STATUSES: AssetStatus[] = ['Active', 'Spare', 'Under maintenance', 'Repair needed', 'Recovery required', 'Lost', 'Scrap proposed', 'Approved for scrap', 'Scrapped', 'Disposed']
const CONDITIONS: AssetCondition[] = ['Good', 'Fair', 'Poor', 'Damaged', 'Obsolete']
const SCRAP_STATUSES: AssetStatus[] = ['Scrap proposed', 'Approved for scrap', 'Scrapped', 'Disposed']

const defaultNotificationSettings = (): AssetNotificationSettings => ({
  default_notification_enabled: true,
  default_reminder_days: 30,
  default_maintenance_interval_months: null,
  notify_inventory_admin: true,
  notify_hr_admin: true,
  notify_accounts_admin: true,
  notify_admins: true,
  apply_to_current_assets: false,
  updated_at: null,
})

const blankAsset = (settings = defaultNotificationSettings(), assetGroup: AssetGroup = 'General'): AssetPayload => ({
  asset_group: assetGroup, source_register: 'Manual entry', employee: null, physical_location: null, department_name: null,
  home_office: null, category: null, brand: null, model: null, serial_imei: null, sim_no: null,
  ups: null, label_no: null, invoice_date: null, invoice_no: null, supplier_name: null, price: null,
  warranty: null, custom_fields: {}, status: 'Active', condition: 'Good', notes: null,
  last_maintenance_date: null, next_maintenance_date: null,
  maintenance_interval_months: settings.default_maintenance_interval_months,
  maintenance_reminder_days: settings.default_reminder_days,
  notification_enabled: settings.default_notification_enabled,
  maintenance_owner: null, maintenance_notes: null, scrap_reason: null, scrap_date: null, scrap_value: null,
})

function assetPayload(item: ITAsset): AssetPayload {
  const { id: _id, source_sn: _source, maintenance_state: _state, maintenance_days_remaining: _days, created_at: _created, updated_at: _updated, ...payload } = item
  return payload
}

function money(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}
function displayDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)) : 'Not scheduled'
}
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
  const [notificationSettings, setNotificationSettings] = useState(defaultNotificationSettings())
  const [settingsForm, setSettingsForm] = useState(defaultNotificationSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [assetGroup, setAssetGroup] = useState<AssetGroup>('IT')
  const [status, setStatus] = useState('All')
  const [category, setCategory] = useState('All')
  const [location, setLocation] = useState('All')
  const [department, setDepartment] = useState('All')
  const [register, setRegister] = useState('All')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [busy, setBusy] = useState<'load' | 'save' | 'import' | 'export' | 'maintenance' | 'remove' | 'settings' | null>(null)
  const [editing, setEditing] = useState<ITAsset | 'new' | null>(null)
  const [form, setForm] = useState<AssetPayload>(blankAsset())
  const [servicing, setServicing] = useState<ITAsset | null>(null)
  const [serviceForm, setServiceForm] = useState({ service_date: new Date().toISOString().slice(0, 10), vendor: '', cost: '', notes: '', next_due_date: '' })
  const [history, setHistory] = useState<AssetMaintenanceEvent[]>([])
  const isTopAdmin = user?.role_names.some((role) => role === 'Super Admin' || role === 'Admin')
  const canUse = hasPermission('users.manage') && (['Inventory', 'HR', 'Accounts'].includes(user?.department_name ?? '') || isTopAdmin)

  const load = useCallback(async (quiet = false) => {
    if (!accessToken || !canUse) return
    if (!quiet) setBusy('load')
    try {
      const [assets, settings] = await Promise.all([
        api.assets.list(accessToken, { search, status, category, location, department, register, assetGroup, attentionOnly }),
        api.assets.notificationSettings(accessToken),
      ])
      setData(assets)
      setNotificationSettings(settings)
    } catch (error) {
      notify('error', error instanceof ApiError ? error.message : 'Unable to load the asset inventory.')
    } finally { if (!quiet) setBusy(null) }
  }, [accessToken, assetGroup, attentionOnly, canUse, category, department, location, notify, register, search, status])

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('attention') === '1') setAttentionOnly(true)
  }, [])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer) }, [load])

  const filteredValue = useMemo(() => data?.items.reduce((sum, item) => sum + (item.price ?? 0), 0) ?? 0, [data])
  function openNew() { setForm(blankAsset(notificationSettings, assetGroup)); setEditing('new') }
  function switchAssetGroup(nextGroup: AssetGroup) {
    setAssetGroup(nextGroup)
    setSearch(''); setStatus('All'); setCategory('All'); setLocation('All'); setDepartment('All'); setRegister('All'); setAttentionOnly(false)
  }
  function openEdit(item: ITAsset) { setForm(assetPayload(item)); setEditing(item) }
  function change<K extends keyof AssetPayload>(key: K, value: AssetPayload[K]) { setForm((current) => ({ ...current, [key]: value })) }

  async function save() {
    if (!accessToken || !editing || !form.category?.trim()) return notify('error', 'Asset category is required.')
    setBusy('save')
    try {
      if (editing === 'new') await api.assets.create(accessToken, form)
      else await api.assets.update(accessToken, editing.id, form)
      notify('success', editing === 'new' ? 'Asset added to the inventory.' : 'Asset details updated.')
      setEditing(null); await load(true)
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to save this asset.') }
    finally { setBusy(null) }
  }

  async function remove(item: ITAsset) {
    if (!accessToken || !window.confirm(`Permanently remove ${item.category || 'this asset'} ${item.label_no ? `(${item.label_no})` : ''}? Service history will also be removed.`)) return
    setBusy('remove')
    try { await api.assets.remove(accessToken, item.id); notify('success', 'Asset removed from the inventory.'); await load(true) }
    catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to remove this asset.') }
    finally { setBusy(null) }
  }

  async function importExcel(files: FileList | null) {
    if (!accessToken || !files?.length) return
    setBusy('import')
    try {
      let created = 0; let updated = 0
      for (const file of Array.from(files)) {
        const result = await api.assets.importRegister(accessToken, file)
        created += result.created; updated += result.updated
      }
      notify('success', `${created} new and ${updated} existing assets processed from ${files.length} workbook${files.length === 1 ? '' : 's'}.`)
      await load(true)
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to import one of the asset workbooks.') }
    finally { setBusy(null); if (importRef.current) importRef.current.value = '' }
  }

  async function exportExcel() {
    if (!accessToken) return
    setBusy('export')
    try {
      const file = await api.assets.exportRegister(accessToken, assetGroup)
      const url = URL.createObjectURL(file.blob); const link = document.createElement('a')
      link.href = url; link.download = file.filename; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify('success', `${assetGroup} asset register downloaded.`)
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to download the asset register.') }
    finally { setBusy(null) }
  }

  async function openMaintenance(item: ITAsset) {
    setServicing(item)
    setServiceForm({ service_date: new Date().toISOString().slice(0, 10), vendor: '', cost: '', notes: '', next_due_date: item.next_maintenance_date ?? '' })
    if (accessToken) setHistory(await api.assets.maintenanceHistory(accessToken, item.id).catch(() => []))
  }
  async function recordMaintenance() {
    if (!accessToken || !servicing || !serviceForm.service_date) return
    setBusy('maintenance')
    try {
      await api.assets.recordMaintenance(accessToken, servicing.id, {
        service_date: serviceForm.service_date, vendor: emptyToNull(serviceForm.vendor),
        cost: serviceForm.cost ? Number(serviceForm.cost) : null, notes: emptyToNull(serviceForm.notes),
        next_due_date: emptyToNull(serviceForm.next_due_date),
      })
      notify('success', 'Service recorded and the next reminder date updated.')
      setServicing(null); await load(true)
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to record this service.') }
    finally { setBusy(null) }
  }

  function openSettings() { setSettingsForm({ ...notificationSettings, apply_to_current_assets: false }); setSettingsOpen(true) }
  async function saveSettings() {
    if (!accessToken) return
    setBusy('settings')
    try {
      const { updated_at: _updated, ...payload } = settingsForm
      const saved = await api.assets.updateNotificationSettings(accessToken, payload)
      setNotificationSettings(saved); setSettingsOpen(false)
      notify('success', settingsForm.apply_to_current_assets ? 'Notification defaults saved and applied to current assets.' : 'Notification defaults saved for new assets.')
      await load(true)
    } catch (error) { notify('error', error instanceof ApiError ? error.message : 'Unable to save notification settings.') }
    finally { setBusy(null) }
  }

  if (!canUse) return <AppLayout><main className="grid min-h-[70vh] place-items-center p-6"><div className="max-w-md text-center"><Boxes className="mx-auto h-10 w-10 text-muted-foreground" /><h1 className="mt-3 text-xl font-semibold">Asset inventory access required</h1><p className="mt-2 text-sm text-muted-foreground">Available to Inventory, HR and Accounts administrators, Admin and Super Admin.</p></div></main></AppLayout>

  return <AppLayout><main className="space-y-5 p-4 md:p-6">
    <PageHeader title="Asset & Inventory Management" description="Separate, easy-to-manage registers for technology and general company assets." actions={<div className="flex flex-wrap gap-2"><input ref={importRef} hidden multiple type="file" accept=".xlsx,.xlsm" onChange={(event) => void importExcel(event.target.files)} /><Button variant="outline" disabled={busy !== null} onClick={() => importRef.current?.click()}>{busy === 'import' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Import workbooks</Button><Button variant="outline" disabled={busy !== null} onClick={() => void exportExcel()}><Download className="mr-2 h-4 w-4" />Download register</Button><Button variant="outline" onClick={openSettings}><Settings2 className="mr-2 h-4 w-4" />Notifications</Button><Button onClick={openNew}><Plus className="mr-2 h-4 w-4" />Add asset</Button></div>} />

    <section className="grid gap-3 md:grid-cols-2" aria-label="Asset registers">
      <RegisterChoice active={assetGroup === 'IT'} title="IT Assets" description="Computers, laptops, mobiles, printers and network equipment" count={data?.group_counts.IT} icon={<Laptop />} onClick={() => switchAssetGroup('IT')} />
      <RegisterChoice active={assetGroup === 'General'} title="General Assets" description="Plant machinery, CCTV, vehicles, ACs, scales and appliances" count={data?.group_counts.General} icon={<Boxes />} onClick={() => switchAssetGroup('General')} />
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Kpi label="Total assets" value={data?.summary.total ?? '—'} icon={<Boxes />} /><Kpi label="Active / spare" value={data ? `${data.summary.active} / ${data.summary.spare}` : '—'} icon={<CheckCircle2 />} /><Kpi label="Service due" value={data?.summary.maintenance_due ?? '—'} icon={<CalendarDays />} tone={data?.summary.maintenance_overdue ? 'text-red-400' : 'text-amber-400'} /><Kpi label="Repair / recovery" value={data ? data.summary.repair_needed + data.summary.recovery_required : '—'} icon={<Wrench />} tone="text-amber-400" /><Kpi label="Scrap queue" value={data?.summary.scrap_queue ?? '—'} icon={<Recycle />} tone={data?.summary.scrap_queue ? 'text-red-400' : ''} /></section>

    <section className="rounded-2xl border border-border bg-card p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label className="relative md:col-span-2"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search asset, person, label, serial or vehicle" className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm" /></label><Filter value={register} onChange={setRegister} options={data?.registers ?? []} label="All registers" /><Filter value={status} onChange={setStatus} options={STATUSES} label="All statuses" /><Filter value={category} onChange={setCategory} options={data?.categories ?? []} label="All categories" /><Filter value={location} onChange={setLocation} options={data?.locations ?? []} label="All locations" /><Filter value={department} onChange={setDepartment} options={data?.departments ?? []} label="All departments" /><button type="button" onClick={() => setAttentionOnly((value) => !value)} className={`h-11 rounded-xl border px-4 text-sm font-medium transition-colors ${attentionOnly ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'}`}>Needs attention</button></div><div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground"><span>{data?.items.length ?? 0} assets shown · {money(filteredValue)} shown value</span><span>{data ? money(data.summary.total_value) : '—'} total recorded value</span></div></section>

    <AssetInventoryList assetGroup={assetGroup} data={data} busy={busy} onService={(item) => void openMaintenance(item)} onEdit={openEdit} onRemove={(item) => void remove(item)} />

    {editing && <Modal title={editing === 'new' ? 'Add an asset' : `Edit ${editing.category || 'asset'}`} onClose={() => setEditing(null)}><div className="grid gap-4 sm:grid-cols-2"><TextField label="Category *" value={form.category ?? ''} onChange={(value) => change('category', emptyToNull(value))} /><TextField label="Source register" value={form.source_register ?? ''} onChange={(value) => change('source_register', emptyToNull(value))} /><TextField label="Assigned employee / user" value={form.employee ?? ''} onChange={(value) => change('employee', emptyToNull(value))} /><TextField label="Department" value={form.department_name ?? ''} onChange={(value) => change('department_name', emptyToNull(value))} /><TextField label="Physical location" value={form.physical_location ?? ''} onChange={(value) => change('physical_location', emptyToNull(value))} /><TextField label="Home / office note" value={form.home_office ?? ''} onChange={(value) => change('home_office', emptyToNull(value))} /><TextField label="Brand" value={form.brand ?? ''} onChange={(value) => change('brand', emptyToNull(value))} /><TextField label="Model" value={form.model ?? ''} onChange={(value) => change('model', emptyToNull(value))} /><TextField label="Serial / IMEI / chassis" value={form.serial_imei ?? ''} onChange={(value) => change('serial_imei', emptyToNull(value))} /><TextField label="Asset label / registration" value={form.label_no ?? ''} onChange={(value) => change('label_no', emptyToNull(value))} /></div><details className="mt-5 rounded-xl border border-border"><summary className="cursor-pointer p-3 text-sm font-medium">Purchase, SIM and other details</summary><div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2"><TextField label="SIM number" value={form.sim_no ?? ''} onChange={(value) => change('sim_no', emptyToNull(value))} /><TextField label="UPS / stabilizer note" value={form.ups ?? ''} onChange={(value) => change('ups', emptyToNull(value))} /><TextField label="Invoice date" type="date" value={form.invoice_date ?? ''} onChange={(value) => change('invoice_date', emptyToNull(value))} /><TextField label="Invoice number" value={form.invoice_no ?? ''} onChange={(value) => change('invoice_no', emptyToNull(value))} /><TextField label="Supplier" value={form.supplier_name ?? ''} onChange={(value) => change('supplier_name', emptyToNull(value))} /><TextField label="Price" type="number" value={form.price?.toString() ?? ''} onChange={(value) => change('price', value ? Number(value) : null)} /><TextField label="Warranty" value={form.warranty ?? ''} onChange={(value) => change('warranty', emptyToNull(value))} /><div className="sm:col-span-2"><CustomFieldsEditor value={form.custom_fields} onChange={(value) => change('custom_fields', value)} /></div></div></details><details open className="mt-4 rounded-xl border border-border"><summary className="cursor-pointer p-3 text-sm font-medium">Lifecycle, service and reminders</summary><div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2"><SelectField label="Status" value={form.status} options={STATUSES} onChange={(value) => change('status', value as AssetStatus)} /><SelectField label="Condition" value={form.condition} options={CONDITIONS} onChange={(value) => change('condition', value as AssetCondition)} /><TextField label="Last service date" type="date" value={form.last_maintenance_date ?? ''} onChange={(value) => change('last_maintenance_date', emptyToNull(value))} /><TextField label="Next service date" type="date" value={form.next_maintenance_date ?? ''} onChange={(value) => change('next_maintenance_date', emptyToNull(value))} /><SelectField label="Notify before" value={String(form.maintenance_reminder_days)} options={['0', '7', '15', '30', '60', '90']} labels={{ '0': 'On due date', '7': '7 days', '15': '15 days', '30': '30 days', '60': '60 days', '90': '90 days' }} onChange={(value) => change('maintenance_reminder_days', Number(value))} /><TextField label="Service interval (months)" type="number" value={form.maintenance_interval_months?.toString() ?? ''} onChange={(value) => change('maintenance_interval_months', value ? Number(value) : null)} /><TextField label="Responsible person" value={form.maintenance_owner ?? ''} onChange={(value) => change('maintenance_owner', emptyToNull(value))} /><ToggleField label="Send service notifications for this asset" checked={form.notification_enabled} onChange={(value) => change('notification_enabled', value)} /><label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-muted-foreground">Notes</span><textarea rows={3} value={form.notes ?? ''} onChange={(event) => change('notes', emptyToNull(event.target.value))} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></label>{SCRAP_STATUSES.includes(form.status) && <><label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-muted-foreground">Scrap / disposal reason</span><textarea rows={3} value={form.scrap_reason ?? ''} onChange={(event) => change('scrap_reason', emptyToNull(event.target.value))} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></label><TextField label="Scrap / disposal date" type="date" value={form.scrap_date ?? ''} onChange={(value) => change('scrap_date', emptyToNull(value))} /><TextField label="Recovered scrap value" type="number" value={form.scrap_value?.toString() ?? ''} onChange={(value) => change('scrap_value', value ? Number(value) : null)} /></>}</div></details><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{editing === 'new' ? 'Add asset' : 'Save changes'}</Button></div></Modal>}

    {servicing && <Modal title={`Record service · ${servicing.category || 'Asset'}`} onClose={() => setServicing(null)}><div className="rounded-xl bg-muted/30 p-3 text-sm"><p className="font-medium">{servicing.label_no || servicing.serial_imei || `Asset ${servicing.source_sn}`}</p><p className="mt-1 text-xs text-muted-foreground">{servicing.employee || 'Unassigned'} · {servicing.physical_location || 'Location not recorded'}</p></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><TextField label="Service date *" type="date" value={serviceForm.service_date} onChange={(value) => setServiceForm((current) => ({ ...current, service_date: value }))} /><TextField label="Next service date" type="date" value={serviceForm.next_due_date} onChange={(value) => setServiceForm((current) => ({ ...current, next_due_date: value }))} /><TextField label="Service vendor" value={serviceForm.vendor} onChange={(value) => setServiceForm((current) => ({ ...current, vendor: value }))} /><TextField label="Service cost" type="number" value={serviceForm.cost} onChange={(value) => setServiceForm((current) => ({ ...current, cost: value }))} /><label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-muted-foreground">Work completed / remarks</span><textarea rows={3} value={serviceForm.notes} onChange={(event) => setServiceForm((current) => ({ ...current, notes: event.target.value }))} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></label></div>{history.length > 0 && <details className="mt-4 rounded-xl border border-border"><summary className="cursor-pointer p-3 text-sm font-medium">Previous service ({history.length})</summary><div className="divide-y divide-border border-t border-border">{history.map((item) => <div key={item.id} className="p-3 text-sm"><div className="flex justify-between"><span className="font-medium">{displayDate(item.service_date)}</span><span>{money(item.cost)}</span></div><p className="mt-1 text-xs text-muted-foreground">{item.vendor || 'Vendor not recorded'} · Next: {displayDate(item.next_due_date)}</p>{item.notes && <p className="mt-2 text-xs">{item.notes}</p>}</div>)}</div></details>}<div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setServicing(null)}>Cancel</Button><Button disabled={busy !== null || !serviceForm.service_date} onClick={() => void recordMaintenance()}>{busy === 'maintenance' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}Save service</Button></div></Modal>}

    {settingsOpen && <Modal title="Asset notification settings" onClose={() => setSettingsOpen(false)}><div className="rounded-xl border border-border bg-muted/25 p-4"><p className="text-sm font-medium">Defaults for newly added or imported assets</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><ToggleField label="Enable service notifications" checked={settingsForm.default_notification_enabled} onChange={(value) => setSettingsForm((current) => ({ ...current, default_notification_enabled: value }))} /><SelectField label="Default reminder" value={String(settingsForm.default_reminder_days)} options={['0', '7', '15', '30', '60', '90']} labels={{ '0': 'On due date', '7': '7 days', '15': '15 days', '30': '30 days', '60': '60 days', '90': '90 days' }} onChange={(value) => setSettingsForm((current) => ({ ...current, default_reminder_days: Number(value) }))} /><TextField label="Default service interval (months)" type="number" value={settingsForm.default_maintenance_interval_months?.toString() ?? ''} onChange={(value) => setSettingsForm((current) => ({ ...current, default_maintenance_interval_months: value ? Number(value) : null }))} /></div></div><div className="mt-4 rounded-xl border border-border p-4"><p className="text-sm font-medium">Who receives service alerts</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><ToggleField label="Inventory Admin" checked={settingsForm.notify_inventory_admin} onChange={(value) => setSettingsForm((current) => ({ ...current, notify_inventory_admin: value }))} /><ToggleField label="HR Admin" checked={settingsForm.notify_hr_admin} onChange={(value) => setSettingsForm((current) => ({ ...current, notify_hr_admin: value }))} /><ToggleField label="Accounts Admin" checked={settingsForm.notify_accounts_admin} onChange={(value) => setSettingsForm((current) => ({ ...current, notify_accounts_admin: value }))} /><ToggleField label="Admin and Super Admin" checked={settingsForm.notify_admins} onChange={(value) => setSettingsForm((current) => ({ ...current, notify_admins: value }))} /></div></div><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4"><input type="checkbox" checked={settingsForm.apply_to_current_assets} onChange={(event) => setSettingsForm((current) => ({ ...current, apply_to_current_assets: event.target.checked }))} className="mt-1 h-4 w-4" /><span><span className="block text-sm font-medium">Apply these defaults to all current assets</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Updates reminder timing and notification switches for existing records. Leave off to affect only future assets.</span></span></label><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button><Button disabled={busy !== null} onClick={() => void saveSettings()}>{busy === 'settings' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <BellRing className="mr-2 h-4 w-4" />}Save settings</Button></div></Modal>}
  </main></AppLayout>
}

function RegisterChoice({ active, title, description, count, icon, onClick }: { active: boolean; title: string; description: string; count?: number; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`group flex min-h-28 items-center gap-4 rounded-2xl border p-4 text-left transition-all ${active ? 'border-primary/45 bg-primary/[0.08] shadow-sm ring-1 ring-primary/15' : 'border-border bg-card hover:border-primary/25 hover:bg-muted/30'}`}>
    <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:text-foreground'}`}>{icon}</span>
    <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="font-semibold">{title}</span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{count ?? '—'}</span></span><span className="mt-1.5 block text-xs leading-5 text-muted-foreground">{description}</span></span>
  </button>
}

function AssetInventoryList({ assetGroup, data, busy, onService, onEdit, onRemove }: {
  assetGroup: AssetGroup
  data: AssetListResponse | null
  busy: string | null
  onService: (item: ITAsset) => void
  onEdit: (item: ITAsset) => void
  onRemove: (item: ITAsset) => void
}) {
  return <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-5">
      <div><h2 className="text-sm font-semibold">{assetGroup === 'IT' ? 'IT asset register' : 'General asset register'}</h2><p className="mt-1 text-xs text-muted-foreground">Scan the essentials. Open source details only when you need them.</p></div>
      <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">{data?.items.length ?? 0} records</span>
    </header>
    <div className="max-h-[68vh] divide-y divide-border/70 overflow-y-auto">
      {data?.items.map((item) => {
        const customEntries = Object.entries(item.custom_fields || {})
        const identity = item.label_no && !/^nil$/i.test(item.label_no) ? item.label_no : item.serial_imei || item.sim_no || 'Identifier not recorded'
        const secondaryIdentity = item.label_no && !/^nil$/i.test(item.label_no) ? item.serial_imei || item.sim_no : null
        const attentionTone = item.maintenance_state === 'overdue' ? 'border-l-red-500 bg-red-500/[0.025]' : item.maintenance_state === 'due' ? 'border-l-amber-500 bg-amber-500/[0.025]' : 'border-l-transparent'
        return <article key={item.id} className={`border-l-2 px-4 py-4 transition-colors hover:bg-muted/20 md:px-5 ${attentionTone}`}>
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(220px,1.25fr)_minmax(150px,.75fr)_minmax(190px,1fr)_minmax(170px,.85fr)_auto] xl:items-center">
            <div className="relative min-w-0">
              <div className="flex items-start gap-3"><span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-primary"><Boxes className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate font-semibold text-foreground">{item.category || 'Uncategorised asset'}</p><p className="mt-0.5 truncate text-sm text-muted-foreground">{[item.brand, item.model].filter(Boolean).join(' · ') || 'Brand and model not recorded'}</p></div></div>
              <div className="ml-[52px] mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"><FileSpreadsheet className="h-3 w-3 shrink-0" /><span className="truncate" title={item.source_register || 'Manual entry'}>{item.source_register?.replace(/\.xlsx$/i, '') || 'Manual entry'}</span></div>
              {customEntries.length > 0 && <details className="group ml-[52px] mt-2 text-xs"><summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-primary"><ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />{customEntries.length} source detail{customEntries.length === 1 ? '' : 's'}</summary><dl className="mt-2 grid gap-1.5 rounded-xl border border-border/70 bg-background/60 p-3 sm:grid-cols-2 xl:absolute xl:z-20 xl:w-[420px] xl:shadow-2xl">{customEntries.map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{key}</dt><dd className="mt-0.5 break-words text-foreground">{value}</dd></div>)}</dl></details>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <InfoLine icon={<UserRound />} label="Assigned to" value={item.employee || 'Unassigned'} detail={item.department_name || 'No department'} />
              <InfoLine icon={<MapPin />} label="Location" value={item.physical_location || 'Not recorded'} detail={item.home_office} />
            </div>

            <div className="min-w-0 rounded-xl border border-border/70 bg-background/45 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">Asset identifier</p>
              <div className="mt-2 flex min-w-0 items-center gap-2"><Tag className="h-3.5 w-3.5 shrink-0 text-primary" /><span className="truncate text-sm font-medium" title={identity}>{identity}</span></div>
              <p className="mt-1 truncate pl-[22px] text-xs text-muted-foreground" title={secondaryIdentity || undefined}>{secondaryIdentity || 'No secondary identifier'}</p>
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusTone(item.status)}`}>{item.status}</span><span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">{item.condition}</span></div>
              <div className={`mt-3 flex items-start gap-2 text-sm ${item.maintenance_state === 'overdue' ? 'text-red-400' : item.maintenance_state === 'due' ? 'text-amber-400' : 'text-foreground'}`}><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" /><div><p className="font-medium">{displayDate(item.next_maintenance_date)}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.maintenance_days_remaining === null ? 'Service not scheduled' : item.maintenance_days_remaining < 0 ? `${Math.abs(item.maintenance_days_remaining)} days overdue` : `${item.maintenance_days_remaining} days remaining`}</p></div></div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">{item.notification_enabled ? <BellRing className="h-3.5 w-3.5 text-emerald-400" /> : <BellOff className="h-3.5 w-3.5" />}Alerts {item.notification_enabled ? `on · ${item.maintenance_reminder_days} days before` : 'off'}</div>
            </div>

            <div className="flex items-center gap-2 xl:justify-end">
              <Button size="icon" variant="outline" onClick={() => onService(item)} aria-label={`Record service for ${item.category || 'asset'}`} title="Record service"><Wrench /></Button>
              <Button size="icon" variant="outline" onClick={() => onEdit(item)} aria-label={`Edit ${item.category || 'asset'}`} title="Edit asset"><Edit3 /></Button>
              <Button size="icon" variant="ghost" disabled={busy !== null} onClick={() => onRemove(item)} aria-label={`Remove ${item.category || 'asset'}`} title="Remove asset" className="text-muted-foreground hover:bg-red-500/10 hover:text-red-400"><Trash2 /></Button>
            </div>
          </div>
        </article>
      })}
      {busy === 'load' && !data && <div className="p-12 text-center text-muted-foreground"><LoaderCircle className="mx-auto h-5 w-5 animate-spin" /><p className="mt-2 text-sm">Loading assets…</p></div>}
      {data?.items.length === 0 && <div className="p-12 text-center text-muted-foreground"><Boxes className="mx-auto h-7 w-7" /><p className="mt-3 font-medium text-foreground">No matching assets</p><p className="mt-1 text-xs">Change the filters or add an asset.</p></div>}
    </div>
  </section>
}

function InfoLine({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string | null }) {
  return <div className="flex min-w-0 gap-2 text-sm"><span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">{label}</p><p className="mt-0.5 truncate font-medium text-foreground" title={value}>{value}</p>{detail && <p className="truncate text-xs text-muted-foreground" title={detail}>{detail}</p>}</div></div>
}

function Kpi({ label, value, icon, tone = '' }: { label: string; value: string | number; icon: React.ReactNode; tone?: string }) { return <div className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between"><p className={`text-2xl font-semibold ${tone}`}>{value}</p><span className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span></div><p className="mt-1 text-xs text-muted-foreground">{label}</p></div> }
function Filter({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl border border-border bg-background px-3 text-sm"><option value="All">{label}</option>{options.map((option) => <option key={option}>{option}</option>)}</select> }
function TextField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><input type={type} min={type === 'number' ? 0 : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /></label> }
function SelectField({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) { return <label><span className="mb-1.5 block text-xs text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">{options.map((option) => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}</select></label> }
function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 text-sm"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4" /></label> }
function CustomFieldsEditor({ value, onChange }: { value: Record<string, string>; onChange: (value: Record<string, string>) => void }) { const entries = Object.entries(value); function update(index: number, key: string, fieldValue: string) { const next = [...entries]; next[index] = [key, fieldValue]; onChange(Object.fromEntries(next.filter(([name]) => name.trim()))) } return <div><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Equipment-specific source details</span><button type="button" onClick={() => onChange({ ...value, [`Detail ${entries.length + 1}`]: '' })} className="text-xs font-medium text-primary">+ Add detail</button></div><div className="mt-2 space-y-2">{entries.length === 0 ? <p className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">Add details such as tonnage, capacity, engine number, insurance period or operating status.</p> : entries.map(([key, fieldValue], index) => <div key={`${key}-${index}`} className="grid grid-cols-[minmax(120px,.7fr)_1fr_auto] gap-2"><input value={key} onChange={(event) => update(index, event.target.value, fieldValue)} placeholder="Detail name" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" /><input value={fieldValue} onChange={(event) => update(index, key, event.target.value)} placeholder="Value" className="h-10 rounded-lg border border-border bg-background px-3 text-sm" /><button type="button" onClick={() => onChange(Object.fromEntries(entries.filter((_, itemIndex) => itemIndex !== index)))} className="rounded-lg border border-border px-3 text-red-400"><X className="h-4 w-4" /></button></div>)}</div></div> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"><section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"><header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button></header><div className="p-5">{children}</div></section></div> }
