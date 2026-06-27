import { useState } from 'react'
import { Award, Download, RefreshCw, FileText } from 'lucide-react'
import { api, currentFY, fmtPaise } from '../../lib/api'

// ── Authenticated download helpers ───────────────────────────────────────────
// The compliance endpoints require a Bearer token, so opening them in a new
// browser tab (window.open) returns 401. Fetch via the authenticated api
// client and build the file client-side instead.

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.map(esc).join(',')].concat(rows.map(r => r.map(esc).join(','))).join('\n')
}

export function CertificatesPage() {
  const [tab, setTab] = useState<'80g' | 'tds'>('80g')
  const [fy, setFy] = useState(currentFY())
  const [generating, setGenerating] = useState(false)
  const [certs, setCerts] = useState<{ id: string; donor: string; mobile?: string; pan_masked?: string; total_eligible_paise: number; receipts: number }[]>([])
  const [form10bd, setForm10bd] = useState<{ id: string; donor: string; pan_masked?: string; amount_paise: number; donation_date: string; payment_mode: string; status: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [tdsData, setTdsData] = useState<{ rows: TdsRow[]; total_tds_paise: number } | null>(null)
  const [tdsQuarter, setTdsQuarter] = useState('')

  interface TdsRow {
    date: string
    vendor: string
    pan_masked?: string
    tds_section?: string
    amount_paise: number
    tds_amount_paise: number
    tds_challan_no?: string
  }

  async function generate10bd() {
    if (!window.confirm(`Generate Form 10BD entries for FY ${fy}? Duplicate entries will be skipped.`)) return
    setGenerating(true)
    try {
      const { data } = await api.post('/compliance/form-10bd/generate', { fy })
      alert(`Form 10BD generated: ${data.data?.new_entries ?? 0} new entries for FY ${fy}`)
      fetchForm10bd()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e.response?.data?.error?.message || 'Failed to generate')
    } finally {
      setGenerating(false)
    }
  }

  async function fetchCerts() {
    setLoading(true)
    try {
      const { data } = await api.get(`/compliance/80g-certificates?fy=${fy}`)
      setCerts(data.data?.rows || data.rows || [])
    } finally {
      setLoading(false)
    }
  }

  async function fetchForm10bd() {
    setLoading(true)
    try {
      const { data } = await api.get(`/compliance/form-10bd?fy=${fy}`)
      setForm10bd(data.data?.rows || data.rows || [])
    } finally {
      setLoading(false)
    }
  }

  async function fetchTds() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ fy })
      if (tdsQuarter) params.set('quarter', tdsQuarter)
      const { data } = await api.get(`/compliance/tds-report?${params}`)
      setTdsData(data.data || data)
    } finally {
      setLoading(false)
    }
  }

  // ── Downloads (authenticated) ──────────────────────────────────────────────
  const [downloading, setDownloading] = useState('')

  async function downloadForm10bd() {
    setDownloading('10bd')
    try {
      const { data } = await api.get(`/compliance/form-10bd?fy=${fy}`)
      const rows = data.data?.rows || data.rows || []
      if (!rows.length) { alert('No Form 10BD entries. Generate them first.'); return }
      // Income-tax Form 10BD utility consumes a JSON/CSV upload; provide JSON.
      downloadBlob(`form-10bd-${fy}.json`, JSON.stringify({ fy, rows }, null, 2), 'application/json')
    } catch {
      alert('Could not download Form 10BD')
    } finally {
      setDownloading('')
    }
  }

  async function download80gList() {
    setDownloading('80g')
    try {
      const { data } = await api.get(`/compliance/80g-certificates?fy=${fy}`)
      const rows = data.data?.rows || data.rows || []
      if (!rows.length) { alert('No 80G-eligible donors for this FY'); return }
      const csv = toCsv(
        ['Donor', 'Mobile', 'PAN', 'Receipts', 'Eligible Amount (₹)'],
        rows.map((c: { donor: string; mobile?: string; pan_masked?: string; receipts: number; total_eligible_paise: number }) =>
          [c.donor, c.mobile ?? '', c.pan_masked ?? '', c.receipts, (c.total_eligible_paise / 100).toFixed(2)]),
      )
      downloadBlob(`80g-certificate-list-${fy}.csv`, csv, 'text/csv')
    } catch {
      alert('Could not download 80G list')
    } finally {
      setDownloading('')
    }
  }

  async function downloadTds(quarter?: string) {
    setDownloading('tds')
    try {
      const params = new URLSearchParams({ fy })
      if (quarter) params.set('quarter', quarter)
      const { data } = await api.get(`/compliance/tds-report?${params}`)
      const d = data.data || data
      const rows = d.rows || []
      if (!rows.length) { alert('No TDS records for this period'); return }
      const csv = toCsv(
        ['Date', 'Vendor', 'PAN', 'Section', 'Expense Amount (₹)', 'TDS Amount (₹)', 'Challan No'],
        rows.map((r: TdsRow) =>
          [r.date, r.vendor ?? '', r.pan_masked ?? '', r.tds_section ?? '', (r.amount_paise / 100).toFixed(2), (r.tds_amount_paise / 100).toFixed(2), r.tds_challan_no ?? '']),
      )
      downloadBlob(`tds-report-${fy}${quarter ? `-q${quarter}` : ''}.csv`, csv, 'text/csv')
    } catch {
      alert('Could not download TDS report')
    } finally {
      setDownloading('')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-navy-900">Compliance — Certificates & TDS</h1>

      {/* Tab bar */}
      <div className="flex gap-2">
        <button type="button" onClick={() => setTab('80g')}
          className={`px-4 py-1.5 text-sm rounded-md font-medium ${tab === '80g' ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
          80G Certificates
        </button>
        <button type="button" onClick={() => setTab('tds')}
          className={`px-4 py-1.5 text-sm rounded-md font-medium ${tab === 'tds' ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
          TDS Report
        </button>
      </div>

      {/* FY selector (shared) */}
      <div className="flex items-center gap-3">
        <label className="form-label mb-0">Financial Year:</label>
        <input className="form-input w-28" value={fy} onChange={e => setFy(e.target.value)} placeholder="2025-26" />
      </div>

      {tab === '80g' && (
        <>
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><Award size={16} /> 80G Certificate Register</h3></div>
            <div className="card-body space-y-4">
              <div className="flex gap-3 flex-wrap">
                <button type="button" onClick={fetchCerts} disabled={loading} className="btn-secondary">
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />} Load Eligible Donors
                </button>
                <button type="button" onClick={generate10bd} disabled={generating} className="btn-primary">
                  {generating ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />}
                  {generating ? 'Generating...' : 'Generate Form 10BD'}
                </button>
                <button type="button" onClick={fetchForm10bd} disabled={loading} className="btn-secondary">
                  <FileText size={14} /> Load Form 10BD Entries
                </button>
              </div>
            </div>
          </div>

          {/* Compliance Downloads */}
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm">Download Compliance Files</h3></div>
            <div className="card-body">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: '10bd', label: 'Form 10BD (JSON)', fn: downloadForm10bd },
                  { key: '80g', label: '80G Certificate List (CSV)', fn: download80gList },
                  { key: 'tds', label: 'TDS Report (CSV)', fn: () => downloadTds() },
                ].map(r => (
                  <button key={r.label} type="button" onClick={r.fn} disabled={downloading === r.key}
                    className="flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-brand-blue hover:bg-blue-50 transition-colors group disabled:opacity-50">
                    <span className="text-sm font-medium text-slate-700 group-hover:text-brand-blue">{r.label}</span>
                    {downloading === r.key
                      ? <RefreshCw size={15} className="text-brand-blue animate-spin" />
                      : <Download size={15} className="text-slate-400 group-hover:text-brand-blue" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 80G eligible donors */}
          {certs.length > 0 && (
            <div className="card overflow-hidden">
              <div className="card-header">
                <h3 className="font-semibold text-sm">80G-Eligible Donors — FY {fy}</h3>
                <span className="badge-blue">{certs.length} donors</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Donor</th><th>Mobile</th><th>PAN</th><th>Receipts</th><th>Eligible Amount</th></tr></thead>
                  <tbody>
                    {certs.map((c, i) => (
                      <tr key={c.id || i}>
                        <td className="font-medium">{c.donor}</td>
                        <td>{c.mobile || '—'}</td>
                        <td className="font-mono text-xs">{c.pan_masked || '—'}</td>
                        <td className="text-center">{c.receipts}</td>
                        <td className="font-semibold text-green-700">₹{fmtPaise(c.total_eligible_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Form 10BD entries */}
          {form10bd.length > 0 && (
            <div className="card overflow-hidden">
              <div className="card-header">
                <h3 className="font-semibold text-sm">Form 10BD Entries — FY {fy}</h3>
                <span className="badge-blue">{form10bd.length} entries</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Donor</th><th>PAN</th><th>Amount</th><th>Date</th><th>Mode</th><th>Status</th></tr></thead>
                  <tbody>
                    {form10bd.map((e, i) => (
                      <tr key={e.id || i}>
                        <td className="font-medium">{e.donor}</td>
                        <td className="font-mono text-xs">{e.pan_masked || '—'}</td>
                        <td className="font-semibold">₹{fmtPaise(e.amount_paise)}</td>
                        <td className="text-xs text-slate-500">{new Date(e.donation_date).toLocaleDateString('en-IN')}</td>
                        <td><span className="badge-gray">{e.payment_mode}</span></td>
                        <td><span className={e.status === 'draft' ? 'badge-yellow' : 'badge-green'}>{e.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'tds' && (
        <>
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><FileText size={16} /> TDS Deducted at Source</h3></div>
            <div className="card-body">
              <div className="flex items-end gap-4">
                <div>
                  <label className="form-label">Quarter (optional)</label>
                  <select className="form-select" value={tdsQuarter} onChange={e => setTdsQuarter(e.target.value)}>
                    <option value="">Full Year</option>
                    <option value="1">Q1 (Apr–Jun)</option>
                    <option value="2">Q2 (Jul–Sep)</option>
                    <option value="3">Q3 (Oct–Dec)</option>
                    <option value="4">Q4 (Jan–Mar)</option>
                  </select>
                </div>
                <button type="button" onClick={fetchTds} disabled={loading} className="btn-primary">
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />} Load TDS Data
                </button>
                <button type="button" onClick={() => downloadTds(tdsQuarter || undefined)} disabled={downloading === 'tds'} className="btn-secondary">
                  <Download size={14} /> Export CSV
                </button>
              </div>
            </div>
          </div>

          {tdsData && (
            <div className="card overflow-hidden">
              <div className="card-header">
                <h3 className="font-semibold text-sm">TDS Records — FY {fy}</h3>
                <span className="font-bold text-red-600">Total TDS: ₹{fmtPaise(tdsData.total_tds_paise)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Vendor</th><th>PAN</th><th>Section</th><th>Expense Amt</th><th>TDS Amount</th><th>Challan No</th></tr></thead>
                  <tbody>
                    {tdsData.rows.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-8 text-slate-400">No TDS records found</td></tr>
                    ) : tdsData.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="text-xs text-slate-500">{new Date(r.date).toLocaleDateString('en-IN')}</td>
                        <td className="font-medium">{r.vendor || '—'}</td>
                        <td className="font-mono text-xs">{r.pan_masked || '—'}</td>
                        <td><span className="badge-gray">{r.tds_section || '—'}</span></td>
                        <td>₹{fmtPaise(r.amount_paise)}</td>
                        <td className="font-semibold text-red-600">₹{fmtPaise(r.tds_amount_paise)}</td>
                        <td className="font-mono text-xs">{r.tds_challan_no || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
