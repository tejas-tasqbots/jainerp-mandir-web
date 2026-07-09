import { api } from './api'
import { downloadRowsPdf } from './pdfTable'

export type ReportFormat = 'csv' | 'pdf'

/** Trigger a browser download of in-memory content (no popup, no auth issues). */
export function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Build a CSV string from headers + rows (values escaped). */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.map(esc).join(',')].concat(rows.map(r => r.map(esc).join(','))).join('\n')
}

const rs = (paise: number | string | null | undefined) =>
  (Number(paise ?? 0) / 100).toFixed(2)

/**
 * Print the current page (browser → "Save as PDF"). Used by the accounting
 * statement screens which already render the full statement on screen — far
 * more reliable than a non-existent server-side PDF endpoint.
 */
export function printCurrentView() {
  window.print()
}

/** Export already-loaded rows to CSV (no extra fetch — matches what's on screen). */
export function exportRowsCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  if (!rows.length) { alert('Nothing to export'); return }
  downloadBlob(filename, toCsv(headers, rows), 'text/csv')
}

/** paise → rupee string, exported for screens that build their own CSV rows. */
export const rsFmt = rs

/** Emit one report dataset as a .csv or a real .pdf file. */
function emit(
  format: ReportFormat,
  filenameBase: string,
  title: string,
  subtitle: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  totals?: (string | number | null | undefined)[],
) {
  if (!rows.length) { alert('No data to export'); return false }
  if (format === 'pdf') {
    downloadRowsPdf(`${filenameBase}.pdf`, title, headers, rows, {
      subtitle,
      totals,
      landscape: headers.length > 6,
    })
  } else {
    const csvRows = totals ? [...rows, totals.map(t => t ?? '')] : rows
    downloadBlob(`${filenameBase}.csv`, toCsv(headers, csvRows as (string | number)[][]), 'text/csv')
  }
  return true
}

/**
 * Fetch an authenticated report and download it as CSV or a real PDF file
 * (FR-DASH-007: every register exports both). The endpoints need a Bearer
 * token, so window.open would 401 — this fetches via the api client and
 * builds the file locally.
 *
 * Returns false (and alerts) when there's no data, so callers can react.
 */
export async function downloadReport(
  key: string,
  params: Record<string, string>,
  format: ReportFormat = 'csv',
): Promise<boolean> {
  const qs = new URLSearchParams(params).toString()
  const range = params.from || params.to
    ? `${params.from ?? '…'} to ${params.to ?? '…'}`
    : params.fy ? `FY ${params.fy}` : ''
  try {
    switch (key) {
      case 'donation-register': {
        const { data } = await api.get(`/reports/donation-register?${qs}`)
        const rows = (data.data?.rows || []) as Record<string, unknown>[]
        const total = rows.reduce((sum, r) => sum + Number(r.amount_paise ?? 0), 0)
        return emit(format, 'donation-register', 'Donation Register', range,
          ['Date', 'Invoice', 'Donor', 'PAN', 'Category', 'Mode', 'Amount', '80G'],
          rows.map(r => [
            r.date as string, r.invoice_no as string, r.donor as string, r.pan_masked as string,
            r.category as string, r.payment_mode as string, rs(r.amount_paise as number),
            r.is_80g_eligible ? 'Yes' : 'No',
          ]),
          ['Total', '', '', '', '', '', rs(total), ''])
      }
      case 'expense-register': {
        const { data } = await api.get(`/reports/expense-register?${qs}`)
        const rows = (data.data?.rows || []) as Record<string, unknown>[]
        const total = rows.reduce((sum, r) => sum + Number(r.amount_paise ?? 0), 0)
        return emit(format, 'expense-register', 'Expense Register', range,
          ['Date', 'Bill No', 'Category', 'Vendor', 'Description', 'Mode', 'Credit', 'Amount', 'GST', 'TDS'],
          rows.map(r => [
            r.date as string, r.bill_number as string, r.category as string, r.vendor as string,
            r.description as string, r.payment_mode as string, r.is_on_credit ? 'Yes' : 'No',
            rs(r.amount_paise as number), rs(r.gst_paid_paise as number), rs(r.tds_amount_paise as number),
          ]),
          ['Total', '', '', '', '', '', '', rs(total), '', ''])
      }
      case 'daily-collection': {
        const { data } = await api.get(`/reports/daily-collection?${qs}`)
        const d = data.data || {}
        return emit(format, `daily-collection-${params.date || ''}`, 'Daily Collection', params.date || '',
          ['Stream', 'Amount'], [
            ['Donations', rs(d.donations_paise)], ['Seva', rs(d.seva_paise)],
            ['Prasad', rs(d.prasad_paise)], ['Bhojanshala', rs(d.bhojanshala_paise)],
            ['Room Advance', rs(d.room_advance_paise)], ['Hall Advance', rs(d.hall_advance_paise)],
            ['Total Collection', rs(d.total_collection_paise)], ['Expenses', rs(d.expenses_paise)],
            ['Net', rs(d.net_paise)],
          ])
      }
      case 'boli-register': {
        const { data } = await api.get(`/bolis/register?${qs}`)
        const rows = (data.data?.rows || []) as Record<string, unknown>[]
        return emit(format, 'boli-register', 'Boli Register', range,
          ['Date', 'Donor', 'Mobile', 'Description', 'Event', 'Pledged', 'Paid', 'Outstanding', 'Status'],
          rows.map(b => [
            b.boli_date as string, b.donor_name as string, b.donor_mobile as string,
            b.seva_description as string, b.event_name as string,
            rs(b.committed_amount_paise as number), rs(b.paid_amount_paise as number),
            rs(b.outstanding_paise as number), b.status as string,
          ]))
      }
      case 'donation-trends': {
        const { data } = await api.get(`/reports/analytics/donation-trends?${qs}`)
        const points = (data.data?.points || []) as Record<string, unknown>[]
        return emit(format, 'donation-trends', 'Donation Trends', range,
          ['Period', 'Receipts', 'Amount'],
          points.map(p => [String(p.bucket ?? ''), Number(p.receipts ?? 0), rs(p.amount_paise as number)]))
      }
      case 'top-donors': {
        const { data } = await api.get(`/reports/analytics/top-donors?${qs}`)
        const rows = (data.data?.rows || data.data || []) as Record<string, unknown>[]
        return emit(format, 'top-donors', 'Top Donors', range,
          ['Donor', 'Mobile', 'PAN', 'Receipts', 'Total'],
          rows.map(r => [
            String(r.donor ?? r.name ?? ''), String(r.mobile ?? ''), String(r.pan_masked ?? ''),
            Number(r.receipts ?? 0), rs((r.amount_paise ?? r.total_paise) as number),
          ]))
      }
      case 'gst-summary': {
        const { data } = await api.get(`/reports/gst-summary?${qs}`)
        const d = data.data || {}
        const rows: (string | number)[][] = [
          ['Output GST — Rooms', rs(d.output_gst?.rooms_paise)],
          ['Output GST — Halls', rs(d.output_gst?.halls_paise)],
          ['Output GST — Prasad', rs(d.output_gst?.prasad_paise)],
          ['Output GST — Total', rs(d.output_gst?.total_paise)],
          ['Input GST (on expenses)', rs(d.input_gst_paise)],
          ['Net GST Payable', rs(d.net_payable_paise)],
        ]
        return emit(format, `gst-summary-${params.fy || ''}`, 'GST Summary', range, ['Head', 'Amount'], rows)
      }
      case 'ca-pack': {
        // Server-built ZIP (registers + trial balance + I&E + balance sheet).
        const res = await api.get(`/reports/ca-pack?${qs}`, { responseType: 'blob' })
        const url = URL.createObjectURL(res.data as Blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `ca-pack-${params.fy || ''}.zip`
        a.click()
        URL.revokeObjectURL(url)
        return true
      }
      default:
        alert('Unknown report')
        return false
    }
  } catch {
    alert('Could not download report. Please try again.')
    return false
  }
}
