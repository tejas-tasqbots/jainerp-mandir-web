import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Search, XCircle, Receipt, Ban } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { printDonationReceipt } from '../../lib/printReceipt'
import type { Donation } from '../../types'

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

  useEffect(() => { load() }, [page, search])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('q', search)
      const { data } = await api.get(`/donations?${params}`)
      setDonations(data.data || [])
      setTotal(data.meta?.total || 0)
    } catch {
      setDonations([])
    } finally {
      setLoading(false)
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
            onClick={() => api.get('/reports/donation-register?export=excel').then(r => window.open(r.data.url)).catch(() => alert('Export not available'))}
            className="btn-secondary btn-sm"
          >
            <Download size={14} /> Export
          </button>
          <button onClick={() => navigate('/donations/add')} className="btn-primary btn-sm">
            <Plus size={14} /> New Donation
          </button>
        </div>
      </div>

      <div className="relative w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="form-input pl-9"
          placeholder="Search donor, invoice..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <XCircle size={14} />
          </button>
        )}
      </div>

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
                        onClick={() => openReceipt(d.id)}
                        title="Print Receipt"
                        disabled={receiptLoading === d.id}
                        className="p-1 text-slate-400 hover:text-brand-blue rounded disabled:opacity-40"
                      >
                        <Receipt size={14} className={receiptLoading === d.id ? 'animate-pulse' : ''} />
                      </button>
                      {!d.is_voided && (
                        <button
                          onClick={() => setVoidModal({ id: d.id, invoiceNo: d.invoice_no })}
                          title="Void Donation"
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
