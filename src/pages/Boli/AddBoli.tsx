import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Save, Settings2, X } from 'lucide-react'
import { api, parsePaise, todayIst } from '../../lib/api'
import { DevoteePicker } from '../../components/DevoteePicker/DevoteePicker'
import type { DevoteeSelection } from '../../types'

/** The type dropdown's "Other…": a type the trust has not added to its list yet. */
const OTHER = '__other__'

interface BoliCategory { id: string; name: string; name_hindi?: string | null; is_active?: boolean }

export function AddBoli() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [devotee, setDevotee] = useState<DevoteeSelection | null>(null)
  // The trust's own boli types (Settings → Categories & Dropdowns → Boli
  // types, tenant migration 061). They were five words hardcoded here, so a
  // trust could not add "Shantidhara" or "Kalash" (2026-10-08).
  const [categories, setCategories] = useState<BoliCategory[]>([])

  const [form, setForm] = useState({
    category_id: '',
    other_category: '',
    description: '',
    pledged_amount: '',
    pledge_date: todayIst(),
    event_name: '',
  })

  useEffect(() => {
    api.get('/boli-categories', { params: { limit: '200' } })
      .then(r => {
        const rows: BoliCategory[] = (r.data.data ?? []).filter((c: BoliCategory) => c.is_active !== false)
        setCategories(rows)
        if (rows.length) setForm(f => (f.category_id ? f : { ...f, category_id: rows[0].id }))
      })
      .catch(() => setCategories([]))
  }, [])

  const label = (c: BoliCategory) => ((i18n.language === 'hi' || i18n.language === 'mr') && c.name_hindi) ? c.name_hindi : c.name

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.pledged_amount || parseFloat(form.pledged_amount) <= 0) { setError(t('msg.validPledgeAmount')); return }
    if (form.category_id === OTHER && !form.other_category.trim()) { setError(t('pledges.typeRequired')); return }
    if (!form.category_id && !form.description.trim()) { setError(t('pledges.typeRequired')); return }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        // The API files it under the type and composes "Aarti — Paryushan".
        ...(form.category_id === OTHER
          ? { category: form.other_category.trim() }
          : form.category_id ? { category_id: form.category_id } : {}),
        description: form.description.trim() || undefined,
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
      setError(err.response?.data?.error?.message || t('pledges.saveFailed'))
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
              <div className="flex items-center justify-between">
                <label className="form-label" htmlFor="add-boli-boli-type">{t('pledges.boliType')}</label>
                <button
                  type="button" className="text-xs text-navy-700 hover:underline inline-flex items-center gap-1"
                  onClick={() => navigate('/settings?tab=masters&sub=boli-categories')}
                >
                  <Settings2 size={12} /> {t('pledges.manageTypes')}
                </button>
              </div>
              <select id="add-boli-boli-type" className="form-select" value={form.category_id}
                onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                {!categories.length && <option value="">{t('pledges.selectType')}</option>}
                {categories.map(c => <option key={c.id} value={c.id}>{label(c)}</option>)}
                <option value={OTHER}>{t('expenseItems.otherCategory')}</option>
              </select>
              {form.category_id === OTHER && (
                <input className="form-input mt-1.5" autoFocus maxLength={120} data-testid="other-boli-type"
                  placeholder={t('pledges.newTypeName')} aria-label={t('pledges.newTypeName')}
                  value={form.other_category} onChange={e => setForm(f => ({ ...f, other_category: e.target.value }))} />
              )}
            </div>
            <div>
              <label className="form-label" htmlFor="add-boli-pledged-amount">{t('pledges.pledgedAmount')}</label>
              <input id="add-boli-pledged-amount" type="number" min="1" step="0.01" className="form-input" value={form.pledged_amount}
                onChange={e => setForm(f => ({ ...f, pledged_amount: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="add-boli-description">{t('pledges.description')} <span className="text-slate-400 font-normal">{t('donations.optional')}</span></label>
            <input id="add-boli-description" className="form-input" placeholder={t('pledges.descriptionPlaceholder')} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label" htmlFor="add-boli-pledge-date">{t('pledges.pledgeDate')}</label>
              <input id="add-boli-pledge-date" type="date" className="form-input" value={form.pledge_date}
                onChange={e => setForm(f => ({ ...f, pledge_date: e.target.value }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="add-boli-event-name">{t('pledges.event2')} <span className="text-slate-400 font-normal">{t('donations.optional')}</span></label>
              <input id="add-boli-event-name" className="form-input" placeholder={t('pledges.eventPlaceholder')} value={form.event_name}
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
