import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'
import { api, fmtPaise } from '../lib/api'
import { printPaymentVoucher } from '../lib/printVoucher'
import { paymentModeLabel } from '../lib/paymentModeLabel'
import { useToast } from './kit/Toast'

interface VoucherRow {
  id: string
  voucher_no: string | null
  date: string
  amount_paise: number
  payment_mode: string | null
  account_name?: string | null
  reference_no?: string | null
  narration?: string | null
  paid_before_paise: number
  balance_after_paise: number
  kind: 'full' | 'part' | 'final'
}
interface Payments { bill_paise: number; paid_paise: number; balance_paise: number; payments: VoucherRow[] }

/**
 * Every payment made against one expense, each a numbered PAYMENT VOUCHER the
 * vendor signs (tenant migration 060) - full, part or final - with its
 * running balance and a Print button. Used in the expense register's
 * "Payments & vouchers" dialog and on the expense's own page.
 */
export function PaymentVouchers({ expenseId, reloadKey = 0 }: { expenseId: string; reloadKey?: number }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [data, setData] = useState<Payments | null>(null)
  const [error, setError] = useState(false)
  const [printing, setPrinting] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(false)
    api.get(`/expenses/${expenseId}/payments`)
      .then(r => setData((r.data?.data ?? r.data) as Payments))
      .catch(() => setError(true))
  }, [expenseId])
  useEffect(() => { load() }, [load, reloadKey])

  async function print(id: string) {
    setPrinting(id)
    try {
      await printPaymentVoucher(expenseId, id)
    } catch {
      toast.error(t('expenses.vouchers.printFailed'))
    } finally {
      setPrinting(null)
    }
  }

  if (error) return <p className="text-sm text-red-600">{t('expenses.vouchers.loadFailed')}</p>
  if (!data) return <p className="text-sm text-slate-400">{t('common.loading')}</p>
  const kindTone = { full: 'bg-emerald-100 text-emerald-800', final: 'bg-emerald-100 text-emerald-800', part: 'bg-amber-100 text-amber-800' }

  return (
    <div className="space-y-3" data-testid="payment-vouchers">
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-md bg-slate-50 px-3 py-2"><p className="text-[11px] text-slate-500">{t('expenses.vouchers.bill')}</p><p className="font-semibold tabular-nums">₹{fmtPaise(data.bill_paise)}</p></div>
        <div className="rounded-md bg-slate-50 px-3 py-2"><p className="text-[11px] text-slate-500">{t('expenses.vouchers.paid')}</p><p className="font-semibold tabular-nums text-emerald-700">₹{fmtPaise(data.paid_paise)}</p></div>
        <div className="rounded-md bg-slate-50 px-3 py-2"><p className="text-[11px] text-slate-500">{t('expenses.vouchers.balance')}</p><p className={`font-semibold tabular-nums ${data.balance_paise > 0 ? 'text-red-600' : 'text-slate-700'}`} data-testid="vouchers-balance">₹{fmtPaise(data.balance_paise)}</p></div>
      </div>
      {data.payments.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid="vouchers-none">{t('expenses.vouchers.none')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {data.payments.map(p => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="voucher-row">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-semibold text-navy-900 whitespace-nowrap">{p.voucher_no ?? '—'}</p>
                <p className="text-[11px] text-slate-500">
                  {new Date(String(p.date).length <= 10 ? `${p.date}T00:00:00+05:30` : p.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {' · '}{paymentModeLabel(t, p.payment_mode ?? '')}
                  {p.reference_no ? ` · ${p.reference_no}` : ''}
                </p>
              </div>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${kindTone[p.kind]}`} data-testid="voucher-kind">{t(`expenses.vouchers.kind_${p.kind}`)}</span>
              <div className="text-right">
                <p className="font-semibold tabular-nums">₹{fmtPaise(p.amount_paise)}</p>
                <p className="text-[11px] text-slate-500">{t('expenses.vouchers.balanceAfter', { amount: fmtPaise(p.balance_after_paise) })}</p>
              </div>
              <button type="button" className="btn-secondary btn-sm" data-testid="voucher-print"
                disabled={printing === p.id} onClick={() => void print(p.id)}>
                <Printer size={13} /> {t('expenses.vouchers.print')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
