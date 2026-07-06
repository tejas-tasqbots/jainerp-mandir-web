import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Download, XCircle, Plus, X } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { CitySelect, CountrySelect, StateSelect } from '../../components/GeoSelect'
import { isValidPhone, PhoneInput } from '../../components/PhoneInput'
import type { Donor } from '../../types'

const emptyForm = {
  name: '', mobile: '', email: '', gotra: '', country: 'India', city: '', state: '', address: '', pan: '', is_80g_eligible: true,
}

export function DonorList() {
  const navigate = useNavigate()
  const [donors, setDonors] = useState<Donor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [page, search])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('q', search)
      const { data } = await api.get(`/donors?${params}`)
      setDonors(data.data || [])
      setTotal(data.meta?.total || 0)
    } catch {
      setDonors([])
    } finally {
      setLoading(false)
    }
  }

  function f(k: keyof typeof form, v: string | boolean) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function addDonor(e: React.FormEvent) {
    e.preventDefault()
    if (form.mobile && !isValidPhone(form.mobile)) {
      setError('Enter a valid mobile number')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { data } = await api.post('/donors', {
        name: form.name,
        mobile: form.mobile || undefined,
        email: form.email || undefined,
        gotra: form.gotra || undefined,
        country: form.country || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        address: form.address || undefined,
        pan: form.pan || undefined,
      })
      setShowAdd(false)
      setForm(emptyForm)
      navigate(`/donors/${data.data.id}`)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e.response?.data?.error?.message || 'Failed to add donor')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Donors / Devotees</h1>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => {}}>
            <Download size={14} /> Export
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary btn-sm">
            <Plus size={14} /> Add Donor
          </button>
        </div>
      </div>

      <div className="relative w-72">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder="Search name, mobile, city..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
            <XCircle size={14} />
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile</th>
                <th>City</th>
                <th>PAN</th>
                <th>This FY</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : donors.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">No donors found</td></tr>
              ) : donors.map(d => (
                <tr key={d.id} className="cursor-pointer" onClick={() => navigate(`/donors/${d.id}`)}>
                  <td>
                    <p className="font-medium">{d.name}</p>
                    {d.gotra && <p className="text-xs text-slate-400">Gotra: {d.gotra}</p>}
                  </td>
                  <td>{d.mobile}</td>
                  <td className="text-slate-600">{d.city || '—'}{d.state ? `, ${d.state}` : ''}</td>
                  <td className="font-mono text-xs">{d.pan_masked || '—'}</td>
                  <td className="font-medium text-green-700">
                    {d.cumulative_amount_current_fy_paise ? `₹${fmtPaise(d.cumulative_amount_current_fy_paise)}` : '—'}
                  </td>
                  <td>{d.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}</td>
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

      {/* Add Donor Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-900">Add New Donor</h3>
              <button onClick={() => { setShowAdd(false); setForm(emptyForm); setError('') }} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
            <form onSubmit={addDonor} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="form-label">Full Name *</label>
                  <input className="form-input" value={form.name} onChange={e => f('name', e.target.value)} required />
                </div>
                <div>
                  <label className="form-label">Mobile</label>
                  <PhoneInput value={form.mobile} onChange={v => f('mobile', v)} />
                </div>
                <div>
                  <label className="form-label">Email</label>
                  <input type="email" className="form-input" value={form.email} onChange={e => f('email', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Gotra</label>
                  <input className="form-input" value={form.gotra} onChange={e => f('gotra', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">PAN</label>
                  <input className="form-input uppercase" placeholder="ABCDE1234F" value={form.pan}
                    onChange={e => f('pan', e.target.value.toUpperCase())} maxLength={10} />
                </div>
                <div>
                  <label className="form-label">Country</label>
                  <CountrySelect value={form.country} onChange={c => { f('country', c); f('state', ''); f('city', '') }} />
                </div>
                {(!form.country || form.country === 'India') ? (
                  <>
                    <div>
                      <label className="form-label">State</label>
                      <StateSelect value={form.state} onChange={s => { f('state', s); f('city', '') }} />
                    </div>
                    <div>
                      <label className="form-label">City</label>
                      <CitySelect state={form.state} value={form.city} onChange={c => f('city', c)} />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="form-label">State / Province</label>
                      <input className="form-input" value={form.state} onChange={e => f('state', e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label">City</label>
                      <input className="form-input" value={form.city} onChange={e => f('city', e.target.value)} />
                    </div>
                  </>
                )}
                <div className="col-span-2">
                  <label className="form-label">Address</label>
                  <input className="form-input" value={form.address} onChange={e => f('address', e.target.value)} />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setShowAdd(false); setForm(emptyForm); setError('') }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Adding...' : 'Add Donor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
