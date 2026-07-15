import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save } from 'lucide-react'
import { api, fmtPaise, parsePaise, currentFY } from '../../lib/api'
import type { Account } from '../../types'

export function ContraEntries() {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entries, setEntries] = useState<{ id: string; from_account_name: string; to_account_name: string; amount_paise: number; narration?: string; created_at: string }[]>([])
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ from_account_id: '', to_account_id: '', amount: '', narration: '' })

  useEffect(() => {
    api.get('/accounts?is_active=true').then(r => setAccounts(r.data.data || []))
    api.get('/contra-entries?limit=20').then(r => setEntries(r.data.data || [])).catch(() => {})
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/contra-entries', {
        entry_date: new Date().toISOString().slice(0, 10),
        from_account_id: form.from_account_id,
        to_account_id: form.to_account_id,
        amount_paise: parsePaise(form.amount),
        narration: form.narration || undefined,
      })
      setForm({ from_account_id: '', to_account_id: '', amount: '', narration: '' })
      setShowForm(false)
      api.get('/contra-entries?limit=20').then(r => setEntries(r.data.data || []))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.contraTitle')}</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm">
          <Plus size={14} /> {t('accounts.newTransfer')}
        </button>
      </div>

      {showForm && (
        <div className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('accounts.recordTransfer')}</h3></div>
          <form onSubmit={submit} className="card-body space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">{t('accounts.fromAccount')}</label>
                <select className="form-select" value={form.from_account_id}
                  onChange={e => setForm(f => ({ ...f, from_account_id: e.target.value }))} required>
                  <option value="">{t('accounts.select')}</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">{t('accounts.toAccount')}</label>
                <select className="form-select" value={form.to_account_id}
                  onChange={e => setForm(f => ({ ...f, to_account_id: e.target.value }))} required>
                  <option value="">{t('accounts.select')}</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">{t('accounts.amount')}</label>
                <input type="number" min="1" step="0.01" className="form-input" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('accounts.narration')}</label>
                <input className="form-input" value={form.narration}
                  onChange={e => setForm(f => ({ ...f, narration: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary btn-sm"><Save size={14} /> {saving ? t('common.saving') : t('accounts.record')}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t('accounts.date')}</th><th>{t('accounts.fromCol')}</th><th>{t('accounts.toCol')}</th><th>{t('common.amount')}</th><th>{t('accounts.narration')}</th></tr></thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-slate-400">{t('accounts.noTransferEntries')}</td></tr>
              ) : entries.map(e => (
                <tr key={e.id}>
                  <td className="text-xs">{new Date(e.created_at).toLocaleDateString('en-IN')}</td>
                  <td>{e.from_account_name}</td>
                  <td>{e.to_account_name}</td>
                  <td className="font-semibold">₹{fmtPaise(e.amount_paise)}</td>
                  <td className="text-slate-500">{e.narration || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
