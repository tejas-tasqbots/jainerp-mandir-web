import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Phone, Mail, FileText, Landmark } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'

interface VendorDetail {
  id: string
  name: string
  contact_person?: string
  mobile?: string
  email?: string
  gstin?: string
  pan_masked?: string
  bank_account?: string
  bank_ifsc?: string
  tds_section?: string
  annual_payment_paise?: number
  notes?: string
  is_active: boolean
  created_at: string
}

interface ExpenseRow {
  id: string
  description: string
  bill_number?: string
  bill_date?: string
  amount_paise: number
  gst_paid_paise?: number
  payment_mode: string
  is_on_credit: boolean
  tds_deducted?: boolean
  tds_amount_paise?: number
  category?: string
  created_at: string
}

interface CreditorRow {
  id: string
  description: string
  original_amount_paise: number
  paid_amount_paise: number
  outstanding_paise: number
  status: string
  due_date?: string
  created_at: string
}

interface Profile {
  vendor: VendorDetail
  totals: { total_billed_paise: number; outstanding_paise: number; expense_count: number; open_payables: number }
  expenses: ExpenseRow[]
  creditors: CreditorRow[]
}

export function VendorProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api.get(`/vendors/${id}/profile`)
      .then(r => setData(r.data.data))
      .catch(() => setError('Could not load vendor profile'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-center py-16 text-slate-400">Loading vendor…</div>
  if (error || !data) return <div className="text-center py-16 text-red-500">{error || 'Not found'}</div>

  const v = data.vendor

  return (
    <div className="space-y-5 max-w-5xl">
      <button type="button" onClick={() => navigate('/masters/vendors')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Vendors
      </button>

      {/* Header card */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-navy-50 flex items-center justify-center flex-shrink-0">
            <Building2 size={26} className="text-navy-900" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-navy-900">{v.name}</h1>
              {v.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}
            </div>
            {v.contact_person && <p className="text-sm text-slate-500 mt-0.5">Contact: {v.contact_person}</p>}
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-slate-600">
              {v.mobile && <span className="flex items-center gap-1"><Phone size={13} className="text-slate-400" /> {v.mobile}</span>}
              {v.email && <span className="flex items-center gap-1"><Mail size={13} className="text-slate-400" /> {v.email}</span>}
              {v.gstin && <span className="flex items-center gap-1"><FileText size={13} className="text-slate-400" /> GSTIN: <span className="font-mono">{v.gstin}</span></span>}
              {v.pan_masked && <span className="flex items-center gap-1">PAN: <span className="font-mono">{v.pan_masked}</span></span>}
              {v.tds_section && <span>TDS: {v.tds_section}</span>}
              {(v.bank_account || v.bank_ifsc) && (
                <span className="flex items-center gap-1"><Landmark size={13} className="text-slate-400" /> {[v.bank_account, v.bank_ifsc].filter(Boolean).join(' / ')}</span>
              )}
            </div>
            {v.notes && <p className="text-xs text-slate-400 mt-2">{v.notes}</p>}
          </div>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-3"><p className="text-xs text-slate-400">Total Billed</p><p className="text-lg font-bold text-navy-900">₹{fmtPaise(data.totals.total_billed_paise)}</p></div>
        <div className="card p-3"><p className="text-xs text-slate-400">Outstanding</p><p className="text-lg font-bold text-red-600">₹{fmtPaise(data.totals.outstanding_paise)}</p></div>
        <div className="card p-3"><p className="text-xs text-slate-400">Bills</p><p className="text-lg font-bold text-navy-900">{data.totals.expense_count}</p></div>
        <div className="card p-3"><p className="text-xs text-slate-400">Open Payables</p><p className="text-lg font-bold text-amber-600">{data.totals.open_payables}</p></div>
      </div>

      {/* Outstanding payables */}
      {data.creditors.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Payables (Udhaar)</h3>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Description</th><th>Original</th><th>Paid</th><th>Outstanding</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {data.creditors.map(c => (
                    <tr key={c.id}>
                      <td className="text-slate-600">{c.description}</td>
                      <td>₹{fmtPaise(c.original_amount_paise)}</td>
                      <td className="text-green-700">₹{fmtPaise(c.paid_amount_paise)}</td>
                      <td className={c.outstanding_paise > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>₹{fmtPaise(c.outstanding_paise)}</td>
                      <td className="text-xs text-slate-400">{c.due_date ? new Date(c.due_date).toLocaleDateString('en-IN') : '—'}</td>
                      <td>
                        {c.status === 'paid' ? <span className="badge-green">Paid</span>
                          : c.status === 'partially_paid' ? <span className="badge-yellow">Partial</span>
                          : <span className="badge-red">Pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Expense history */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Transaction History (Expenses)</h3>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Bill No</th><th>Amount</th><th>TDS</th><th>Mode</th><th>Type</th></tr></thead>
              <tbody>
                {data.expenses.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">No transactions yet</td></tr>
                ) : data.expenses.map(e => (
                  <tr key={e.id}>
                    <td className="text-xs text-slate-500">{new Date(e.bill_date || e.created_at).toLocaleDateString('en-IN')}</td>
                    <td className="font-medium">{e.description}</td>
                    <td className="text-slate-500">{e.category || '—'}</td>
                    <td className="font-mono text-xs text-slate-400">{e.bill_number || '—'}</td>
                    <td className="font-semibold">
                      ₹{fmtPaise(e.amount_paise)}
                      {!!e.gst_paid_paise && <span className="block text-xs text-slate-400 font-normal">+GST ₹{fmtPaise(e.gst_paid_paise)}</span>}
                    </td>
                    <td>{e.tds_deducted ? <span className="badge-blue">₹{fmtPaise(e.tds_amount_paise ?? 0)}</span> : <span className="text-slate-300">—</span>}</td>
                    <td><span className="badge-gray">{e.payment_mode}</span></td>
                    <td>{e.is_on_credit ? <span className="badge-red">Credit</span> : <span className="badge-green">Paid</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
