import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { api, currentFY } from '../../lib/api'

export function ReportsHome() {
  const [fy, setFy] = useState(currentFY())
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + '01')
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState<string | null>(null)

  async function download(label: string, url: string) {
    setLoading(label)
    try {
      window.open(url, '_blank')
    } finally {
      setTimeout(() => setLoading(null), 1000)
    }
  }

  const reports = [
    {
      group: 'Daily & Transaction Reports',
      items: [
        { label: 'Daily Collection Report', url: `/api/v1/reports/daily-collection?date=${to}` },
        { label: 'Donation Register (Excel)', url: `/api/v1/reports/donation-register?from=${from}&to=${to}&export=excel` },
        { label: 'Expense Register (Excel)', url: `/api/v1/reports/expense-register?from=${from}&to=${to}&export=excel` },
        { label: 'Boli Register (PDF)', url: `/api/v1/reports/boli-register?fy=${fy}&export=pdf` },
      ],
    },
    {
      group: 'Analytics',
      items: [
        { label: 'Donation Trends (Monthly)', url: `/api/v1/reports/analytics/donation-trends?granularity=monthly&fy=${fy}` },
        { label: 'Top Donors Report', url: `/api/v1/reports/analytics/top-donors?fy=${fy}&limit=20` },
        { label: 'GST Summary', url: `/api/v1/reports/gst-summary?fy=${fy}` },
        { label: 'CA Pack (ZIP — all reports)', url: `/api/v1/reports/ca-pack?fy=${fy}` },
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
                <button
                  key={r.label}
                  onClick={() => download(r.label, r.url)}
                  disabled={loading === r.label}
                  className="flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 hover:border-brand-blue hover:bg-blue-50 transition-colors text-left group disabled:opacity-50"
                >
                  <span className="text-sm font-medium text-slate-700 group-hover:text-brand-blue">
                    {r.label}
                  </span>
                  <Download size={15} className="text-slate-400 group-hover:text-brand-blue flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
