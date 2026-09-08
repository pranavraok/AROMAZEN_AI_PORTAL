'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, FileText, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SpreadsheetPreview, type SpreadsheetWorkbook } from '@/components/document-viewer/spreadsheet-preview'
import { isDocx, isExcel, extractSpreadsheetWorkbook, renderDocxToHtml } from '@/components/document-viewer/preview-helpers'

type ViewerFile = { blob: Blob; filename: string; title: string }

type PreviewKind = 'pdf' | 'image' | 'text' | 'docx' | 'xlsx' | 'binary'

function classify(file: ViewerFile): PreviewKind {
  const type = file.blob.type
  const name = file.filename.toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (isDocx(file.filename, type)) return 'docx'
  if (isExcel(file.filename, type)) return 'xlsx'
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return 'image'
  if (type.startsWith('text/') || /\.(txt|csv|md)$/.test(name)) return 'text'
  return 'binary'
}

function saveBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }

/**
 * In-page document viewer. Opens a Blob in a modal instead of window.open, which
 * popup blockers and embedded webviews block when the call happens after an await.
 * PDFs/images/text render in an iframe; DOCX renders as sanitized HTML via mammoth;
 * XLSX renders via the spreadsheet previewer (same as the knowledge viewer).
 */
export function DocumentViewerModal({ file, onClose }: { file: ViewerFile | null; onClose: () => void }) {
  const url = useMemo(() => (file ? URL.createObjectURL(file.blob) : null), [file])
  const kind = useMemo(() => (file ? classify(file) : 'binary'), [file])
  const [docxHtml, setDocxHtml] = useState<string | null>(null)
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetWorkbook | null>(null)
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState('')

  useEffect(() => {
    if (!file || !url) return
    const previewKind = classify(file)
    if (previewKind !== 'docx' && previewKind !== 'xlsx') return
    let cancelled = false
    setConverting(true); setConvertError(''); setDocxHtml(null); setSpreadsheet(null)
    const run = previewKind === 'docx'
      ? renderDocxToHtml(file.blob).then((html) => { if (!cancelled) setDocxHtml(html) })
      : extractSpreadsheetWorkbook(file.blob).then((workbook) => { if (!cancelled) setSpreadsheet(workbook) })
    run
      .catch((error) => { if (!cancelled) setConvertError(error instanceof Error ? error.message : 'Unable to render this document.') })
      .finally(() => { if (!cancelled) setConverting(false) })
    return () => { cancelled = true }
  }, [file, url])

  useEffect(() => {
    if (!url) return
    const revoke = window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.clearTimeout(revoke); window.removeEventListener('keydown', onKey) }
  }, [url, onClose])

  useEffect(() => { if (!file) return; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [file])

  if (!file || !url) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-2 backdrop-blur-sm md:p-6" role="dialog" aria-modal="true" aria-label={file.title} onClick={onClose}>
      <div className="flex h-full max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{file.title}</h2>
              <p className="truncate text-xs text-muted-foreground">{file.filename}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => saveBlob(file.blob, file.filename)}><Download className="mr-1.5 h-4 w-4" />Download</Button>
            <Button size="sm" variant="outline" onClick={() => window.open(url, '_blank')}><ExternalLink className="mr-1.5 h-4 w-4" />New tab</Button>
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close viewer"><X className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {kind === 'docx' || kind === 'xlsx' ? (
            converting
              ? <div className="flex h-full items-center justify-center gap-3 text-muted-foreground"><LoaderCircle className="h-5 w-5 animate-spin" />Rendering document…</div>
              : convertError || (kind === 'docx' ? docxHtml === null : spreadsheet === null)
                ? (
                  <div className="grid h-full place-items-center p-8 text-center">
                    <div>
                      <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                      <p className="mt-3 font-medium">{convertError || 'Unable to render this document.'}</p>
                      <div className="mt-4 flex justify-center"><Button onClick={() => saveBlob(file.blob, file.filename)}><Download className="mr-2 h-4 w-4" />Download to view</Button></div>
                    </div>
                  </div>
                )
                : kind === 'docx' && docxHtml !== null
                  ? (
                    <div className="docx-paper-scroll h-full overflow-auto overscroll-contain">
                      <div className="docx-paper">
                        <div dangerouslySetInnerHTML={{ __html: docxHtml }} />
                      </div>
                    </div>
                  )
                  : spreadsheet !== null && <SpreadsheetPreview workbook={spreadsheet} />
          ) : kind === 'binary'
            ? (
              <div className="grid h-full place-items-center p-8 text-center">
                <div>
                  <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                  <p className="mt-3 font-medium">This file type cannot be previewed here</p>
                  <p className="mt-1 text-sm text-muted-foreground">{file.filename}</p>
                  <div className="mt-4 flex justify-center"><Button onClick={() => saveBlob(file.blob, file.filename)}><Download className="mr-2 h-4 w-4" />Download to view</Button></div>
                </div>
              </div>
            )
            : <iframe src={url} title={file.title} className="h-full w-full bg-white" />}
        </div>
      </div>
    </div>
  )
}
