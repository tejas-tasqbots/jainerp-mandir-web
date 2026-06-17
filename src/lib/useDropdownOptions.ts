import { useEffect, useState } from 'react'
import { api } from './api'

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
