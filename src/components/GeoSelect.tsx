import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/**
 * State + City as clean native <select> dropdowns backed by the bundled India
 * geo API. Native selects avoid the browser-autofill overlay mess that
 * `<input list=datalist>` caused. If the current city isn't in the list (older
 * free-typed value), it's added as an option so nothing is lost.
 */
export function StateSelect({ value, onChange, className = 'form-select' }: {
  value: string; onChange: (state: string) => void; className?: string
}) {
  const [states, setStates] = useState<string[]>([])
  useEffect(() => { api.get('/geo/states').then(r => setStates(r.data.data ?? r.data ?? [])).catch(() => {}) }, [])
  const opts = value && !states.includes(value) ? [value, ...states] : states
  return (
    <select className={className} value={value} autoComplete="off" onChange={e => onChange(e.target.value)}>
      <option value="">Select state…</option>
      {opts.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

export function CitySelect({ state, value, onChange, className = 'form-select' }: {
  state: string; value: string; onChange: (city: string) => void; className?: string
}) {
  const [cities, setCities] = useState<string[]>([])
  useEffect(() => {
    if (!state) { setCities([]); return }
    api.get(`/geo/states/${encodeURIComponent(state)}/cities`).then(r => setCities(r.data.data ?? r.data ?? [])).catch(() => setCities([]))
  }, [state])
  const opts = value && !cities.includes(value) ? [value, ...cities] : cities
  return (
    <select className={className} value={value} autoComplete="off" disabled={!state} onChange={e => onChange(e.target.value)}>
      <option value="">{state ? 'Select city…' : 'Pick a state first'}</option>
      {opts.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}
