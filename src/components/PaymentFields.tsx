import { useTranslation } from 'react-i18next'
import { autoSelectAccount, useAccounts, usePaymentModes } from '../lib/useDropdownOptions'
import { paymentModeOptionLabel } from '../lib/paymentModeLabel'

/**
 * One payment, one mode: the mode, the account it moves through, and the UTR
 * / transaction / cheque number for anything that is not cash.
 *
 * For money that is paid in ONE go — a salary, an advance, a refund. A bill a
 * customer may split across cash and UPI uses PaymentSplitInput instead.
 *
 * Two mistakes it exists to stop: the advance form had no mode at all, so an
 * advance paid by bank transfer was recorded as cash; and no payment-out form
 * asked for the UTR, so a bank payment could not be traced to the statement.
 */
export interface PaymentFieldsValue {
  payment_mode: string
  payment_account_id: string
  reference_no: string
}

export const emptyPayment = (mode = 'cash'): PaymentFieldsValue => ({ payment_mode: mode, payment_account_id: '', reference_no: '' })

/** True when this mode needs a UTR / cheque number before it can be saved. */
export function needsReference(modes: { code: string; requires_reference?: boolean }[], code: string): boolean {
  return modes.find(m => m.code === code)?.requires_reference ?? code !== 'cash'
}

export function PaymentFields({ value, onChange, idPrefix, disabled, direction = 'in' }: {
  value: PaymentFieldsValue
  onChange: (v: PaymentFieldsValue) => void
  idPrefix: string
  disabled?: boolean
  /** 'out' for money the trust pays (salary, advance, refund): the account is where it is paid FROM. */
  direction?: 'in' | 'out'
}) {
  const { t } = useTranslation()
  const modes = usePaymentModes()
  const accounts = useAccounts()
  const want = value.payment_mode === 'cash' ? 'cash' : 'bank'
  const matching = accounts.filter(a => a.type === want)
  const list = matching.length ? matching : accounts
  const refNeeded = needsReference(modes, value.payment_mode)

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <label className="form-label" htmlFor={`${idPrefix}-mode`}>{t('donations.paymentMode')}</label>
        <select
          id={`${idPrefix}-mode`} className="form-select" value={value.payment_mode} disabled={disabled}
          onChange={e => onChange({
            payment_mode: e.target.value,
            payment_account_id: autoSelectAccount(accounts, e.target.value),
            reference_no: '',
          })}
        >
          {modes.filter(m => m.code !== 'credit').map(m => <option key={m.code} value={m.code}>{paymentModeOptionLabel(t, m)}</option>)}
        </select>
      </div>
      <div>
        <label className="form-label" htmlFor={`${idPrefix}-acct`}>{direction === 'out' ? t('payroll.paidFrom') : t('ui.splitColAccount')}</label>
        <select
          id={`${idPrefix}-acct`} className="form-select" value={value.payment_account_id} disabled={disabled}
          onChange={e => onChange({ ...value, payment_account_id: e.target.value })}
        >
          <option value="">{t('ui.defaultAccount')}</option>
          {list.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <label className="form-label" htmlFor={`${idPrefix}-ref`}>
          {t('ui.utrChequeNo')}{refNeeded && <span className="text-red-600"> *</span>}
        </label>
        <input
          id={`${idPrefix}-ref`} className="form-input" value={value.reference_no} disabled={disabled || !refNeeded}
          placeholder={refNeeded ? t('ui.utrChequeNo') as string : '—'}
          onChange={e => onChange({ ...value, reference_no: e.target.value })}
        />
      </div>
    </div>
  )
}
