import type { TFunction } from 'i18next'

/**
 * The API's account of how a stay was charged (tenant migration 072), worded
 * in the reader's language. The API sends `steps` as codes with their figures
 * (and an English `explanation` beside them); a screen words the codes itself
 * so a Hindi counter does not read English sentences.
 */
export interface StayStep { code: string; [k: string]: string | number }

export function fmtDuration(t: TFunction, minutes: number): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  const parts: string[] = []
  if (d) parts.push(t('stayCharge.dur.d', { count: d }))
  if (h) parts.push(t('stayCharge.dur.h', { count: h }))
  if (mm || !parts.length) parts.push(t('stayCharge.dur.m', { count: mm }))
  return parts.join(' ')
}

function clock12(hhmm: unknown): string {
  const [h, m] = String(hhmm ?? '00:00').split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const inr = (paise: unknown) => `₹${(Number(paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** One step as a sentence; an unknown code falls back to the API's English. */
export function stayStepText(t: TFunction, s: StayStep, english?: string): string {
  const key = `stayCharge.step.${s.code}`
  const params = {
    duration: fmtDuration(t, Number(s.duration ?? 0)),
    rest: fmtDuration(t, Number(s.rest ?? 0)),
    grace: fmtDuration(t, Number(s.grace ?? 0)),
    nights: s.nights, count: Number(s.nights ?? s.days ?? 0), days: s.days, hours: s.hours,
    amount: inr(s.amount), checkin: clock12(s.checkin), checkout: clock12(s.checkout),
  }
  const out = t(key, params)
  return out === key ? (english ?? s.code) : out
}
