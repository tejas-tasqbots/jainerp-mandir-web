/**
 * Shared date-range presets for list screens. The financial year runs
 * April–March (Indian FY), so "This FY" / "Last FY" are first-class presets
 * alongside the calendar ones.
 */

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

const iso = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function resolvePreset(preset: RangePreset, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear()
  const m = now.getMonth()
  const fyStartYear = m >= 3 ? y : y - 1
  switch (preset) {
    case 'today':
      return { from: iso(now), to: iso(now) }
    case 'yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1)
      return { from: iso(d), to: iso(d) }
    }
    case 'thisWeek': {
      // Week starts Monday.
      const d = new Date(now)
      const dow = (d.getDay() + 6) % 7
      d.setDate(d.getDate() - dow)
      return { from: iso(d), to: iso(now) }
    }
    case 'thisMonth':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) }
    case 'lastMonth':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
    case 'thisQuarter': {
      const qStart = Math.floor(m / 3) * 3
      return { from: iso(new Date(y, qStart, 1)), to: iso(new Date(y, qStart + 3, 0)) }
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
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to + 'T00:00:00')
  const days = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1
  if (days <= 0) return null
  const prevTo = new Date(f); prevTo.setDate(prevTo.getDate() - 1)
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days + 1)
  return { from: iso(prevFrom), to: iso(prevTo) }
}

/** Human caption for print headers / export subtitles. */
export function rangeCaption(range: DateRange, allLabel = 'All dates'): string {
  if (!range.from && !range.to) return allLabel
  const f = range.from ? new Date(range.from + 'T00:00:00').toLocaleDateString('en-IN') : '…'
  const t = range.to ? new Date(range.to + 'T00:00:00').toLocaleDateString('en-IN') : '…'
  return `${f} – ${t}`
}
