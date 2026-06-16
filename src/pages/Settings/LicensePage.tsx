import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'

interface SubData {
  plan: string
  display_name: string
  status: string
  billing_cycle: string
  current_period_start: string
  current_period_end: string
}

interface TenantData {
  name: string
  platform?: { slug: string; plan: string; plan_display: string; tenancy_tier: string }
}

function daysRemaining(end: string) {
  const diff = new Date(end).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 86400000))
}

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function LicensePage() {
  const [sub, setSub] = useState<SubData | null>(null)
  const [tenant, setTenant] = useState<TenantData | null>(null)
  const [loading, setLoading] = useState(true)
  const [key, setKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [activateMsg, setActivateMsg] = useState('')

  useEffect(() => {
    Promise.all([
      api.get('/tenants/me/subscription').then(r => setSub(r.data.data?.subscription || null)),
      api.get('/tenants/me').then(r => setTenant(r.data.data || null)),
    ]).finally(() => setLoading(false))
  }, [])

  async function activate(e: React.FormEvent) {
    e.preventDefault()
    if (!key.trim()) return
    setActivating(true)
    setActivateMsg('')
    try {
      await api.post('/tenants/me/activate-license', { key: key.trim() })
      setActivateMsg('License activated successfully!')
      setKey('')
    } catch (err: any) {
      setActivateMsg(err?.response?.data?.message || 'Invalid license key. Please check and try again.')
    } finally {
      setActivating(false)
    }
  }

  const isActive = sub?.status === 'active' || !sub
  const days = sub?.current_period_end ? daysRemaining(sub.current_period_end) : null

  if (loading) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-bold text-navy-900 mb-5">License</h1>
        <div className="card card-body text-center text-slate-400 py-12">
          <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
          Loading license info...
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-xl font-bold text-navy-900">License</h1>

      {/* Current License */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Current License</h3></div>
        <div className="card-body">
          <div className={`rounded-lg border p-4 ${isActive ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <div className="flex items-center gap-2 mb-3">
              {isActive
                ? <ShieldCheck size={18} className="text-green-600" />
                : <ShieldAlert size={18} className="text-red-500" />
              }
              <span className={`font-semibold text-sm ${isActive ? 'text-green-700' : 'text-red-600'}`}>
                {sub ? (sub.status.charAt(0).toUpperCase() + sub.status.slice(1)) : 'Active'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-slate-500">Customer</span>
              <span className="font-medium text-navy-900">{tenant?.name || '—'}</span>
              <span className="text-slate-500">Customer ID</span>
              <span className="font-medium text-navy-900 uppercase">{tenant?.platform?.slug || '—'}</span>
              <span className="text-slate-500">Plan</span>
              <span className="font-medium text-navy-900">{sub?.display_name || tenant?.platform?.plan_display || 'Pro'}</span>
              <span className="text-slate-500">Billing Cycle</span>
              <span className="font-medium text-navy-900 capitalize">{sub?.billing_cycle || 'Annual'}</span>
              {sub?.current_period_start && (
                <>
                  <span className="text-slate-500">Issued</span>
                  <span className="font-medium text-navy-900">{fmt(sub.current_period_start)}</span>
                </>
              )}
              {sub?.current_period_end && (
                <>
                  <span className="text-slate-500">Expires</span>
                  <span className="font-medium text-navy-900">{fmt(sub.current_period_end)}</span>
                  <span className="text-slate-500">Days Remaining</span>
                  <span className={`font-semibold ${(days ?? 0) < 30 ? 'text-amber-600' : 'text-green-700'}`}>
                    {days} days
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Renew License */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">Renew / Activate License</h3></div>
        <div className="card-body space-y-3">
          <p className="text-sm text-slate-500">
            Enter your license key from Tasqbots Technologies to activate or renew your subscription.
          </p>
          <form onSubmit={activate} className="space-y-3">
            <textarea
              className="form-textarea font-mono text-sm"
              rows={3}
              placeholder="KSHETRA-eyJ..."
              value={key}
              onChange={e => setKey(e.target.value)}
            />
            {activateMsg && (
              <div className={`text-sm rounded px-3 py-2 ${
                activateMsg.includes('success')
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-red-50 border border-red-200 text-red-600'
              }`}>
                {activateMsg}
              </div>
            )}
            <button type="submit" disabled={activating || !key.trim()} className="btn-primary">
              {activating ? <RefreshCw size={14} className="animate-spin" /> : null}
              {activating ? 'Activating...' : 'Activate Key'}
            </button>
          </form>
          <p className="text-xs text-slate-400">
            To purchase or renew, contact{' '}
            <a href="mailto:sales@tasqbots.com" className="text-navy-900 underline">sales@tasqbots.com</a>
          </p>
        </div>
      </div>
    </div>
  )
}
