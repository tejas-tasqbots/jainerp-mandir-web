import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Download, Search, XCircle, Receipt, Ban, Award, Filter, Pencil, FileDown } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { printDonationReceipt, downloadReceiptPdf } from '../../lib/printReceipt'
import { print80gCertificate } from '../../lib/print80gCertificate'
import { downloadReport } from '../../lib/downloadReport'
import type { Donation, DonationCategory } from '../../types'

const PAYMENT_MODES = ['cash', 'upi', 'cheque', 'netbanking', 'online']

export function DonationsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [voidModal, setVoidModal] = useState<{ id: string; invoiceNo: string } | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // Filters
  const [showFilters, setShowFilters] = useState(false)
  const [categories, setCategories] = useState<DonationCategory[]>([])
  const [fCategory, setFCategory] = useState('')
  const [fMode, setFMode] = useState('')
  const [f80g, setF80g] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')

  useEffect(() => {
    api.get('/donation-categories', { params: { is_active: 'true' } })
      .then(r => setCategories(r.data.data || [])).catch(() => {})
  }, [])

  useEffect(() => { load() }, [page, search, fCategory, fMode, f80g, fFrom, fTo])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('q', search)
      if (fCategory) params.set('category', fCategory)
      if (fMode) params.set('payment_mode', fMode)
      if (fFrom) params.set('from', fFrom)
      if (fTo) params.set('to', fTo)
      const { data } = await api.get(`/donations?${params}`)
      let rows: Donation[] = data.data || []
      // 80G filter is client-side (API has no flag for it yet)
      if (f80g === 'yes') rows = rows.filter(d => d.is_80g_eligible)
      else if (f80g === 'no') rows = rows.filter(d => !d.is_80g_eligible)
      setDonations(rows)
      setTotal(data.meta?.total || 0)
    } catch {
      setDonations([])
    } finally {
      setLoading(false)
    }
  }

  function clearFilters() {
    setFCategory(''); setFMode(''); setF80g(''); setFFrom(''); setFTo(''); setPage(1)
  }
  const activeFilterCount = [fCategory, fMode, f80g, fFrom, fTo].filter(Boolean).length

  const [certLoading, setCertLoading] = useState<string | null>(null)
  async function download80g(donorId: string) {
    setCertLoading(donorId)
    try {
      await print80gCertificate(donorId)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      alert(err.response?.data?.error?.message || 'No 80G-eligible donations for this donor this year')
    } finally {
      setCertLoading(null)
    }
  }

  function paymentModeBadge(mode: string) {
    const map: Record<string, string> = {
      cash: 'badge-green', upi: 'badge-blue',
      cheque: 'badge-yellow', netbanking: 'badge-blue', online: 'badge-blue',
    }
    return map[mode] || 'badge-gray'
  }

  const [receiptLoading, setReceiptLoading] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState<string | null>(null)

  async function openReceipt(id: string) {
    setReceiptLoading(id)
    try {
      await printDonationReceipt(id)
    } catch {
      alert('Could not load receipt. Please try again.')
    } finally {
      setReceiptLoading(null)
    }
  }

  async function savePdf(id: string) {
    setPdfLoading(id)
    try {
      await downloadReceiptPdf(id)
    } catch {
      alert('Could not generate the PDF. Please try again.')
    } finally {
      setPdfLoading(null)
    }
  }

  async function confirmVoid() {
    if (!voidModal || !voidReason.trim()) return
    setVoiding(true)
    try {
      await api.patch(`/donations/${voidModal.id}/void`, { reason: voidReason })
      setVoidModal(null)
      setVoidReason('')
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      alert(err.response?.data?.error?.message || 'Failed to void donation')
    } finally {
      setVoiding(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('donations.title')}</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const p: Record<string, string> = {}
              if (fFrom) p.from = fFrom
              if (fTo) p.to = fTo
              if (fCategory) p.category = fCategory
              if (fMode) p.payment_mode = fMode
              downloadReport('donation-register', p, 'pdf')
            }}
            className="btn-secondary btn-sm"
          >
            <FileDown size={14} /> {t('donations.exportPdf')}
          </button>
          <button
            type="button"
            onClick={() => {
              const p: Record<string, string> = {}
              if (fFrom) p.from = fFrom
              if (fTo) p.to = fTo
              if (fCategory) p.category = fCategory
              if (fMode) p.payment_mode = fMode
              downloadReport('donation-register', p)
            }}
            className="btn-secondary btn-sm"
          >
            <Download size={14} /> {t('donations.exportCsv')}
          </button>
          <button onClick={() => setImportOpen(true)} className="btn-secondary btn-sm">
            <FileDown size={14} /> {t('donations.importOldRegister')}
          </button>
          <button onClick={() => navigate('/donations/add')} className="btn-primary btn-sm">
            <Plus size={14} /> {t('donations.newDonation')}
          </button>
        </div>
      </div>

      {importOpen && <BulkImportModal onClose={ok => { setImportOpen(false); if (ok) load() }} />}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="form-input pl-9"
            placeholder={t('donations.searchPlaceholder')}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
          {search && (
            <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <XCircle size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowFilters(s => !s)}
          className={`btn-secondary btn-sm ${activeFilterCount ? 'border-brand-blue text-brand-blue' : ''}`}
        >
          <Filter size={14} /> {t('common.filters')}{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </button>
        {activeFilterCount > 0 && (
          <button type="button" onClick={clearFilters} className="text-xs text-slate-400 hover:text-red-500">{t('common.clearAll')}</button>
        )}
      </div>

      {showFilters && (
        <div className="card p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label htmlFor="f-category" className="form-label text-xs">{t('donations.category')}</label>
            <select id="f-category" className="form-select" value={fCategory} onChange={e => { setFCategory(e.target.value); setPage(1) }}>
              <option value="">{t('common.all')}</option>
              {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-mode" className="form-label text-xs">{t('donations.paymentMode')}</label>
            <select id="f-mode" className="form-select" value={fMode} onChange={e => { setFMode(e.target.value); setPage(1) }}>
              <option value="">{t('common.all')}</option>
              {PAYMENT_MODES.map(m => <option key={m} value={m}>{t(`common.${m}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-80g" className="form-label text-xs">{t('donations.eightyG')}</label>
            <select id="f-80g" className="form-select" value={f80g} onChange={e => { setF80g(e.target.value); setPage(1) }}>
              <option value="">{t('common.all')}</option>
              <option value="yes">{t('donations.eightyGOnly')}</option>
              <option value="no">{t('donations.nonEightyG')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-from" className="form-label text-xs">{t('donations.from')}</label>
            <input id="f-from" type="date" title="From date" className="form-input" value={fFrom} onChange={e => { setFFrom(e.target.value); setPage(1) }} />
          </div>
          <div>
            <label htmlFor="f-to" className="form-label text-xs">{t('donations.to')}</label>
            <input id="f-to" type="date" title="To date" className="form-input" value={fTo} onChange={e => { setFTo(e.target.value); setPage(1) }} />
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('donations.invoiceNo')}</th>
                <th>{t('donations.donor')}</th>
                <th>{t('donations.category')}</th>
                <th>{t('common.amount')}</th>
                <th>{t('donations.mode')}</th>
                <th>{t('donations.eightyG')}</th>
                <th>{t('common.date')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">{t('common.loading')}</td></tr>
              ) : donations.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">{t('donations.noDonationsFound')}</td></tr>
              ) : donations.map(d => (
                <tr key={d.id}>
                  <td className="font-mono text-xs text-brand-blue">{d.invoice_no}</td>
                  <td>
                    <p className="font-medium">{d.donor_name || '—'}</p>
                    {d.donor_mobile && <p className="text-xs text-slate-400">{d.donor_mobile}</p>}
                    {d.is_anonymous && (
                      <p className="text-xs text-slate-400 italic">
                        {d.anonymous_category === 'dan_peti' ? t('donations.danPeti') : t('donations.anonymousGuptDan')}
                      </p>
                    )}
                  </td>
                  <td className="text-slate-600">{d.category_name || '—'}</td>
                  <td className="font-semibold">₹{fmtPaise(d.amount_paise)}</td>
                  <td><span className={paymentModeBadge(d.payment_mode)}>{d.payment_mode}</span></td>
                  <td>{d.is_80g_eligible ? <span className="badge-green">{t('common.yes')}</span> : <span className="badge-gray">{t('common.no')}</span>}</td>
                  <td className="text-slate-500 text-xs">{new Date(d.created_at).toLocaleDateString('en-IN')}</td>
                  <td>{d.is_voided ? <span className="badge-red">{t('donations.voided')}</span> : <span className="badge-green">{t('common.active')}</span>}</td>
                  <td>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => openReceipt(d.id)}
                        title={t('donations.printReceipt')}
                        aria-label={t('donations.printReceipt')}
                        disabled={receiptLoading === d.id}
                        className="p-1 text-slate-400 hover:text-brand-blue rounded disabled:opacity-40"
                      >
                        <Receipt size={14} className={receiptLoading === d.id ? 'animate-pulse' : ''} />
                      </button>
                      <button
                        type="button"
                        onClick={() => savePdf(d.id)}
                        title={t('donations.downloadPdf')}
                        aria-label={t('donations.downloadPdf')}
                        disabled={pdfLoading === d.id}
                        className="p-1 text-slate-400 hover:text-brand-blue rounded disabled:opacity-40"
                      >
                        <FileDown size={14} className={pdfLoading === d.id ? 'animate-pulse' : ''} />
                      </button>
                      {d.is_80g_eligible && d.donor_id && !d.is_anonymous && (
                        <button
                          type="button"
                          onClick={() => download80g(d.donor_id!)}
                          title={t('donations.download80gCertificate')}
                          aria-label={t('donations.download80gCertificate')}
                          disabled={certLoading === d.donor_id}
                          className="p-1 text-slate-400 hover:text-green-600 rounded disabled:opacity-40"
                        >
                          <Award size={14} className={certLoading === d.donor_id ? 'animate-pulse' : ''} />
                        </button>
                      )}
                      {!d.is_voided && (
                        <button
                          type="button"
                          onClick={() => navigate(`/donations/${d.id}/edit`)}
                          title={t('donations.editVoidReissue')}
                          aria-label={t('donations.editVoidReissue')}
                          className="p-1 text-slate-400 hover:text-amber-600 rounded"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {!d.is_voided && (
                        <button
                          type="button"
                          onClick={() => setVoidModal({ id: d.id, invoiceNo: d.invoice_no })}
                          title={t('donations.voidDonation')}
                          aria-label={t('donations.voidDonation')}
                          className="p-1 text-slate-400 hover:text-brand-red rounded"
                        >
                          <Ban size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {total > 20 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{t('donations.showing', { from: ((page-1)*20)+1, to: Math.min(page*20, total), total })}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p-1)} className="btn-secondary btn-sm">{t('common.prev')}</button>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p+1)} className="btn-secondary btn-sm">{t('common.next')}</button>
          </div>
        </div>
      )}

      {/* Void confirmation modal */}
      {voidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('donations.voidDonation')}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {t('donations.voidModalWarning', { invoiceNo: voidModal.invoiceNo })}
            </p>
            <div className="mb-4">
              <label className="form-label">{t('donations.reasonForVoiding')}</label>
              <textarea
                className="form-input"
                rows={3}
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                placeholder={t('donations.enterReason')}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setVoidModal(null); setVoidReason('') }} className="btn-secondary">{t('common.cancel')}</button>
              <button
                onClick={confirmVoid}
                disabled={!voidReason.trim() || voiding}
                className="btn-danger"
              >
                {voiding ? t('donations.voiding') : t('donations.voidDonation')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Import an old donation register (doc §M4 bulk import). Accepts CSV pasted or
 * chosen as a file with the header:
 *   date,donor_name,mobile,category,amount_rupees,payment_mode,is_80g,pan,remarks
 * Rows are parsed client-side and posted to POST /donations/bulk-import.
 */
function BulkImportModal({ onClose }: { onClose: (imported: boolean) => void }) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ total: number; imported: number; failed: number; errors: { row: number; message: string }[] } | null>(null)
  const [err, setErr] = useState('')

  function parseCsv(src: string): Record<string, string>[] {
    const lines = src.trim().split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return []
    const parseLine = (line: string): string[] => {
      const out: string[] = []
      let cur = ''
      let quoted = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
          else if (ch === '"') quoted = false
          else cur += ch
        } else if (ch === '"') quoted = true
        else if (ch === ',') { out.push(cur); cur = '' }
        else cur += ch
      }
      out.push(cur)
      return out
    }
    const headers = parseLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    return lines.slice(1).map(l => {
      const vals = parseLine(l)
      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim() })
      return row
    })
  }

  async function run() {
    setErr(''); setResult(null)
    const parsed = parseCsv(text)
    if (!parsed.length) { setErr('Paste CSV data with a header row first.'); return }
    const rows = parsed.map(r => ({
      donor_name: r.donor_name || r.donor || r.name,
      mobile: r.mobile || undefined,
      category: r.category || undefined,
      amount_rupees: r.amount_rupees || r.amount || undefined,
      payment_mode: r.payment_mode || r.mode || 'cash',
      date: r.date || undefined,
      is_80g: ['yes', 'true', '1', 'y'].includes((r.is_80g || '').toLowerCase()),
      pan: r.pan || undefined,
      remarks: r.remarks || undefined,
    }))
    setBusy(true)
    try {
      const { data } = await api.post('/donations/bulk-import', { rows })
      setResult(data.data)
    } catch (e: unknown) {
      const ex = e as { response?: { data?: { error?: { message?: string } } } }
      setErr(ex.response?.data?.error?.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  function onFile(f: File | undefined) {
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(f)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-navy-900">{t('donations.importTitle')}</h3>
          <button onClick={() => onClose(!!result && result.imported > 0)} className="text-slate-400 hover:text-slate-600"><XCircle size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-500">
            Upload or paste a CSV with the columns
            <code className="mx-1 text-xs bg-slate-100 px-1 py-0.5 rounded">date, donor_name, mobile, category, amount_rupees, payment_mode, is_80g, pan, remarks</code>
            (header row required — save your Excel register as CSV). Each row becomes a receipted donation. Max 2000 rows per import.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={e => onFile(e.target.files?.[0])} className="text-sm" />
          <textarea
            className="form-input font-mono text-xs"
            rows={8}
            placeholder={'date,donor_name,mobile,category,amount_rupees,payment_mode,is_80g\n2024-04-12,Rakesh Jain,9876543210,General,5100,cash,no'}
            value={text}
            onChange={e => setText(e.target.value)}
          />
          {err && <p className="text-sm text-red-600">{err}</p>}
          {result && (
            <div className={`rounded-md px-4 py-3 text-sm ${result.failed ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-green-50 border border-green-200 text-green-700'}`}>
              <p className="font-medium">{result.imported} of {result.total} rows imported{result.failed ? `, ${result.failed} failed` : ''}.</p>
              {result.errors?.slice(0, 8).map(e2 => (
                <p key={e2.row} className="text-xs mt-1">Row {e2.row}: {e2.message}</p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={() => onClose(!!result && result.imported > 0)} className="btn-secondary">{t('common.close')}</button>
            <button onClick={run} disabled={busy || !text.trim()} className="btn-primary">
              {busy ? t('donations.importing') : t('donations.importRows')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
