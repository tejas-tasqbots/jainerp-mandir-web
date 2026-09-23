import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, X } from 'lucide-react'
import { api, parsePaise, todayIst } from '../../lib/api'
import { DevoteePicker } from '../../components/DevoteePicker/DevoteePicker'
import type { DevoteeSelection } from '../../types'

export function AddBoli() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [devotee, setDevotee] = useState<DevoteeSelection | null>(null)

  const [form, setForm] = useState({
    boli_type: 'aarti',
    description: '',
    pledged_amount: '',
    pledge_date: todayIst(),
    event_name: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.pledged_amount || parseFloat(form.pledged_amount) <= 0) { setError('Enter valid pledged amount'); return }
    setSaving(true)
    setError('')
    try {
      // The API stores a single seva_description; fold the boli type into it
      // (capitalised) so the type is preserved and the field is never empty.
      const typeLabel = form.boli_type.charAt(0).toUpperCase() + form.boli_type.slice(1)
      const sevaDescription = form.description.trim()
        ? `${typeLabel} — ${form.description.trim()}`
        : typeLabel
      const payload: Record<string, unknown> = {
        seva_description: sevaDescription,
        pledged_amount_paise: parsePaise(form.pledged_amount),
        boli_date: form.pledge_date,
        event_name: form.event_name || undefined,
      }

      if (devotee?.is_anonymous) {
        payload.is_anonymous = true
      } else if (devotee?.global_user_id) {
        payload.donor = { global_user_id: devotee.global_user_id, name: devotee.name, mobile: devotee.mobile }
      } else if (devotee?.name) {
        payload.donor = { name: devotee.name, mobile: devotee.mobile }
      }

      await api.post('/bolis', payload)
      navigate('/donations?tab=pledges')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setError(err.response?.data?.error?.message || 'Failed to save boli')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-navy-900">{t('pledges.newPledgeTitle')}</h1>
        <button onClick={() => navigate('/donations?tab=pledges')} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
      </div>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body space-y-5">
          <DevoteePicker
            label={t('pledges.devotee')}
            value={devotee}
            onChange={setDevotee}
            showAnonymous
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('pledges.boliType')}</label>
              <select className="form-select" value={form.boli_type}
                onChange={e => setForm(f => ({ ...f, boli_type: e.target.value }))}>
                <option value="aarti">{t('ui.aarti')}</option>
                <option value="pratistha">{t('ui.pratistha')}</option>
                <option value="seva">Seva</option>
                <option value="chadhava">{t('ui.chadhava')}</option>
                <option value="other">{t('ui.other')}</option>
              </select>
            </div>
            <div>
              <label className="form-label">{t('pledges.pledgedAmount')}</label>
              <input type="number" min="1" step="0.01" className="form-input" value={form.pledged_amount}
                onChange={e => setForm(f => ({ ...f, pledged_amount: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="form-label">{t('pledges.description')}</label>
            <input className="form-input" placeholder={t('pledges.descriptionPlaceholder')} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('pledges.pledgeDate')}</label>
              <input type="date" className="form-input" value={form.pledge_date}
                onChange={e => setForm(f => ({ ...f, pledge_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('pledges.event2')} <span className="text-slate-400 font-normal">{t('donations.optional')}</span></label>
              <input className="form-input" placeholder={t('pledges.eventPlaceholder')} value={form.event_name}
                onChange={e => setForm(f => ({ ...f, event_name: e.target.value }))} />
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/donations?tab=pledges')} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? t('common.saving') : t('pledges.savePledge')}
          </button>
        </div>
      </form>
    </div>
  )
}
