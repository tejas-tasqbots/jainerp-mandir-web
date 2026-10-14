import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import type { Expense } from '../../types'
import { paymentModeLabel } from '../../lib/paymentModeLabel'
import { PaymentVouchers } from '../../components/PaymentVouchers'
import { AttachmentThumb } from '../../components/kit/AttachmentViewer'

/** Row detail drawer for an expense — bill details plus the scanned attachment (plan §05). */
export function ExpenseDetail({ expense }: { expense: Expense }) {
  const { t } = useTranslation()
  const [photo, setPhoto] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // The bill's items (tenant migration 057), read only when the row says it
  // has some - a one-line expense costs no extra request.
  const [items, setItems] = useState<Array<{ id: string; description: string; qty: number; unit: string | null; rate_paise: number; gst_rate: number; amount_paise: number; category: string | null }>>([])
  useEffect(() => {
    if (!expense.item_count) { setItems([]); return }
    let alive = true
    api.get(`/expenses/${expense.id}`).then(r => { if (alive) setItems(r.data.data?.items ?? []) }).catch(() => {})
    return () => { alive = false }
  }, [expense.id, expense.item_count])

  useEffect(() => {
    if (!expense.has_bill_photo) { setPhoto(null); return }
    let alive = true
    setLoading(true)
    api.get(`/expenses/${expense.id}/bill-photo`)
      .then(r => { if (alive) setPhoto(r.data.data?.bill_photo_base64 ?? null) })
      .catch(() => { if (alive) setPhoto(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [expense.id, expense.has_bill_photo])

  const outstanding = expense.is_on_credit
    ? expense.amount_paise - (expense.credit_paid_paise ?? 0)
    : 0

  const rows: [string, React.ReactNode][] = [
    [t('expenses.vendor'), expense.vendor_name || '—'],
    [t('expenses.category'), expense.category || '—'],
    [t('common.amount'), <span className="font-semibold">₹{fmtPaise(expense.amount_paise)}</span>],
    ...(expense.gst_paid_paise ? [[`GST`, `₹${fmtPaise(expense.gst_paid_paise)}`] as [string, React.ReactNode]] : []),
    ...(expense.tds_deducted ? [[t('expenses.tds'), `₹${fmtPaise(expense.tds_amount_paise ?? 0)}`] as [string, React.ReactNode]] : []),
    [t('expenses.mode'), <span className="badge-gray">{paymentModeLabel(t, expense.payment_mode)}</span>],
    [t('expenses.billNo'), expense.bill_number || '—'],
    [t('common.date'), new Date(expense.bill_date || expense.created_at).toLocaleDateString('en-IN')],
    [t('expenses.type'), expense.is_on_credit
      ? <span className="badge-red">{t('expenses.credit')}</span>
      : <span className="badge-green">{t('expenses.paid')}</span>],
    ...(expense.is_on_credit
      ? [[t('expenses.outstanding'), outstanding > 0
          ? <span className="text-red-600 font-semibold">₹{fmtPaise(outstanding)}</span>
          : <span className="text-green-600">{t('creditors.statusPaid')}</span>] as [string, React.ReactNode]]
      : []),
  ]

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 text-sm">
            <span className="text-slate-500 flex-shrink-0">{label}</span>
            <span className="text-right">{value}</span>
          </div>
        ))}
        {expense.notes && <p className="text-xs text-slate-500 border-t border-slate-100 pt-2">{expense.notes}</p>}
      </div>

      {items.length > 0 && (
        <div data-testid="expense-detail-items">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{t('expenseItems.heading', { count: items.length })}</h4>
          <table className="w-full text-sm">
            <tbody>
              {items.map(i => (
                <tr key={i.id} className="border-b border-slate-100">
                  <td className="py-1.5">
                    {i.description}
                    <span className="block text-xs text-slate-400">
                      {i.qty}{i.unit ? ` ${i.unit}` : ''} × ₹{fmtPaise(i.rate_paise)}{i.gst_rate ? ` + GST ${i.gst_rate}%` : ''}{i.category ? ` · ${i.category}` : ''}
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-semibold whitespace-nowrap">₹{fmtPaise(i.amount_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Every payment against this bill, each a voucher the vendor signs
          (tenant migration 060) - the one payment of a bill paid at entry, or
          every installment of one bought on credit. */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{t('expenses.vouchers.title')}</h4>
        <PaymentVouchers expenseId={expense.id} />
      </div>

      <div>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
          <Paperclip size={13} /> {t('expenses.billAttachment')}
        </h4>
        {!expense.has_bill_photo ? (
          <p className="text-xs text-slate-400">{t('expenses.noBillAttached')}</p>
        ) : loading ? (
          <div className="h-40 bg-slate-100 rounded animate-pulse" />
        ) : !photo ? (
          <p className="text-xs text-slate-400">{t('expenses.billLoadFailed')}</p>
        ) : (
          // Images zoom, PDFs open in the viewer (a data: link in a new tab is blocked by Chrome).
          <AttachmentThumb src={photo} alt={t('expenses.billAttachment')} fileName={`expense-bill-${expense.id.slice(0, 8)}`} />
        )}
      </div>
    </div>
  )
}
