import { api } from './api'

interface ReceiptData {
  receipt_number: string
  date: string
  mandir: {
    name: string
    address: string
    reg_80g_number?: string | null
    reg_12a_number?: string | null
    pan?: string | null
    show_80g?: boolean
    footer?: string | null
  } | null
  donor: { name?: string | null; mobile?: string | null }
  category: string
  amount_paise: number
  payment_mode: string
  is_80g_eligible: boolean
  is_voided: boolean
}

function fmtRs(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
}

function modeName(mode: string): string {
  const map: Record<string, string> = {
    cash: 'Cash', upi: 'UPI', cheque: 'Cheque',
    netbanking: 'Net Banking', online: 'Online',
  }
  return map[mode] || mode
}

function buildHtml(r: ReceiptData): string {
  const dateStr = new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const mandir = r.mandir ?? { name: 'Mandir', address: '' }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Donation Receipt – ${r.receipt_number}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #111; background: #fff; }
  .page { max-width: 680px; margin: 20px auto; padding: 28px 32px; border: 1px solid #ccc; }
  .header { text-align: center; border-bottom: 2px solid #0D1B2E; padding-bottom: 12px; margin-bottom: 16px; }
  .mandir-name { font-size: 20px; font-weight: 700; color: #0D1B2E; }
  .mandir-address { font-size: 11px; color: #555; margin-top: 2px; }
  .receipt-title { font-size: 15px; font-weight: 700; letter-spacing: 1px; margin-top: 8px; color: #0D1B2E; }
  .voided-banner { background: #fee2e2; border: 1px solid #fca5a5; color: #991b1b; padding: 6px 12px; border-radius: 4px; text-align: center; font-weight: 700; margin-bottom: 12px; }
  .meta { display: flex; justify-content: space-between; font-size: 12px; color: #555; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  td { padding: 7px 10px; border: 1px solid #e2e8f0; vertical-align: top; }
  td:first-child { font-weight: 600; color: #374151; width: 38%; background: #f8fafc; }
  .amount-row td { font-size: 16px; font-weight: 700; color: #0D1B2E; }
  .footer-note { font-size: 11px; color: #6b7280; border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 4px; }
  .reg-info { font-size: 11px; color: #374151; margin-top: 10px; }
  .print-hint { font-size: 11px; color: #999; text-align: center; margin-top: 12px; }
  @media print { .print-hint { display: none; } body { margin: 0; } .page { border: none; margin: 0; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="mandir-name">${mandir.name}</div>
    ${mandir.address ? `<div class="mandir-address">${mandir.address}</div>` : ''}
    <div class="receipt-title">DONATION RECEIPT</div>
  </div>

  ${r.is_voided ? '<div class="voided-banner">⚠ VOIDED</div>' : ''}

  <div class="meta">
    <span><strong>Receipt No:</strong> ${r.receipt_number}</span>
    <span><strong>Date:</strong> ${dateStr}</span>
  </div>

  <table>
    <tr><td>Donor Name</td><td>${r.donor?.name || 'Anonymous'}</td></tr>
    ${r.donor?.mobile ? `<tr><td>Mobile</td><td>${r.donor.mobile}</td></tr>` : ''}
    <tr><td>Category</td><td>${r.category || '—'}</td></tr>
    <tr><td>Payment Mode</td><td>${modeName(r.payment_mode)}</td></tr>
    <tr class="amount-row"><td>Amount</td><td>₹ ${fmtRs(r.amount_paise)}</td></tr>
    <tr><td>80G Eligible</td><td>${r.is_80g_eligible ? 'Yes' : 'No'}</td></tr>
  </table>

  ${mandir.show_80g && (mandir.reg_80g_number || mandir.reg_12a_number || mandir.pan) ? `
  <div class="reg-info">
    ${mandir.reg_80g_number ? `80G Reg No: <strong>${mandir.reg_80g_number}</strong>&nbsp;&nbsp;` : ''}
    ${mandir.reg_12a_number ? `12A Reg No: <strong>${mandir.reg_12a_number}</strong>&nbsp;&nbsp;` : ''}
    ${mandir.pan ? `PAN: <strong>${mandir.pan}</strong>` : ''}
  </div>` : ''}

  ${mandir.footer ? `<div class="footer-note">${mandir.footer}</div>` : ''}

  <div class="print-hint">Print this page or save as PDF using your browser's print function (Ctrl+P)</div>
</div>
<script>window.onload = () => { window.print() }</script>
</body>
</html>`
}

export async function printDonationReceipt(donationId: string): Promise<void> {
  const { data } = await api.get(`/donations/${donationId}/receipt`)
  const receipt: ReceiptData = data.data
  const html = buildHtml(receipt)
  const win = window.open('', '_blank', 'width=780,height=900')
  if (!win) {
    alert('Popup blocked. Please allow popups for this site and try again.')
    return
  }
  win.document.write(html)
  win.document.close()
}
