import { createContext, useContext } from 'react'
import { useAuthStore } from '../store/authStore'

/**
 * The delete-an-entry dialog's context and hooks, apart from the dialog itself
 * (DeleteEntryDialog.tsx) so that file exports components only.
 */

export type EntryKind =
  | 'donation' | 'seva_booking' | 'prasad_sale' | 'bhojanshala_sale'
  | 'room_booking' | 'hall_booking' | 'expense'

export interface DeleteTarget {
  kind: EntryKind
  id: string
  /** Who or what — the donor, guest, buyer, the expense's description. */
  title?: string | null
  /** One more line of context — the category, the room, the items. */
  detail?: string | null
  /** Receipt / invoice / bill number. */
  reference?: string | null
  amountPaise?: number | null
  /** The entry's own date, YYYY-MM-DD or an ISO timestamp. */
  date?: string | null
}

/** Resolves true once the entry is deleted, false if the person backed out. */
export type DeleteFn = (target: DeleteTarget) => Promise<boolean>

export const DeleteEntryContext = createContext<DeleteFn | null>(null)

/** Does the signed-in user hold the role the API requires to delete an entry? */
export function useCanDeleteEntries(): boolean {
  const roles = useAuthStore(s => s.user?.roles)
  return !!roles?.includes('temple_admin')
}

export function useDeleteEntry(): DeleteFn {
  const ctx = useContext(DeleteEntryContext)
  if (!ctx) throw new Error('useDeleteEntry must be used within a DeleteEntryProvider')
  return ctx
}
