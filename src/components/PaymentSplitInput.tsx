import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { usePaymentModes, useAccounts, autoSelectAccount } from '../lib/useDropdownOptions'

/**
 * Collects one or more TENDERS for a bill.
 *
 * A guest may settle ₹5,000 as ₹2,000 cash + ₹3,000 UPI, or pay only part of
 * it now. Each row here becomes a row in {s}.payments; the balance is derived
 * from their sum, never typed by hand.
 *
 * Amounts are entered in RUPEES for the cashier and emitted in PAISE — money
 * is integer paise everywhere behind the form.
 * See doc-v2/Payments_And_Billing.md.
 */

export interface PaymentRow {
  payment_mode: string
  /** Rupees as typed. Converted to paise on submit by `toPayload`. */
  amount: string
  reference_no?: string
  payment_account_id?: string
}

export function emptyPaymentRow(mode = 'cash'): PaymentRow {
  return { payment_mode: mode, amount: '', reference_no: '', payment_account_id: '' }
}

/** Rows → API `payments[]` (paise). Blank/zero rows are dropped. */
export function toPayload(rows: PaymentRow[]) {
  return rows
    .map(r => ({
      payment_mode: r.payment_mode,
      amount_paise: Math.round(Number(r.amount || 0) * 100),
      reference_no: r.reference_no?.trim() || null,
      payment_account_id: r.payment_account_id || null,
    }))
    .filter(p => p.amount_paise > 0)
}

/** Sum of the rows, in paise. */
export function sumPaise(rows: PaymentRow[]): number {
  return rows.reduce((s, r) => s + Math.round(Number(r.amount || 0) * 100), 0)
}

/**
 * The cash part of the rows, in paise. s.80G(5D) disallows a deduction for a
 * cash gift above ₹2,000 — the CASH part, not the whole receipt: ₹1,000 cash +
 * ₹9,000 UPI is fully eligible. The API decides it this way; the form has to
 * agree or it greys out a checkbox the server would have accepted.
 */
export function cashPaise(rows: PaymentRow[]): number {
  return sumPaise(rows.filter(r => r.payment_mode === 'cash'))
}

/**
 * Columns for one tender row, shared with the headings so both line up. Every
 * class is spelled out whole: Tailwind only generates classes it can read
 * literally in the source, so `sm:${...}` would silently produce nothing.
 *
 * Flexible, with floors that still fit the narrowest host — the room and hall
 * payment dialogs (max-w-lg, ~464px of content). Fixed widths there left the
 * reference box a few pixels wide.
 */
const ROW_COLS = 'sm:grid-cols-[minmax(6rem,1fr)_minmax(5.5rem,0.9fr)_minmax(6rem,1.4fr)_minmax(7rem,1.3fr)_2rem]'

interface Props {
  rows: PaymentRow[]
  onChange: (rows: PaymentRow[]) => void
  /** Bill total in paise — drives the remaining/change indicator. */
  totalPaise?: number
  /** Already collected (e.g. the advance), in paise. */
  paidPaise?: number
  disabled?: boolean
}

export function PaymentSplitInput({ rows, onChange, totalPaise = 0, paidPaise = 0, disabled }: Props) {
  const { t } = useTranslation()
  const paymentModes = usePaymentModes()
  const accounts = useAccounts()

  const entered = useMemo(() => sumPaise(rows), [rows])
  const due = Math.max(0, totalPaise - paidPaise)
  const remaining = due - entered

  function update(i: number, patch: Partial<PaymentRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  /**
   * A new row offers what is still owed, in a mode not already used — the
   * cashier adding "the rest by UPI" should only have to pick UPI.
   */
  function addRow() {
    const used = new Set(rows.map(r => r.payment_mode))
    const mode = paymentModes.find(m => !used.has(m.code))?.code ?? 'cash'
    onChange([...rows, {
      ...emptyPaymentRow(mode),
      amount: remaining > 0 ? String(remaining / 100) : '',
      payment_account_id: autoSelectAccount(accounts, mode),
    }])
  }
  function removeRow(i: number) {
    onChange(rows.length === 1 ? [emptyPaymentRow()] : rows.filter((_, idx) => idx !== i))
  }

  /** Cash tenders land in a cash account; every other mode in a bank account. */
  function accountsFor(mode: string) {
    const want = mode === 'cash' ? 'cash' : 'bank'
    const matching = accounts.filter(a => a.type === want)
    // If the trust hasn't set up that account type, fall back to all of them
    // rather than showing an empty dropdown the cashier cannot get past.
    return matching.length ? matching : accounts
  }

  const modeNeedsRef = (code: string) =>
    paymentModes.find(m => m.code === code)?.requires_reference ?? code !== 'cash'

  const inr = (paise: number) => (paise / 100).toLocaleString('en-IN')

  // Column headings, so a row reads as "UPI · 8,900 · UTR … · Bank" without
  // guessing which box is which. Hidden on phones, where the row wraps.
  return (
    <div className="space-y-2">
      <div className={`hidden sm:grid ${ROW_COLS} gap-2 text-xs font-medium text-slate-500`}>
        <span>{t('ui.splitColMode')}</span>
        <span className="text-right">{t('ui.splitColAmount')}</span>
        <span>{t('ui.splitColReference')}</span>
        <span>{t('ui.splitColAccount')}</span>
        <span />
      </div>
      {rows.map((r, i) => (
        <div key={i} className={`flex flex-wrap items-center gap-2 sm:grid ${ROW_COLS}`} data-testid="split-row">
          <select
            className="form-input w-full min-w-0"
            value={r.payment_mode}
            disabled={disabled}
            // A new mode gets that mode's own account, and its old reference
            // number goes: a UTR typed for UPI is not a cheque number.
            onChange={e => update(i, {
              payment_mode: e.target.value,
              payment_account_id: autoSelectAccount(accounts, e.target.value),
              reference_no: '',
            })}
            aria-label={`Payment mode ${i + 1}`}
          >
            {paymentModes.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
          </select>

          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            className="form-input w-full min-w-0 text-right"
            placeholder="0.00"
            value={r.amount}
            disabled={disabled}
            onChange={e => update(i, { amount: e.target.value })}
            aria-label={`Amount ${i + 1}`}
          />

          {/* Cash needs no reference, but the cell stays so the account
              column does not jump left under it. */}
          {modeNeedsRef(r.payment_mode) ? (
            <input
              type="text"
              className="form-input w-full min-w-0"
              placeholder={t('ui.utrChequeNo')}
              value={r.reference_no ?? ''}
              disabled={disabled}
              onChange={e => update(i, { reference_no: e.target.value })}
              aria-label={`Reference ${i + 1}`}
            />
          ) : (
            <span className="hidden sm:block text-xs text-slate-300 px-3">—</span>
          )}

          {/* Only accounts that can actually receive this tender: cash modes
              credit a cash account, everything else a bank account. Offering
              a bank account for a cash payment was simply wrong. */}
          {accountsFor(r.payment_mode).length > 0 ? (
            <select
              className="form-input w-full min-w-0"
              value={r.payment_account_id ?? ''}
              disabled={disabled}
              onChange={e => update(i, { payment_account_id: e.target.value })}
              aria-label={`Account ${i + 1}`}
            >
              <option value="">{t('ui.defaultAccount')}</option>
              {accountsFor(r.payment_mode).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : (
            <span className="hidden sm:block" />
          )}

          <button
            type="button" onClick={() => removeRow(i)} disabled={disabled}
            className="p-2 text-slate-400 hover:text-red-500 rounded"
            title={t('ui.removeThisPayment')} aria-label={`Remove payment ${i + 1}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between">
        <button
          type="button" onClick={addRow} disabled={disabled}
          className="inline-flex items-center gap-1 text-sm text-navy-700 hover:text-navy-900 font-medium"
        >
          <Plus size={14} />{t('ui.addPaymentMode')}</button>

        {totalPaise > 0 && (
          <span data-testid="split-status" className={`text-sm font-medium ${
            remaining > 0 ? 'text-amber-600' : remaining < 0 ? 'text-red-600' : 'text-green-600'
          }`}>
            {remaining > 0
              ? t('ui.splitBalance', { amount: inr(remaining) })
              : remaining < 0
                ? t('ui.splitOver', { amount: inr(-remaining) })
                : t('ui.splitSettled')}
          </span>
        )}
      </div>
    </div>
  )
}
