import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { mockCollections, mockDocuments } from '@/lib/mock-data'
import { Upload, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default function KnowledgePage() {
  const collectionIcons: Record<string, string> = {
    Share2: '🔗',
    Factory: '🏭',
    FlaskConical: '⚗️',
    Megaphone: '📢',
    Users: '👥',
  }

  const documentsColumns = [
    { header: 'Document', key: 'name' as const },
    { header: 'Collection', key: 'collection' as const },
    { header: 'Uploader', key: 'uploader' as const },
    {
      header: 'Status',
      key: 'status' as const,
      render: (value: string) => <StatusBadge status={value as any} />,
    },
    { header: 'Version', key: 'version' as const },
    { header: 'Date', key: 'date' as const },
  ]

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Knowledge Base"
          description="Manage documents and collections"
          actions={
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload Document
            </Button>
          }
        />

        {/* Collections Grid */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Collections</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {mockCollections.map((collection) => (
              <Link key={collection.id} href={`/knowledge/${collection.id}`}>
                <div className="rounded-lg border border-border bg-card p-4 hover:bg-card/80 hover:border-primary/50 transition-all cursor-pointer group">
                  <div className="text-3xl mb-3 group-hover:scale-110 transition-transform">
                    {collectionIcons[collection.icon] || '📁'}
                  </div>
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors mb-1">
                    {collection.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">{collection.scope}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{collection.docs} docs</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Updated {collection.lastUpdate}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Documents */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Recent Documents</h2>
            <Button variant="ghost" size="sm" className="text-primary">
              View all <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <DataTable columns={documentsColumns} data={mockDocuments} />
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

function ChevronRight({ className }: { className: string }) {
  return <span className={`${className}`}>→</span>
}
