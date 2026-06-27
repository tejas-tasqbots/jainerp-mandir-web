import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Search, XCircle, Receipt, Ban, Award, Filter, Pencil } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { printDonationReceipt } from '../../lib/printReceipt'
import { print80gCertificate } from '../../lib/print80gCertificate'
import { downloadReport } from '../../lib/downloadReport'
import type { Donation, DonationCategory } from '../../types'

const PAYMENT_MODES = ['cash', 'upi', 'cheque', 'netbanking', 'online']

export function DonationsList() {
  const navigate = useNavigate()
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [voidModal, setVoidModal] = useState<{ id: string; invoiceNo: string } | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)

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
        <h1 className="text-xl font-bold text-navy-900">Donations</h1>
        <div className="flex gap-2">
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
            <Download size={14} /> Export CSV
          </button>
          <button onClick={() => navigate('/donations/add')} className="btn-primary btn-sm">
            <Plus size={14} /> New Donation
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="form-input pl-9"
            placeholder="Search donor, invoice, category..."
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
          <Filter size={14} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </button>
        {activeFilterCount > 0 && (
          <button type="button" onClick={clearFilters} className="text-xs text-slate-400 hover:text-red-500">Clear all</button>
        )}
      </div>

      {showFilters && (
        <div className="card p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label htmlFor="f-category" className="form-label text-xs">Category</label>
            <select id="f-category" className="form-select" value={fCategory} onChange={e => { setFCategory(e.target.value); setPage(1) }}>
              <option value="">All</option>
              {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-mode" className="form-label text-xs">Payment Mode</label>
            <select id="f-mode" className="form-select" value={fMode} onChange={e => { setFMode(e.target.value); setPage(1) }}>
              <option value="">All</option>
              {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-80g" className="form-label text-xs">80G</label>
            <select id="f-80g" className="form-select" value={f80g} onChange={e => { setF80g(e.target.value); setPage(1) }}>
              <option value="">All</option>
              <option value="yes">80G Only</option>
              <option value="no">Non-80G</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-from" className="form-label text-xs">From</label>
            <input id="f-from" type="date" title="From date" className="form-input" value={fFrom} onChange={e => { setFFrom(e.target.value); setPage(1) }} />
          </div>
          <div>
            <label htmlFor="f-to" className="form-label text-xs">To</label>
            <input id="f-to" type="date" title="To date" className="form-input" value={fTo} onChange={e => { setFTo(e.target.value); setPage(1) }} />
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Donor</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Mode</th>
                <th>80G</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : donations.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">No donations found</td></tr>
              ) : donations.map(d => (
                <tr key={d.id}>
                  <td className="font-mono text-xs text-brand-blue">{d.invoice_no}</td>
                  <td>
                    <p className="font-medium">{d.donor_name || '—'}</p>
                    {d.donor_mobile && <p className="text-xs text-slate-400">{d.donor_mobile}</p>}
                    {d.is_anonymous && (
                      <p className="text-xs text-slate-400 italic">
                        {d.anonymous_category === 'dan_peti' ? 'Dan Peti' : 'Anonymous / Gupt Dan'}
                      </p>
                    )}
                  </td>
                  <td className="text-slate-600">{d.category_name || '—'}</td>
                  <td className="font-semibold">₹{fmtPaise(d.amount_paise)}</td>
                  <td><span className={paymentModeBadge(d.payment_mode)}>{d.payment_mode}</span></td>
                  <td>{d.is_80g_eligible ? <span className="badge-green">Yes</span> : <span className="badge-gray">No</span>}</td>
                  <td className="text-slate-500 text-xs">{new Date(d.created_at).toLocaleDateString('en-IN')}</td>
                  <td>{d.is_voided ? <span className="badge-red">Voided</span> : <span className="badge-green">Active</span>}</td>
                  <td>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => openReceipt(d.id)}
                        title="Print Receipt"
                        aria-label="Print Receipt"
                        disabled={receiptLoading === d.id}
                        className="p-1 text-slate-400 hover:text-brand-blue rounded disabled:opacity-40"
                      >
                        <Receipt size={14} className={receiptLoading === d.id ? 'animate-pulse' : ''} />
                      </button>
                      {d.is_80g_eligible && d.donor_id && !d.is_anonymous && (
                        <button
                          type="button"
                          onClick={() => download80g(d.donor_id!)}
                          title="Download 80G Certificate"
                          aria-label="Download 80G Certificate"
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
                          title="Edit (void & reissue)"
                          aria-label="Edit donation"
                          className="p-1 text-slate-400 hover:text-amber-600 rounded"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {!d.is_voided && (
                        <button
                          type="button"
                          onClick={() => setVoidModal({ id: d.id, invoiceNo: d.invoice_no })}
                          title="Void Donation"
                          aria-label="Void Donation"
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
          <span>Showing {((page-1)*20)+1}–{Math.min(page*20, total)} of {total}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p-1)} className="btn-secondary btn-sm">Prev</button>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p+1)} className="btn-secondary btn-sm">Next</button>
          </div>
        </div>
      )}

      {/* Void confirmation modal */}
      {voidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-1">Void Donation</h3>
            <p className="text-sm text-slate-500 mb-4">
              Invoice <span className="font-mono font-semibold text-navy-900">{voidModal.invoiceNo}</span> will be voided. This cannot be undone.
            </p>
            <div className="mb-4">
              <label className="form-label">Reason for voiding *</label>
              <textarea
                className="form-input"
                rows={3}
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                placeholder="Enter reason..."
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setVoidModal(null); setVoidReason('') }} className="btn-secondary">Cancel</button>
              <button
                onClick={confirmVoid}
                disabled={!voidReason.trim() || voiding}
                className="btn-danger"
              >
                {voiding ? 'Voiding...' : 'Void Donation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
