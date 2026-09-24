import { useEffect, useState } from 'react'
import { api, parsePaise } from '../../lib/api'

/** The rows behind ExtraChargesEditor, and what they send (tenant migration 057). */
export interface ChargeItem { id: string; name: string; default_rate_paise: number; per_night: boolean }

export interface ChargeRow {
  key: string
  room_id: string
  charge_item_id: string
  /** "Other…" chosen in the dropdown: the description is typed. */
  other: boolean
  description: string
  qty: string
  nights: string
  rate: string
}

export const newChargeRow = (roomId = '', nights = 1): ChargeRow => ({
  key: Math.random().toString(36).slice(2), room_id: roomId, charge_item_id: '', other: false, description: '',
  qty: '1', nights: String(Math.max(1, nights)), rate: '',
})

/** What the API takes. Blank rows are dropped here and again by the API. */
export function chargesPayload(rows: ChargeRow[]) {
  return rows
    .filter(r => r.description.trim() || r.rate)
    .map(r => ({
      ...(r.room_id ? { room_id: r.room_id } : {}),
      ...(r.charge_item_id ? { charge_item_id: r.charge_item_id } : {}),
      description: r.description.trim(),
      qty: Number(r.qty || 1),
      nights: Number(r.nights || 1),
      rate_paise: parsePaise(r.rate || '0'),
    }))
}

export function chargesTotalPaise(rows: ChargeRow[]): number {
  return chargesPayload(rows).reduce((s, c) => s + Math.round(c.rate_paise * c.qty * c.nights), 0)
}

/** The trust's price list, loaded once per mount. */
export function useChargeItems(): ChargeItem[] {
  const [items, setItems] = useState<ChargeItem[]>([])
  useEffect(() => {
    api.get('/room-charge-items').then(r => setItems((r.data.data ?? []).map((i: ChargeItem) => ({
      ...i, default_rate_paise: Number(i.default_rate_paise),
    })))).catch(() => setItems([]))
  }, [])
  return items
}

