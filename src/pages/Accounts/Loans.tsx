import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import type { Loan } from '../../types'

export function Loans() {
  const { t } = useTranslation()
  const [loans, setLoans] = useState<Loan[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    type: 'taken', party_name: '', principal: '',
    interest_rate: '0', start_date: new Date().toISOString().slice(0, 10), end_date: '',
  })

  useEffect(() => {
    api.get('/loans').then(r => setLoans(r.data.data || [])).finally(() => setLoading(false))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/loans', {
        type: form.type,
        party_name: form.party_name,
        principal_paise: parsePaise(form.principal),
        interest_rate: parseFloat(form.interest_rate),
        start_date: form.start_date,
        end_date: form.end_date || undefined,
      })
      setShowForm(false)
      api.get('/loans').then(r => setLoans(r.data.data || []))
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.loansTitle')}</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm"><Plus size={14} /> {t('accounts.addLoan')}</button>
      </div>

      {showForm && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('accounts.recordLoan')}</h3></div>
          <form onSubmit={submit} className="card-body space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="form-label">{t('accounts.type')}</label>
                <select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="taken">{t('accounts.loanTaken')}</option><option value="given">{t('accounts.loanGiven')}</option>
                </select>
              </div>
              <div><label className="form-label">{t('accounts.partyName')}</label><input className="form-input" value={form.party_name} onChange={e => setForm(f => ({ ...f, party_name: e.target.value }))} required /></div>
              <div><label className="form-label">{t('accounts.principal')}</label><input type="number" className="form-input" value={form.principal} onChange={e => setForm(f => ({ ...f, principal: e.target.value }))} required /></div>
              <div><label className="form-label">{t('accounts.interestRate')}</label><input type="number" step="0.01" className="form-input" value={form.interest_rate} onChange={e => setForm(f => ({ ...f, interest_rate: e.target.value }))} /></div>
              <div><label className="form-label">{t('accounts.startDate')}</label><input type="date" className="form-input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
              <div><label className="form-label">{t('accounts.endDate')}</label><input type="date" className="form-input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary btn-sm"><Save size={14} /> {saving ? t('common.saving') : t('common.save')}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t('accounts.type')}</th><th>{t('accounts.party')}</th><th>{t('accounts.principal')}</th><th>{t('accounts.interest')}</th><th>{t('accounts.repaid')}</th><th>{t('accounts.outstanding')}</th><th>{t('accounts.start')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">{t('common.loading')}</td></tr>
                : loans.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">{t('accounts.noLoans')}</td></tr>
                : loans.map(l => (
                  <tr key={l.id}>
                    <td><span className={l.type === 'taken' ? 'badge-red' : 'badge-green'}>{l.type === 'taken' ? t('accounts.typeTaken') : t('accounts.typeGiven')}</span></td>
                    <td className="font-medium">{l.party_name}</td>
                    <td>₹{fmtPaise(l.principal_paise)}</td>
                    <td>{l.interest_rate}%</td>
                    <td className="text-green-700">₹{fmtPaise(l.repaid_paise)}</td>
                    <td className="font-semibold">{l.principal_paise - l.repaid_paise > 0 ? `₹${fmtPaise(l.principal_paise - l.repaid_paise)}` : '—'}</td>
                    <td className="text-xs">{new Date(l.start_date).toLocaleDateString('en-IN')}</td>
                    <td>{l.status === 'active' ? <span className="badge-blue">{t('accounts.active')}</span> : <span className="badge-gray">{t('accounts.closed')}</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
