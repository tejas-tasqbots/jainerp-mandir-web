import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/* Darshan timings, picked rather than typed.

   The field is one free-text string and devotees read it verbatim, so it
   arrived as "5:30-11:30", "5.30 am to 11.30 am", "morning 6-11 evening 4-9" —
   every trust inventing a format, and no way for the devotee app to say whether
   a mandir is open right now.

   Most mandirs close in the middle of the day, so two sessions is the normal
   shape, not the exception; some stay open straight through, and a few never
   close. Those are the three modes here. The value is still stored in the same
   `darshan_timings` column as a readable string — no migration, and the devotee
   app keeps rendering exactly what it always did.

   Anything already saved that does not parse is kept as-is under "Custom", so
   turning this on never silently rewrites a trust's existing wording. */

export type TimingsMode = 'allday' | 'single' | 'split' | 'custom'

export interface ParsedTimings {
  mode: TimingsMode
  morningFrom: string
  morningTo: string
  eveningFrom: string
  eveningTo: string
  raw: string
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** "5:30" / "05:30" / "5.30" → "05:30"; anything else → ''. */
function norm(t: string): string {
  const s = t.trim().replace('.', ':')
  const m = HHMM.exec(s)
  if (!m) return ''
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/** 24h "17:30" → "5:30 PM", which is how the timing reads on a public page. */
export function to12h(t: string): string {
  const m = HHMM.exec(t)
  if (!m) return t
  const h = Number(m[1])
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m[2]} ${suffix}`
}

export function formatTimings(p: ParsedTimings): string {
  if (p.mode === 'allday') return 'Open 24 hours'
  if (p.mode === 'custom') return p.raw
  const a = p.morningFrom && p.morningTo ? `${to12h(p.morningFrom)} – ${to12h(p.morningTo)}` : ''
  if (p.mode === 'single') return a
  const b = p.eveningFrom && p.eveningTo ? `${to12h(p.eveningFrom)} – ${to12h(p.eveningTo)}` : ''
  return [a, b].filter(Boolean).join(', ')
}

/**
 * Reads an existing value back into the editor.
 *
 * Deliberately conservative: it recognises what this editor writes and the
 * plain `H:MM-H:MM` shapes trusts typed by hand, and calls everything else
 * custom rather than guessing and losing meaning.
 */
export function parseTimings(value: string): ParsedTimings {
  const empty: ParsedTimings = {
    mode: 'split', morningFrom: '', morningTo: '', eveningFrom: '', eveningTo: '', raw: value,
  }
  const v = (value ?? '').trim()
  if (!v) return empty
  if (/^open\s*24|24\s*hours?|all\s*day$/i.test(v)) return { ...empty, mode: 'allday' }

  // Pull out every H:MM (or H.MM), with an optional am/pm that decides the hour.
  const times: string[] = []
  const rx = /(\d{1,2})[:.](\d{2})\s*(am|pm)?/gi
  let m: RegExpExecArray | null
  while ((m = rx.exec(v))) {
    let h = Number(m[1])
    const ap = m[3]?.toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    const t = norm(`${h}:${m[2]}`)
    if (t) times.push(t)
  }
  if (times.length === 4) {
    return { ...empty, mode: 'split', morningFrom: times[0], morningTo: times[1], eveningFrom: times[2], eveningTo: times[3] }
  }
  if (times.length === 2) {
    return { ...empty, mode: 'single', morningFrom: times[0], morningTo: times[1] }
  }
  return { ...empty, mode: 'custom' }
}

/* Declared at module scope on purpose. Nested inside the parent it would be a
   NEW component type on every render, so React unmounted and remounted the
   inputs after each change — the field lost focus mid-entry and a second time
   could not be typed at all. */
function TimeBox({ v, onSet, aria }: { v: string; onSet: (s: string) => void; aria: string }) {
  return (
    <input
      type="time"
      className="form-input"
      value={v}
      aria-label={aria}
      onChange={e => onSet(e.target.value)}
    />
  )
}

export function DarshanTimings({
  value, onChange, label, hint,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  hint?: string
}) {
  const { t } = useTranslation()
  const [p, setP] = useState<ParsedTimings>(() => parseTimings(value))

  // Re-read only when the incoming value is something this editor did not just
  // write — otherwise every keystroke would round-trip and fight the inputs.
  useEffect(() => {
    if (formatTimings(p) !== (value ?? '').trim()) setP(parseTimings(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function apply(next: Partial<ParsedTimings>) {
    const merged = { ...p, ...next }
    setP(merged)
    onChange(formatTimings(merged))
  }

  const modes: { key: TimingsMode; label: string }[] = useMemo(() => [
    { key: 'split', label: t('timings.split', 'Morning & evening') },
    { key: 'single', label: t('timings.single', 'One session') },
    { key: 'allday', label: t('timings.allday', 'Open all day') },
  ], [t])

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">{label}</label>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {modes.map(m => (
          <button
            key={m.key}
            type="button"
            aria-pressed={p.mode === m.key}
            onClick={() => apply({ mode: m.key })}
            className={`px-2.5 py-1 rounded-full text-[13px] border transition-colors ${
              p.mode === m.key
                ? 'border-brand-red bg-red-50 text-brand-red font-semibold'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {p.mode === 'custom' && (
        <>
          <input className="form-input w-full" value={p.raw}
            onChange={e => { setP({ ...p, raw: e.target.value }); onChange(e.target.value) }} />
          <p className="mt-1 text-xs text-amber-700">
            {t('timings.customNote', 'Kept as you wrote it. Pick a mode above to use times instead.')}
          </p>
        </>
      )}

      {p.mode === 'allday' && (
        <p className="text-xs text-slate-500">{t('timings.alldayNote', 'Shown to devotees as “Open 24 hours”.')}</p>
      )}

      {(p.mode === 'single' || p.mode === 'split') && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {p.mode === 'split' && (
              <span className="text-xs text-slate-500 w-16 shrink-0">{t('timings.morning', 'Morning')}</span>
            )}
            <TimeBox v={p.morningFrom} onSet={s => apply({ morningFrom: s })} aria={t('timings.from', 'From')} />
            <span className="text-slate-400 text-sm">–</span>
            <TimeBox v={p.morningTo} onSet={s => apply({ morningTo: s })} aria={t('timings.to', 'To')} />
          </div>
          {p.mode === 'split' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-16 shrink-0">{t('timings.evening', 'Evening')}</span>
              <TimeBox v={p.eveningFrom} onSet={s => apply({ eveningFrom: s })} aria={t('timings.from', 'From')} />
              <span className="text-slate-400 text-sm">–</span>
              <TimeBox v={p.eveningTo} onSet={s => apply({ eveningTo: s })} aria={t('timings.to', 'To')} />
            </div>
          )}
        </div>
      )}

      <p className="mt-1.5 text-xs text-slate-400">
        {formatTimings(p)
          ? t('timings.preview', 'Devotees see: {{v}}', { v: formatTimings(p) })
          : hint}
      </p>
    </div>
  )
}
