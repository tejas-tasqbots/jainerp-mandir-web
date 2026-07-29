import { useTranslation } from 'react-i18next'
import { PaymentSplitInput, emptyPaymentRow, type PaymentRow } from './PaymentSplitInput'

/**
 * "Split across multiple payment modes" checkbox + the tender rows it reveals.
 *
 * Opt-in on purpose: the overwhelming counter case is one mode, and forcing a
 * table on every sale would slow the common path down. Ticking it seeds row 1
 * from whatever the single-mode fields already hold, so nothing is retyped.
 *
 * Used by the donation, seva, prasad and hall forms. Rooms use
 * PaymentSplitInput directly, because settlement there is always a dialog.
 */
export function SplitPaymentToggle({
  enabled, onEnabledChange, rows, onRowsChange,
  totalPaise, seedMode = 'cash', seedAmount = '', seedRef = '', seedAccountId = '',
  hintKey = 'donations.splitPaymentHint',
}: {
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  rows: PaymentRow[]
  onRowsChange: (r: PaymentRow[]) => void
  /** Bill total in paise — drives the live remaining indicator. */
  totalPaise: number
  seedMode?: string
  seedAmount?: string
  seedRef?: string
  seedAccountId?: string
  /** Which i18n hint to show — the default names the donation amount. */
  hintKey?: string
}) {
  const { t } = useTranslation()
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => {
            onEnabledChange(e.target.checked)
            if (e.target.checked) {
              onRowsChange([{
                ...emptyPaymentRow(seedMode),
                amount: seedAmount,
                reference_no: seedRef,
                payment_account_id: seedAccountId,
              }])
            }
          }}
        />
        {t('donations.splitPayment')}
      </label>
      {enabled && (
        <div className="mt-2">
          <PaymentSplitInput rows={rows} onChange={onRowsChange} totalPaise={totalPaise} />
          <p className="text-xs text-slate-400 mt-1">{t(hintKey)}</p>
        </div>
      )}
    </div>
  )
}
