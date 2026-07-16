import { fyOptions } from '../lib/api'

interface FySelectProps {
  value: string
  onChange: (fy: string) => void
  className?: string
  /** Years to list before the current FY (default 6). */
  back?: number
  /** Years to list after the current FY (default 1 — the upcoming year). */
  forward?: number
}

/**
 * Financial-year picker used across Reports, Certificates and the Accounts
 * statements. A real dropdown (not free text) so users can only pick a valid
 * India FY (April–March, e.g. "2026-27"); the current value is always included
 * even if it falls outside the default window.
 */
export function FySelect({ value, onChange, className = 'form-select w-32', back, forward }: FySelectProps) {
  const options = fyOptions({ back, forward, ensure: value })
  return (
    <select className={className} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(fy => (
        <option key={fy} value={fy}>{fy}</option>
      ))}
    </select>
  )
}
