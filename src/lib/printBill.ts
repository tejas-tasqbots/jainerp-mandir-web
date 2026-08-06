import { printReceiptHtml } from './printReceipt'

/**
 * Standalone bill document for the Dharamshala modules (rooms + halls).
 *
 * A bill is not a receipt: `/bill` is the working settlement view (tenders,
 * paid, balance) while `/receipt` is the guest-facing document that stops
 * changing once the invoice number is issued. printReceipt.ts covers receipts;
 * this covers bills.
 *
 * Both Print buttons used to call window.print(), which prints the *page* — so
 * the output was the register listing with the modal floating over it, never
 * the bill. Rendering into a hidden iframe isolates the document from the page.
 */

export interface BillLine {
  label: string
  value: string
  bold?: boolean
}

export interface BillDoc {
  templeName: string
  templeAddress?: string
  /** "Room Bill" / "Hall Bill" */
  title: string
  invoiceNo?: string
  /** Guest + room, or booker + hall + event. */
  meta: BillLine[]
  /** Subtotal, CGST, SGST, Total. */
  charges: BillLine[]
  paymentsLabel: string
  payments: BillLine[]
  noPaymentsLabel: string
  balanceLabel: string
  balanceValue: string
  /** Drives the balance colour: red when money is still owed. */
  balanceOutstanding: boolean
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function rows(lines: BillLine[]): string {
  return lines
    .map(l =>
      `<tr><td${l.bold ? ' class="b"' : ''}>${esc(l.label)}</td>` +
      `<td class="r${l.bold ? ' b' : ''}">${esc(l.value)}</td></tr>`)
    .join('')
}

export function printBillDoc(doc: BillDoc): void {
  const payments = doc.payments.length
    ? rows(doc.payments)
    : `<tr><td colspan="2" class="muted">${esc(doc.noPaymentsLabel)}</td></tr>`

  printReceiptHtml(`<!doctype html><html><head><meta charset="utf-8">
<title>${esc(doc.invoiceNo || doc.title)}</title>
<style>
  @page { size: A4; margin: 16mm }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1e293b; font-size: 13px }
  h1 { font-size: 18px; margin: 0; text-align: center }
  .addr, .meta { text-align: center; color: #64748b; font-size: 12px }
  h2 { font-size: 14px; margin: 18px 0 8px; text-align: center; letter-spacing: .08em; text-transform: uppercase }
  table { width: 100%; border-collapse: collapse; margin-top: 6px }
  td { padding: 5px 0; border-bottom: 1px solid #f1f5f9 }
  .r { text-align: right }
  .b { font-weight: 700 }
  .muted { color: #94a3b8 }
  .sec { margin-top: 16px; font-weight: 600; font-size: 12px; text-transform: uppercase; color: #64748b }
  .due { color: ${doc.balanceOutstanding ? '#dc2626' : '#16a34a'} }
</style></head><body>
  <h1>${esc(doc.templeName)}</h1>
  ${doc.templeAddress ? `<div class="addr">${esc(doc.templeAddress)}</div>` : ''}
  <h2>${esc(doc.title)}</h2>
  <div class="meta">${esc(doc.invoiceNo || '')} · ${new Date().toLocaleDateString('en-IN')}</div>
  <table>${rows(doc.meta)}</table>
  <table>${rows(doc.charges)}</table>
  <div class="sec">${esc(doc.paymentsLabel)}</div>
  <table>${payments}</table>
  <table>
    <tr><td class="b">${esc(doc.balanceLabel)}</td>
        <td class="r b due">${esc(doc.balanceValue)}</td></tr>
  </table>
</body></html>`)
}
