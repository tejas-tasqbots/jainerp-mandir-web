import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Award, Download, RefreshCw, FileText } from 'lucide-react'
import { api, currentFY, fmtPaise } from '../../lib/api'
import { downloadRowsPdf } from '../../lib/pdfTable'
import { useConfirm } from '../../components/ConfirmDialog'
import { FySelect } from '../../components/FySelect'
import { useToast } from '../../components/kit/Toast'
import { paymentModeLabel } from '../../lib/paymentModeLabel'
import { statusLabel } from '../../lib/statusLabel'

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
  const toast = useToast()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [tab, setTab] = useState<'80g' | 'tds'>('80g')
  const [fy, setFy] = useState(currentFY())
  const [generating, setGenerating] = useState(false)
  const [certs, setCerts] = useState<{ id: string; donor: string; mobile?: string; pan_masked?: string; total_eligible_paise: number; receipts: number; certificate_no?: string | null }[]>([])
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

  async function generate80g() {
    if (!(await confirm({ title: t('certificates.generate80gConfirmTitle'), message: t('certificates.generate80gConfirmMessage', { fy }), confirmLabel: t('certificates.generate') }))) return
    setGenerating(true)
    try {
      const { data } = await api.post('/compliance/80g-certificates/generate', { fy, donor_ids: 'all' })
      const d = data.data || {}
      toast.success(t('certificates.eightyGResult', { created: d.created ?? 0, updated: d.updated ?? 0, eligible: d.eligible_donors ?? 0 }))
      fetchCerts()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message || t('certificates.failedToGenerateCerts'))
    } finally {
      setGenerating(false)
    }
  }

  async function generate10bd() {
    if (!(await confirm({ title: t('certificates.generate10bdConfirmTitle'), message: t('certificates.generate10bdConfirmMessage', { fy }), confirmLabel: t('certificates.generate') }))) return
    setGenerating(true)
    try {
      const { data } = await api.post('/compliance/form-10bd/generate', { fy })
      toast.success(t('certificates.form10bdResult', { count: data.data?.new_entries ?? 0, fy }))
      fetchForm10bd()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message || t('certificates.failedToGenerate'))
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
      if (!rows.length) { toast.info(t('certificates.noForm10bdEntries')); return }
      // Income-tax Form 10BD utility consumes a JSON/CSV upload; provide JSON.
      downloadBlob(`form-10bd-${fy}.json`, JSON.stringify({ fy, rows }, null, 2), 'application/json')
    } catch {
      toast.error(t('certificates.couldNotDownload10bd'))
    } finally {
      setDownloading('')
    }
  }

  async function download80gList() {
    setDownloading('80g')
    try {
      const { data } = await api.get(`/compliance/80g-certificates?fy=${fy}`)
      const rows = data.data?.rows || data.rows || []
      if (!rows.length) { toast.success(t('certificates.no80gDonors')); return }
      const csv = toCsv(
        ['Donor', 'Mobile', 'PAN', 'Receipts', 'Eligible Amount (₹)'],
        rows.map((c: { donor: string; mobile?: string; pan_masked?: string; receipts: number; total_eligible_paise: number }) =>
          [c.donor, c.mobile ?? '', c.pan_masked ?? '', c.receipts, (c.total_eligible_paise / 100).toFixed(2)]),
      )
      downloadBlob(`80g-certificate-list-${fy}.csv`, csv, 'text/csv')
    } catch {
      toast.error(t('certificates.couldNotDownload80g'))
    } finally {
      setDownloading('')
    }
  }

  async function download80gListPdf() {
    setDownloading('80g-pdf')
    try {
      const { data } = await api.get(`/compliance/80g-certificates?fy=${fy}`)
      const rows = data.data?.rows || data.rows || []
      if (!rows.length) { toast.success(t('certificates.no80gDonors')); return }
      const total = rows.reduce((s: number, c: { total_eligible_paise: number }) => s + Number(c.total_eligible_paise), 0)
      downloadRowsPdf(`80g-certificate-list-${fy}.pdf`, '80G Certificate Register',
        ['Certificate No.', 'Donor', 'Mobile', 'PAN', 'Receipts', 'Eligible Amount'],
        rows.map((c: { certificate_no?: string | null; donor: string; mobile?: string; pan_masked?: string; receipts: number; total_eligible_paise: number }) =>
          [c.certificate_no ?? '', c.donor, c.mobile ?? '', c.pan_masked ?? '', c.receipts, (c.total_eligible_paise / 100).toFixed(2)]),
        { subtitle: `FY ${fy}`, totals: ['Total', '', '', '', '', (total / 100).toFixed(2)] })
    } catch {
      toast.error(t('certificates.couldNotDownload80g'))
    } finally {
      setDownloading('')
    }
  }

  async function downloadTdsPdf(quarter?: string) {
    setDownloading('tds-pdf')
    try {
      const params = new URLSearchParams({ fy })
      if (quarter) params.set('quarter', quarter)
      const { data } = await api.get(`/compliance/tds-report?${params}`)
      const d = data.data || data
      const rows: TdsRow[] = d.rows || []
      if (!rows.length) { toast.info(t('certificates.noTdsForPeriod')); return }
      downloadRowsPdf(`tds-report-${fy}${quarter ? `-q${quarter}` : ''}.pdf`, 'TDS Report',
        ['Date', 'Vendor', 'PAN', 'Section', 'Expense Amount', 'TDS Amount', 'Challan No'],
        rows.map(r => [
          r.date, r.vendor ?? '', r.pan_masked ?? '', r.tds_section ?? '',
          (r.amount_paise / 100).toFixed(2), (r.tds_amount_paise / 100).toFixed(2), r.tds_challan_no ?? '',
        ]),
        { subtitle: `FY ${fy}${quarter ? ` — Q${quarter}` : ''}`, totals: ['Total TDS', '', '', '', '', ((d.total_tds_paise ?? 0) / 100).toFixed(2), ''] })
    } catch {
      toast.error(t('certificates.couldNotDownloadTds'))
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
      if (!rows.length) { toast.info(t('certificates.noTdsForPeriod')); return }
      const csv = toCsv(
        ['Date', 'Vendor', 'PAN', 'Section', 'Expense Amount (₹)', 'TDS Amount (₹)', 'Challan No'],
        rows.map((r: TdsRow) =>
          [r.date, r.vendor ?? '', r.pan_masked ?? '', r.tds_section ?? '', (r.amount_paise / 100).toFixed(2), (r.tds_amount_paise / 100).toFixed(2), r.tds_challan_no ?? '']),
      )
      downloadBlob(`tds-report-${fy}${quarter ? `-q${quarter}` : ''}.csv`, csv, 'text/csv')
    } catch {
      toast.error(t('certificates.couldNotDownloadTds'))
    } finally {
      setDownloading('')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-navy-900">{t('certificates.title')}</h1>

      {/* Tab bar */}
      <div className="flex gap-2">
        <button type="button" onClick={() => setTab('80g')}
          className={`px-4 py-1.5 text-sm rounded-md font-medium ${tab === '80g' ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
          {t('certificates.tab80g')}
        </button>
        <button type="button" onClick={() => setTab('tds')}
          className={`px-4 py-1.5 text-sm rounded-md font-medium ${tab === 'tds' ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
          {t('certificates.tabTds')}
        </button>
      </div>

      {/* FY selector (shared) */}
      <div className="flex items-center gap-3">
        <label className="form-label mb-0">{t('certificates.financialYear')}</label>
        <FySelect value={fy} onChange={setFy} className="w-32" />
      </div>

      {tab === '80g' && (
        <>
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><Award size={16} /> {t('certificates.registerTitle')}</h3></div>
            <div className="card-body space-y-4">
              <div className="flex gap-3 flex-wrap">
                <button type="button" onClick={fetchCerts} disabled={loading} className="btn-secondary">
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />} {t('certificates.loadEligibleDonors')}
                </button>
                <button type="button" onClick={generate80g} disabled={generating} className="btn-primary">
                  {generating ? <RefreshCw size={14} className="animate-spin" /> : <Award size={14} />}
                  {generating ? t('certificates.generating') : t('certificates.generate80g')}
                </button>
                <button type="button" onClick={generate10bd} disabled={generating} className="btn-primary">
                  {generating ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />}
                  {generating ? t('certificates.generating') : t('certificates.generateForm10bd')}
                </button>
                <button type="button" onClick={fetchForm10bd} disabled={loading} className="btn-secondary">
                  <FileText size={14} /> {t('certificates.loadForm10bd')}
                </button>
              </div>
            </div>
          </div>

          {/* Compliance Downloads */}
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm">{t('certificates.downloadFilesTitle')}</h3></div>
            <div className="card-body">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: '10bd', labelKey: 'certificates.form10bdJson', fn: downloadForm10bd },
                  { key: '80g', labelKey: 'certificates.eightyGListCsv', fn: download80gList },
                  { key: '80g-pdf', labelKey: 'certificates.eightyGListPdf', fn: download80gListPdf },
                  { key: 'tds', labelKey: 'certificates.tdsReportCsv', fn: () => downloadTds() },
                  { key: 'tds-pdf', labelKey: 'certificates.tdsReportPdf', fn: () => downloadTdsPdf() },
                ].map(r => (
                  <button key={r.key} type="button" onClick={r.fn} disabled={downloading === r.key}
                    className="flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-brand-blue hover:bg-blue-50 transition-colors group disabled:opacity-50">
                    <span className="text-sm font-medium text-slate-700 group-hover:text-brand-blue">{t(r.labelKey)}</span>
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
                <h3 className="font-semibold text-sm">{t('certificates.eligibleDonorsFy', { fy })}</h3>
                <span className="badge-blue">{t('certificates.donorsCount', { count: certs.length })}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>{t('certificates.certificateNo')}</th><th>{t('certificates.donor')}</th><th>{t('certificates.mobile')}</th><th>{t('certificates.pan')}</th><th>{t('certificates.receipts')}</th><th>{t('certificates.eligibleAmount')}</th></tr></thead>
                  <tbody>
                    {certs.map((c, i) => (
                      <tr key={c.id || i}>
                        <td className="font-mono text-xs">{c.certificate_no || <span className="text-slate-400">{t('certificates.notGenerated')}</span>}</td>
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
                <h3 className="font-semibold text-sm">{t('certificates.form10bdEntriesFy', { fy })}</h3>
                <span className="badge-blue">{t('certificates.entriesCount', { count: form10bd.length })}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>{t('certificates.donor')}</th><th>{t('certificates.pan')}</th><th>{t('certificates.amount')}</th><th>{t('certificates.date')}</th><th>{t('certificates.mode')}</th><th>{t('certificates.status')}</th></tr></thead>
                  <tbody>
                    {form10bd.map((e, i) => (
                      <tr key={e.id || i}>
                        <td className="font-medium">{e.donor}</td>
                        <td className="font-mono text-xs">{e.pan_masked || '—'}</td>
                        <td className="font-semibold">₹{fmtPaise(e.amount_paise)}</td>
                        <td className="text-xs text-slate-500">{new Date(e.donation_date).toLocaleDateString('en-IN')}</td>
                        <td><span className="badge-gray">{paymentModeLabel(t, e.payment_mode)}</span></td>
                        <td><span className={e.status === 'draft' ? 'badge-yellow' : 'badge-green'}>{statusLabel(t, e.status)}</span></td>
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
            <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><FileText size={16} /> {t('certificates.tdsTitle')}</h3></div>
            <div className="card-body">
              <div className="flex items-end gap-4">
                <div>
                  <label className="form-label" htmlFor="certificates-page-tdsQuarter">{t('certificates.quarterOptional')}</label>
                  <select id="certificates-page-tdsQuarter" className="form-select" value={tdsQuarter} onChange={e => setTdsQuarter(e.target.value)}>
                    <option value="">{t('certificates.fullYear')}</option>
                    <option value="1">{t('certificates.q1')}</option>
                    <option value="2">{t('certificates.q2')}</option>
                    <option value="3">{t('certificates.q3')}</option>
                    <option value="4">{t('certificates.q4')}</option>
                  </select>
                </div>
                <button type="button" onClick={fetchTds} disabled={loading} className="btn-primary">
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />} {t('certificates.loadTdsData')}
                </button>
                <button type="button" onClick={() => downloadTds(tdsQuarter || undefined)} disabled={downloading === 'tds'} className="btn-secondary">
                  <Download size={14} /> {t('certificates.exportCsv')}
                </button>
              </div>
            </div>
          </div>

          {tdsData && (
            <div className="card overflow-hidden">
              <div className="card-header">
                <h3 className="font-semibold text-sm">{t('certificates.tdsRecordsFy', { fy })}</h3>
                <span className="font-bold text-red-600">{t('certificates.totalTds', { amount: fmtPaise(tdsData.total_tds_paise) })}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>{t('certificates.date')}</th><th>{t('certificates.vendor')}</th><th>{t('certificates.pan')}</th><th>{t('certificates.section')}</th><th>{t('certificates.expenseAmt')}</th><th>{t('certificates.tdsAmount')}</th><th>{t('certificates.challanNo')}</th></tr></thead>
                  <tbody>
                    {tdsData.rows.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-8 text-slate-400">{t('certificates.noTdsRecords')}</td></tr>
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
