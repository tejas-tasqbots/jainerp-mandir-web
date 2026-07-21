/**
 * Build DataTable `graphData` from the rows already loaded on screen.
 *
 * Per the plan's engineering note: the graph toggle charts the *filtered
 * dataset the user is looking at* — trend-by-day for dated transaction lists,
 * or split-by-enum for categorical ones. No extra API call.
 */

export interface GraphPoint { label: string; value: number }

/** Sum `amountKey` (paise) per calendar day of `dateKey`, oldest first. Returns rupees. */
export function trendByDay<T>(
  rows: T[],
  dateKey: keyof T,
  amountKey: keyof T,
): GraphPoint[] {
  const byDay = new Map<string, number>()
  for (const r of rows) {
    const raw = r[dateKey] as unknown as string | undefined
    if (!raw) continue
    const day = String(raw).slice(0, 10)
    const amt = Number(r[amountKey] ?? 0)
    byDay.set(day, (byDay.get(day) ?? 0) + amt)
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, paise]) => ({
      label: new Date(day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      value: paise / 100,
    }))
}

/** Sum `amountKey` (paise) grouped by a categorical field, largest first. Returns rupees. */
export function splitBy<T>(
  rows: T[],
  groupKey: keyof T,
  amountKey: keyof T,
  labelOf: (v: string) => string = v => v,
): GraphPoint[] {
  const byKey = new Map<string, number>()
  for (const r of rows) {
    const k = String(r[groupKey] ?? '—')
    byKey.set(k, (byKey.get(k) ?? 0) + Number(r[amountKey] ?? 0))
  }
  return [...byKey.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, paise]) => ({ label: labelOf(k), value: paise / 100 }))
}
