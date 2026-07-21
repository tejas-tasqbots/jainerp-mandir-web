import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, X, CheckCircle2, AlertTriangle, Copy } from 'lucide-react'
import { api } from '../../lib/api'
import { useToast } from '../../components/kit/Toast'

interface ResultRow {
  row: number
  name: string
  mobile: string | null
  status: 'new' | 'duplicate' | 'error'
  message?: string
}
interface ImportResult {
  dry_run: boolean
  summary: { total: number; new: number; duplicates: number; errors: number }
  rows: ResultRow[]
}

const HEADERS = ['name', 'mobile', 'email', 'gotra', 'city', 'state', 'pincode', 'address', 'pan']

/**
 * Donor import wizard (plan §06): paste/upload CSV → dry-run validation with a
 * per-row preview → commit. Nothing is written until the operator confirms.
 */
export function DonorImportModal({ onClose }: { onClose: (imported: boolean) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [committed, setCommitted] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  function parseCsv(src: string): Record<string, string>[] {
    const lines = src.trim().split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return []
    const split = (line: string) => line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const headers = split(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
    return lines.slice(1).map(l => {
      const vals = split(l)
      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
      return row
    })
  }

  async function send(dryRun: boolean) {
    const rows = parseCsv(text)
    if (!rows.length) { setError(t('donors.importNeedsRows')); return }
    setBusy(true); setError('')
    try {
      const { data } = await api.post('/donors/bulk-import', { rows, dry_run: dryRun })
      if (dryRun) setPreview(data.data)
      else {
        setCommitted(data.data)
        toast.success(t('donors.importDone', { count: data.data.summary.new }))
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || t('donors.importFailed'))
    } finally {
      setBusy(false)
    }
  }

  const result = committed ?? preview
  const badge = (s: ResultRow['status']) =>
    s === 'new' ? 'badge-green' : s === 'duplicate' ? 'badge-yellow' : 'badge-red'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-navy-900">{t('donors.importTitle')}</h3>
          <button onClick={() => onClose(!!committed)} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!committed && (
            <>
              <div className="flex items-start gap-2 text-sm text-slate-500">
                <p className="flex-1">
                  {t('donors.importHelp')}{' '}
                  <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{HEADERS.join(', ')}</code>
                </p>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard?.writeText(HEADERS.join(',')); toast.success(t('donors.headerCopied')) }}
                  className="btn-secondary btn-sm flex-shrink-0"
                >
                  <Copy size={13} /> {t('donors.copyHeader')}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <label className="btn-secondary btn-sm cursor-pointer">
                  <Upload size={14} /> {t('donors.uploadCsv')}
                  <input type="file" accept=".csv,text/csv" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]; if (!f) return
                      const r = new FileReader()
                      r.onload = () => { setText(String(r.result ?? '')); setPreview(null) }
                      r.readAsText(f)
                    }} />
                </label>
                <span className="text-xs text-slate-400">{t('donors.orPaste')}</span>
              </div>

              <textarea
                className="form-input font-mono text-xs" rows={7}
                placeholder={'name,mobile,city,pan\nRakesh Jain,9876543210,Pune,ABCDE1234F'}
                value={text}
                onChange={e => { setText(e.target.value); setPreview(null) }}
              />
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  [t('donors.importTotal'), result.summary.total, 'text-navy-900'],
                  [t('donors.importNew'), result.summary.new, 'text-green-700'],
                  [t('donors.importDuplicates'), result.summary.duplicates, 'text-amber-600'],
                  [t('donors.importErrors'), result.summary.errors, 'text-red-600'],
                ].map(([label, val, cls]) => (
                  <div key={String(label)} className="card py-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
                    <p className={`text-lg font-bold ${cls}`}>{val}</p>
                  </div>
                ))}
              </div>

              <div className="border border-slate-200 rounded-lg max-h-64 overflow-y-auto">
                <table className="data-table">
                  <thead><tr><th>#</th><th>{t('donors.fullName')}</th><th>{t('donors.mobile')}</th><th>{t('common.status')}</th></tr></thead>
                  <tbody>
                    {result.rows.map(r => (
                      <tr key={r.row}>
                        <td className="text-xs text-slate-400">{r.row}</td>
                        <td>{r.name || '—'}</td>
                        <td className="font-mono text-xs">{r.mobile || '—'}</td>
                        <td>
                          <span className={badge(r.status)}>{t(`donors.importStatus_${r.status}`)}</span>
                          {r.message && <span className="block text-[11px] text-slate-400 mt-0.5">{r.message}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!committed && result.summary.new === 0 && (
                <p className="text-sm text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {t('donors.importNothingToCommit')}
                </p>
              )}
              {committed && (
                <p className="text-sm text-green-700 flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> {t('donors.importCommitted', { count: committed.summary.new })}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={() => onClose(!!committed)} className="btn-secondary">
            {committed ? t('common.close') : t('common.cancel')}
          </button>
          {!committed && !preview && (
            <button onClick={() => send(true)} disabled={busy || !text.trim()} className="btn-primary">
              {busy ? t('donors.importValidating') : t('donors.importValidate')}
            </button>
          )}
          {!committed && preview && (
            <button onClick={() => send(false)} disabled={busy || preview.summary.new === 0} className="btn-primary">
              {busy ? t('donors.importing') : t('donors.importCommit', { count: preview.summary.new })}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
