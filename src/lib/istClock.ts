/**
 * The trust's clock: IST, and the server's idea of "now".
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A counter PC was found with Windows set to a US timezone and its clock
 * hand-moved until the taskbar showed Indian time. Everything that trusted the
 * PC went wrong at once:
 *
 *   - every `toLocaleDateString('en-IN')` drew in the PC's zone, so a donation
 *     of 9 Oct (`"2026-10-09"`, i.e. UTC midnight) showed as 8 Oct in the
 *     Cash Book while the Donations list (pinned to IST) said 9 Oct;
 *   - token times read "05:45 am" for a 4:15 pm sale;
 *   - `todayIst()` was computed from an epoch ~10 h ahead of the truth, so
 *     every form defaulted to TOMORROW from mid-afternoon on.
 *
 * The books are kept in IST (FY April–March, the Day Book, the midnight
 * summary), so the PC's zone is never the right one to draw a date in, and the
 * PC's clock is not trustworthy enough to decide which day a receipt belongs
 * to. So:
 *
 *   1. `installIstDateFormatting()` makes Date#toLocale{,Date,Time}String default
 *      to Asia/Kolkata. One change instead of ~170 call sites, and a new screen
 *      cannot reintroduce the bug by forgetting the option.
 *   2. `serverNow()` corrects the PC clock by the offset the API's HTTP `Date`
 *      header reveals, so "today" is the server's today.
 *
 * IST has no daylight saving, so a fixed +05:30 is exact for calendar math.
 */

export const IST_TZ = 'Asia/Kolkata'
const IST_OFFSET_MS = 330 * 60_000

/** Ordinary drift is left alone; only a clock that is plainly wrong is corrected. */
const SKEW_THRESHOLD_MS = 2 * 60_000

let skewMs = 0
let latestServerMs = 0

/**
 * Record the server time an API response carried (its HTTP `Date` header).
 *
 * The header has one-second resolution and is stamped during the round trip,
 * which is noise next to the 2-minute threshold. A response whose Date is older
 * than one already seen is a cached copy, not the time now — skip it.
 */
export function noteServerDate(header: unknown, receivedAt = Date.now()): void {
  if (typeof header !== 'string' || !header) return
  const server = Date.parse(header)
  if (Number.isNaN(server) || server < latestServerMs) return
  latestServerMs = server
  const skew = server - receivedAt
  skewMs = Math.abs(skew) > SKEW_THRESHOLD_MS ? skew : 0
}

/** How far the PC clock is from the server's, in ms (0 when it is close enough). */
export function clockSkewMs(): number {
  return skewMs
}

/** "Now" as the server sees it — the PC clock, corrected if it is plainly wrong. */
export function serverNow(): Date {
  return new Date(Date.now() + skewMs)
}

/** The IST wall-clock parts of an instant (month is 0-based, like Date). */
export function istParts(at: Date = serverNow()): { y: number; m: number; d: number; h: number; dow: number } {
  const s = new Date(at.getTime() + IST_OFFSET_MS)
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate(), h: s.getUTCHours(), dow: s.getUTCDay() }
}

let installed = false

/**
 * Make Date's locale formatters draw in IST unless a caller names a zone.
 * Idempotent; call once before the app renders.
 */
export function installIstDateFormatting(): void {
  if (installed) return
  installed = true
  const proto = Date.prototype as unknown as Record<string, (this: Date, ...a: unknown[]) => string>
  for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const) {
    const original = proto[name]
    proto[name] = function (this: Date, locales?: unknown, options?: unknown) {
      const opts = (options ?? {}) as Intl.DateTimeFormatOptions
      return original.call(this, locales, opts.timeZone ? opts : { ...opts, timeZone: IST_TZ })
    }
  }
}

/**
 * An instant as the IST wall clock a `datetime-local` input takes
 * (`YYYY-MM-DDTHH:mm`), or '' for nothing. The input has no zone of its own, so
 * shifting by the PC's offset showed — and saved — a time in the PC's zone.
 */
export function istInputOf(value?: string | Date | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16)
}

/** "Now" for a `datetime-local` input, in IST by the server's clock. */
export function istInputNow(): string {
  return istInputOf(serverNow())
}

/** A `datetime-local` value read as IST, as an instant; null when blank or invalid. */
export function istInputToDate(value: string): Date | null {
  if (!value) return null
  const d = new Date(`${value.length === 16 ? `${value}:00` : value}+05:30`)
  return Number.isNaN(d.getTime()) ? null : d
}
