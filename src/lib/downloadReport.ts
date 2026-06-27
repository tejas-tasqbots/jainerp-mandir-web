import { api } from './api'

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

/**
 * Fetch an authenticated report and download it as CSV/JSON. The compliance &
 * report endpoints require a Bearer token, so opening them with window.open
 * returns 401 — this fetches via the api client and builds the file locally.
 *
 * Returns false (and alerts) when there's no data, so callers can react.
 */
export async function downloadReport(key: string, params: Record<string, string>): Promise<boolean> {
  const qs = new URLSearchParams(params).toString()
  try {
    switch (key) {
      case 'donation-register': {
        const { data } = await api.get(`/reports/donation-register?${qs}`)
        const rows = data.data?.rows || []
        if (!rows.length) { alert('No donations in this range'); return false }
        const csv = toCsv(
          ['Date', 'Invoice', 'Donor', 'PAN', 'Category', 'Mode', 'Amount', '80G'],
          rows.map((r: Record<string, unknown>) => [
            r.date, r.invoice_no, r.donor, r.pan_masked, r.category, r.payment_mode,
            rs(r.amount_paise as number), r.is_80g_eligible ? 'Yes' : 'No',
          ]),
        )
        downloadBlob(`donation-register.csv`, csv, 'text/csv')
        return true
      }
      case 'expense-register': {
        const { data } = await api.get(`/reports/expense-register?${qs}`)
        const rows = data.data?.rows || []
        if (!rows.length) { alert('No expenses in this range'); return false }
        const csv = toCsv(
          ['Date', 'Bill No', 'Category', 'Vendor', 'Description', 'Mode', 'Credit', 'Amount', 'GST', 'TDS'],
          rows.map((r: Record<string, unknown>) => [
            r.date, r.bill_number, r.category, r.vendor, r.description, r.payment_mode,
            r.is_on_credit ? 'Yes' : 'No', rs(r.amount_paise as number), rs(r.gst_paid_paise as number), rs(r.tds_amount_paise as number),
          ]),
        )
        downloadBlob(`expense-register.csv`, csv, 'text/csv')
        return true
      }
      case 'daily-collection': {
        const { data } = await api.get(`/reports/daily-collection?${qs}`)
        const d = data.data || {}
        const csv = toCsv(['Stream', 'Amount'], [
          ['Donations', rs(d.donations_paise)], ['Seva', rs(d.seva_paise)],
          ['Prasad', rs(d.prasad_paise)], ['Bhojanshala', rs(d.bhojanshala_paise)],
          ['Room Advance', rs(d.room_advance_paise)], ['Hall Advance', rs(d.hall_advance_paise)],
          ['Total Collection', rs(d.total_collection_paise)], ['Expenses', rs(d.expenses_paise)],
          ['Net', rs(d.net_paise)],
        ])
        downloadBlob(`daily-collection-${params.date || ''}.csv`, csv, 'text/csv')
        return true
      }
      case 'boli-register': {
        const { data } = await api.get(`/bolis/register?${qs}`)
        const rows = data.data?.rows || []
        if (!rows.length) { alert('No boli records'); return false }
        const csv = toCsv(
          ['Date', 'Donor', 'Mobile', 'Description', 'Event', 'Pledged', 'Paid', 'Outstanding', 'Status'],
          rows.map((b: Record<string, unknown>) => [
            b.boli_date, b.donor_name, b.donor_mobile, b.seva_description, b.event_name,
            rs(b.committed_amount_paise as number), rs(b.paid_amount_paise as number), rs(b.outstanding_paise as number), b.status,
          ]),
        )
        downloadBlob(`boli-register.csv`, csv, 'text/csv')
        return true
      }
      case 'donation-trends': {
        const { data } = await api.get(`/reports/analytics/donation-trends?${qs}`)
        const points = data.data?.points || []
        if (!points.length) { alert('No data'); return false }
        const csv = toCsv(['Period', 'Receipts', 'Amount'],
          points.map((p: Record<string, unknown>) => [p.bucket, p.receipts, rs(p.amount_paise as number)]))
        downloadBlob(`donation-trends.csv`, csv, 'text/csv')
        return true
      }
      case 'top-donors': {
        const { data } = await api.get(`/reports/analytics/top-donors?${qs}`)
        const rows = data.data?.rows || data.data || []
        if (!rows.length) { alert('No data'); return false }
        const csv = toCsv(['Donor', 'Mobile', 'PAN', 'Receipts', 'Total'],
          rows.map((r: Record<string, unknown>) => [
            String(r.donor ?? r.name ?? ''), String(r.mobile ?? ''), String(r.pan_masked ?? ''),
            Number(r.receipts ?? 0), rs((r.amount_paise ?? r.total_paise) as number),
          ]))
        downloadBlob(`top-donors.csv`, csv, 'text/csv')
        return true
      }
      case 'gst-summary': {
        const { data } = await api.get(`/reports/gst-summary?${qs}`)
        downloadBlob(`gst-summary-${params.fy || ''}.json`, JSON.stringify(data.data, null, 2), 'application/json')
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
