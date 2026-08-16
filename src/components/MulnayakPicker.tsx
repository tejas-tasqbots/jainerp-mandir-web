import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/* Mulnayak — the presiding Tirthankar — picked from the twenty-four.

   It was free text, so the same Bhagwan arrived spelled a dozen ways
   ("Parshwanath", "Parshvanatha", "1008 Shri Parasnath") and the devotee app
   could not group temples by their mulnayak or answer "Adinath temples near
   me". There are exactly twenty-four Tirthankars and the list has not changed
   in a very long time, so it belongs in a dropdown.

   Two things it must not do:

   - It must not force a Tirthankar on a temple that has none. A trust may be
     registered here as Hindu, Sikh or Buddhist, and some Jain temples name a
     Siddha or a shrine rather than a Tirthankar. "Other" keeps free text.
   - It must not rewrite what a trust already saved. A stored value that is not
     one of the twenty-four selects Other and is kept exactly as written. */

export interface Tirthankar {
  /** Stored value — the short name a temple actually uses. */
  name: string
  /** Position in the sequence, shown so the list reads in the canonical order. */
  n: number
  /** Names the same Bhagwan is also known by, for matching what is on file. */
  aka?: string[]
}

/** The twenty-four, in order. `aka` carries the Digambar/Shwetambar and
 *  Sanskrit variants so an existing value still matches its own entry. */
export const TIRTHANKARS: Tirthankar[] = [
  { n: 1, name: 'Adinath', aka: ['Rishabhanatha', 'Rishabhdev', 'Rushabhdev', 'Adeshwar'] },
  { n: 2, name: 'Ajitnath', aka: ['Ajitanatha'] },
  { n: 3, name: 'Sambhavnath', aka: ['Sambhavanatha'] },
  { n: 4, name: 'Abhinandannath', aka: ['Abhinandananatha'] },
  { n: 5, name: 'Sumatinath', aka: ['Sumatinatha'] },
  { n: 6, name: 'Padmaprabh', aka: ['Padmaprabha'] },
  { n: 7, name: 'Suparshvanath', aka: ['Suparshvanatha'] },
  { n: 8, name: 'Chandraprabh', aka: ['Chandraprabha'] },
  { n: 9, name: 'Suvidhinath', aka: ['Pushpadanta', 'Pushpadant'] },
  { n: 10, name: 'Shitalnath', aka: ['Shitalanatha'] },
  { n: 11, name: 'Shreyansnath', aka: ['Shreyanasanatha'] },
  { n: 12, name: 'Vasupujya', aka: ['Vasupujya Swami'] },
  { n: 13, name: 'Vimalnath', aka: ['Vimalanatha'] },
  { n: 14, name: 'Anantnath', aka: ['Anantanatha'] },
  { n: 15, name: 'Dharmanath', aka: ['Dharmanatha'] },
  { n: 16, name: 'Shantinath', aka: ['Shantinatha'] },
  { n: 17, name: 'Kunthunath', aka: ['Kunthunatha'] },
  { n: 18, name: 'Arnath', aka: ['Aranatha', 'Aranath'] },
  { n: 19, name: 'Mallinath', aka: ['Mallinatha'] },
  { n: 20, name: 'Munisuvrat', aka: ['Munisuvrata', 'Munisuvratnath'] },
  { n: 21, name: 'Naminath', aka: ['Naminatha'] },
  { n: 22, name: 'Neminath', aka: ['Neminatha', 'Arishtanemi'] },
  { n: 23, name: 'Parshvanath', aka: ['Parshwanath', 'Parasnath', 'Parshvanatha'] },
  { n: 24, name: 'Mahavir', aka: ['Mahavira', 'Vardhaman', 'Vardhamana', 'Mahavir Swami'] },
]

const OTHER = '__other__'
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

/**
 * Which entry a stored value belongs to, or null when it is something else.
 *
 * Matches on containment, not equality, because temples store the honorific
 * with the name — "Bhagwan Adinath", "Shri 1008 Parshwanath". Longest name
 * first so "Adinath" cannot win against a value that also contains a longer
 * name.
 */
export function matchTirthankar(value: string): Tirthankar | null {
  const v = norm(value ?? '')
  if (!v) return null
  const keys = TIRTHANKARS.flatMap(t =>
    [t.name, ...(t.aka ?? [])].map(k => ({ t, key: norm(k) })),
  )
  // Longest first: "Parshvanath" must win over nothing, and "Munisuvratnath"
  // must not be decided by a shorter name that happens to sit inside it.
  keys.sort((a, b) => b.key.length - a.key.length)
  return keys.find(k => k.key && v.includes(k.key))?.t ?? null
}

/** Registered types that are definitely not Jain, so the Tirthankars do not apply. */
const NON_JAIN = new Set(['hindu', 'sikh', 'buddhist', 'gurudwara', 'church'])

export function MulnayakPicker({
  value, onChange, label, templeType,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  /** The trust's registered type. Anything not clearly non-Jain gets the list. */
  templeType?: string | null
}) {
  const { t } = useTranslation()
  /* Fails OPEN, deliberately. An earlier version asked `templeType === 'jain'`,
     so a value that was merely cased differently, padded, or absent from the
     payload silently dropped a Jain temple back to a free-text box — the very
     thing this replaced, and invisible unless you knew to look. This is
     JainERP: show the twenty-four unless the trust is registered as something
     that plainly has none. "Other" covers the rest either way. */
  const jain = !NON_JAIN.has(String(templeType ?? '').trim().toLowerCase())
  const matched = matchTirthankar(value)
  const [other, setOther] = useState(!!value && !matched)

  // A value arriving from the server after first paint decides the mode once.
  useEffect(() => {
    if (value && !matchTirthankar(value)) setOther(true)
  }, [value])

  if (!jain) {
    return (
      <div>
        <label className="form-label">{label}</label>
        <input className="form-input" value={value} onChange={e => onChange(e.target.value)} />
      </div>
    )
  }

  return (
    <div>
      <label className="form-label">{label}</label>
      <select
        className="form-input"
        value={other ? OTHER : (matched?.name ?? '')}
        onChange={e => {
          const v = e.target.value
          if (v === OTHER) { setOther(true); onChange('') } else { setOther(false); onChange(v) }
        }}
      >
        <option value="">{t('mulnayak.choose', 'Select the mulnayak…')}</option>
        {TIRTHANKARS.map(x => (
          <option key={x.n} value={x.name}>
            {x.n}. {x.name}{x.aka?.length ? ` (${x.aka[0]})` : ''}
          </option>
        ))}
        <option value={OTHER}>{t('mulnayak.other', 'Other / not a Tirthankar')}</option>
      </select>

      {other && (
        <input
          className="form-input mt-2"
          value={value}
          placeholder={t('mulnayak.otherPlaceholder', 'Name the presiding deity')}
          onChange={e => onChange(e.target.value)}
        />
      )}

      {/* What is on file said the same thing in different words — say so rather
          than silently swapping it for the canonical spelling. */}
      {!other && matched && value && norm(value) !== norm(matched.name) && (
        <p className="mt-1 text-xs text-slate-400">
          {t('mulnayak.matched', 'On file as “{{v}}” — saving stores {{n}}.', { v: value, n: matched.name })}
        </p>
      )}
    </div>
  )
}
