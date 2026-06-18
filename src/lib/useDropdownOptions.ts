import { useEffect, useMemo, useState } from 'react'
import { api } from './api'

export interface AccountOption {
  id: string
  name: string
  type: 'cash' | 'bank'
  account_number?: string
  bank_name?: string
  is_default_cash: boolean
  is_default_bank: boolean
}

export interface PaymentModeOption {
  code: string
  name: string
  requires_reference?: boolean
}

const FALLBACK_PAYMENT_MODES: PaymentModeOption[] = [
  { code: 'cash', name: 'Cash', requires_reference: false },
  { code: 'upi', name: 'UPI', requires_reference: true },
  { code: 'cheque', name: 'Cheque', requires_reference: true },
  { code: 'netbanking', name: 'Net Banking', requires_reference: true },
  { code: 'online', name: 'Online', requires_reference: true },
]

/**
 * Active payment modes configured for the mandir (Settings → Categories &
 * Dropdowns). Falls back to the built-in list if the endpoint is unavailable
 * (e.g. tenant not yet migrated), so existing forms never break.
 */
export function usePaymentModes(): PaymentModeOption[] {
  const [modes, setModes] = useState<PaymentModeOption[]>(FALLBACK_PAYMENT_MODES)
  useEffect(() => {
    api.get('/payment-modes', { params: { is_active: 'true' } })
      .then(r => {
        const rows = (r.data.data || r.data || []) as PaymentModeOption[]
        if (Array.isArray(rows) && rows.length) setModes(rows)
      })
      .catch(() => { /* keep fallback */ })
  }, [])
  return modes
}

/**
 * All active bank/cash accounts. Used to show "Received in / Paid from Account" on forms.
 * cashOnly=true → only cash accounts; bankOnly=true → only bank accounts.
 */
export function useAccounts(filter?: 'cash' | 'bank'): AccountOption[] {
  const [all, setAll] = useState<AccountOption[]>([])
  useEffect(() => {
    api.get('/accounts', { params: { is_active: 'true' } })
      .then(r => setAll(r.data.data || r.data || []))
      .catch(() => {})
  }, [])
  return useMemo(() => filter ? all.filter(a => a.type === filter) : all, [all, filter])
}

/**
 * Returns the single best account for the given payment_mode.
 * - cash → default cash account (or first cash account)
 * - non-cash → first bank account
 * Returns '' (no auto-select) when there are multiple choices.
 */
export function autoSelectAccount(accounts: AccountOption[], paymentMode: string): string {
  const isCash = paymentMode === 'cash'
  const relevant = accounts.filter(a => a.type === (isCash ? 'cash' : 'bank'))
  if (relevant.length === 1) return relevant[0].id
  const def = relevant.find(a => isCash ? a.is_default_cash : a.is_default_bank)
  if (def) return def.id
  return ''
}

/**
 * Active names for a simple master resource (e.g. 'expense-categories').
 * Returns `fallback` until loaded / on error.
 */
export function useResourceNames(resource: string, fallback: string[] = []): string[] {
  const [names, setNames] = useState<string[]>(fallback)
  useEffect(() => {
    api.get(`/${resource}`, { params: { is_active: 'true' } })
      .then(r => {
        const rows = (r.data.data || r.data || []) as { name?: string }[]
        const list = rows.map(x => x.name).filter((n): n is string => !!n)
        if (list.length) setNames(list)
      })
      .catch(() => { /* keep fallback */ })
  }, [resource])
  return names
}
