import { useEffect, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Save, RefreshCw, Lock, Unlock } from 'lucide-react'
import { api, currentFY } from '../../../lib/api'
import { FySelect } from '../../../components/FySelect'
import { useConfirm } from '../../../components/ConfirmDialog'
import { useToast } from '../../../components/kit/Toast'

export function AccountingRulesTab() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const [form, setForm] = useState({ accounting_basis: 'cash', enable_depreciation: false })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [lockedFy, setLockedFy] = useState<string | null>(null)
  const [closeFy, setCloseFy] = useState(currentFY())
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = (r.data.data || {}) as Record<string, unknown>
      setForm({
        accounting_basis: (p.accounting_basis as string) || 'cash',
        enable_depreciation: Boolean(p.enable_depreciation),
      })
      setLockedFy((p.locked_fy as string) || null)
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

  async function closeBooks() {
    if (!(await confirm({
      title: t('settings.accounting.closeConfirmTitle'),
      message: t('settings.accounting.closeConfirmMessage', { fy: closeFy }),
      confirmLabel: t('settings.accounting.closeButton'),
      danger: true,
    }))) return
    setClosing(true)
    try {
      await api.patch('/tenants/me', { locked_fy: closeFy })
      setLockedFy(closeFy)
      toast.success(t('settings.accounting.closeSuccess', { fy: closeFy }))
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('settings.accounting.closeFailed'))
    } finally {
      setClosing(false)
    }
  }

  async function reopenBooks() {
    if (!(await confirm({
      title: t('settings.accounting.reopenConfirmTitle'),
      message: t('settings.accounting.reopenConfirmMessage'),
      confirmLabel: t('settings.accounting.reopenButton'),
    }))) return
    setClosing(true)
    try {
      await api.patch('/tenants/me', { locked_fy: null })
      setLockedFy(null)
      toast.success(t('settings.accounting.reopenSuccess'))
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('settings.accounting.closeFailed'))
    } finally {
      setClosing(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 max-w-2xl">
      {success && <div className="bg-green-50 border border-green-200 rounded-md px-4 py-2 text-sm text-green-700">{t('settings.accounting.saved')}</div>}

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.accounting.basisHeading')}</h3></div>
        <div className="card-body space-y-2">
          {[
            { id: 'cash', label: t('settings.accounting.cashBasis'), desc: t('settings.accounting.cashBasisDesc') },
            { id: 'accrual', label: t('settings.accounting.accrualBasis'), desc: t('settings.accounting.accrualBasisDesc') },
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
          <p className="text-xs text-slate-400 pt-1">
            <Trans i18nKey="settings.accounting.basisHelp" components={{ bold: <strong />, bold2: <strong /> }} />
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.accounting.depreciationHeading')}</h3></div>
        <div className="card-body">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="w-4 h-4" checked={form.enable_depreciation}
              onChange={e => setForm(f => ({ ...f, enable_depreciation: e.target.checked }))} />
            {t('settings.accounting.enableDepreciation')}
          </label>
          <p className="text-xs text-slate-400 mt-2">
            {t('settings.accounting.depreciationHelp')}
          </p>
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
        {saving ? t('settings.saving') : t('settings.accounting.saveButton')}
      </button>

      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">{t('settings.accounting.closeBooksHeading')}</h3></div>
        <div className="card-body space-y-3">
          {lockedFy ? (
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-md px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-amber-800">
                <Lock size={15} />
                {t('settings.accounting.lockedThrough', { fy: lockedFy })}
              </div>
              <button type="button" onClick={reopenBooks} disabled={closing} className="btn-secondary btn-sm">
                <Unlock size={13} /> {closing ? t('settings.saving') : t('settings.accounting.reopenButton')}
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-400">{t('settings.accounting.closeBooksHelp')}</p>
              <div className="flex items-end gap-3">
                <div>
                  <label className="form-label text-xs">{t('settings.accounting.closeThroughFy')}</label>
                  <FySelect value={closeFy} onChange={setCloseFy} className="w-32" />
                </div>
                <button type="button" onClick={closeBooks} disabled={closing} className="btn-danger btn-sm">
                  <Lock size={13} /> {closing ? t('settings.saving') : t('settings.accounting.closeButton')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </form>
  )
}
