import { useState } from 'react'
import { Download, FileText, RefreshCw } from 'lucide-react'
import { currentFY } from '../../lib/api'
import { downloadReport, type ReportFormat } from '../../lib/downloadReport'

export function ReportsHome() {
  const [fy, setFy] = useState(currentFY())
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + '01')
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState<string | null>(null)

  async function download(label: string, key: string, params: Record<string, string>, format: ReportFormat) {
    setLoading(`${label}:${format}`)
    try {
      await downloadReport(key, params, format)
    } finally {
      setLoading(null)
    }
  }

  const reports: { group: string; items: { label: string; key: string; params: Record<string, string>; formats?: ReportFormat[] }[] }[] = [
    {
      group: 'Daily & Transaction Reports',
      items: [
        { label: 'Daily Collection', key: 'daily-collection', params: { date: to } },
        { label: 'Donation Register', key: 'donation-register', params: { from, to } },
        { label: 'Expense Register', key: 'expense-register', params: { from, to } },
        { label: 'Boli Register', key: 'boli-register', params: { fy } },
      ],
    },
    {
      group: 'Analytics',
      items: [
        { label: 'Donation Trends', key: 'donation-trends', params: { granularity: 'monthly', fy } },
        { label: 'Top Donors', key: 'top-donors', params: { fy, limit: '20' } },
        { label: 'GST Summary', key: 'gst-summary', params: { fy } },
      ],
    },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-navy-900">Reports</h1>

      {/* Filters */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600">FY:</label>
              <input className="form-input w-28" value={fy} onChange={e => setFy(e.target.value)} placeholder="2025-26" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600">From:</label>
              <input type="date" className="form-input w-40" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600">To:</label>
              <input type="date" className="form-input w-40" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {reports.map(group => (
        <div key={group.group} className="card">
          <div className="card-header">
            <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
              <FileText size={15} /> {group.group}
            </h3>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-2 gap-3">
              {group.items.map(r => (
                <div
                  key={r.label}
                  className="flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 gap-3"
                >
                  <span className="text-sm font-medium text-slate-700 min-w-0 truncate">{r.label}</span>
                  <span className="flex gap-1.5 flex-shrink-0">
                    {(['csv', 'pdf'] as ReportFormat[]).map(fmt => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => download(r.label, r.key, r.params, fmt)}
                        disabled={loading === `${r.label}:${fmt}`}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors disabled:opacity-50 ${
                          fmt === 'pdf'
                            ? 'border-red-200 text-red-700 hover:bg-red-50'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                        title={`Download ${r.label} as ${fmt.toUpperCase()}`}
                      >
                        {loading === `${r.label}:${fmt}`
                          ? <RefreshCw size={11} className="animate-spin" />
                          : <Download size={11} />}
                        {fmt.toUpperCase()}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      {/* CA pack (server ZIP) */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
            <FileText size={15} /> Chartered Accountant
          </h3>
        </div>
        <div className="card-body">
          <button
            type="button"
            onClick={() => download('CA Pack', 'ca-pack', { fy }, 'csv')}
            disabled={loading === 'CA Pack:csv'}
            className="flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-brand-blue hover:bg-blue-50 transition-colors text-left group disabled:opacity-50 w-full md:w-1/2"
          >
            <span className="text-sm font-medium text-slate-700 group-hover:text-brand-blue">
              CA Pack — all registers &amp; statements (ZIP)
            </span>
            {loading === 'CA Pack:csv'
              ? <RefreshCw size={15} className="text-brand-blue animate-spin flex-shrink-0" />
              : <Download size={15} className="text-slate-400 group-hover:text-brand-blue flex-shrink-0" />}
          </button>
        </div>
      </div>
    </div>
  )
}
