import { CalendarRange, ChevronDown } from 'lucide-react'
import { fyOptions } from '../lib/api'

interface FySelectProps {
  value: string
  onChange: (fy: string) => void
  /** Width/margin utilities for the wrapper (e.g. "w-full mb-4"). Default: a compact fixed width. */
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
 *
 * Styled as a compact pill (calendar icon + "FY 2026-27" + chevron) so it
 * matches the DateRangePicker and the rest of the filter-row controls instead
 * of rendering as a bulky bare <select>. `className` sets the wrapper width.
 */
export function FySelect({ value, onChange, className = 'w-36', back, forward }: FySelectProps) {
  const options = fyOptions({ back, forward, ensure: value })
  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <CalendarRange size={13} className="absolute left-2.5 text-slate-400 pointer-events-none" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label="Financial year"
        className="w-full appearance-none pl-7 pr-7 py-1.5 text-xs font-semibold text-navy-900 bg-white border border-slate-300 rounded-md cursor-pointer transition-colors hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue-light)] focus:border-accent-500"
      >
        {options.map(fy => (
          <option key={fy} value={fy}>{fy}</option>
        ))}
      </select>
      <ChevronDown size={13} className="absolute right-2 text-slate-400 pointer-events-none" />
    </div>
  )
}
