import { useMemo } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { usePaymentModes, useAccounts } from '../lib/useDropdownOptions'

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
  const paymentModes = usePaymentModes()
  const accounts = useAccounts()

  const entered = useMemo(() => sumPaise(rows), [rows])
  const due = Math.max(0, totalPaise - paidPaise)
  const remaining = due - entered

  function update(i: number, patch: Partial<PaymentRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() {
    onChange([...rows, emptyPaymentRow()])
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

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap sm:flex-nowrap gap-2 items-start">
          <select
            className="form-input w-full sm:w-32 flex-shrink-0"
            value={r.payment_mode}
            disabled={disabled}
            onChange={e => update(i, { payment_mode: e.target.value, payment_account_id: '' })}
            aria-label={`Payment mode ${i + 1}`}
          >
            {paymentModes.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
          </select>

          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            className="form-input w-28 flex-1 sm:flex-none text-right"
            placeholder="0.00"
            value={r.amount}
            disabled={disabled}
            onChange={e => update(i, { amount: e.target.value })}
            aria-label={`Amount ${i + 1}`}
          />

          {modeNeedsRef(r.payment_mode) && (
            <input
              type="text"
              className="form-input flex-1 min-w-0"
              placeholder="UTR / cheque no."
              value={r.reference_no ?? ''}
              disabled={disabled}
              onChange={e => update(i, { reference_no: e.target.value })}
              aria-label={`Reference ${i + 1}`}
            />
          )}

          {/* Only accounts that can actually receive this tender: cash modes
              credit a cash account, everything else a bank account. Offering
              a bank account for a cash payment was simply wrong. */}
          {accountsFor(r.payment_mode).length > 0 && (
            <select
              className="form-input w-full sm:w-36 flex-shrink-0"
              value={r.payment_account_id ?? ''}
              disabled={disabled}
              onChange={e => update(i, { payment_account_id: e.target.value })}
              aria-label={`Account ${i + 1}`}
            >
              <option value="">Default account</option>
              {accountsFor(r.payment_mode).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}

          <button
            type="button" onClick={() => removeRow(i)} disabled={disabled}
            className="p-2 text-slate-400 hover:text-red-500 rounded flex-shrink-0"
            title="Remove this payment" aria-label={`Remove payment ${i + 1}`}
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
          <Plus size={14} /> Add payment mode
        </button>

        {totalPaise > 0 && (
          <span className={`text-sm font-medium ${
            remaining > 0 ? 'text-amber-600' : remaining < 0 ? 'text-red-600' : 'text-green-600'
          }`}>
            {remaining > 0
              ? `Balance ₹${(remaining / 100).toLocaleString('en-IN')}`
              : remaining < 0
                ? `Over by ₹${(-remaining / 100).toLocaleString('en-IN')}`
                : 'Fully settled'}
          </span>
        )}
      </div>
    </div>
  )
}
