import { useProfileStore } from '../store/profileStore'

/**
 * Column spec for XLSX export. `type: 'money'` values are given in PAISE and
 * written as rupees with Indian-grouping number format so Excel treats them
 * as real numbers (sortable, summable) instead of text.
 */
export interface XlsxColumn {
  header: string
  type?: 'text' | 'money' | 'number' | 'date'
  width?: number
}

export interface XlsxOptions {
  /** Report title printed under the letterhead, e.g. "Donation Register". */
  title: string
  /** Period / filter description, e.g. "01/07/2026 – 31/07/2026 · Mode: Cash". */
  subtitle?: string
  columns: XlsxColumn[]
  rows: (string | number | null | undefined)[][]
  /** Optional totals row; money cells in paise like data rows. */
  totals?: (string | number | null | undefined)[]
  filename: string
  sheetName?: string
}

const INR_FORMAT = '#,##,##0.00'
const NAVY = 'FF0D1B2E'

/**
 * Build and download a styled .xlsx: temple letterhead, frozen styled header
 * row, typed columns, bold totals. exceljs is imported lazily so it never
 * weighs down the main bundle.
 */
export async function exportXlsx(opts: XlsxOptions): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const profile = useProfileStore.getState().profile

  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet(opts.sheetName || opts.title.slice(0, 28), {
    views: [{ state: 'frozen', ySplit: 5 }],
  })

  const colCount = opts.columns.length
  ws.columns = opts.columns.map(c => ({
    width: c.width ?? (c.type === 'money' || c.type === 'number' ? 14 : c.type === 'date' ? 12 : 22),
  }))

  // ── Letterhead ────────────────────────────────────────────────────────────
  const templeName = profile?.name || 'Temple'
  const addressBits = [profile?.address, profile?.city, profile?.state].filter(Boolean).join(', ')

  ws.mergeCells(1, 1, 1, colCount)
  const nameCell = ws.getCell(1, 1)
  nameCell.value = templeName
  nameCell.font = { bold: true, size: 14, color: { argb: NAVY } }

  ws.mergeCells(2, 1, 2, colCount)
  ws.getCell(2, 1).value = addressBits
  ws.getCell(2, 1).font = { size: 9, color: { argb: 'FF64748B' } }

  ws.mergeCells(3, 1, 3, colCount)
  const titleCell = ws.getCell(3, 1)
  titleCell.value = opts.subtitle ? `${opts.title} — ${opts.subtitle}` : opts.title
  titleCell.font = { bold: true, size: 11 }

  ws.addRow([]) // spacer (row 4)

  // ── Header row (row 5) ────────────────────────────────────────────────────
  const headerRow = ws.addRow(opts.columns.map(c => c.header))
  headerRow.eachCell(cell => {
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    cell.alignment = { vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } }
  })
  headerRow.height = 18

  // ── Data rows ─────────────────────────────────────────────────────────────
  const writeRow = (values: (string | number | null | undefined)[], bold = false) => {
    const row = ws.addRow(
      values.map((v, i) => {
        const col = opts.columns[i]
        if (col?.type === 'money' && typeof v === 'number') return v / 100
        return v ?? ''
      }),
    )
    row.eachCell((cell, colNo) => {
      const col = opts.columns[colNo - 1]
      if (col?.type === 'money' || col?.type === 'number') {
        cell.alignment = { horizontal: 'right' }
        if (col.type === 'money') cell.numFmt = INR_FORMAT
      }
      cell.font = { size: 9, bold }
    })
    return row
  }

  opts.rows.forEach(r => writeRow(r))

  if (opts.totals) {
    const totalRow = writeRow(opts.totals, true)
    totalRow.eachCell(cell => {
      cell.border = { top: { style: 'thin', color: { argb: NAVY } } }
    })
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  ws.addRow([])
  const stamp = ws.addRow([
    `Generated on ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
  ])
  stamp.getCell(1).font = { size: 8, italic: true, color: { argb: 'FF94A3B8' } }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename.endsWith('.xlsx') ? opts.filename : `${opts.filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
