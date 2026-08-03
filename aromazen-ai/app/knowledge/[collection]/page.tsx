import { AppLayout } from '@/components/layouts/app-layout'
import { PageHeader } from '@/components/ui/page-header'
import { DataTable } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { mockCollections, mockDocuments } from '@/lib/mock-data'
import { Upload, ChevronLeft } from 'lucide-react'
import Link from 'next/link'

interface Props {
  params: Promise<{
    collection: string
  }>
}

export default async function CollectionDetailPage(props: Props) {
  const params = await props.params
  const collection = mockCollections.find((c) => c.id === params.collection)
  const collectionDocs = mockDocuments.filter(
    (d) => d.collection === collection?.name || d.collection === params.collection
  )

  const columns = [
    { header: 'Document', key: 'name' as const },
    { header: 'Uploader', key: 'uploader' as const },
    {
      header: 'Status',
      key: 'status' as const,
      render: (value: string) => <StatusBadge status={value as any} />,
    },
    { header: 'Version', key: 'version' as const },
    { header: 'Date', key: 'date' as const },
  ]

  if (!collection) {
    return (
      <AppLayout>
        <div className="p-6 text-center">
          <p className="text-muted-foreground">Collection not found</p>
          <Link href="/knowledge">
            <Button className="mt-4">Back to Knowledge</Button>
          </Link>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Breadcrumb */}
        <Link href="/knowledge" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Back to Knowledge
        </Link>

        <PageHeader
          title={collection.name}
          description={collection.scope}
          actions={
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload Document
            </Button>
          }
        />

        {/* Collection Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground mb-1">Total Documents</p>
            <p className="text-3xl font-semibold text-foreground">{collection.docs}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground mb-1">Access Scope</p>
            <p className="text-lg font-semibold text-foreground">{collection.scope}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground mb-1">Last Updated</p>
            <p className="text-lg font-semibold text-foreground">{collection.lastUpdate}</p>
          </div>
        </div>

        {/* Documents Table */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Documents in {collection.name}</h2>
          </div>
          <DataTable columns={columns} data={collectionDocs} />
        </div>
      </div>
    </AppLayout>
  )
}
