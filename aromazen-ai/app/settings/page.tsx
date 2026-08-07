'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { BellRing, Bot, Database, ExternalLink, Loader2, Palette, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { useToast } from '@/components/ui/toast-provider'
import { ApiError } from '@/lib/api/client'
import { api } from '@/lib/api/services'
import type { OrganizationSettings } from '@/lib/api/types'

function bytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${(value / 1024 ** 3).toFixed(2)} GB` }
function applyTheme(theme: OrganizationSettings['theme']) { const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.classList.toggle('dark', dark); document.documentElement.classList.toggle('light', !dark) }

export default function SettingsPage() {
  const { accessToken, refreshProfile } = useAuth()
  const { notify } = useToast()
  const [settings, setSettings] = useState<OrganizationSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    try { const result = await api.settings.get(accessToken); setSettings(result); applyTheme(result.theme) }
    catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to load organization settings.') }
    finally { setLoading(false) }
  }, [accessToken, notify])
  useEffect(() => { void load() }, [load])

  function field<K extends keyof OrganizationSettings>(key: K, value: OrganizationSettings[K]) { setSettings((current) => current ? { ...current, [key]: value } : current) }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!accessToken || !settings) return; setBusy(true)
    try {
      const result = await api.settings.update(accessToken, { organization_name: settings.organization_name, platform_name: settings.platform_name, theme: settings.theme, default_ai_provider: settings.default_ai_provider, session_timeout_minutes: settings.session_timeout_minutes, timezone: settings.timezone, daily_ai_request_limit: settings.daily_ai_request_limit, monthly_ai_request_limit: settings.monthly_ai_request_limit, monthly_ai_cost_limit_inr: settings.monthly_ai_cost_limit_inr })
      setSettings(result); applyTheme(result.theme); await refreshProfile(); notify('success', 'Organization settings saved. AI routing and new session duration are now active.')
    } catch (reason) { notify('error', reason instanceof ApiError ? reason.message : 'Unable to save organization settings.') }
    finally { setBusy(false) }
  }

  if (loading || !settings) return <AppLayout><div className="grid min-h-[60vh] place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading live settings…</div></div></AppLayout>
  return <AppLayout><form onSubmit={save} className="space-y-6 p-6">
    <PageHeader title="Organization Settings" description="Persistent controls for branding, appearance, AI routing, security, and operational capacity" actions={<div className="flex gap-2"><Button type="button" variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Reload</Button><Button type="submit" disabled={busy}><Save className="mr-2 h-4 w-4" />{busy ? 'Saving…' : 'Save changes'}</Button></div>} />

    <div className="grid gap-6 xl:grid-cols-2">
      <Section icon={<ShieldCheck />} title="Organization profile" description="Names displayed across the managed portal.">
        <Field label="Organization name"><input required value={settings.organization_name} onChange={(e) => field('organization_name', e.target.value)} className="control" /></Field>
        <Field label="Platform name"><input required value={settings.platform_name} onChange={(e) => field('platform_name', e.target.value)} className="control" /></Field>
        <Field label="Organization timezone"><select value={settings.timezone} onChange={(e) => field('timezone', e.target.value)} className="control"><option value="Asia/Calcutta">India Standard Time</option><option value="UTC">UTC</option><option value="Asia/Dubai">Dubai</option><option value="Europe/London">London</option><option value="America/New_York">New York</option></select></Field>
      </Section>

      <Section icon={<Palette />} title="Appearance" description="Saved to the organization database and applied for every signed-in session.">
        <div className="grid gap-3 sm:grid-cols-3">{(['light', 'dark', 'system'] as const).map((theme) => <label key={theme} className={`cursor-pointer rounded-xl border p-4 capitalize transition ${settings.theme === theme ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/40'}`}><input className="mr-2" type="radio" name="theme" checked={settings.theme === theme} onChange={() => { field('theme', theme); applyTheme(theme) }} />{theme}<p className="mt-2 text-xs normal-case text-muted-foreground">{theme === 'system' ? 'Follow the device appearance' : theme === 'light' ? 'Ivory, charcoal, and warm accents' : 'Deep graphite with cool green accents'}</p></label>)}</div>
      </Section>

      <Section icon={<Bot />} title="AI provider routing" description="Choose the primary provider. The existing provider remains an automatic fallback when available.">
        <div className="space-y-3">{settings.providers.map((provider) => <label key={provider.key} className={`flex items-start gap-3 rounded-lg border p-4 ${provider.connected ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} ${settings.default_ai_provider === provider.key ? 'border-primary bg-primary/10' : 'border-border'}`}><input type="radio" name="provider" disabled={!provider.connected} checked={settings.default_ai_provider === provider.key} onChange={() => field('default_ai_provider', provider.key)} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between"><span className="font-medium">{provider.name}</span><span className={`text-xs ${provider.connected ? 'text-emerald-500' : 'text-muted-foreground'}`}>{provider.connected ? 'Connected' : 'Not configured'}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{provider.models.join(' · ')}</p></div></label>)}</div>
        <div className="flex items-center justify-between rounded-lg border border-border p-4"><div><p className="text-sm font-medium">Zoho Mail</p><p className="mt-1 text-xs text-muted-foreground">Secure confirmed email sending from AI chat</p></div><span className={`text-xs ${settings.zoho_email_connected ? 'text-emerald-500' : 'text-muted-foreground'}`}>{settings.zoho_email_connected ? 'Connected' : 'Not configured'}</span></div>
      </Section>

      <Section icon={<ShieldCheck />} title="Security and accountability" description="Applies to newly issued access tokens; refresh sessions remain securely rotated.">
        <Field label="Access session duration"><select value={settings.session_timeout_minutes} onChange={(e) => field('session_timeout_minutes', Number(e.target.value))} className="control"><option value={30}>30 minutes</option><option value={120}>2 hours</option><option value={480}>8 hours</option><option value={1440}>24 hours</option></select></Field>
        <Link href="/admin/users" className="block"><Button type="button" variant="outline" className="w-full">View users and audit log <ExternalLink className="ml-2 h-4 w-4" /></Button></Link>
      </Section>

      <div id="usage-alerts"><Section icon={<BellRing />} title="AI usage alerts" description="Notify employees and their administration hierarchy before request or cost limits are exceeded.">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Daily requests per employee"><input type="number" min={1} value={settings.daily_ai_request_limit} onChange={(e) => field('daily_ai_request_limit', Number(e.target.value))} className="control" /></Field><Field label="Monthly requests per employee"><input type="number" min={1} value={settings.monthly_ai_request_limit} onChange={(e) => field('monthly_ai_request_limit', Number(e.target.value))} className="control" /></Field></div>
        <Field label="Monthly organization cost alert (₹)"><input type="number" min={1} step="1" value={settings.monthly_ai_cost_limit_inr} onChange={(e) => field('monthly_ai_cost_limit_inr', Number(e.target.value))} className="control" /></Field>
        <p className="text-xs text-muted-foreground">All costs are shown in Indian rupees using the latest available reference rate (₹{settings.usd_to_inr_rate.toFixed(2)} per provider billing unit; updated {new Date(settings.exchange_rate_updated_at).toLocaleDateString()}).</p>
        <p className="text-xs leading-5 text-muted-foreground">Warnings appear at 80%. Employees see their own usage; Department Admins see their team; Admins and Super Admins see organization-wide alerts.</p>
      </Section></div>
    </div>

    <Section icon={<Database />} title="Live storage and content" description="Calculated from the current organization database; no sample quota or usage values.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Stat label="Knowledge storage" value={bytes(settings.storage_bytes)} /><Stat label="Knowledge documents" value={settings.knowledge_documents.toLocaleString()} /><Stat label="Generated documents" value={settings.generated_documents.toLocaleString()} /><Stat label="Knowledge upload" value={`${settings.max_upload_size_mb} MB per file`} /><Stat label="R&D Excel upload" value={`${settings.max_excel_upload_size_mb} MB per file`} /></div>
      <Link href="/admin/knowledge"><Button type="button" variant="outline">Manage knowledge storage <ExternalLink className="ml-2 h-4 w-4" /></Button></Link>
    </Section>
    <p className="text-right text-xs text-muted-foreground">{settings.updated_at ? `Last saved ${new Date(settings.updated_at).toLocaleString()}` : 'Using deployment defaults until first save'}</p>
  </form></AppLayout>
}

function Section({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) { return <section className="space-y-4 rounded-lg border border-border bg-card p-6"><div className="flex gap-3"><div className="mt-0.5 text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</div><div><h2 className="text-lg font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div></div>{children}</section> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label> }
function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-border bg-muted/30 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div> }
