import type { RoomBooking } from '../../../types'

/** The security deposit still held on a stay: taken, less refunded, less kept. */
export function depositHeldOf(b: RoomBooking): number {
  const x = b as unknown as Record<string, unknown>
  return Number(x.deposit_paise ?? 0) - Number(x.deposit_refunded_paise ?? 0) - Number(x.deposit_forfeited_paise ?? 0)
}
