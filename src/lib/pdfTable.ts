import { jsPDF } from 'jspdf'
import { useProfileStore } from '../store/profileStore'

/**
 * Real PDF downloads for tabular reports (registers, books, statements),
 * built with jsPDF text primitives — no print dialog, no server round-trip.
 *
 * Note: jsPDF's built-in Helvetica has no ₹ glyph, so amounts are printed as
 * plain numbers with an "All amounts in INR" note in the header.
 */

type Cell = string | number | null | undefined

export interface PdfSection {
  heading?: string
  headers: string[]
  rows: Cell[][]
  /** Optional bold summary row rendered after the section body. */
  totals?: Cell[]
}

export interface PdfOptions {
  subtitle?: string
  landscape?: boolean
  /** Per-column alignment; auto-detected from cell content when omitted. */
  aligns?: ('left' | 'right')[]
}

const MARGIN = 40
const FONT = 'helvetica'
const HEAD_FILL: [number, number, number] = [13, 27, 46] // navy-900
const ZEBRA: [number, number, number] = [246, 248, 251]
const BODY_SIZE = 8.5
const LINE_H = 11

const s = (v: Cell) => (v === null || v === undefined ? '' : String(v))
const isNumeric = (v: string) => /^-?[\d,]+(\.\d+)?$/.test(v.trim())

function detectAligns(headers: string[], rows: Cell[][]): ('left' | 'right')[] {
  return headers.map((_, c) => {
    const samples = rows.map(r => s(r[c])).filter(Boolean)
    if (!samples.length) return 'left'
    const numeric = samples.filter(isNumeric).length
    return numeric / samples.length > 0.6 ? 'right' : 'left'
  })
}

function columnWidths(doc: jsPDF, headers: string[], rows: Cell[][], tableW: number): number[] {
  doc.setFontSize(BODY_SIZE)
  const want = headers.map((h, c) => {
    doc.setFont(FONT, 'bold')
    let w = doc.getTextWidth(h)
    doc.setFont(FONT, 'normal')
    for (const r of rows.slice(0, 300)) w = Math.max(w, doc.getTextWidth(s(r[c])))
    return Math.min(Math.max(w + 12, 46), 240)
  })
  const total = want.reduce((a, b) => a + b, 0)
  return want.map(w => (w / total) * tableW)
}

class PdfBuilder {
  doc: jsPDF
  pageW: number
  pageH: number
  y: number
  title: string
  subtitle?: string

  constructor(title: string, opts?: PdfOptions) {
    this.doc = new jsPDF({ orientation: opts?.landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
    this.pageW = this.doc.internal.pageSize.getWidth()
    this.pageH = this.doc.internal.pageSize.getHeight()
    this.title = title
    this.subtitle = opts?.subtitle
    this.y = MARGIN
    this.documentHeader()
  }

  private documentHeader() {
    const temple = useProfileStore.getState().profile?.name || 'Mandir'
    const doc = this.doc
    doc.setFont(FONT, 'bold').setFontSize(13).setTextColor(13, 27, 46)
    doc.text(temple, MARGIN, this.y + 4)
    doc.setFontSize(11).setTextColor(194, 65, 12)
    doc.text(this.title, MARGIN, this.y + 22)
    doc.setFont(FONT, 'normal').setFontSize(8).setTextColor(110, 120, 135)
    const meta = [
      this.subtitle,
      `Generated ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
      'All amounts in INR',
    ].filter(Boolean).join('   ·   ')
    doc.text(meta, MARGIN, this.y + 36)
    doc.setDrawColor(220, 226, 235)
    doc.line(MARGIN, this.y + 44, this.pageW - MARGIN, this.y + 44)
    this.y += 58
    doc.setTextColor(30, 36, 45)
  }

  private ensureRoom(rowH: number, redraw?: () => void) {
    if (this.y + rowH <= this.pageH - MARGIN - 14) return
    this.doc.addPage()
    this.y = MARGIN
    redraw?.()
  }

  sectionHeading(text: string) {
    this.ensureRoom(26)
    this.doc.setFont(FONT, 'bold').setFontSize(10).setTextColor(13, 27, 46)
    this.doc.text(text, MARGIN, this.y + 10)
    this.y += 20
    this.doc.setTextColor(30, 36, 45)
  }

  table(headers: string[], rows: Cell[][], totals?: Cell[], aligns?: ('left' | 'right')[]) {
    const doc = this.doc
    const tableW = this.pageW - 2 * MARGIN
    const widths = columnWidths(doc, headers, rows, tableW)
    const align = aligns ?? detectAligns(headers, rows)

    const xAt = (c: number) => MARGIN + widths.slice(0, c).reduce((a, b) => a + b, 0)
    const cellX = (c: number) => (align[c] === 'right' ? xAt(c) + widths[c] - 5 : xAt(c) + 5)

    const hasHeaders = headers.some(h => h.trim() !== '')
    const headRow = () => {
      if (!hasHeaders) return
      doc.setFillColor(...HEAD_FILL)
      doc.rect(MARGIN, this.y, tableW, 16, 'F')
      doc.setFont(FONT, 'bold').setFontSize(BODY_SIZE).setTextColor(255, 255, 255)
      headers.forEach((h, c) => doc.text(h, cellX(c), this.y + 11, { align: align[c] }))
      this.y += 16
      doc.setFont(FONT, 'normal').setTextColor(30, 36, 45)
    }

    headRow()
    rows.forEach((row, ri) => {
      doc.setFontSize(BODY_SIZE)
      const wrapped = row.map((v, c) => doc.splitTextToSize(s(v), widths[c] - 10) as string[])
      const lines = Math.max(1, ...wrapped.map(w => w.length))
      const rowH = lines * LINE_H + 5
      this.ensureRoom(rowH, headRow)
      if (ri % 2 === 1) {
        doc.setFillColor(...ZEBRA)
        doc.rect(MARGIN, this.y, tableW, rowH, 'F')
      }
      wrapped.forEach((linesArr, c) =>
        linesArr.forEach((ln, li) => doc.text(ln, cellX(c), this.y + LINE_H * (li + 1) - 2, { align: align[c] })),
      )
      this.y += rowH
    })

    if (totals) {
      this.ensureRoom(18, headRow)
      doc.setDrawColor(13, 27, 46)
      doc.line(MARGIN, this.y, MARGIN + tableW, this.y)
      doc.setFont(FONT, 'bold').setFontSize(BODY_SIZE)
      totals.forEach((v, c) => v !== undefined && v !== null && v !== '' &&
        doc.text(s(v), cellX(c), this.y + 12, { align: align[c] }))
      this.y += 18
      doc.setFont(FONT, 'normal')
    }
    this.y += 10
  }

  save(filename: string) {
    const doc = this.doc
    const pages = doc.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i)
      doc.setFont(FONT, 'normal').setFontSize(7.5).setTextColor(140, 150, 162)
      doc.text(`${this.title} — Page ${i} of ${pages}`, this.pageW / 2, this.pageH - 18, { align: 'center' })
    }
    doc.save(filename)
  }
}

/** Single-table report → real .pdf download. Mirrors exportRowsCsv's shape. */
export function downloadRowsPdf(
  filename: string,
  title: string,
  headers: string[],
  rows: Cell[][],
  opts?: PdfOptions & { totals?: Cell[] },
) {
  if (!rows.length) { alert('Nothing to export'); return }
  const b = new PdfBuilder(title, opts)
  b.table(headers, rows, opts?.totals, opts?.aligns)
  b.save(filename)
}

/** Multi-section statement (Income & Expenditure, Receipts & Payments, …). */
export function downloadSectionsPdf(
  filename: string,
  title: string,
  sections: PdfSection[],
  opts?: PdfOptions,
) {
  if (!sections.some(sec => sec.rows.length)) { alert('Nothing to export'); return }
  const b = new PdfBuilder(title, opts)
  for (const sec of sections) {
    if (sec.heading) b.sectionHeading(sec.heading)
    b.table(sec.headers, sec.rows, sec.totals)
  }
  b.save(filename)
}
