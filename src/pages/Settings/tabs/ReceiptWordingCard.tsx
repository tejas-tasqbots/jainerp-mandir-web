import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Search } from 'lucide-react'
import {
  labelPlaceholders, LOCKED_LABELS, MAX_LABEL_LEN, OVERRIDABLE_LABELS, receiptLabels,
  type LabelOverrides, type ReceiptLabels,
} from '../../../lib/receiptLabels'

/**
 * "Every word on the receipt should be ours."
 *
 * A client asked for it in the plainest possible terms: "for Dan word they need
 * 'bhet'". The trust's vocabulary is not our vocabulary, and it varies by
 * sampraday and by region — one trust's Donation Amount is another's Bhet Rashi.
 *
 * ── WHY THIS IS NOT PART OF THE DESIGNER ────────────────────────────────────
 * The obvious place is the custom-design editor, which already lets a trust set
 * a title and one line of its own. But that only helps a trust that designs its
 * own receipt, and only for two strings. Every one of the shipped designs reads
 * every word it prints through ONE table (`receiptLabels.ts`), so an override
 * there changes the word on all of them, on both copies, on the WhatsApp PDF and
 * in the devotee app — and needs no approval, because renaming a heading is not
 * a layout.
 *
 * ── WHY IT IS NOT 105 INPUT BOXES ───────────────────────────────────────────
 * There are 105 labels and the client's complaint was that the screen is already
 * "too much messy". So: the dozen a trust actually renames are shown first, by
 * name, and the rest are behind one search box. Nothing is hidden — everything
 * is reachable — but nothing is in the way either. A renamed label shows its
 * original underneath, because six months later "why does this say Bhet" is the
 * question, and the answer has to be on the same screen.
 */

/**
 * The labels worth putting in front of someone, in the order they appear on a
 * receipt. Chosen from what a trust actually asks to change: the words for the
 * gift, the giver, the money, and the sign-off. Everything else is one search
 * away.
 */
const COMMON: readonly (keyof ReceiptLabels)[] = [
  'donationReceipt', 'receivedFrom', 'receivedWithThanks', 'donationAmount',
  'amount', 'amountInWords', 'category', 'purposeOfDonation', 'donorName',
  'paymentMode', 'receiptNo', 'date', 'thankYou', 'authorisedSignatory',
  'forTrust', 'eligible80g', 'donorCopy', 'officeCopy',
]

const LANGS = ['en', 'hi', 'mr', 'gu', 'kn', 'ta', 'te'] as const

export function ReceiptWordingCard({
  value, onChange, lang, onLangChange,
}: {
  value: LabelOverrides
  onChange: (next: LabelOverrides) => void
  /** Shared with the preview, so a Hindi rename is previewed in Hindi. */
  lang: string
  onLangChange: (lang: string) => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')

  const ours = useMemo(() => receiptLabels(lang), [lang])
  const shipped = useMemo(() => receiptLabels('en'), [])

  /**
   * Which labels to show: the common ones until someone searches, then whatever
   * matches — searched against BOTH our word and the trust's own, so a trust
   * that renamed "Donation Amount" to "Bhet Rashi" can find it by either.
   */
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return COMMON.filter(k => OVERRIDABLE_LABELS.includes(k))
    return OVERRIDABLE_LABELS.filter(k =>
      k.toLowerCase().includes(term)
      || String(ours[k] ?? '').toLowerCase().includes(term)
      || String(shipped[k] ?? '').toLowerCase().includes(term)
      || String(value[k]?.[lang] ?? '').toLowerCase().includes(term))
  }, [q, ours, shipped, value, lang])

  const changedCount = useMemo(
    () => OVERRIDABLE_LABELS.filter(k => (value[k]?.[lang] ?? '').trim()).length,
    [value, lang],
  )

  function set(key: keyof ReceiptLabels, text: string) {
    const next: LabelOverrides = { ...value }
    const byLang = { ...(next[key] ?? {}) }
    if (text.trim()) byLang[lang] = text
    else delete byLang[lang]
    // A key with no languages left is removed entirely, so an emptied field
    // leaves no trace in the stored map rather than an empty object that reads
    // like a setting.
    if (Object.keys(byLang).length) next[key] = byLang
    else delete next[key]
    onChange(next)
  }

  function resetAll() {
    const next: LabelOverrides = {}
    // Only THIS language is cleared. A trust that set Hindi words and then wants
    // its English back must not lose the Hindi in the process.
    for (const k of OVERRIDABLE_LABELS) {
      const byLang = { ...(value[k] ?? {}) }
      delete byLang[lang]
      if (Object.keys(byLang).length) next[k] = byLang
    }
    onChange(next)
  }

  return (
    <div className="card">
      <div className="card-header flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">{t('settings.wording.heading')}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{t('settings.wording.subheading')}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {changedCount > 0 && (
            <>
              <span className="text-[11px] font-semibold text-navy-700" data-testid="wording-count">
                {t('settings.wording.changedCount', { count: changedCount })}
              </span>
              <button
                type="button" onClick={resetAll}
                className="btn-secondary btn-sm" data-testid="wording-reset"
                title={t('settings.wording.resetAllHint')}
              ><RotateCcw size={12} /> {t('settings.wording.resetAll')}</button>
            </>
          )}
          {/* The language the words are FOR, which is also the language the
              preview renders in — a Hindi rename previewed in English would
              look like it had not applied. */}
          <select
            className="form-select w-auto text-xs" value={lang}
            onChange={e => onLangChange(e.target.value)} data-testid="wording-lang"
            aria-label={t('settings.wording.language')}
          >
            {LANGS.map(l => <option key={l} value={l}>{t(`settings.wording.lang.${l}`)}</option>)}
          </select>
        </div>
      </div>

      <div className="card-body space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="form-input pl-9" value={q} onChange={e => setQ(e.target.value)}
            placeholder={t('settings.wording.searchPlaceholder')}
            data-testid="wording-search"
            aria-label={t('settings.wording.searchPlaceholder')}
          />
        </div>
        <p className="text-[11px] text-slate-400">
          {q.trim()
            ? t('settings.wording.searchResults', { count: shown.length })
            : t('settings.wording.commonHint', { total: OVERRIDABLE_LABELS.length })}
        </p>

        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{t('settings.wording.noMatch')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map(key => {
              const mine = value[key]?.[lang] ?? ''
              // A label with a `{token}` substitutes something at print time.
              // The editor used to show the braces and say nothing about them,
              // and a trust typed its own name over "For {name}" - which would
              // have printed that person above every signature for ever.
              const tokens = labelPlaceholders(key)
              const missing = !!mine && tokens.some(tk => !mine.includes(tk))
              return (
                <li key={key} className="py-2" data-testid={`wording-${key}`}>
                  <div className="flex items-baseline gap-2">
                    {/* OUR word is the label of the field, not a placeholder
                        inside it: a placeholder disappears the moment someone
                        types, and the whole question here is "what was this
                        before". */}
                    <label className="form-label mb-0 flex-1 truncate" htmlFor={`wording-${key}`}>
                      {ours[key]}
                    </label>
                    {mine && (
                      <button
                        type="button" onClick={() => set(key, '')}
                        className="text-[11px] text-slate-400 hover:text-navy-700"
                      >{t('settings.wording.reset')}</button>
                    )}
                  </div>
                  <input
                    id={`wording-${key}`}
                    className={`form-input mt-1 ${missing ? 'border-red-400' : ''}`}
                    value={mine}
                    maxLength={MAX_LABEL_LEN}
                    placeholder={String(ours[key] ?? '')}
                    onChange={e => set(key, e.target.value)}
                    aria-invalid={missing || undefined}
                  />
                  {tokens.length > 0 && (
                    <p className={`form-hint ${missing ? 'text-red-600' : ''}`}>
                      {t('settings.wording.keepToken', { token: tokens.join(' ') })}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {/* The two sentences a trust may NOT rewrite, said out loud. Silently
            omitting them would send someone searching for a field that is not
            there; the reason is short and worth reading once. */}
        <p className="rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          {t('settings.wording.lockedNote', {
            words: LOCKED_LABELS.map(k => `"${shipped[k as keyof ReceiptLabels]}"`).join(' · '),
          })}
        </p>
      </div>
    </div>
  )
}
