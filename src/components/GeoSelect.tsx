import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { loadDialCodes } from './PhoneInput'

/**
 * State + City as clean native <select> dropdowns backed by the bundled India
 * geo API. Native selects avoid the browser-autofill overlay mess that
 * `<input list=datalist>` caused. If the current city isn't in the list (older
 * free-typed value), it's added as an option so nothing is lost.
 */
export function StateSelect({ value, onChange, className = 'form-select' }: {
  value: string; onChange: (state: string) => void; className?: string
}) {
  const { t } = useTranslation()
  const [states, setStates] = useState<string[]>([])
  useEffect(() => { api.get('/geo/states').then(r => setStates(r.data.data ?? r.data ?? [])).catch(() => {}) }, [])
  const opts = value && !states.includes(value) ? [value, ...states] : states
  return (
    <select className={className} value={value} autoComplete="off" onChange={e => onChange(e.target.value)}>
      <option value="">{t('ui.selectState')}</option>
      {opts.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

/**
 * City, with a way out.
 *
 * This was a bare <select> over a bundled list, and the list held the ten
 * biggest cities of each state. A trust in Rajsamand or Beawar opened it, did
 * not find its town, and could not finish onboarding — there was no other way
 * to enter a city. The list is much longer now, and that is still not the fix:
 * India has ~800 districts and far more towns, and districts get reorganised.
 * Any list will miss somebody.
 *
 * So the last option is always "My city is not listed", which swaps in a text
 * box. A typed city is saved exactly as typed and is offered back as the
 * selected option next time, so nothing is lost on a later edit.
 *
 * Still a <select> rather than `<input list=datalist>`: the datalist version
 * collided with the browser's own autofill overlay, which is why native
 * selects were chosen here in the first place.
 */
const OTHER = '__other__'

export function CitySelect({ state, value, onChange, className = 'form-select' }: {
  state: string; value: string; onChange: (city: string) => void; className?: string
}) {
  const { t } = useTranslation()
  const [cities, setCities] = useState<string[]>([])
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    if (!state) { setCities([]); return }
    api.get(`/geo/states/${encodeURIComponent(state)}/cities`).then(r => setCities(r.data.data ?? r.data ?? [])).catch(() => setCities([]))
  }, [state])

  // Changing state invalidates the town that was typed for the previous one.
  useEffect(() => { setTyping(false) }, [state])

  const known = value && cities.includes(value)
  // A value already saved that is not in the list (typed here before, or from
  // an older build) keeps its place at the top rather than silently blanking.
  const opts = value && !known ? [value, ...cities] : cities

  if (typing) {
    return (
      <div className="flex gap-2">
        <input
          className="form-input"
          autoFocus
          value={value}
          placeholder={t('ui.typeCity')}
          maxLength={100}
          onChange={e => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary btn-sm whitespace-nowrap"
          onClick={() => { setTyping(false); onChange('') }}
        >
          {t('ui.pickFromList')}
        </button>
      </div>
    )
  }

  return (
    <select
      className={className}
      value={value}
      autoComplete="off"
      disabled={!state}
      onChange={e => {
        if (e.target.value === OTHER) { setTyping(true); onChange('') ; return }
        onChange(e.target.value)
      }}
    >
      <option value="">{state ? t('ui.selectCity') : t('ui.pickStateFirst')}</option>
      {opts.map(c => <option key={c} value={c}>{c}</option>)}
      <option value={OTHER}>{t('ui.cityNotListed')}</option>
    </select>
  )
}

/** Countries devotees/donors commonly come from — India first. */
export const COUNTRIES = [
  'India', 'United Arab Emirates', 'United States', 'Canada', 'United Kingdom',
  'Singapore', 'Hong Kong', 'Australia', 'New Zealand', 'Germany', 'France',
  'Belgium', 'Netherlands', 'Switzerland', 'Japan', 'Malaysia', 'Thailand',
  'Indonesia', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Oman', 'Bahrain', 'Nepal',
  'Sri Lanka', 'Kenya', 'Tanzania', 'South Africa', 'Mauritius', 'Other',
]

/**
 * Country dropdown backed by GET /geo/countries (COUNTRIES below is the
 * offline fallback). Defaults to India; when the value is India callers pair
 * it with StateSelect/CitySelect, otherwise free-text state/city inputs.
 */
export function CountrySelect({ value, onChange, className = 'form-select' }: {
  value: string; onChange: (country: string) => void; className?: string
}) {
  const [names, setNames] = useState<string[]>(COUNTRIES)
  useEffect(() => { loadDialCodes().then(l => setNames(l.map(c => c.name))).catch(() => {}) }, [])
  const effective = value || 'India'
  const opts = !names.includes(effective) ? [effective, ...names] : names
  return (
    <select className={className} value={effective} autoComplete="off" onChange={e => onChange(e.target.value)}>
      {opts.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}
