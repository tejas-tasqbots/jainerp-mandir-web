import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Download, AlertTriangle, Bell, Search, XCircle } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { printBoliIntimation } from '../../lib/printBoliIntimation'
import type { Boli } from '../../types'

export function BoliList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [bolis, setBolis] = useState<Boli[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [meta, setMeta] = useState<{ committed_paise: number; paid_paise: number; outstanding_paise: number } | null>(null)
  const [payModal, setPayModal] = useState<{ id: string; name: string; outstanding: number } | null>(null)
  const [payForm, setPayForm] = useState({ amount: '', mode: 'cash' })
  const [paying, setPaying] = useState(false)
  const [waiveModal, setWaiveModal] = useState<{ id: string; name: string } | null>(null)
  const [waiveReason, setWaiveReason] = useState('')
  const [waiving, setWaiving] = useState(false)
  const [intimating, setIntimating] = useState<string | null>(null)

  useEffect(() => { load() }, [statusFilter, search])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search) params.set('q', search)
      const { data } = await api.get(`/bolis?${params}`)
      setBolis(data.data || [])
      setMeta(data.meta || null)
    } catch {
      setBolis([])
    } finally {
      setLoading(false)
    }
  }

  function statusBadge(s: string) {
    if (s === 'pledged') return <span className="badge-yellow">{t('pledges.statusPledged')}</span>
    if (s === 'partially_paid') return <span className="badge-blue">{t('pledges.statusPartial')}</span>
    if (s === 'paid') return <span className="badge-green">{t('pledges.statusPaid')}</span>
    if (s === 'waived') return <span className="badge-gray">{t('pledges.statusWaived')}</span>
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

  async function openIntimation(id: string) {
    setIntimating(id)
    try {
      await printBoliIntimation(id)
    } catch {
      alert('Could not generate intimation slip')
    } finally {
      setIntimating(null)
    }
  }

  function downloadRegister() {
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    api.get(`/bolis/register?${params}`).then(r => {
      // register returns { fy, rows }
      const rows: Record<string, unknown>[] = r.data.data?.rows || []
      if (!rows.length) { alert('No boli records to export'); return }
      // Build a CSV the user can open in Excel
      const headers = ['Date', 'Donor', 'Mobile', 'Description', 'Event', 'Pledged', 'Paid', 'Outstanding', 'Status']
      const csv = [headers.join(',')].concat(
        rows.map(b => [
          b.boli_date, b.donor_name, b.donor_mobile ?? '', `"${String(b.seva_description ?? '').replace(/"/g, '""')}"`,
          b.event_name ?? '', Number(b.committed_amount_paise) / 100, Number(b.paid_amount_paise) / 100,
          Number(b.outstanding_paise) / 100, b.status,
        ].join(','))
      ).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `boli-register.csv`; a.click()
      URL.revokeObjectURL(url)
    }).catch(() => alert('Could not load boli register'))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('pledges.title')}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={downloadRegister} className="btn-secondary btn-sm">
            <Download size={14} /> {t('pledges.registerCsv')}
          </button>
          <button type="button" onClick={() => navigate('/boli/add')} className="btn-primary btn-sm">
            <Plus size={14} /> {t('pledges.newPledge')}
          </button>
        </div>
      </div>

      {/* Summary */}
      {meta && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-3"><p className="text-xs text-slate-400">{t('pledges.pledged')}</p><p className="text-lg font-bold text-navy-900">₹{fmtPaise(meta.committed_paise)}</p></div>
          <div className="card p-3"><p className="text-xs text-slate-400">{t('pledges.collected')}</p><p className="text-lg font-bold text-green-700">₹{fmtPaise(meta.paid_paise)}</p></div>
          <div className="card p-3"><p className="text-xs text-slate-400">{t('pledges.outstanding')}</p><p className="text-lg font-bold text-red-600">₹{fmtPaise(meta.outstanding_paise)}</p></div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="form-input pl-9" placeholder={t('pledges.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <XCircle size={14} />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {(['all', 'pledged', 'partially_paid', 'paid', 'waived'] as const).map(s => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs rounded-md font-medium capitalize transition-colors ${statusFilter === s ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
              {{
                all: t('pledges.filterAll'),
                pledged: t('pledges.filterPledged'),
                partially_paid: t('pledges.filterPartiallyPaid'),
                paid: t('pledges.filterPaid'),
                waived: t('pledges.filterWaived'),
              }[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('donations.donor')}</th>
                <th>{t('pledges.description')}</th>
                <th>{t('pledges.event')}</th>
                <th>{t('pledges.pledged')}</th>
                <th>{t('pledges.paid')}</th>
                <th>{t('pledges.outstanding')}</th>
                <th>{t('common.date')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">{t('common.loading')}</td></tr>
              ) : bolis.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">{t('pledges.noPledgesFound')}</td></tr>
              ) : bolis.map(b => (
                <tr key={b.id}>
                  <td>
                    <p className="font-medium">{b.is_anonymous ? t('pledges.anonymous') : b.donor_name}</p>
                    {b.donor_mobile && <p className="text-xs text-slate-400">{b.donor_mobile}</p>}
                  </td>
                  <td className="text-slate-600 max-w-[220px] truncate">{b.seva_description || '—'}</td>
                  <td className="text-slate-500 text-xs">{b.event_name || '—'}</td>
                  <td className="font-semibold">₹{fmtPaise(b.committed_amount_paise)}</td>
                  <td className="text-green-700">₹{fmtPaise(b.paid_amount_paise)}</td>
                  <td className={b.outstanding_paise > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
                    ₹{fmtPaise(b.outstanding_paise)}
                  </td>
                  <td className="text-xs text-slate-400">
                    {b.boli_date ? new Date(b.boli_date).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td>{statusBadge(b.status)}</td>
                  <td>
                    <div className="flex gap-1 items-center">
                      {(b.status === 'pledged' || b.status === 'pending' || b.status === 'partially_paid') && (
                        <>
                          <button
                            type="button"
                            onClick={() => setPayModal({ id: b.id, name: b.donor_name, outstanding: b.outstanding_paise })}
                            className="btn-success btn-sm"
                          >
                            {t('pledges.pay')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setWaiveModal({ id: b.id, name: b.donor_name })}
                            title={t('pledges.waiveOutstanding')}
                            aria-label={t('pledges.waiveOutstanding')}
                            className="p-1 text-slate-400 hover:text-yellow-600 rounded"
                          >
                            <AlertTriangle size={14} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => openIntimation(b.id)}
                        title={t('pledges.printIntimation')}
                        aria-label={t('pledges.printIntimation')}
                        disabled={intimating === b.id}
                        className="p-1 text-slate-400 hover:text-brand-blue rounded disabled:opacity-40"
                      >
                        <Bell size={14} className={intimating === b.id ? 'animate-pulse' : ''} />
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
            <h3 className="font-bold text-navy-900 mb-1">{t('pledges.recordPayment')}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {t('pledges.pledgeByOutstanding', { name: payModal.name, amount: fmtPaise(payModal.outstanding) })}
            </p>
            <form onSubmit={recordPayment} className="space-y-4">
              <div>
                <label className="form-label">{t('donations.amountLabel')}</label>
                <input type="number" step="0.01" min="0.01" className="form-input" autoFocus
                  value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('donations.paymentMode')}</label>
                <select className="form-select" value={payForm.mode} onChange={e => setPayForm(f => ({ ...f, mode: e.target.value }))}>
                  <option value="cash">{t('common.cash')}</option>
                  <option value="upi">{t('common.upi')}</option>
                  <option value="cheque">{t('common.cheque')}</option>
                  <option value="netbanking">{t('common.netbanking')}</option>
                </select>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setPayModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={paying} className="btn-success">{paying ? t('pledges.recording') : t('pledges.recordPayment')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Waive modal */}
      {waiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('pledges.waivePledge')}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {t('pledges.waiveWarning', { name: waiveModal.name })}
            </p>
            <form onSubmit={waive} className="space-y-4">
              <div>
                <label className="form-label">{t('common.reason')} *</label>
                <textarea className="form-input" rows={3} value={waiveReason}
                  onChange={e => setWaiveReason(e.target.value)} placeholder={t('pledges.waiveReasonPlaceholder')} required />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setWaiveModal(null); setWaiveReason('') }} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={waiving || !waiveReason.trim()} className="btn-danger">
                  {waiving ? t('pledges.waiving') : t('pledges.waive')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
