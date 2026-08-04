import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SHORTCUTS } from '../../lib/shortcuts'
import { canSee } from '../../lib/rbac'
import { useAuthStore } from '../../store/authStore'
import { ShortcutsSheet } from './ShortcutsSheet'

const ROUTE_KEYS: Record<string, string> = {
  F2: SHORTCUTS.find(s => s.keys === 'F2')!.route!,
  F3: SHORTCUTS.find(s => s.keys === 'F3')!.route!,
  F4: SHORTCUTS.find(s => s.keys === 'F4')!.route!,
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * App-wide shortcut listener (F2/F3/F4 jump to the three most-used "add"
 * flows, "?" opens the reference sheet). Ctrl+K/Ctrl+F are handled inside
 * CommandPalette itself. Disabled while typing in any field so it never
 * steals a literal "F2" or "?" character from a form.
 */
export function KeyboardShortcuts() {
  const navigate = useNavigate()
  const roles = useAuthStore(s => s.user?.roles)
  const modules = useAuthStore(s => s.modules)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    function onOpenSheet() { setSheetOpen(true) }
    window.addEventListener('open-shortcuts-sheet', onOpenSheet)
    return () => window.removeEventListener('open-shortcuts-sheet', onOpenSheet)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === '?') {
        e.preventDefault()
        setSheetOpen(o => !o)
        return
      }
      if (e.key === 'Escape' && sheetOpen) {
        setSheetOpen(false)
        return
      }
      const route = ROUTE_KEYS[e.key]
      if (route && canSee(route, roles, modules)) {
        e.preventDefault()
        navigate(route)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, roles, modules, sheetOpen])

  if (!sheetOpen) return null
  return <ShortcutsSheet onClose={() => setSheetOpen(false)} />
}
