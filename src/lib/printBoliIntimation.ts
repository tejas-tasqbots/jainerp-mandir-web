import { api } from './api'
import { printReceiptHtml } from './printReceipt'

interface IntimationData {
  mandir: { name: string; city?: string | null; mobile?: string | null } | null
  boli: {
    id: string
    date: string
    description: string
    donor_name: string
    donor_mobile?: string | null
    committed_paise: number
    paid_paise: number
    outstanding_paise: number
    status: string
  }
}

function fmtRs(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function buildIntimationHtml(d: IntimationData): string {
  const m = d.mandir ?? { name: 'Mandir' }
  const b = d.boli
  const color = '#0D1B2E'
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Boli Intimation — ${b.donor_name}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Arial',sans-serif;background:#f0f2f5;color:#1a1a1a;}
    .page{max-width:640px;margin:24px auto;background:#fff;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;}
    .header{background:${color};color:#fff;padding:22px 28px;}
    .header h1{font-size:18px;font-weight:700;}
    .header p{font-size:11px;opacity:.85;margin-top:2px;}
    .title{text-align:center;padding:14px;background:#fef9ee;border-bottom:1px solid #fde68a;}
    .title h2{font-size:15px;letter-spacing:1px;text-transform:uppercase;color:#b45309;}
    .body{padding:24px 28px;}
    .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;}
    .row .k{color:#6b7280;font-weight:600;}
    .row .v{color:#111;font-weight:600;text-align:right;}
    .out{background:#fef2f2;border:1.5px solid #fca5a5;border-radius:8px;padding:14px 18px;margin-top:16px;display:flex;justify-content:space-between;align-items:center;}
    .out .lbl{font-size:13px;color:#b91c1c;font-weight:700;}
    .out .amt{font-size:24px;font-weight:800;color:#b91c1c;font-family:monospace;}
    .note{font-size:11px;color:#6b7280;margin-top:16px;font-style:italic;line-height:1.7;}
    .print-hint{font-size:10px;color:#cbd5e1;text-align:center;padding:8px;}
    @media print{body{background:#fff;}.page{border:none;margin:0;}.print-hint{display:none;}}
  </style></head><body>
  <div class="page">
    <div class="header">
      <h1>${m.name}</h1>
      <p>${[m.city, m.mobile].filter(Boolean).join(' · ')}</p>
    </div>
    <div class="title"><h2>Boli Pledge Intimation</h2></div>
    <div class="body">
      <div class="row"><span class="k">Donor</span><span class="v">${b.donor_name}${b.donor_mobile ? ' · ' + b.donor_mobile : ''}</span></div>
      <div class="row"><span class="k">Pledge Date</span><span class="v">${fmtDate(b.date)}</span></div>
      <div class="row"><span class="k">Description</span><span class="v">${b.description}</span></div>
      <div class="row"><span class="k">Pledged Amount</span><span class="v">₹ ${fmtRs(b.committed_paise)}</span></div>
      <div class="row"><span class="k">Paid So Far</span><span class="v">₹ ${fmtRs(b.paid_paise)}</span></div>
      <div class="row"><span class="k">Status</span><span class="v" style="text-transform:capitalize">${b.status.replace('_', ' ')}</span></div>
      <div class="out">
        <span class="lbl">Outstanding Amount</span>
        <span class="amt">₹ ${fmtRs(b.outstanding_paise)}</span>
      </div>
      <p class="note">Kindly clear the outstanding pledge amount at your earliest convenience.
        This is a reminder intimation and not a payment receipt. A receipt will be issued upon payment.</p>
    </div>
    <div class="print-hint">Ctrl+P to print or save as PDF</div>
  </div></body></html>`
}

/** Fetch a boli's intimation payload and open the print dialog. */
export async function printBoliIntimation(boliId: string): Promise<void> {
  const { data } = await api.get(`/bolis/${boliId}/intimation`)
  const html = buildIntimationHtml((data.data ?? data) as IntimationData)
  printReceiptHtml(html)
}
