import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, AlertTriangle, Bell } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import type { Boli } from '../../types'

export function BoliList() {
  const navigate = useNavigate()
  const [bolis, setBolis] = useState<Boli[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [payModal, setPayModal] = useState<{ id: string; name: string; outstanding: number } | null>(null)
  const [payForm, setPayForm] = useState({ amount: '', mode: 'cash' })
  const [paying, setPaying] = useState(false)
  const [waiveModal, setWaiveModal] = useState<{ id: string; name: string } | null>(null)
  const [waiveReason, setWaiveReason] = useState('')
  const [waiving, setWaiving] = useState(false)
  const [intimation, setIntimation] = useState<Record<string, unknown> | null>(null)

  useEffect(() => { load() }, [statusFilter])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const { data } = await api.get(`/bolis?${params}`)
      setBolis(data.data || [])
    } catch {
      setBolis([])
    } finally {
      setLoading(false)
    }
  }

  function statusBadge(s: string) {
    if (s === 'pledged') return <span className="badge-yellow">Pledged</span>
    if (s === 'partially_paid') return <span className="badge-blue">Partial</span>
    if (s === 'paid') return <span className="badge-green">Paid</span>
    if (s === 'waived') return <span className="badge-gray">Waived</span>
    return null
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!payModal) return
    setPaying(true)
    try {
      await api.post(`/bolis/${payModal.id}/payments`, {
        amount_paise: Math.round(parseFloat(payForm.amount) * 100),
        payment_mode: payForm.mode,
      })
      setPayModal(null)
      setPayForm({ amount: '', mode: 'cash' })
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e.response?.data?.error?.message || 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  async function waive(e: React.FormEvent) {
    e.preventDefault()
    if (!waiveModal || !waiveReason.trim()) return
    setWaiving(true)
    try {
      await api.post(`/bolis/${waiveModal.id}/waive`, { reason: waiveReason })
      setWaiveModal(null)
      setWaiveReason('')
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e.response?.data?.error?.message || 'Waive failed')
    } finally {
      setWaiving(false)
    }
  }

  async function fetchIntimation(id: string) {
    try {
      const { data } = await api.get(`/bolis/${id}/intimation`)
      setIntimation(data.data || data)
    } catch {
      alert('Could not fetch intimation details')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Boli Donations</h1>
        <div className="flex gap-2">
          <button
            onClick={() => api.get('/bolis/register').then(r => {
              const rows = r.data.data || []
              alert(`Boli Register: ${rows.length} records. Open console for data.`)
              console.table(rows)
            })}
            className="btn-secondary btn-sm"
          >
            <Download size={14} /> Register
          </button>
          <button onClick={() => navigate('/boli/add')} className="btn-primary btn-sm">
            <Plus size={14} /> New Boli
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {['all', 'pledged', 'partially_paid', 'paid', 'waived'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 text-xs rounded-md font-medium capitalize transition-colors ${statusFilter === s ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {s === 'all' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Devotee</th>
                <th>Type</th>
                <th>Description</th>
                <th>Pledged</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : bolis.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">No boli records found</td></tr>
              ) : bolis.map(b => (
                <tr key={b.id}>
                  <td>
                    <p className="font-medium">{b.devotee_name}</p>
                    {b.devotee_mobile && <p className="text-xs text-slate-400">{b.devotee_mobile}</p>}
                  </td>
                  <td className="capitalize text-slate-600">{b.boli_type}</td>
                  <td className="text-slate-600 max-w-[200px] truncate">{b.description || '—'}</td>
                  <td className="font-semibold">₹{fmtPaise(b.pledged_amount_paise)}</td>
                  <td className="text-green-700">₹{fmtPaise(b.paid_amount_paise)}</td>
                  <td className={b.outstanding_paise > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
                    ₹{fmtPaise(b.outstanding_paise)}
                  </td>
                  <td className="text-xs text-slate-400">
                    {b.due_date ? new Date(b.due_date).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td>{statusBadge(b.status)}</td>
                  <td>
                    <div className="flex gap-1">
                      {(b.status === 'pledged' || b.status === 'partially_paid') && (
                        <>
                          <button
                            onClick={() => setPayModal({ id: b.id, name: b.devotee_name, outstanding: b.outstanding_paise })}
                            className="btn-success btn-sm"
                          >
                            Pay
                          </button>
                          <button
                            onClick={() => setWaiveModal({ id: b.id, name: b.devotee_name })}
                            title="Waive outstanding"
                            className="p-1 text-slate-400 hover:text-yellow-600 rounded"
                          >
                            <AlertTriangle size={14} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => fetchIntimation(b.id)}
                        title="View intimation"
                        className="p-1 text-slate-400 hover:text-brand-blue rounded"
                      >
                        <Bell size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment modal */}
      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-1">Record Payment</h3>
            <p className="text-sm text-slate-500 mb-4">
              Boli by <span className="font-semibold">{payModal.name}</span> — Outstanding: ₹{fmtPaise(payModal.outstanding)}
            </p>
            <form onSubmit={recordPayment} className="space-y-4">
              <div>
                <label className="form-label">Amount (₹) *</label>
                <input type="number" step="0.01" min="0.01" className="form-input" autoFocus
                  value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Payment Mode</label>
                <select className="form-select" value={payForm.mode} onChange={e => setPayForm(f => ({ ...f, mode: e.target.value }))}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="netbanking">Net Banking</option>
                </select>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setPayModal(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={paying} className="btn-success">{paying ? 'Recording...' : 'Record Payment'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Waive modal */}
      {waiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-1">Waive Boli</h3>
            <p className="text-sm text-slate-500 mb-4">
              Waive outstanding amount for <span className="font-semibold">{waiveModal.name}</span>. This cannot be undone.
            </p>
            <form onSubmit={waive} className="space-y-4">
              <div>
                <label className="form-label">Reason *</label>
                <textarea className="form-input" rows={3} value={waiveReason}
                  onChange={e => setWaiveReason(e.target.value)} placeholder="Reason for waiving..." required />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setWaiveModal(null); setWaiveReason('') }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={waiving || !waiveReason.trim()} className="btn-danger">
                  {waiving ? 'Waiving...' : 'Waive'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Intimation modal */}
      {intimation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-900">Boli Intimation</h3>
              <button onClick={() => setIntimation(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <pre className="text-xs text-slate-700 bg-slate-50 rounded-lg p-4 overflow-auto max-h-64 whitespace-pre-wrap">
              {JSON.stringify(intimation, null, 2)}
            </pre>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setIntimation(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
