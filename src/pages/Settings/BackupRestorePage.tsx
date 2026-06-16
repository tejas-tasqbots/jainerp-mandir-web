import { useState } from 'react'
import { Download, CloudOff, AlertTriangle, Database } from 'lucide-react'
import { api } from '../../lib/api'

export function BackupRestorePage() {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  async function downloadExport() {
    setExporting(true)
    setExportError('')
    try {
      const r = await api.get('/tenants/me/export')
      const data = r.data.data
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jainerp-export-${data.tenant}-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-xl font-bold text-navy-900">Backup & Restore</h1>

      {/* Cloud storage info */}
      <div className="card">
        <div className="card-body">
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Database size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-sm text-navy-900">Data Storage</p>
              <p className="text-sm text-slate-500 mt-0.5">
                Your data is securely stored in a cloud-hosted PostgreSQL database managed by Tasqbots Technologies.
                Automated daily backups are taken and retained for 30 days.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Manual Export */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Manual Data Export</h3></div>
        <div className="card-body space-y-3">
          <p className="text-sm text-slate-600">
            Download a full snapshot of your temple data (donors, donations, expenses, accounts) as a JSON file.
            Save this to Google Drive, a USB drive, or your desktop for safe-keeping.
          </p>
          {exportError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{exportError}</div>
          )}
          <button
            onClick={downloadExport}
            disabled={exporting}
            className="btn-primary"
          >
            <Download size={15} />
            {exporting ? 'Preparing export...' : 'Export Data (JSON)'}
          </button>
        </div>
      </div>

      {/* Restore */}
      <div className="card border-red-100">
        <div className="card-header">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            Restore from Backup
          </h3>
        </div>
        <div className="card-body space-y-3">
          <p className="text-sm text-slate-600">
            To restore data from a backup or an older export file, please contact Tasqbots support.
            Data restoration replaces all current records and cannot be undone.
          </p>
          <a
            href="mailto:support@tasqbots.com?subject=Data Restore Request"
            className="btn-secondary inline-flex items-center gap-2"
          >
            Contact Support for Restore
          </a>
        </div>
      </div>

      {/* Cloud sync note */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <CloudOff size={14} className="text-slate-400" />
            Cloud Sync
          </h3>
        </div>
        <div className="card-body">
          <p className="text-sm text-slate-500">
            Cloud sync is managed automatically by the platform. Your data is replicated across availability zones
            for redundancy. No additional configuration is needed.
          </p>
        </div>
      </div>
    </div>
  )
}
