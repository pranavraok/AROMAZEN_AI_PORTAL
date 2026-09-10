'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus, Scan } from 'lucide-react'

interface PdfViewport {
  width: number
  height: number
}

interface PdfRenderTask {
  promise: Promise<void>
  cancel: () => void
}

interface PdfPageHandle {
  getViewport: (options: { scale: number }) => PdfViewport
  render: (options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => PdfRenderTask
}

interface PdfDocumentHandle {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPageHandle>
  destroy?: () => Promise<void>
}

export function PdfPreview({ data, initialPage = 1 }: { data: Uint8Array; initialPage?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [documentHandle, setDocumentHandle] = useState<PdfDocumentHandle | null>(null)
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPage))
  const [zoom, setZoom] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const [loading, setLoading] = useState(true)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const updateWidth = () => setContainerWidth(container.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [loading])

  useEffect(() => {
    let cancelled = false
    let loadedDocument: PdfDocumentHandle | null = null
    let loadingTask: { promise: Promise<PdfDocumentHandle>; destroy?: () => Promise<void> } | null = null
    setLoading(true)
    setError('')

    void import('pdfjs-dist')
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        loadingTask = pdfjs.getDocument({ data: data.slice() }) as unknown as typeof loadingTask
        if (!loadingTask) throw new Error('Unable to start the PDF renderer.')
        loadedDocument = await loadingTask.promise
        if (cancelled) {
          await loadedDocument.destroy?.()
          return
        }
        setDocumentHandle(loadedDocument)
        setPageNumber(Math.min(loadedDocument.numPages, Math.max(1, initialPage)))
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to render this PDF.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      setDocumentHandle(null)
      if (loadingTask && !loadedDocument) void loadingTask.destroy?.()
      if (loadedDocument) void loadedDocument.destroy?.()
    }
  }, [data, initialPage])

  useEffect(() => {
    if (!documentHandle || !containerWidth || !canvasRef.current) return
    let active = true
    let renderTask: PdfRenderTask | null = null
    setRendering(true)
    setError('')

    void documentHandle.getPage(pageNumber)
      .then((pdfPage) => {
        if (!active || !canvasRef.current) return
        const baseViewport = pdfPage.getViewport({ scale: 1 })
        const fitScale = Math.max(0.25, (containerWidth - 24) / baseViewport.width)
        const viewport = pdfPage.getViewport({ scale: fitScale * zoom })
        const outputScale = Math.min(window.devicePixelRatio || 1, 2)
        const canvas = canvasRef.current
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('Canvas rendering is unavailable on this device.')
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
        renderTask = pdfPage.render({ canvas, canvasContext: context, viewport })
        return renderTask.promise
      })
      .catch((reason) => {
        if (active && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) {
          setError(reason instanceof Error ? reason.message : 'Unable to render this PDF page.')
        }
      })
      .finally(() => {
        if (active) setRendering(false)
      })

    return () => {
      active = false
      renderTask?.cancel()
    }
  }, [containerWidth, documentHandle, pageNumber, zoom])

  function changePage(nextPage: number) {
    if (!documentHandle) return
    setPageNumber(Math.min(documentHandle.numPages, Math.max(1, nextPage)))
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loading) return <div className="flex h-full items-center justify-center gap-3 text-gray-600"><LoaderCircle className="h-5 w-5 animate-spin" />Preparing PDF preview…</div>
  if (error && !documentHandle) return <div className="grid h-full place-items-center p-6 text-center text-sm text-gray-600">{error}</div>

  return <div className="flex h-full min-h-0 flex-col bg-[#d9d9d5] text-gray-900">
    <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-gray-300 bg-white/95 px-2 shadow-sm sm:px-3">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => changePage(pageNumber - 1)} disabled={pageNumber <= 1} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-gray-100 disabled:opacity-35" aria-label="Previous PDF page"><ChevronLeft className="h-5 w-5" /></button>
        <span className="min-w-20 text-center text-xs font-medium">{pageNumber} / {documentHandle?.numPages ?? 1}</span>
        <button type="button" onClick={() => changePage(pageNumber + 1)} disabled={!documentHandle || pageNumber >= documentHandle.numPages} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-gray-100 disabled:opacity-35" aria-label="Next PDF page"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setZoom((value) => Math.max(0.65, value - 0.15))} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-gray-100" aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
        <button type="button" onClick={() => setZoom(1)} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-gray-100" aria-label="Fit PDF to screen"><Scan className="h-4 w-4" /></button>
        <button type="button" onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-gray-100" aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
      </div>
    </div>
    <div ref={containerRef} className="min-h-0 flex-1 overflow-auto overscroll-contain p-3 [touch-action:pan-x_pan-y_pinch-zoom]">
      <div className="relative mx-auto w-fit min-w-full">
        <canvas ref={canvasRef} className="mx-auto block bg-white shadow-[0_8px_30px_rgba(0,0,0,.16)]" />
        {rendering && <div className="absolute inset-0 grid place-items-center bg-white/55"><LoaderCircle className="h-6 w-6 animate-spin text-gray-600" /></div>}
      </div>
      {error && <p className="mx-auto mt-3 max-w-md rounded-xl bg-red-50 p-3 text-center text-xs text-red-700">{error}</p>}
    </div>
  </div>
}
