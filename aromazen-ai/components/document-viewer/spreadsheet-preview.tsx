'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Table2 } from 'lucide-react'

export interface SpreadsheetSheet {
  name: string
  rows: string[][]
  startColumn: number
  startRow: number
  truncated: boolean
}

export interface SpreadsheetWorkbook {
  sheets: SpreadsheetSheet[]
}

function columnLabel(index: number): string {
  let label = ''
  let value = index + 1
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

export function SpreadsheetPreview({ workbook }: { workbook: SpreadsheetWorkbook }) {
  const [activeSheet, setActiveSheet] = useState(0)
  const [page, setPage] = useState(0)

  useEffect(() => { setActiveSheet(0); setPage(0) }, [workbook])

  const sheet = workbook.sheets[activeSheet]
  const columnCount = useMemo(() => Math.max(1, ...(sheet?.rows.map((row) => row.length) ?? [1])), [sheet])
  const rowsPerPage = 250
  const pageCount = Math.max(1, Math.ceil((sheet?.rows.length ?? 0) / rowsPerPage))
  const visibleRows = useMemo(() => sheet?.rows.slice(page * rowsPerPage, (page + 1) * rowsPerPage) ?? [], [page, sheet])

  if (!sheet) {
    return <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500"><Table2 className="h-10 w-10" /><p className="text-sm">This workbook does not contain a visible worksheet.</p></div>
  }

  return <div className="flex h-full min-h-0 flex-col bg-[#f3f4f6] text-gray-900">
    {sheet.truncated && <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">This preview shows the first 2,000 rows and 100 columns. Download the workbook to view anything beyond that range.</div>}
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="border-separate border-spacing-0 bg-white text-xs">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 h-7 min-w-12 border-b border-r border-gray-300 bg-gray-100" aria-label="Row numbers" />
            {Array.from({ length: columnCount }, (_, index) => <th key={index} className="h-7 min-w-28 border-b border-r border-gray-300 bg-gray-100 px-2 text-center font-medium text-gray-600">{columnLabel(sheet.startColumn + index)}</th>)}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length ? visibleRows.map((row, rowIndex) => <tr key={page * rowsPerPage + rowIndex} className="group">
            <th className="sticky left-0 z-10 h-7 min-w-12 border-b border-r border-gray-300 bg-gray-100 px-2 text-right font-normal text-gray-500 group-hover:bg-blue-50">{sheet.startRow + page * rowsPerPage + rowIndex + 1}</th>
            {Array.from({ length: columnCount }, (_, columnIndex) => <td key={columnIndex} className="h-7 min-w-28 max-w-80 whitespace-pre-wrap border-b border-r border-gray-200 bg-white px-2 py-1 align-top group-hover:bg-blue-50/30">{row[columnIndex] ?? ''}</td>)}
          </tr>) : <tr><td colSpan={columnCount + 1} className="h-40 text-center text-gray-500">This worksheet is empty.</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-300 bg-[#e7e9ed]">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 pt-1">
        {workbook.sheets.map((item, index) => <button key={`${item.name}-${index}`} type="button" onClick={() => { setActiveSheet(index); setPage(0) }} className={`max-w-48 shrink-0 truncate border-b-2 px-4 py-2 text-xs font-medium transition-colors ${index === activeSheet ? 'border-emerald-600 bg-white text-emerald-800' : 'border-transparent text-gray-600 hover:bg-white/70 hover:text-gray-900'}`} title={item.name}>{item.name}</button>)}
      </div>
      {sheet.rows.length > rowsPerPage && <div className="flex shrink-0 items-center gap-1 pr-2 text-xs text-gray-600">
        <span className="hidden sm:inline">Rows {page * rowsPerPage + 1}–{Math.min((page + 1) * rowsPerPage, sheet.rows.length)} of {sheet.rows.length}</span>
        <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} className="rounded p-1.5 hover:bg-white disabled:opacity-35" aria-label="Previous rows"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1} className="rounded p-1.5 hover:bg-white disabled:opacity-35" aria-label="Next rows"><ChevronRight className="h-4 w-4" /></button>
      </div>}
    </div>
  </div>
}
