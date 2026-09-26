import { api } from './api'
import { printReceiptHtml } from './printReceipt'
import { buildPaymentVoucherHtml, type PaymentVoucherData } from './paymentVoucher'

/**
 * One payment voucher from the API (tenant migration 060). `paymentId` is
 * 'direct' for an expense paid in full when it was entered.
 *
 * Kept apart from paymentVoucher.ts so the renderer stays pure and can be
 * bundled on its own by the QA harnesses.
 */
export async function fetchPaymentVoucher(expenseId: string, paymentId: string): Promise<PaymentVoucherData> {
  const r = await api.get(`/expenses/${expenseId}/payments/${paymentId}/voucher`)
  return (r.data?.data ?? r.data) as PaymentVoucherData
}

/** Print it - through the desktop printer path on the desktop, the browser's otherwise. */
export async function printPaymentVoucher(expenseId: string, paymentId: string): Promise<void> {
  printReceiptHtml(buildPaymentVoucherHtml(await fetchPaymentVoucher(expenseId, paymentId)))
}
