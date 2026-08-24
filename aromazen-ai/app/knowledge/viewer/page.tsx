'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Download, ExternalLink, FileText, LoaderCircle, Table2 } from 'lucide-react'
import { AppLayout } from '@/components/layouts/app-layout'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth/auth-provider'
import { api } from '@/lib/api/services'
import mammoth from 'mammoth'
import { SpreadsheetPreview, type SpreadsheetWorkbook } from '@/components/document-viewer/spreadsheet-preview'

const DOCX_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]

const EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel',
]

function isExcel(filename: string, ct: string): boolean {
  if (EXCEL_TYPES.includes(ct.toLowerCase())) return true
  return /\.(xlsx|xlsm|xls)$/i.test(filename)
}

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
  const attachmentId = searchParams.get('attachmentId')
  const docName = searchParams.get('name') || 'Document'
  const fromWorkspace = Boolean(attachmentId)
  const requestedPage = searchParams.get('page')
  const requestedReturnTo = searchParams.get('returnTo')
  const returnTo = requestedReturnTo?.startsWith('/workspace') || requestedReturnTo?.startsWith('/knowledge')
    ? requestedReturnTo
    : fromWorkspace ? '/workspace' : '/knowledge'

  const [url, setUrl] = useState<string | null>(null)
  const [contentType, setContentType] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [docxHtml, setDocxHtml] = useState<string | null>(null)
  const [docxLoading, setDocxLoading] = useState(false)
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetWorkbook | null>(null)
  const [spreadsheetLoading, setSpreadsheetLoading] = useState(false)

  useEffect(() => {
    if (!accessToken || (!attachmentId && (!collectionId || !documentId))) return
    let revoked = false
    let createdUrl: string | null = null
    setLoading(true)
    setError(false)
    setUrl(null)
    setContentType('')
    setDocxHtml(null)
    setDocxLoading(false)
    setSpreadsheet(null)
    setSpreadsheetLoading(false)

    const contentUrl = attachmentId
      ? api.workspace.attachmentContentUrl(attachmentId)
      : api.knowledge.documentContentUrl(collectionId as string, documentId as string)

    void fetch(contentUrl, {
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

        if (isExcel(docName, ct)) {
          setSpreadsheetLoading(true)
          try {
            const XLSX = await import('xlsx')
            const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellDates: true })
            const sheets = workbook.SheetNames.flatMap((name) => {
              const worksheet = workbook.Sheets[name]
              if (!worksheet) return []
              const reference = worksheet['!ref']
              if (!reference) return [{ name, rows: [], startColumn: 0, startRow: 0, truncated: false }]
              const fullRange = XLSX.utils.decode_range(reference)
              const range = {
                s: fullRange.s,
                e: {
                  r: Math.min(fullRange.e.r, fullRange.s.r + 1999),
                  c: Math.min(fullRange.e.c, fullRange.s.c + 99),
                },
              }
              const values = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false, defval: '', range })
              return [{
                name,
                rows: values.map((row) => row.map((value) => value == null ? '' : String(value))),
                startColumn: range.s.c,
                startRow: range.s.r,
                truncated: fullRange.e.r > range.e.r || fullRange.e.c > range.e.c,
              }]
            })
            if (!revoked) setSpreadsheet({ sheets })
          } catch (err) {
            console.error('spreadsheet error:', err)
          } finally {
            if (!revoked) setSpreadsheetLoading(false)
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
  }, [accessToken, attachmentId, collectionId, documentId, docName])

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
  const showExcel = isExcel(docName, contentType)

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3 sm:gap-3 sm:px-6">
        <Link href={returnTo} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back to {fromWorkspace ? 'Workspace' : 'Knowledge'}</span>
        </Link>
        <div className="mx-2 h-4 w-px bg-border" />
        {showExcel ? <Table2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <FileText className="h-4 w-4 shrink-0 text-primary" />}
        <span className="truncate text-sm font-medium">{docName}</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleDownload} disabled={!url}>
          <Download className="h-3.5 w-3.5 sm:mr-1.5" /> <span className="hidden sm:inline">Download</span>
        </Button>
        <Button variant="outline" size="sm" onClick={handleOpenExternal} disabled={!url}>
          <ExternalLink className="h-3.5 w-3.5 sm:mr-1.5" /> <span className="hidden sm:inline">Open in new tab</span>
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
            {isPdf && <iframe src={requestedPage ? `${url}#page=${requestedPage}` : url} className="h-full w-full border-0" title={docName} />}

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

            {showExcel && spreadsheetLoading && (
              <div className="flex h-full items-center justify-center gap-3 text-gray-500">
                <LoaderCircle className="h-5 w-5 animate-spin" /> Rendering spreadsheet…
              </div>
            )}

            {showExcel && !spreadsheetLoading && spreadsheet && <SpreadsheetPreview workbook={spreadsheet} />}

            {showExcel && !spreadsheetLoading && spreadsheet === null && (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-gray-500">
                <Table2 className="h-12 w-12" />
                <p className="text-sm">Unable to render this spreadsheet.</p>
                <Button onClick={handleDownload}><Download className="mr-1.5 h-4 w-4" /> Download to view</Button>
              </div>
            )}

            {!isPdf && !isImage && !showDocx && !showExcel && (
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
