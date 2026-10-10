/**
 * Shared date-range presets for list screens. The financial year runs
 * April–March (Indian FY), so "This FY" / "Last FY" are first-class presets
 * alongside the calendar ones.
 */

import { IST_TZ, istParts, serverNow } from './istClock'

export type RangePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'thisFY'
  | 'lastFY'
  | 'custom'

export interface DateRange {
  preset: RangePreset
  /** ISO yyyy-mm-dd, empty string = unbounded */
  from: string
  to: string
}

// Calendar dates live in UTC-midnight Date objects and are read with the UTC
// getters, so no PC timezone can move a day. "Now" is the IST day by the
// server's clock (lib/istClock) — a PC with a wrong zone or clock used to put
// "Today" and "This Month" on the wrong day.
const iso = (d: Date) => d.toISOString().slice(0, 10)
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d))
const addDays = (d: Date, n: number) => { const c = new Date(d); c.setUTCDate(c.getUTCDate() + n); return c }

export function resolvePreset(preset: RangePreset, now: Date = serverNow()): { from: string; to: string } {
  const { y, m, d, dow } = istParts(now)
  const today = day(y, m, d)
  const fyStartYear = m >= 3 ? y : y - 1
  switch (preset) {
    case 'today':
      return { from: iso(today), to: iso(today) }
    case 'yesterday': {
      const yd = addDays(today, -1)
      return { from: iso(yd), to: iso(yd) }
    }
    case 'thisWeek':
      // Week starts Monday.
      return { from: iso(addDays(today, -((dow + 6) % 7))), to: iso(today) }
    case 'thisMonth':
      return { from: iso(day(y, m, 1)), to: iso(day(y, m + 1, 0)) }
    case 'lastMonth':
      return { from: iso(day(y, m - 1, 1)), to: iso(day(y, m, 0)) }
    case 'thisQuarter': {
      const qStart = Math.floor(m / 3) * 3
      return { from: iso(day(y, qStart, 1)), to: iso(day(y, qStart + 3, 0)) }
    }
    case 'thisFY':
      return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` }
    case 'lastFY':
      return { from: `${fyStartYear - 1}-04-01`, to: `${fyStartYear}-03-31` }
    case 'all':
    case 'custom':
    default:
      return { from: '', to: '' }
  }
}

export function makeRange(preset: RangePreset): DateRange {
  return { preset, ...resolvePreset(preset) }
}

/**
 * The equal-length period immediately before [from, to] — used for the
 * "vs previous period" delta on summary strips. Returns null when the range
 * is unbounded (nothing meaningful to compare against).
 */
export function previousPeriod(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to) return null
  const f = new Date(from + 'T00:00:00Z')
  const t = new Date(to + 'T00:00:00Z')
  const days = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1
  if (days <= 0) return null
  const prevTo = addDays(f, -1)
  const prevFrom = addDays(prevTo, -days + 1)
  return { from: iso(prevFrom), to: iso(prevTo) }
}

/** Human caption for print headers / export subtitles. */
export function rangeCaption(range: DateRange, allLabel = 'All dates'): string {
  if (!range.from && !range.to) return allLabel
  const f = range.from ? new Date(range.from + 'T00:00:00+05:30').toLocaleDateString('en-IN', { timeZone: IST_TZ }) : '…'
  const t = range.to ? new Date(range.to + 'T00:00:00+05:30').toLocaleDateString('en-IN', { timeZone: IST_TZ }) : '…'
  return `${f} – ${t}`
}
