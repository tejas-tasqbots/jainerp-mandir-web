/**
 * The roll print options, as the Settings screen handles them.
 *
 * ── WHY THIS IS NOT IN receiptTemplates.ts ─────────────────────────────────
 * That file is one of the four vendored BYTE-IDENTICAL into devotee-api
 * (qa-comms-catalog.mjs enforces it), so anything added there has to make sense
 * in a NestJS service with no React and no i18n. These helpers are about
 * editing the value in a form — reading a partially-filled object, turning
 * "absent means all" into a list of ticked boxes — which is a screen's problem,
 * not a renderer's.
 *
 * The renderer has its own `thermalOpts()` and keeps it: it must survive a
 * stored row written by an older build, and it is the last line before ink
 * hits paper. This module is the door; that one is the lock.
 */

/** The optional rows a roll may be told to leave out. */
export const THERMAL_FIELD_KEYS = [
  'mobile', 'pan', 'category', 'payment_mode', 'amount_in_words',
  'registration', 'upi_qr', 'footer',
] as const
export type ThermalField = typeof THERMAL_FIELD_KEYS[number]

/**
 * The widest feed offered, matching MAX_FEED_MM in the API's validator and the
 * clamp in the renderer. Three copies of one number, which is two too many —
 * but they live in three packages with no shared build, and
 * qa-receipt-thermal.mjs asserts they agree.
 */
export const MAX_FEED_MM = 40

/** The default feed, and why it is not zero: see the migration's comment. */
export const DEFAULT_FEED_MM = 18

export interface ThermalOptions {
  bold?: boolean
  feed_mm?: number
  cut_between_copies?: boolean
  /** Absent means every field prints. */
  fields?: ThermalField[]
}

/** Every paper size that is a roll rather than a sheet. */
const ROLL_PAPERS = new Set(['thermal58', 'thermal80', 'thermal112'])

export const isRollPaper = (paper?: string): boolean => !!paper && ROLL_PAPERS.has(paper)

/**
 * Read a stored value into something a form can edit.
 *
 * Defensive for the same reason the renderer is: this row can have been written
 * by an older build, restored from a backup, or edited by hand. A shape the
 * editor cannot handle must come back as "nothing stored" rather than putting
 * the screen into a state it cannot render or save.
 */
export function readThermal(raw: unknown): ThermalOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: ThermalOptions = {}

  if (typeof o.bold === 'boolean') out.bold = o.bold
  if (typeof o.cut_between_copies === 'boolean') out.cut_between_copies = o.cut_between_copies

  const feed = Number(o.feed_mm)
  if (Number.isFinite(feed)) out.feed_mm = Math.min(Math.max(Math.round(feed), 0), MAX_FEED_MM)

  if (Array.isArray(o.fields)) {
    out.fields = o.fields.filter(
      (f): f is ThermalField => typeof f === 'string'
        && (THERMAL_FIELD_KEYS as readonly string[]).includes(f),
    )
  }
  return out
}

/**
 * The fields currently ticked.
 *
 * An ABSENT list means every field prints — that is what a trust with no stored
 * settings has, and the renderer agrees. So the form has to show all of them
 * ticked, which means expanding the absence into the full list before the first
 * box is unticked. Without that, unticking one field would send
 * `fields: []` — read as "print nothing" — instead of "all but this one".
 */
export function rollFields(t: ThermalOptions): ThermalField[] {
  return t.fields ?? [...THERMAL_FIELD_KEYS]
}

export const rollFieldOn = (t: ThermalOptions, f: ThermalField): boolean =>
  rollFields(t).includes(f)
