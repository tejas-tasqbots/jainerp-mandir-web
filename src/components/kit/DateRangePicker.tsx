import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, ChevronDown } from 'lucide-react'
import type { DateRange, RangePreset } from '../../lib/dateRanges'
import { makeRange } from '../../lib/dateRanges'

const PRESETS: RangePreset[] = [
  'all', 'today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisFY', 'lastFY',
]

interface Props {
  value: DateRange
  onChange: (range: DateRange) => void
  /** localStorage key — remembers the last preset per screen */
  storageKey?: string
}

export function loadStoredRange(storageKey: string, fallback: RangePreset = 'thisMonth'): DateRange {
  try {
    const stored = localStorage.getItem(`daterange:${storageKey}`) as RangePreset | null
    if (stored && stored !== 'custom' && PRESETS.includes(stored)) return makeRange(stored)
  } catch { /* storage unavailable */ }
  return makeRange(fallback)
}

export function DateRangePicker({ value, onChange, storageKey }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function pick(preset: RangePreset) {
    setOpen(false)
    if (storageKey) {
      try { localStorage.setItem(`daterange:${storageKey}`, preset) } catch { /* ignore */ }
    }
    onChange(makeRange(preset))
  }

  function setCustom(part: 'from' | 'to', v: string) {
    onChange({ preset: 'custom', from: part === 'from' ? v : value.from, to: part === 'to' ? v : value.to })
  }

  return (
    <div className="flex items-end gap-2 flex-wrap" ref={ref}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="btn-secondary btn-sm !font-semibold"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <Calendar size={13} />
          {t(`dateRange.${value.preset}`)}
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute z-30 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1" role="listbox">
            {PRESETS.map(p => (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={value.preset === p}
                onClick={() => pick(p)}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  value.preset === p
                    ? 'bg-navy-50 text-navy-900 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t(`dateRange.${p}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="form-label !text-xs !mb-0.5" htmlFor={`${storageKey ?? 'range'}-from`}>{t('dateRange.from')}</label>
        <input
          id={`${storageKey ?? 'range'}-from`}
          type="date"
          className="form-input !py-1.5 !text-xs w-36"
          value={value.from}
          onChange={e => setCustom('from', e.target.value)}
        />
      </div>
      <div>
        <label className="form-label !text-xs !mb-0.5" htmlFor={`${storageKey ?? 'range'}-to`}>{t('dateRange.to')}</label>
        <input
          id={`${storageKey ?? 'range'}-to`}
          type="date"
          className="form-input !py-1.5 !text-xs w-36"
          value={value.to}
          onChange={e => setCustom('to', e.target.value)}
        />
      </div>
    </div>
  )
}
