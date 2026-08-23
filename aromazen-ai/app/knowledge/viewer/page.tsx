'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Download, ExternalLink, FileText, LoaderCircle } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { api } from '@/lib/api/services'
import mammoth from 'mammoth'

const DOCX_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]

function isDocx(filename: string, ct: string): boolean {
  if (DOCX_TYPES.includes(ct)) return true
  const lower = filename.toLowerCase()
  return lower.endsWith('.docx') || lower.endsWith('.doc')
}

function sanitizeDocxHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  parsed.querySelectorAll('script, iframe, object, embed, style, link, meta').forEach((element) => element.remove())
  parsed.body.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      const unsafeUrl = (name === 'href' || name === 'src') && (value.startsWith('javascript:') || (value.startsWith('data:') && !value.startsWith('data:image/')))
      if (name.startsWith('on') || name === 'style' || unsafeUrl) element.removeAttribute(attribute.name)
    }
  })
  return parsed.body.innerHTML
}

function DocumentViewer() {
  const searchParams = useSearchParams()
  const { accessToken } = useAuth()

  const collectionId = searchParams.get('collectionId')
  const documentId = searchParams.get('documentId')
  const docName = searchParams.get('name') || 'Document'

  const [url, setUrl] = useState<string | null>(null)
  const [contentType, setContentType] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [docxHtml, setDocxHtml] = useState<string | null>(null)
  const [docxLoading, setDocxLoading] = useState(false)

  useEffect(() => {
    if (!accessToken || !collectionId || !documentId) return
    let revoked = false
    let createdUrl: string | null = null
    setLoading(true)
    setError(false)
    setDocxHtml(null)

    void fetch(api.knowledge.documentContentUrl(collectionId, documentId), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load document')
        const ct = res.headers.get('content-type') || 'application/octet-stream'
        const blob = await res.blob()
        if (revoked) return

        createdUrl = URL.createObjectURL(new Blob([blob], { type: ct }))
        setUrl(createdUrl)
        setContentType(ct)
        setLoading(false)

        // If .docx, convert to HTML using mammoth
        if (isDocx(docName, ct)) {
          setDocxLoading(true)
          try {
            const arrayBuffer = await blob.arrayBuffer()
            const result = await mammoth.convertToHtml({ arrayBuffer })
            if (!revoked) {
              setDocxHtml(sanitizeDocxHtml(result.value))
            }
          } catch (err) {
            console.error('mammoth error:', err)
          } finally {
            if (!revoked) setDocxLoading(false)
          }
        }
      })
      .catch(() => {
        if (!revoked) {
          setError(true)
          setLoading(false)
        }
      })

    return () => {
      revoked = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [accessToken, collectionId, documentId, docName])

  function handleDownload() {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = docName
    a.click()
  }

  function handleOpenExternal() {
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const isImage = contentType.startsWith('image/')
  const isPdf = contentType === 'application/pdf'
  const showDocx = isDocx(docName, contentType)

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Link href="/knowledge" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Knowledge
        </Link>
        <div className="mx-2 h-4 w-px bg-border" />
        <FileText className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate text-sm font-medium">{docName}</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Download
        </Button>
        <Button variant="outline" size="sm" onClick={handleOpenExternal}>
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
        </Button>
      </div>

      {/* Document content */}
      <div className="flex-1 overflow-auto bg-[#e8e6e0]">
        {loading && (
          <div className="flex h-full items-center justify-center gap-3 text-gray-500">
            <LoaderCircle className="h-5 w-5 animate-spin" /> Loading document…
          </div>
        )}

        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500">
            <FileText className="h-10 w-10" />
            <p className="text-sm">Unable to load document.</p>
            <Link href="/knowledge" className="text-sm text-primary hover:underline">Go back to Knowledge</Link>
          </div>
        )}

        {url && !loading && !error && (
          <>
            {isPdf && <iframe src={url} className="h-full w-full border-0" title={docName} />}

            {isImage && (
              <div className="relative h-full w-full p-4">
                <Image src={url} alt={docName} fill unoptimized className="object-contain p-4" />
              </div>
            )}

            {showDocx && docxLoading && (
              <div className="flex h-full items-center justify-center gap-3 text-gray-500">
                <LoaderCircle className="h-5 w-5 animate-spin" /> Rendering document…
              </div>
            )}

            {showDocx && !docxLoading && docxHtml !== null && (
              <div className="overflow-x-auto">
                <div className="docx-paper">
                  <div dangerouslySetInnerHTML={{ __html: docxHtml }} />
                </div>
              </div>
            )}

            {showDocx && !docxLoading && docxHtml === null && (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-gray-500">
                <FileText className="h-12 w-12" />
                <p className="text-sm">Unable to render this document.</p>
                <Button onClick={handleDownload}><Download className="mr-1.5 h-4 w-4" /> Download to view</Button>
              </div>
            )}

            {!isPdf && !isImage && !showDocx && (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-gray-500">
                <FileText className="h-12 w-12" />
                <p className="text-sm">This file type ({contentType}) cannot be previewed inline.</p>
                <div className="flex gap-3">
                  <Button onClick={handleDownload}><Download className="mr-1.5 h-4 w-4" /> Download to view</Button>
                  <Button variant="outline" onClick={handleOpenExternal}><ExternalLink className="mr-1.5 h-4 w-4" /> Open in new tab</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function DocumentViewerPage() {
  return (
    <AppLayout>
      <Suspense fallback={<div className="flex h-full items-center justify-center gap-3 text-gray-500"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading…</div>}>
        <DocumentViewer />
      </Suspense>
    </AppLayout>
  )
}
