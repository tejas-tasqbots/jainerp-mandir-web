import { api } from './api'
import { printReceiptHtml } from './printReceipt'
import { buildPaymentVoucherHtml, type PaymentVoucherData } from './paymentVoucher'
import { buildPayslipHtml, type PayslipData } from './payslip'
import { buildDepositReceiptHtml, type DepositReceiptData } from './depositReceipt'

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

/** The voucher an employee signs for a salary advance (tenant migration 061). */
export async function printAdvanceVoucher(advanceId: string): Promise<void> {
  const r = await api.get(`/payroll/advances/${advanceId}/voucher`)
  printReceiptHtml(buildPaymentVoucherHtml((r.data?.data ?? r.data) as PaymentVoucherData))
}

/** One month's payslip: the working, every deduction, net and how it was paid. */
export async function printPayslip(salaryRecordId: string): Promise<void> {
  const r = await api.get(`/payroll/salaries/${salaryRecordId}/payslip`)
  printReceiptHtml(buildPayslipHtml((r.data?.data ?? r.data) as PayslipData))
}

/** The security deposit receipt the guest keeps and returns at checkout (061). */
export async function printDepositReceipt(bookingId: string, receiptNo?: string): Promise<void> {
  const r = await api.get(`/room-bookings/${bookingId}/deposit/receipt`, { params: receiptNo ? { no: receiptNo } : {} })
  printReceiptHtml(buildDepositReceiptHtml((r.data?.data ?? r.data) as DepositReceiptData))
}

/** The voucher the guest signs for the deposit given back (and what was kept). */
export async function printDepositRefundVoucher(bookingId: string): Promise<void> {
  const r = await api.get(`/room-bookings/${bookingId}/deposit/refund-voucher`)
  printReceiptHtml(buildPaymentVoucherHtml((r.data?.data ?? r.data) as PaymentVoucherData))
}
