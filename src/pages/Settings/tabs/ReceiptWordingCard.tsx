import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, RotateCcw, Search } from 'lucide-react'
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
 * Every printed word, grouped by where it appears on a receipt.
 *
 * The first version of this editor showed eighteen "common" labels and left the
 * other eighty behind a search box. That answered an earlier complaint that the
 * screen was too messy and created a worse one: a trust cannot search for a word
 * it does not know we call `anumodana`, so nine of the Anumodana sheet's own
 * lines - the blessing under the amount among them - were editable in principle
 * and unfindable in practice.
 *
 * Grouped by WHERE THE WORD APPEARS rather than by what it is. "The blessing and
 * the sign-off" is a place on the page; "string constants" is not. Someone
 * looking for the line under the amount looks for the part of the receipt it is
 * on, not for its key.
 *
 * `qa-document-wording.mjs` asserts every overridable key is in exactly one
 * group. A key in none would be invisible, which is the defect being fixed here.
 */
const GROUPS: { id: string; keys: readonly string[] }[] = [
  {
    id: 'gift',
    keys: ['donationReceipt', 'receivedFrom', 'receivedWithThanks', 'soldTo',
      'donorName', 'donorNamePrefix', 'donorsDetail', 'donorPan',
      'anonymous', 'anonymousDonor', 'mobile', 'generalDonation'],
  },
  {
    id: 'money',
    keys: ['amount', 'amountInr', 'donationAmount', 'amountInWords',
      'subtotal', 'total', 'amountPaid', 'balanceDue', 'advance',
      'securityDeposit', 'realizedAmount'],
  },
  {
    id: 'doc',
    keys: ['date', 'receiptNo', 'transactionId', 'status', 'received',
      'category', 'purpose', 'purposeOfDonation', 'description'],
  },
  {
    id: 'blessing',
    // The lines a trust is most likely to want in its own words, and the ones
    // that were hardest to find: `anumodana` is the blessing under the amount.
    keys: ['anumodana', 'thanks', 'thankYou', 'forTrust',
      'authorisedSignatory', 'authorised', 'signature'],
  },
  {
    id: 'payment',
    keys: ['paymentMode', 'modeOfPayment', 'mode', 'paymentDetails',
      'bankLabel', 'bank', 'accountName', 'accountNo', 'ifsc', 'upiId',
      'scanToPay', 'scanToDonate', 'receivedOn', 'reference',
      'instrumentNo', 'instrumentDate', 'paymentsReceived', 'noPaymentsRecorded'],
  },
  {
    id: 'statutory',
    // The GST tax-invoice vocabulary lives here with taxInvoice/placeOfSupply/
    // taxableValue, which it extends. Added to an EXISTING group on purpose: a
    // new group would need its own translated heading in seven languages, and
    // these words belong beside the ones already here.
    //
    // `gstDeclaration` is deliberately absent — it is in LOCKED_LABELS. A trust
    // may rename "Dan" to "Bhet"; it may not reword a declaration it is making
    // to the tax authority.
    //
    // CGST, SGST and IGST are absent because they are not labels at all:
    // statutory acronyms stay Latin in every language.
    keys: ['eligible80g', 'registrationNo', 'darpanNo', 'pan', 'panOfTrust',
      'validUpto', 'total80gEligible', 'taxInvoice', 'placeOfSupply',
      'taxableValue', 'hsnSac', 'taxRate', 'reverseCharge', 'guestGstin',
      'originalForRecipient', 'supplier', 'recipient', 'qty'],
  },
  {
    id: 'stay',
    keys: ['stayDetails', 'checkIn', 'checkOut', 'nights', 'persons', 'room',
      'guest', 'guestIdLabel', 'houseRules', 'roomBill', 'hallBill',
      'guestFolio', 'eventName'],
  },
  {
    id: 'slips',
    keys: ['bhojanshalaToken', 'prasadSlip', 'sevaReceipt', 'token', 'onePlate',
      'breakfast', 'lunch', 'dinner', 'donorCopy', 'officeCopy'],
  },
  {
    id: 'boli',
    keys: ['boliIntimation', 'pledgedAmount', 'pledgeDate', 'paidSoFar',
      'outstandingAmount'],
  },
  {
    id: 'other',
    // The catch-all, and it is deliberately LAST and deliberately named
    // honestly. `yes`/`no` really are just words; `voided` is a stamp.
    keys: ['yes', 'no', 'notProvided', 'voided'],
  },
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

  /** Which group is expanded. The first, until somebody opens another. */
  const [openGroup, setOpenGroup] = useState<string>(GROUPS[0].id)

  /**
   * Does a label match what was typed?
   *
   * Searched against our word AND the trust's own, so a trust that renamed
   * "Donation Amount" to "Bhet Rashi" can find it by either — six months later
   * "where did I change this" is asked with the NEW word in mind.
   */
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return null
    return (k: keyof ReceiptLabels) =>
      k.toLowerCase().includes(term)
      || String(ours[k] ?? '').toLowerCase().includes(term)
      || String(shipped[k] ?? '').toLowerCase().includes(term)
      || String(value[k]?.[lang] ?? '').toLowerCase().includes(term)
  }, [q, ours, shipped, value, lang])

  /**
   * The groups to render, and which keys in each.
   *
   * A search flattens the grouping — cutting across all nine is the point of a
   * search — and an empty group is dropped rather than rendered empty.
   */
  const groups = useMemo(() => {
    const editable = new Set<string>(OVERRIDABLE_LABELS as readonly string[])
    return GROUPS
      .map(g => ({
        id: g.id,
        keys: (g.keys as readonly (keyof ReceiptLabels)[])
          .filter(k => editable.has(k as string))
          .filter(k => !matches || matches(k)),
      }))
      .filter(g => g.keys.length > 0)
  }, [matches])

  const shownCount = useMemo(
    () => groups.reduce((n, g) => n + g.keys.length, 0),
    [groups],
  )

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
            ? t('settings.wording.searchResults', { count: shownCount })
            : t('settings.wording.allHint', { total: OVERRIDABLE_LABELS.length })}
        </p>

        {shownCount === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{t('settings.wording.noMatch')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {groups.map(group => {
              // A search flattens the grouping: cutting across all nine is the
              // point of searching, so every matching group is open.
              const expanded = !!q.trim() || openGroup === group.id
              const changed = group.keys.filter(k => (value[k]?.[lang] ?? '').trim()).length
              return (
                <div key={group.id} data-testid={`wording-group-${group.id}`}>
                  <button
                    type="button"
                    onClick={() => setOpenGroup(expanded && !q.trim() ? '' : group.id)}
                    className="flex w-full items-center gap-2 py-2 text-left"
                    aria-expanded={expanded}
                  >
                    <ChevronRight
                      size={14}
                      className={`flex-shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
                    />
                    <span className="text-sm font-medium text-slate-800">
                      {t(`settings.wording.group.${group.id}`)}
                    </span>
                    <span className="text-[11px] text-slate-400">{group.keys.length}</span>
                    {/* How many of THIS group the trust has renamed, so a
                        collapsed group still says whether anything is in it. */}
                    {changed > 0 && (
                      <span className="rounded-full bg-navy-50 px-1.5 text-[10px] font-bold text-navy-700">
                        {changed}
                      </span>
                    )}
                  </button>
                  {expanded && (
                    <ul className="pb-2 pl-6 divide-y divide-slate-50">
                      {group.keys.map(key => (
                        <WordingField
                          key={key}
                          labelKey={key}
                          ours={String(ours[key] ?? '')}
                          mine={value[key]?.[lang] ?? ''}
                          onChange={text => set(key, text)}
                          t={t}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
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

/**
 * One label: our word as the field's label, the trust's word in the box.
 *
 * OUR word is the LABEL and not a placeholder inside the input. A placeholder
 * disappears the moment somebody types, and the whole question six months later
 * is "what did this used to say" — which has to be answerable while the new
 * wording is on screen.
 */
function WordingField({ labelKey, ours, mine, onChange, t }: {
  labelKey: keyof ReceiptLabels
  ours: string
  mine: string
  onChange: (text: string) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  // A label with a `{token}` substitutes something at print time. The editor
  // used to show the braces and say nothing about them, and a trust typed its
  // own name over "For {name}" — which would have printed that person above
  // every signature for ever.
  const tokens = labelPlaceholders(labelKey)
  const missing = !!mine && tokens.some(tk => !mine.includes(tk))
  // A sentence needs a textarea. `anumodana` is 120 characters and `valid80g`
  // longer; both were single-line inputs showing about a fifth of themselves.
  const long = ours.length > 60

  return (
    <li className="py-2" data-testid={`wording-${labelKey}`}>
      <div className="flex items-baseline gap-2">
        <label className="form-label mb-0 flex-1" htmlFor={`wording-${labelKey}`}>
          {ours}
        </label>
        {mine && (
          <button
            type="button" onClick={() => onChange('')}
            className="flex-shrink-0 text-[11px] text-slate-400 hover:text-navy-700"
          >{t('settings.wording.reset')}</button>
        )}
      </div>
      {long ? (
        <textarea
          id={`wording-${labelKey}`}
          className={`form-input mt-1 ${missing ? 'border-red-400' : ''}`}
          rows={2} value={mine} maxLength={MAX_LABEL_LEN}
          placeholder={ours}
          onChange={e => onChange(e.target.value)}
          aria-invalid={missing || undefined}
        />
      ) : (
        <input
          id={`wording-${labelKey}`}
          className={`form-input mt-1 ${missing ? 'border-red-400' : ''}`}
          value={mine} maxLength={MAX_LABEL_LEN}
          placeholder={ours}
          onChange={e => onChange(e.target.value)}
          aria-invalid={missing || undefined}
        />
      )}
      {tokens.length > 0 && (
        <p className={`form-hint ${missing ? 'text-red-600' : ''}`}>
          {t('settings.wording.keepToken', { token: tokens.join(' ') })}
        </p>
      )}
    </li>
  )
}
