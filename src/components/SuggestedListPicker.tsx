import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus } from 'lucide-react'

/* Pick from the names most trusts use, then add anything they call their own.

   Donation categories and expense heads are largely the same list from one
   mandir to the next, and typing them as free comma-separated text produced
   near-duplicates that then had to be reconciled in the ledger — "Pooja
   Samagri" beside "Puja Samagri", "Staff Salary" beside "Salaries". Offering
   the common ones as one-tap chips makes the shared spelling the easy path,
   and the free-text box stays for everything genuinely local.

   Names the trust ALREADY has are shown greyed and un-tappable rather than
   hidden: the admin can see the list is not empty, and cannot re-add a name
   the API would only reject or duplicate. */

export interface SuggestedListPickerProps {
  label: string
  /** Common names offered as chips. */
  suggestions: readonly string[]
  /** Names the trust already has — shown as present, never selectable. */
  existing?: readonly string[]
  /** Selected chips plus anything typed, as the comma-separated string the caller posts. */
  value: string
  onChange: (csv: string) => void
  hint?: string
}

const splitCsv = (s: string) => s.split(',').map(v => v.trim()).filter(Boolean)
const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function SuggestedListPicker({
  label, suggestions, existing = [], value, onChange, hint,
}: SuggestedListPickerProps) {
  const { t } = useTranslation()
  const [other, setOther] = useState('')

  const picked = useMemo(() => splitCsv(value), [value])
  const has = (name: string) => picked.some(p => eq(p, name))
  const already = (name: string) => existing.some(e => eq(e, name))

  function toggle(name: string) {
    if (already(name)) return
    const next = has(name) ? picked.filter(p => !eq(p, name)) : [...picked, name]
    onChange(next.join(', '))
  }

  /** Everything typed that is not one of the offered chips — the "Other" tail. */
  const custom = picked.filter(p => !suggestions.some(s => eq(s, p)))

  function addOther() {
    const names = splitCsv(other).filter(n => !has(n) && !already(n))
    if (!names.length) { setOther(''); return }
    onChange([...picked, ...names].join(', '))
    setOther('')
  }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">{label}</label>

      <div className="flex flex-wrap gap-1.5">
        {suggestions.map(name => {
          const isThere = already(name)
          const on = has(name)
          return (
            <button
              key={name}
              type="button"
              onClick={() => toggle(name)}
              disabled={isThere}
              aria-pressed={on}
              title={isThere ? t('setupWizard.categories.alreadyAdded', 'Already added') : undefined}
              className={`px-2.5 py-1 rounded-full text-[13px] border transition-colors inline-flex items-center gap-1 ${
                isThere
                  ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-default'
                  : on
                    ? 'border-brand-red bg-red-50 text-brand-red font-semibold'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {(on || isThere) && <Check size={12} aria-hidden />}
              {name}
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className="form-input w-full"
          placeholder={t('setupWizard.categories.otherPlaceholder', 'Something else? Type it and press Add')}
          value={other}
          onChange={e => setOther(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); addOther() }
          }}
        />
        <button type="button" onClick={addOther} disabled={!other.trim()}
          className="btn-secondary btn-sm whitespace-nowrap disabled:opacity-50 inline-flex items-center gap-1">
          <Plus size={13} aria-hidden /> {t('common.add', 'Add')}
        </button>
      </div>

      {custom.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {custom.map(name => (
            <button key={name} type="button" onClick={() => toggle(name)}
              className="px-2.5 py-1 rounded-full text-[13px] border border-brand-red bg-red-50 text-brand-red font-semibold inline-flex items-center gap-1">
              <Check size={12} aria-hidden /> {name}
            </button>
          ))}
        </div>
      )}

      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

/** The names a Jain trust most often uses. Matches `tenant-seed.sql` exactly
 *  where they overlap, so a chip never creates a near-duplicate of a seeded row. */
export const COMMON_DONATION_CATEGORIES = [
  'General', 'Annadaan', 'Jal Seva', 'Deepak Seva', 'Renovation', 'Bhojanshala',
  'Path/Pravachan', 'Pratishtha Mahotsav', 'Paryushana', 'Corpus Donation',
  'Building Fund', 'Gaushala / Cow Seva', 'Abhishek', 'Aarti', 'Boli / Bidding',
  'Sadharan', 'Puja', 'Swadhyay',
] as const

export const COMMON_EXPENSE_HEADS = [
  'Electricity', 'Water', 'Maintenance', 'Prasad Purchase', 'Pooja Samagri',
  'Staff Salary', 'Events', 'Printing', 'Security', 'Horticulture', 'Repair',
  'Miscellaneous', 'Bhojanshala', 'Gaushala Feed', 'Travel', 'Bank Charges',
  'Insurance',
] as const
