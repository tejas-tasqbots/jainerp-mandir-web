import { useState } from 'react'
import { Download, RefreshCw, ShieldAlert } from 'lucide-react'
import { api } from '../../../lib/api'

export function BackupTab() {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  async function downloadExport() {
    setExporting(true)
    setError('')
    try {
      const r = await api.get('/tenants/me/export')
      const payload = r.data.data || r.data
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jainerp-backup-${payload.tenant || 'mandir'}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      const e2 = e as { response?: { data?: { error?: { message?: string } } } }
      setError(e2.response?.data?.error?.message || 'Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Manual Data Export</h3></div>
        <div className="card-body space-y-3">
          <p className="text-sm text-slate-500">
            Download a complete JSON backup of this mandir's data — donations, expenses, donors, accounts,
            bookings and master records. Keep this file safe; it can be used to restore data with help from support.
          </p>
          {error && <p className="text-sm text-brand-red">{error}</p>}
          <button onClick={downloadExport} disabled={exporting} className="btn-primary">
            {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
            {exporting ? 'Preparing export…' : 'Download Backup (JSON)'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm flex items-center gap-2"><ShieldAlert size={14} /> Restore</h3>
        </div>
        <div className="card-body">
          <p className="text-sm text-slate-500">
            To restore data from a backup or an older export file, please contact Tasqbots support. Restores are
            performed by the support team to protect your existing data.
          </p>
        </div>
      </div>
    </div>
  )
}
