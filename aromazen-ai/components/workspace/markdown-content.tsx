'use client'

import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'

interface MarkdownContentProps {
  content: string
  onCitation?: (citationNumber: number) => void
}

function inline(text: string, onCitation?: (citationNumber: number) => void): ReactNode[] {
  const tokens: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[(\d+)\]|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) tokens.push(text.slice(cursor, match.index))
    const value = match[0]
    if (value.startsWith('**')) {
      tokens.push(<strong key={`${match.index}-strong`} className="font-semibold text-foreground">{value.slice(2, -2)}</strong>)
    } else if (value.startsWith('`')) {
      tokens.push(<code key={`${match.index}-code`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">{value.slice(1, -1)}</code>)
    } else if (match[2]) {
      const number = Number(match[2])
      tokens.push(<button key={`${match.index}-citation`} type="button" onClick={() => onCitation?.(number)} className="mx-0.5 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded-md bg-primary/15 px-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/25" aria-label={`Open source ${number}`}>{number}</button>)
    } else if (match[3] && match[4]) {
      tokens.push(<a key={`${match.index}-link`} href={match[4]} target="_blank" rel="noreferrer" className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary">{match[3]}</a>)
    }
    cursor = pattern.lastIndex
  }
  if (cursor < text.length) tokens.push(text.slice(cursor))
  return tokens
}

function isTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function cells(line: string) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
}

export function markdownToPlainText(content: string) {
  return content
    .replace(/```(?:[^\n]*)\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .trim()
}

function TableBlock({ headers, rows, onCitation }: { headers: string[]; rows: string[][]; onCitation?: (citationNumber: number) => void }) {
  const [copied, setCopied] = useState(false)

  async function copyTable() {
    const tableText = [headers, ...rows]
      .map((row) => row.map((cell) => markdownToPlainText(cell)).join('\t'))
      .join('\n')
    await navigator.clipboard.writeText(tableText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return <div className="overflow-hidden rounded-xl border border-border">
    <div className="flex items-center justify-end border-b border-border bg-muted/30 px-2 py-1.5">
      <button type="button" onClick={() => void copyTable()} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground" aria-label="Copy table as plain text">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy table'}</button>
    </div>
    <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead className="bg-muted/60"><tr>{headers.map((header, cellIndex) => <th key={cellIndex} className="border-b border-border px-3 py-2 font-semibold">{inline(header, onCitation)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-border/70 last:border-0">{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top text-foreground/90">{inline(cell, onCitation)}</td>)}</tr>)}</tbody></table></div>
  </div>
}

export function MarkdownContent({ content, onCitation }: MarkdownContentProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) { code.push(lines[index]); index += 1 }
      index += 1
      blocks.push(<div key={`code-${index}`} className="overflow-hidden rounded-xl border border-border bg-black/35"><div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{language || 'Code'}</div><pre className="overflow-x-auto p-4 text-[13px] leading-6"><code>{code.join('\n')}</code></pre></div>)
      continue
    }
    if (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1])) {
      const headers = cells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(cells(lines[index])); index += 1 }
      blocks.push(<TableBlock key={`table-${index}`} headers={headers} rows={rows} onCitation={onCitation} />)
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const className = level === 1 ? 'pt-2 text-xl font-semibold tracking-tight' : level === 2 ? 'pt-2 text-lg font-semibold tracking-tight' : 'pt-1 text-base font-semibold'
      blocks.push(<div key={`heading-${index}`} className={className}>{inline(heading[2], onCitation)}</div>)
      index += 1
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) { items.push(lines[index].replace(/^\s*[-*]\s+/, '')); index += 1 }
      blocks.push(<ul key={`ul-${index}`} className="ml-5 list-disc space-y-1.5 marker:text-muted-foreground">{items.map((item, itemIndex) => <li key={itemIndex} className="pl-1">{inline(item, onCitation)}</li>)}</ul>)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) { items.push(lines[index].replace(/^\s*\d+[.)]\s+/, '')); index += 1 }
      blocks.push(<ol key={`ol-${index}`} className="ml-5 list-decimal space-y-1.5 marker:font-medium marker:text-muted-foreground">{items.map((item, itemIndex) => <li key={itemIndex} className="pl-1">{inline(item, onCitation)}</li>)}</ol>)
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) { quote.push(lines[index].replace(/^\s*>\s?/, '')); index += 1 }
      blocks.push(<blockquote key={`quote-${index}`} className="border-l-2 border-primary/50 pl-4 text-muted-foreground">{inline(quote.join(' '), onCitation)}</blockquote>)
      continue
    }
    const paragraph = [line.trim()]
    index += 1
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index]) && !/^\s*[-*]\s+/.test(lines[index]) && !/^\s*\d+[.)]\s+/.test(lines[index]) && !lines[index].trim().startsWith('```')) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push(<p key={`p-${index}`} className="whitespace-pre-wrap">{inline(paragraph.join(' '), onCitation)}</p>)
  }
  return <div className="min-w-0 space-y-4 break-words text-[15px] leading-7 text-foreground/95 [overflow-wrap:anywhere]">{blocks}</div>
}
