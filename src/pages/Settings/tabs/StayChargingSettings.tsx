import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../lib/api'

/**
 * How a stay is charged, and who may change the price (tenant migration 072).
 *
 * Asked by a client (2026-10-25): a guest who came at 10:00 and left at 11:30
 * the same day - why could that be two days? The answer depends on the trust's
 * rule, so the rule is set here, with the client's case and four others worked
 * out by the API under the UNSAVED choices, so the person choosing sees what
 * each one charges before saving it.
 *
 * Every part is the trust's: the mode, each side's grace period and charge
 * (free, half, full, a percentage, a fixed amount or per hour), when a part
 * day becomes a full day, whether a same-day stay is always one day, a
 * short-stay rate, and who may change a price at the desk. Bookings keep the
 * rule they were made under; the hint says so.
 */
export type PartCharge = 'free' | 'half' | 'full' | 'percent' | 'fixed' | 'hourly'
export const STAY_CHARGE_DEFAULTS = {
  stay_billing_mode: 'calendar' as 'calendar' | 'checkout_time' | 'rolling_24h',
  stay_early_grace_minutes: 60,
  stay_late_grace_minutes: 60,
  stay_early_charge: 'half' as PartCharge,
  stay_late_charge: 'half' as PartCharge,
  stay_early_value: 0,
  stay_late_value: 0,
  stay_full_day_after_hours: 6,
  stay_same_day: 'one_day' as 'one_day' | 'strict',
  stay_short_stay_hours: 0,
  stay_short_stay_kind: 'percent' as 'percent' | 'fixed',
  stay_short_stay_percent: 50,
  stay_short_stay_paise: 0,
  room_price_policy: 'flexible' as 'fixed' | 'controlled' | 'flexible',
  room_discount_limit_percent: 10,
}
export type StayChargeSettings = typeof STAY_CHARGE_DEFAULTS
const PART_CHARGES: readonly PartCharge[] = ['free', 'half', 'full', 'percent', 'fixed', 'hourly']

const num = (v: unknown, d: number) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d)
const pick = <T extends string>(v: unknown, allowed: readonly T[], f: T): T => (allowed.includes(v as T) ? (v as T) : f)

export function stayChargeFromProfile(p: Record<string, unknown>): StayChargeSettings {
  const d = STAY_CHARGE_DEFAULTS
  return {
    stay_billing_mode: pick(p.stay_billing_mode, ['calendar', 'checkout_time', 'rolling_24h'] as const, d.stay_billing_mode),
    stay_early_grace_minutes: num(p.stay_early_grace_minutes, d.stay_early_grace_minutes),
    stay_late_grace_minutes: num(p.stay_late_grace_minutes, d.stay_late_grace_minutes),
    stay_early_charge: pick(p.stay_early_charge, PART_CHARGES, d.stay_early_charge),
    stay_late_charge: pick(p.stay_late_charge, PART_CHARGES, d.stay_late_charge),
    stay_early_value: num(p.stay_early_value, d.stay_early_value),
    stay_late_value: num(p.stay_late_value, d.stay_late_value),
    stay_full_day_after_hours: num(p.stay_full_day_after_hours, d.stay_full_day_after_hours),
    stay_same_day: pick(p.stay_same_day, ['one_day', 'strict'] as const, d.stay_same_day),
    stay_short_stay_hours: num(p.stay_short_stay_hours, d.stay_short_stay_hours),
    stay_short_stay_kind: pick(p.stay_short_stay_kind, ['percent', 'fixed'] as const, d.stay_short_stay_kind),
    stay_short_stay_percent: num(p.stay_short_stay_percent, d.stay_short_stay_percent),
    stay_short_stay_paise: num(p.stay_short_stay_paise, d.stay_short_stay_paise),
    room_price_policy: pick(p.room_price_policy, ['fixed', 'controlled', 'flexible'] as const, d.room_price_policy),
    room_discount_limit_percent: num(p.room_discount_limit_percent, d.room_discount_limit_percent),
  }
}

/** Only these keys, for the PATCH body (the caller passes its whole form). */
export function stayChargePayload(v: StayChargeSettings): StayChargeSettings {
  const out = {} as Record<string, unknown>
  for (const k of Object.keys(STAY_CHARGE_DEFAULTS)) out[k] = (v as Record<string, unknown>)[k]
  // A percentage side needs a percentage; switching from a ₹ amount would
  // otherwise send 20000 "percent".
  for (const side of ['early', 'late'] as const) {
    const c = out[`stay_${side}_charge`]
    const val = Number(out[`stay_${side}_value`] ?? 0)
    if (c === 'percent' && (val < 1 || val > 100)) out[`stay_${side}_value`] = 50
    if (c !== 'percent' && c !== 'fixed' && c !== 'hourly') out[`stay_${side}_value`] = 0
  }
  return out as StayChargeSettings
}

interface Quote { total_paise: number; nights: number; explanation: string[]; fees: { description: string; amount_paise: number }[] }

const RATE = 100_000 // the examples price a ₹1,000 room

function istDayPlus(n: number): string {
  return new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10)
}
function shift(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const t = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + minutes))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`).toISOString()

export function StayChargingSettings({ value, onChange, checkin, checkout }: {
  value: StayChargeSettings
  onChange: <K extends keyof StayChargeSettings>(k: K, v: StayChargeSettings[K]) => void
  checkin: string
  checkout: string
}) {
  const { t } = useTranslation()
  const v = value
  const timed = v.stay_billing_mode !== 'calendar'
  const partDay = (c: PartCharge) => c !== 'free' && c !== 'full'

  // The worked examples, priced by the API under the unsaved choices.
  const examples = useMemo(() => {
    const d1 = istDayPlus(1)
    const d2 = istDayPlus(2)
    const ci = checkin || '12:00'
    const co = checkout || '10:00'
    return [
      { key: 'sameDay', label: t('stayCharge.exSameDay', { from: clock12(shift(ci, -60)), to: clock12(shift(co, 60)) }), arrival: at(d1, shift(ci, -60)), departure: at(d1, shift(co, 60)) },
      { key: 'night', label: t('stayCharge.exNight', { from: clock12(ci), to: clock12(co) }), arrival: at(d1, ci), departure: at(d2, co) },
      { key: 'late', label: t('stayCharge.exLate', { to: clock12(shift(co, 270)) }), arrival: at(d1, ci), departure: at(d2, shift(co, 270)) },
      { key: 'veryLate', label: t('stayCharge.exLate', { to: clock12(shift(co, 480)) }), arrival: at(d1, ci), departure: at(d2, shift(co, 480)) },
      { key: 'early', label: t('stayCharge.exEarly', { from: clock12('05:00') }), arrival: at(d1, '05:00'), departure: at(d2, co) },
      { key: 'short', label: t('stayCharge.exShort'), arrival: at(d1, '14:00'), departure: at(d1, '17:00') },
    ]
  }, [t, checkin, checkout])

  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({})
  const policyKey = JSON.stringify({ v, checkin, checkout })
  useEffect(() => {
    const policy = {
      mode: v.stay_billing_mode, checkin: checkin || '12:00', checkout: checkout || '10:00',
      early_grace_minutes: v.stay_early_grace_minutes, late_grace_minutes: v.stay_late_grace_minutes,
      early_charge: v.stay_early_charge, late_charge: v.stay_late_charge,
      early_value: v.stay_early_value, late_value: v.stay_late_value,
      full_day_after_hours: v.stay_full_day_after_hours, same_day: v.stay_same_day,
      short_stay_hours: v.stay_short_stay_hours, short_stay_kind: v.stay_short_stay_kind,
      short_stay_percent: v.stay_short_stay_percent, short_stay_paise: v.stay_short_stay_paise,
    }
    const timer = setTimeout(() => {
      Promise.all(examples.map(e => api.post('/room-bookings/quote', { rate_paise: RATE, arrival: e.arrival, departure: e.departure, policy })
        .then(r => [e.key, r.data.data as Quote] as const)
        .catch(() => [e.key, null] as const)))
        .then(list => setQuotes(Object.fromEntries(list)))
    }, 300)
    return () => clearTimeout(timer)
  }, [policyKey, examples]) // eslint-disable-line react-hooks/exhaustive-deps

  const days = (paise: number) => {
    const d = paise / RATE
    return t('stayCharge.days', { count: d, days: Number.isInteger(d) ? d : d.toFixed(2).replace(/\.?0+$/, '') })
  }

  const intInput = (k: keyof StayChargeSettings, id: string, min: number, max: number, cls = 'w-24') => (
    <input id={id} type="number" min={min} max={max} step={1} className={`form-input ${cls}`} data-testid={id}
      value={v[k] as number}
      onChange={e => onChange(k, Math.min(max, Math.max(min, Math.round(Number(e.target.value) || 0))) as never)} />
  )
  /** A paise column typed in rupees. */
  const rupeeInput = (k: keyof StayChargeSettings, id: string) => (
    <span className="inline-flex items-center gap-1">
      <span>₹</span>
      <input id={id} type="number" min={0} step="1" className="form-input w-28" data-testid={id}
        value={Number(v[k]) / 100}
        onChange={e => onChange(k, Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) as never)} />
    </span>
  )

  /** One side: early arrival or late departure (or time over 24 h). */
  const side = (s: 'early' | 'late', label: string) => {
    const ck = `stay_${s}_charge` as const
    const vk = `stay_${s}_value` as const
    const gk = `stay_${s}_grace_minutes` as const
    const c = v[ck]
    return (
      <div className="space-y-2 rounded-lg border border-slate-100 p-3" data-testid={`stay-side-${s}`}>
        <label className="form-label" htmlFor={`stay-${s}-charge`}>{label}</label>
        <select id={`stay-${s}-charge`} className="form-select" data-testid={`stay-${s}-charge`} value={c}
          onChange={e => {
            const next = e.target.value as PartCharge
            onChange(ck, next)
            // A sensible starting figure for the new kind.
            if (next === 'percent') onChange(vk, 50)
            else if (next === 'fixed') onChange(vk, 20_000)
            else if (next === 'hourly') onChange(vk, 10_000)
            else onChange(vk, 0)
          }}>
          {PART_CHARGES.map(o => <option key={o} value={o}>{t(`stayCharge.charge.${o}`)}</option>)}
        </select>
        {c === 'percent' && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            {intInput(vk, `stay-${s}-value`, 1, 100)}<span>{t('stayCharge.pctOfDay')}</span>
          </div>
        )}
        {c === 'fixed' && <div className="text-xs text-slate-600">{rupeeInput(vk, `stay-${s}-value`)}</div>}
        {c === 'hourly' && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            {rupeeInput(vk, `stay-${s}-value`)}<span>{t('stayCharge.perHour')}</span>
          </div>
        )}
        {c !== 'free' && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <label htmlFor={`stay-${s}-grace`}>{t('stayCharge.grace')}</label>
            {intInput(gk, `stay-${s}-grace`, 0, 720)}
            <span>{t('stayCharge.minutes')}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4" data-testid="stay-charging">
      <div>
        <p className="text-sm font-semibold text-navy-900">{t('stayCharge.heading')}</p>
        <p className="text-[11px] text-slate-500">{t('stayCharge.subheading')}</p>
      </div>

      <fieldset className="space-y-2">
        {(['calendar', 'checkout_time', 'rolling_24h'] as const).map(m => (
          <label key={m} className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer ${v.stay_billing_mode === m ? 'border-brand-blue bg-blue-50/40' : 'border-slate-200'}`}>
            <input type="radio" name="stay-billing-mode" className="mt-1" data-testid={`stay-mode-${m}`}
              checked={v.stay_billing_mode === m} onChange={() => onChange('stay_billing_mode', m)} />
            <span>
              <span className="text-sm text-slate-800">{t(`stayCharge.mode.${m}`)}{m === 'calendar' ? ` ${t('stayCharge.defaultTag')}` : ''}</span>
              <span className="block text-[11px] text-slate-500">{t(`stayCharge.modeHint.${m}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {timed && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {v.stay_billing_mode === 'checkout_time' && side('early', t('stayCharge.early'))}
            {side('late', v.stay_billing_mode === 'rolling_24h' ? t('stayCharge.over24') : t('stayCharge.late'))}
          </div>
          {((v.stay_billing_mode === 'checkout_time' && partDay(v.stay_early_charge)) || partDay(v.stay_late_charge)) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <label htmlFor="stay-full-day-after">{t('stayCharge.fullDayAfter')}</label>
              {intInput('stay_full_day_after_hours', 'stay-full-day-after', 1, 23)}
              <span>{t('stayCharge.fullDayAfterHint')}</span>
            </div>
          )}
          {v.stay_billing_mode === 'checkout_time' && (
            <fieldset className="space-y-1" data-testid="stay-same-day">
              <legend className="form-label">{t('stayCharge.sameDay')}</legend>
              {(['one_day', 'strict'] as const).map(o => (
                <label key={o} className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="stay-same-day" className="mt-1" data-testid={`stay-same-day-${o}`}
                    checked={v.stay_same_day === o} onChange={() => onChange('stay_same_day', o)} />
                  <span>
                    <span className="text-sm text-slate-700">{t(`stayCharge.sameDayOpt.${o}`)}</span>
                    <span className="block text-[11px] text-slate-400">{t(`stayCharge.sameDayHint.${o}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}

      <div className="space-y-1">
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="form-checkbox mt-0.5" data-testid="stay-short-on"
            checked={v.stay_short_stay_hours > 0}
            onChange={e => onChange('stay_short_stay_hours', e.target.checked ? 6 : 0)} />
          <span>
            <span className="text-sm text-slate-700">{t('stayCharge.shortStay')}</span>
            <span className="block text-[11px] text-slate-400">{t('stayCharge.shortStayHint')}</span>
          </span>
        </label>
        {v.stay_short_stay_hours > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 pl-6">
            <label htmlFor="stay-short-hours">{t('stayCharge.shortUpTo')}</label>
            {intInput('stay_short_stay_hours', 'stay-short-hours', 1, 12)}
            <label htmlFor="stay-short-kind">{t('stayCharge.shortHoursAt')}</label>
            <select id="stay-short-kind" className="form-select w-auto" data-testid="stay-short-kind" value={v.stay_short_stay_kind}
              onChange={e => onChange('stay_short_stay_kind', e.target.value as 'percent' | 'fixed')}>
              <option value="percent">{t('stayCharge.shortKind.percent')}</option>
              <option value="fixed">{t('stayCharge.shortKind.fixed')}</option>
            </select>
            {v.stay_short_stay_kind === 'percent'
              ? <>{intInput('stay_short_stay_percent', 'stay-short-percent', 1, 100)}<span>{t('stayCharge.pctOfDay')}</span></>
              : rupeeInput('stay_short_stay_paise', 'stay-short-paise')}
          </div>
        )}
      </div>

      <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1" data-testid="stay-examples">
        <p className="font-semibold text-slate-700">{t('stayCharge.examples', { rate: '1,000' })}</p>
        {examples.map(e => {
          const q = quotes[e.key]
          return (
            <div key={e.key} className="flex justify-between gap-3" title={q?.explanation?.join(' ') ?? ''} data-testid={`stay-example-${e.key}`}>
              <span className="text-slate-600">{e.label}</span>
              <span className="font-semibold text-navy-900 whitespace-nowrap">
                {q ? `${days(q.total_paise)} · ₹${(q.total_paise / 100).toLocaleString('en-IN')}` : '…'}
              </span>
            </div>
          )
        })}
        <p className="text-[11px] text-slate-400 pt-1">{t('stayCharge.existingKeep')}</p>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <p className="text-sm font-semibold text-navy-900">{t('stayCharge.priceHeading')}</p>
        {(['fixed', 'controlled', 'flexible'] as const).map(m => (
          <label key={m} className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="room-price-policy" className="mt-1" data-testid={`price-policy-${m}`}
              checked={v.room_price_policy === m} onChange={() => onChange('room_price_policy', m)} />
            <span>
              <span className="text-sm text-slate-800">{t(`stayCharge.price.${m}`)}</span>
              <span className="block text-[11px] text-slate-500">{t(`stayCharge.priceHint.${m}`)}</span>
            </span>
          </label>
        ))}
        {v.room_price_policy === 'controlled' && (
          <div className="flex items-center gap-2 text-xs text-slate-600 pl-6">
            <label htmlFor="price-limit">{t('stayCharge.limit')}</label>
            {intInput('room_discount_limit_percent', 'price-limit', 0, 100)}
            <span>%</span>
          </div>
        )}
        <p className="text-[11px] text-slate-400">{t('stayCharge.reasonAlways')}</p>
      </div>
    </div>
  )
}
