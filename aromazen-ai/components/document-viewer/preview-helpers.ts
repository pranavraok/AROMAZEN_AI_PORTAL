import type { SpreadsheetWorkbook } from './spreadsheet-preview'

const DOCX_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]

const EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel',
]

export function isExcel(filename: string, contentType: string): boolean {
  if (EXCEL_TYPES.includes(contentType.toLowerCase())) return true
  return /\.(xlsx|xlsm|xls)$/i.test(filename)
}

export function isDocx(filename: string, contentType: string): boolean {
  if (DOCX_TYPES.includes(contentType)) return true
  const lower = filename.toLowerCase()
  return lower.endsWith('.docx') || lower.endsWith('.doc')
}

export function isPdf(filename: string, contentType: string): boolean {
  return contentType.split(';')[0].trim().toLowerCase() === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')
}

export function sanitizeDocxHtml(html: string): string {
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

/** Convert a DOCX blob to sanitized HTML with mammoth (same rendering as the knowledge viewer). */
export async function renderDocxToHtml(blob: Blob): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() })
  return sanitizeDocxHtml(result.value)
}

/** Extract a truncated workbook preview with xlsx (same rendering as the knowledge viewer). */
export async function extractSpreadsheetWorkbook(blob: Blob): Promise<SpreadsheetWorkbook> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellDates: true })
  const sheets = workbook.SheetNames.flatMap((name) => {
    const worksheet = workbook.Sheets[name]
    if (!worksheet) return [{ name, rows: [] as string[][], startColumn: 0, startRow: 0, truncated: false }]
    const reference = worksheet['!ref']
    if (!reference) return [{ name, rows: [] as string[][], startColumn: 0, startRow: 0, truncated: false }]
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
  return { sheets }
}
