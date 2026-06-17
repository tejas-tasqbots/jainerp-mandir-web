import { useEffect, useState } from 'react'
import { Save, RefreshCw } from 'lucide-react'
import { api } from '../../../lib/api'

export function AccountingRulesTab() {
  const [form, setForm] = useState({ accounting_basis: 'cash', enable_depreciation: false })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = (r.data.data || {}) as Record<string, unknown>
      setForm({
        accounting_basis: (p.accounting_basis as string) || 'cash',
        enable_depreciation: Boolean(p.enable_depreciation),
      })
    }).catch(() => {})
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.patch('/tenants/me', form)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 max-w-2xl">
      {success && <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">Accounting rules saved!</div>}

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Accounting Basis</h3></div>
        <div className="card-body space-y-2">
          {[
            { id: 'cash', label: 'Cash Basis', desc: 'Income & expenses recorded when money actually moves. Simpler; common for temples.' },
            { id: 'accrual', label: 'Accrual Basis', desc: 'Income & expenses recorded when earned/incurred, regardless of payment timing.' },
          ].map(o => (
            <label key={o.id} className={`flex items-start gap-3 border rounded-md p-3 cursor-pointer ${form.accounting_basis === o.id ? 'border-navy-900 ring-1 ring-navy-900' : 'border-slate-200'}`}>
              <input type="radio" name="basis" className="mt-1" checked={form.accounting_basis === o.id}
                onChange={() => setForm(f => ({ ...f, accounting_basis: o.id }))} />
              <div>
                <p className="font-medium text-sm">{o.label}</p>
                <p className="text-xs text-slate-400">{o.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Fixed Asset Depreciation</h3></div>
        <div className="card-body">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="w-4 h-4" checked={form.enable_depreciation}
              onChange={e => setForm(f => ({ ...f, enable_depreciation: e.target.checked }))} />
            Enable depreciation tracking for fixed assets
          </label>
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
        {saving ? 'Saving...' : 'Save Accounting Rules'}
      </button>
    </form>
  )
}
