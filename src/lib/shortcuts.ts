/**
 * Single source of truth for the app's keyboard shortcuts — used by the
 * global handler (KeyboardShortcuts.tsx), the "?" help sheet, and the Help
 * page's reference table, so the three never drift apart.
 */
export interface ShortcutDef {
  /** Display form, e.g. "F2" or "Ctrl + K". */
  keys: string
  labelKey: string
  /** Route to navigate to; omitted for shortcuts that aren't navigation (e.g. "?"). */
  route?: string
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: 'Ctrl + K', labelKey: 'shortcuts.search' },
  { keys: 'F2', labelKey: 'shortcuts.newDonation', route: '/donations/add' },
  { keys: 'F3', labelKey: 'shortcuts.newExpense', route: '/expenses/add' },
  { keys: 'F4', labelKey: 'shortcuts.newPledge', route: '/boli/add' },
  { keys: '?', labelKey: 'shortcuts.showShortcuts' },
  { keys: 'Esc', labelKey: 'shortcuts.closeDialog' },
]
