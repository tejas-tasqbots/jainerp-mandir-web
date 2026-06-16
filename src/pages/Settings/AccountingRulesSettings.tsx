import { useEffect, useState } from 'react'
import { Save, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'

export function AccountingRulesSettings() {
  const [form, setForm] = useState({ accounting_basis: 'cash', enable_depreciation: false })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = r.data.data || {}
      setForm({
        accounting_basis: p.accounting_basis || 'cash',
        enable_depreciation: p.enable_depreciation || false,
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
    <form onSubmit={save} className="max-w-2xl space-y-5">
      <h1 className="text-xl font-bold text-navy-900">Accounting Rules</h1>
      <p className="text-sm text-slate-500">These settings control how income and expenses are recognised in your reports and financial statements.</p>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">Settings saved!</div>
      )}

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Accounting Basis</h3></div>
        <div className="card-body space-y-3">
          <p className="text-xs text-slate-500">Controls how Boli donations and credit expenses appear in Trial Balance, I&E and Balance Sheet.</p>
          {[
            { value: 'cash', label: 'Cash Basis', desc: 'Income and expenses recorded only when cash changes hands. Boli income counted only when actually collected. Simpler and more conservative.' },
            { value: 'accrual', label: 'Accrual Basis', badge: 'Recommended by CA', desc: 'Income recognised when earned (Boli commitment), expenses when incurred (credit expenses). Boli Receivable appears as an asset in Balance Sheet. More accurate for large temples.' },
          ].map(opt => (
            <label key={opt.value}
              className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                form.accounting_basis === opt.value ? 'border-navy-900 bg-navy-50' : 'border-slate-200 hover:border-slate-300'
              }`}>
              <input type="radio" name="accounting_basis" value={opt.value}
                checked={form.accounting_basis === opt.value}
                onChange={() => setForm(f => ({ ...f, accounting_basis: opt.value }))}
                className="mt-0.5 accent-navy-900" />
              <div>
                <p className="font-medium text-sm">
                  {opt.label}
                  {opt.badge && <span className="ml-2 text-xs text-slate-400">({opt.badge})</span>}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Fixed Asset Depreciation</h3></div>
        <div className="card-body space-y-3">
          <p className="text-xs text-slate-500">
            Enable depreciation to reduce the book value of fixed assets (furniture, equipment, ACs, computers) over time.
            Depreciation appears as an expense in I&E and reduces net block in Balance Sheet.
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-navy-900"
              checked={form.enable_depreciation}
              onChange={e => setForm(f => ({ ...f, enable_depreciation: e.target.checked }))} />
            <div>
              <p className="font-medium text-sm">Enable Depreciation Calculations</p>
              <p className="text-xs text-slate-400">When enabled, depreciation is recorded against fixed assets in your books.</p>
            </div>
          </label>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </form>
  )
}
