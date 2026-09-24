import type { TFunction } from 'i18next'

/**
 * A stored status or kind ("draft", "checked_in", "corpus", "asset") in the
 * screen's language. Several lists printed the code itself, in English, on
 * Hindi and Marathi screens (UI audit, 2026-09-25). An unknown code reads as
 * itself, tidied, never as a raw key.
 */
export function statusLabel(t: TFunction, code: string | null | undefined): string {
  if (!code) return '—'
  const tidy = code.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase())
  return t(`statusWord.${code}`, { defaultValue: tidy }) as string
}
