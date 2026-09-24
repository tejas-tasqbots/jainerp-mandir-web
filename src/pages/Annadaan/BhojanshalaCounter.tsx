import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Plus, Printer, RefreshCw, ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, apiErrorMessage, fmtPaise } from '../../lib/api'
import { PhoneInput } from '../../components/PhoneInput'
import { autoPrintSlip } from '../../lib/printReceipt'
import { useToast } from '../../components/kit/Toast'

export const SESSIONS = ['breakfast', 'lunch', 'dinner'] as const
export type Session = (typeof SESSIONS)[number]

/** Rate per plate, in paise, for each sitting. 0 means the trust has not set one. */
export type SessionRates = Record<Session, number>

const STORE_KEY = 'jainerp_bhojanshala_session'

/**
 * Which sitting is open right now.
 *
 * The counter should already be on the right session when a clerk opens it at
 * 11am — being wrong by one tap is fine, being wrong silently is not, which is
 * why the tabs stay visible and the choice is remembered once made.
 */
export function sessionForHour(hour: number): Session {
  if (hour < 11) return 'breakfast'
  if (hour < 17) return 'lunch'
  return 'dinner'
}

export function initialSession(): Session {
  try {
    const saved = localStorage.getItem(STORE_KEY)
    if (saved && (SESSIONS as readonly string[]).includes(saved)) return saved as Session
  } catch { /* private window, or storage blocked */ }
  return sessionForHour(new Date().getHours())
}

/**
 * The bhojanshala counter: quantity, and a print button.
 *
 * ── WHY THIS IS NOT A FORM ──────────────────────────────────────────────────
 * There is a queue. The only thing that changes between one person and the
 * next is HOW MANY PLATES. The session changes three times a day; the rate
 * belongs to the trust and is set once in Settings; the name and mobile are
 * not given by most people buying a thali. Asking for all of it per sale is
 * what made the old screen slow — six fields for a transaction whose content
 * is "four plates, cash".
 *
 * So: big − / + either side of the count, payment as two visible buttons
 * (a window takes cash and UPI and nothing else), and everything optional
 * folded behind "Add details". Enter prints. After a sale the count returns to
 * 1 and focus returns to the count, so the next person is one keystroke away.
 *
 * The rate is shown but not editable. It is enforced server-side too — a price
 * the UI calls fixed and the API takes from the client is not fixed at all.
 */
export function BhojanshalaCounter({
  rates, session, onSession, date, onSold,
}: {
  rates: SessionRates
  session: Session
  onSession: (s: Session) => void
  /** The day being recorded — the page's date filter, so a backdated sale works. */
  date: string
  onSold: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [qty, setQty] = useState(1)
  const [mode, setMode] = useState<'cash' | 'upi'>('cash')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [reference, setReference] = useState('')
  const qtyRef = useRef<HTMLInputElement>(null)

  const rate = rates[session] ?? 0
  const total = rate * qty

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, session) } catch { /* ignore */ }
  }, [session])

  async function sell() {
    if (qty < 1 || saving) return
    setSaving(true)
    try {
      const { data } = await api.post('/bhojanshala/sales', {
        meal_type: session,
        tokens: qty,
        // Sent for a trust that has not set a rate yet; the server prefers its
        // own configured rate whenever there is one.
        rate_paise: rate,
        payment_mode: mode,
        reference_no: reference.trim() || undefined,
        buyer_name: name.trim() || undefined,
        devotee_mobile: mobile || undefined,
        sale_date: date,
      })
      // Never awaited and never fatal: the tokens are sold either way, and a
      // printer that is out of paper must not read as a failed sale.
      if (data?.data?.id) void autoPrintSlip(data.data.id, '/bhojanshala/sales', data.data.receipt)

      // Back to the top of the queue: only the quantity and the one-off
      // details reset. Session, payment mode and the open/closed state of the
      // details panel are how this clerk is working today.
      setQty(1)
      setName('')
      setMobile('')
      setReference('')
      qtyRef.current?.focus()
      qtyRef.current?.select()
      onSold()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  const step = (by: number) => setQty(q => Math.max(1, Math.min(999, q + by)))

  return (
    <div className="card no-print" data-testid="bhojanshala-counter">
      {/* Session — chosen once, not per sale. */}
      <div className="card-header flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden" role="tablist"
          aria-label={t('bhojanshala.session')}>
          {SESSIONS.map(s => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={session === s}
              data-testid={`session-${s}`}
              onClick={() => onSession(s)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                session === s ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t(`bhojanshala.${s}`)}
            </button>
          ))}
        </div>

        <div className="ml-auto text-sm" data-testid="counter-rate">
          {rate > 0 ? (
            <span className="text-slate-500">
              {t('bhojanshala.perPlate')} <b className="text-slate-800">₹{fmtPaise(rate)}</b>
            </span>
          ) : (
            // Without a rate every sale is worth nothing, so say so here rather
            // than letting a day's collection quietly total zero.
            <Link to="/settings?tab=masters&sub=bhojanshala" className="inline-flex items-center gap-1 text-brand-red hover:underline">
              <Settings2 size={13} /> {t('bhojanshala.noRateSet')}
            </Link>
          )}
        </div>
      </div>

      <div className="card-body">
        <div className="flex flex-wrap items-end gap-4">
          {/* Quantity — the only thing that changes between one person and the next. */}
          <div>
            <label className="form-label" htmlFor="counter-qty">{t('bhojanshala.tokens')}</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => step(-1)} disabled={qty <= 1}
                aria-label={t('bhojanshala.oneFewer')} data-testid="qty-minus"
                className="h-12 w-12 rounded-lg border border-slate-300 text-slate-700 text-xl font-bold
                           hover:bg-slate-50 disabled:opacity-40 flex items-center justify-center">
                <Minus size={20} />
              </button>
              <input
                id="counter-qty"
                ref={qtyRef}
                data-testid="qty-input"
                type="number"
                min={1}
                max={999}
                inputMode="numeric"
                value={qty}
                autoFocus
                onFocus={e => e.target.select()}
                onChange={e => setQty(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void sell() } }}
                className="form-input h-12 w-24 text-center text-2xl font-bold tabular-nums"
              />
              <button type="button" onClick={() => step(1)}
                aria-label={t('bhojanshala.oneMore')} data-testid="qty-plus"
                className="h-12 w-12 rounded-lg border border-slate-300 text-slate-700 text-xl font-bold
                           hover:bg-slate-50 flex items-center justify-center">
                <Plus size={20} />
              </button>
            </div>
          </div>

          {/* Payment — a window takes cash and UPI. Both visible, one tap. */}
          <div>
            <label className="form-label">{t('bhojanshala.paymentMode')}</label>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {(['cash', 'upi'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)} data-testid={`mode-${m}`}
                  aria-pressed={mode === m}
                  className={`h-12 px-5 text-sm font-medium transition-colors ${
                    mode === m ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}>
                  {t(`common.${m}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-[7rem]">
            <label className="form-label">{t('bhojanshala.total')}</label>
            <p className="h-12 flex items-center text-2xl font-bold text-green-700 tabular-nums"
              data-testid="counter-total">
              ₹{fmtPaise(total)}
            </p>
          </div>

          <button type="button" onClick={sell} disabled={saving || qty < 1}
            data-testid="counter-print"
            className="btn-primary h-12 px-6 text-base">
            {saving ? <RefreshCw size={18} className="animate-spin" /> : <Printer size={18} />}
            {saving ? t('common.saving') : t('bhojanshala.printTokens', { count: qty })}
          </button>
        </div>

        {/* Everything most people never give. */}
        <button type="button" onClick={() => setOpen(o => !o)} data-testid="counter-details-toggle"
          className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {open ? t('bhojanshala.hideDetails') : t('bhojanshala.addDetails')}
        </button>

        {open && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="counter-details">
            <div>
              <label className="form-label" htmlFor="counter-name">{t('bhojanshala.buyerName')}</label>
              <input id="counter-name" className="form-input" value={name}
                onChange={e => setName(e.target.value)} placeholder={t('bhojanshala.optional') as string} />
            </div>
            <div>
              <label className="form-label">{t('bhojanshala.mobileOptional')}</label>
              <PhoneInput value={mobile} onChange={setMobile} />
            </div>
            {mode !== 'cash' && (
              <div>
                <label className="form-label" htmlFor="counter-ref">{t('bhojanshala.reference')}</label>
                <input id="counter-ref" className="form-input" value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder={t('bhojanshala.referenceHint') as string} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
