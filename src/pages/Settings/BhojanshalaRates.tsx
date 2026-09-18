import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Save } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise, parsePaise } from '../../lib/api'
import { useToast } from '../../components/kit/Toast'

const SESSIONS = ['breakfast', 'lunch', 'dinner'] as const
type Session = (typeof SESSIONS)[number]

const COLUMN: Record<Session, string> = {
  breakfast: 'bhojanshala_rate_breakfast_paise',
  lunch: 'bhojanshala_rate_lunch_paise',
  dinner: 'bhojanshala_rate_dinner_paise',
}

/**
 * What one plate costs at each bhojanshala sitting.
 *
 * ── WHY THIS IS A SETTING AND NOT A FIELD ON THE SALE ───────────────────────
 * The counter used to ask for the rate on every sale, pre-filled with "20" —
 * a guess about somebody else's trust. With a queue at the window a clerk
 * either accepts that number or retypes the right one, per person. The price
 * of a thali is a property of the trust and the sitting; it changes when the
 * committee decides, not when the next person reaches the counter.
 *
 * Empty (0) means "not set", NOT "free": the API then falls back to whatever
 * the caller sends, so a trust that never opens this screen keeps working
 * exactly as it does today. Once a rate is set the server prices from it and
 * ignores the client, which is what lets the counter present it as fixed.
 */
export function BhojanshalaRates() {
  const { t } = useTranslation()
  const toast = useToast()
  const [rupees, setRupees] = useState<Record<Session, string>>({ breakfast: '', lunch: '', dinner: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = r.data?.data ?? r.data ?? {}
      setRupees({
        breakfast: toRupees(p[COLUMN.breakfast]),
        lunch: toRupees(p[COLUMN.lunch]),
        dinner: toRupees(p[COLUMN.dinner]),
      })
    }).catch(() => { /* leave the boxes empty; saving still works */ })
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    try {
      await api.patch('/tenants/me', Object.fromEntries(
        SESSIONS.map(s => [COLUMN[s], rupees[s].trim() ? parsePaise(rupees[s]) : 0]),
      ))
      toast.success(t('settings.bhojanshalaRates.saved'))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" data-testid="bhojanshala-rates">
      <div className="card-header">
        <h3 className="font-semibold text-sm">{t('settings.bhojanshalaRates.heading')}</h3>
        <p className="text-xs text-slate-400 mt-0.5">{t('settings.bhojanshalaRates.help')}</p>
      </div>
      <div className="card-body space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SESSIONS.map(s => (
            <div key={s}>
              <label className="form-label" htmlFor={`rate-${s}`}>{t(`bhojanshala.${s}`)}</label>
              <input
                id={`rate-${s}`}
                data-testid={`rate-${s}`}
                className="form-input"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                disabled={loading}
                value={rupees[s]}
                onChange={e => setRupees(r => ({ ...r, [s]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">{t('settings.bhojanshalaRates.zeroNote')}</p>
        <button type="button" onClick={save} disabled={saving || loading} className="btn-primary btn-sm">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? t('common.saving') : t('settings.bhojanshalaRates.save')}
        </button>
      </div>
    </div>
  )
}

/** Paise from the API to the rupees a committee actually talks in. */
function toRupees(paise: unknown): string {
  const n = Number(paise ?? 0)
  return Number.isFinite(n) && n > 0 ? fmtPaise(n).replace(/,/g, '') : ''
}
