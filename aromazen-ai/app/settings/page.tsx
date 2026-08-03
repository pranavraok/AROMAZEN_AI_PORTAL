import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { AlertCircle, Check } from 'lucide-react'

export default function SettingsPage() {
  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Settings"
          description="Configure organization settings and preferences"
        />

        {/* Branding */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Branding</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Your organization&apos;s branding and display settings
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Organization Name
              </label>
              <input
                type="text"
                defaultValue="AROMAZEN"
                className="w-full px-4 py-2 rounded-lg bg-muted border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Platform Name
              </label>
              <input
                type="text"
                defaultValue="AROMAZEN AI"
                className="w-full px-4 py-2 rounded-lg bg-muted border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Theme */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Theme</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Customize the appearance of the platform
            </p>
          </div>
          <div className="space-y-3">
            <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50 transition-colors">
              <input type="radio" name="theme" defaultChecked className="w-4 h-4" />
              <div>
                <p className="font-medium text-foreground">Dark Mode</p>
                <p className="text-xs text-muted-foreground">Dark background with amber accents</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50 transition-colors">
              <input type="radio" name="theme" className="w-4 h-4" />
              <div>
                <p className="font-medium text-foreground">Light Mode</p>
                <p className="text-xs text-muted-foreground">Light background with blue accents</p>
              </div>
            </label>
          </div>
        </div>

        {/* AI Provider */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-2">AI Provider</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Configure your AI service provider
            </p>
          </div>
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-3">
              <Check className="w-5 h-5 text-emerald-500" />
              <div>
                <p className="font-medium text-foreground">OpenAI</p>
                <p className="text-sm text-muted-foreground">Connected and active</p>
              </div>
            </div>
            <Button variant="outline" size="sm">
              Manage
            </Button>
          </div>
        </div>

        {/* Storage */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Storage</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Manage file storage and backup settings
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border">
              <div>
                <p className="font-medium text-foreground">Local Storage</p>
                <p className="text-sm text-muted-foreground">1.2 GB / 2 GB used</p>
              </div>
              <Button variant="outline" size="sm">
                Clear Cache
              </Button>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Security</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Manage security settings and sessions
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Session Duration
              </label>
              <select className="w-full px-4 py-2 rounded-lg bg-muted border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all">
                <option>30 minutes</option>
                <option selected>8 hours</option>
                <option>24 hours</option>
              </select>
            </div>
            <Button variant="outline" className="w-full">
              View Audit Log
            </Button>
          </div>
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
            Save Settings
          </Button>
        </div>
      </div>
    </AppLayout>
  )
}
