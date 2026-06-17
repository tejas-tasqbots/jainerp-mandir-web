import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit2, Save, X } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import type { Donor } from '../../types'

interface LedgerRow {
  id: string
  txn_type: 'donation' | 'boli' | 'seva'
  invoice_no: string | null
  amount_paise: number
  payment_mode: string | null
  detail: string | null
  created_at: string
  voided: boolean
}

interface LedgerTotals { donated_paise: number; receipts: number }

export function DonorProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [donor, setDonor] = useState<Donor | null>(null)
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [totals, setTotals] = useState<LedgerTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', mobile: '', email: '', gotra: '', city: '', state: '', address: '', pan: '' })

  useEffect(() => { if (id) load() }, [id])

  async function load() {
    setLoading(true)
    try {
      const [donorResp, ledgerResp] = await Promise.allSettled([
        api.get(`/donors/${id}`),
        api.get(`/donors/${id}/ledger`),
      ])
      if (donorResp.status === 'fulfilled') {
        const d = donorResp.value.data.data
        setDonor(d)
        setForm({
          name: d.name || '',
          mobile: (d.mobile || '').replace(/^\+91/, ''),
          email: d.email || '',
          gotra: d.gotra || '',
          city: d.city || '',
          state: d.state || '',
          address: d.address_line1 || '',
          pan: d.pan_masked || '',
        })
      }
      if (ledgerResp.status === 'fulfilled') {
        const ld = ledgerResp.value.data.data
        setLedger(ld?.transactions || [])
        setTotals(ld?.totals || null)
      }
    } finally {
      setLoading(false)
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setSaving(true)
    try {
      await api.patch(`/donors/${id}`, {
        name: form.name,
        mobile: form.mobile ? `+91${form.mobile.replace(/^\+91/, '')}` : undefined,
        email: form.email || undefined,
        gotra: form.gotra || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        address_line1: form.address || undefined,
        pan: form.pan || undefined,
      })
      setEditing(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const txnBadge = (type: string) => {
    if (type === 'donation') return 'badge-green'
    if (type === 'seva') return 'badge-blue'
    return 'badge-gray'
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-cta border-t-transparent rounded-full animate-spin" /></div>
  if (!donor) return <div className="text-center py-20 text-slate-400">Donor not found</div>

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/donors')} className="btn-icon"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold text-navy-900">{donor.name}</h1>
        {donor.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}
        <div className="ml-auto">
          {editing ? (
            <button onClick={() => setEditing(false)} className="btn-secondary btn-sm"><X size={14} /> Cancel</button>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-secondary btn-sm"><Edit2 size={14} /> Edit</button>
          )}
        </div>
      </div>

      {editing ? (
        <form onSubmit={saveEdit} className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">Edit Donor</h3></div>
          <div className="card-body space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="form-label">Full Name *</label>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Mobile</label>
                <div className="flex">
                  <span className="flex items-center px-3 bg-slate-50 border border-slate-300 rounded-l-md text-sm text-slate-500">+91</span>
                  <input type="tel" className="form-input rounded-l-none flex-1" value={form.mobile}
                    onChange={e => setForm(f => ({ ...f, mobile: e.target.value.replace(/\D/g, '') }))} maxLength={10} />
                </div>
              </div>
              <div>
                <label className="form-label">Email</label>
                <input type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Gotra</label>
                <input className="form-input" value={form.gotra} onChange={e => setForm(f => ({ ...f, gotra: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">PAN</label>
                <input className="form-input uppercase" value={form.pan} onChange={e => setForm(f => ({ ...f, pan: e.target.value.toUpperCase() }))} maxLength={10} />
              </div>
              <div>
                <label className="form-label">City</label>
                <input className="form-input" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">State</label>
                <input className="form-input" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="form-label">Address</label>
                <input className="form-input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary">
                <Save size={14} /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm">Profile</h3></div>
            <div className="card-body space-y-3">
              {[
                ['Mobile', donor.mobile || '—'],
                ['Email', donor.email || '—'],
                ['PAN', donor.pan_masked || '—'],
                ['Gotra', donor.gotra || '—'],
                ['City', donor.city ? `${donor.city}${donor.state ? `, ${donor.state}` : ''}` : '—'],
                ['Pincode', donor.pincode || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm">Giving Summary</h3></div>
            <div className="card-body space-y-3">
              <div className="text-center">
                <p className="text-3xl font-bold text-green-700">
                  ₹{fmtPaise(totals?.donated_paise ?? donor.cumulative_amount_current_fy_paise ?? 0)}
                </p>
                <p className="text-sm text-slate-400 mt-1">Total donated (donations only)</p>
              </div>
              {totals && (
                <div className="text-center text-sm text-slate-500">
                  {totals.receipts} receipt{totals.receipts !== 1 ? 's' : ''} issued
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900">Transaction History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Type</th><th>Invoice</th><th>Details</th><th>Amount</th><th>Mode</th><th>Date</th></tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">No transactions</td></tr>
              ) : ledger.map(tx => (
                <tr key={tx.id} className={tx.voided ? 'opacity-40 line-through' : ''}>
                  <td><span className={`badge ${txnBadge(tx.txn_type)}`}>{tx.txn_type}</span></td>
                  <td className="font-mono text-xs text-brand-blue">{tx.invoice_no || '—'}</td>
                  <td>{tx.detail || '—'}</td>
                  <td className="font-semibold">₹{fmtPaise(tx.amount_paise)}</td>
                  <td>{tx.payment_mode ? <span className="badge-gray">{tx.payment_mode}</span> : '—'}</td>
                  <td className="text-xs text-slate-400">{new Date(tx.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
