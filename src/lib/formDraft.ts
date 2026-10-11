import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../store/authStore'

/**
 * A half-filled entry form survives being left (2026-10-11: "if I started to
 * fill ... and I want to leave and do something urgently, when I come back it
 * should be saved as draft, but now I need to fill it again").
 *
 * The way mail and accounting apps do it: the form saves itself as you type
 * ("Draft saved 10:42"), comes back filled when reopened ("Draft from 10:42 -
 * Discard"), and is cleared the moment the entry is actually saved. Nothing is
 * sent to the server and no receipt number is taken - a draft is not an entry.
 *
 * Kept in this browser / desktop app (localStorage), per trust and per user, so
 * two cashiers sharing a counter PC never see each other's draft. Dropped after
 * DRAFT_TTL_DAYS. Callers leave out what must not sit in browser storage (ID
 * photos and numbers) and what is too large for it.
 */
export const DRAFT_TTL_DAYS = 14

interface Stored<T> { v: 1; savedAt: string; data: T }

/** The signed-in user's id from the access token, when the profile has not filled it in yet. */
function tokenSubject(token: string | null): string | null {
  try {
    const part = token?.split('.')[1]
    if (!part) return null
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.sub === 'string' ? json.sub : null
  } catch {
    return null
  }
}

function storageKey(form: string): string | null {
  const { tenant, user, accessToken } = useAuthStore.getState()
  // user.id arrives with /auth/me after sign-in; until then (or if that call
  // failed) the token says who this is. Without a user there is no draft.
  const who = user?.id || tokenSubject(accessToken) || user?.mobile
  if (!tenant?.id || !who) return null
  return `jainerp-draft:${tenant.id}:${who}:${form}`
}

function read<T>(form: string): Stored<T> | null {
  const key = storageKey(form)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const s = JSON.parse(raw) as Stored<T>
    if (s?.v !== 1 || !s.savedAt) return null
    if (Date.now() - Date.parse(s.savedAt) > DRAFT_TTL_DAYS * 86_400_000) {
      localStorage.removeItem(key)
      return null
    }
    return s
  } catch {
    return null
  }
}

/** Is there a draft for this form? (For a list page's "Continue draft" button.) */
export function hasDraft(form: string): boolean {
  return read(form) !== null
}

export interface FormDraft {
  /** When the draft that was put back into the form had been saved, if one was. */
  restoredFrom: Date | null
  /** When this session last wrote the draft. */
  savedAt: Date | null
  /** Write it now (the "Save draft" button): stored, nothing worth storing, or storage refused it. */
  saveNow: () => 'saved' | 'empty' | 'failed'
  /** Throw the draft away; the caller resets the form. */
  discard: () => void
  /** The entry was saved: the draft is done. */
  clear: () => void
}

/**
 * @param form   a stable name for the form ('hall-booking', 'donation', ...)
 * @param value  everything worth keeping, as plain JSON
 * @param apply  puts a stored value back into the form's state (called once, on open)
 * @param isEmpty a value not worth a draft (an untouched form) - stored drafts are removed instead
 * @param enabled false to switch drafts off (an edit of an existing entry)
 */
export function useFormDraft<T>(
  form: string,
  value: T,
  apply: (v: T) => void,
  isEmpty: (v: T) => boolean,
  enabled = true,
): FormDraft {
  const [restoredFrom, setRestoredFrom] = useState<Date | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  // Writing only starts after the stored draft has been applied, or the
  // form's blank first render would overwrite the draft it is about to load.
  const ready = useRef(false)
  // A keystroke not yet written (the autosave waits half a second).
  const pending = useRef(false)
  // The entry was saved: nothing may write the draft back afterwards.
  const done = useRef(false)
  const latest = useRef(value)
  const applyRef = useRef(apply)
  const emptyRef = useRef(isEmpty)
  // The latest of each, for the timers and the restore below.
  useEffect(() => { latest.current = value; applyRef.current = apply; emptyRef.current = isEmpty })

  useEffect(() => {
    if (!enabled) return
    const s = read<T>(form)
    if (s) {
      applyRef.current(s.data)
      setRestoredFrom(new Date(s.savedAt))
    }
    // After the restored state has rendered, so the first save is of it.
    const h = setTimeout(() => { ready.current = true }, 0)
    return () => clearTimeout(h)
  }, [form, enabled])

  /** Writes the draft; `quiet` when the form is going away (no state to set). */
  const write = useCallback((v: T, quiet = false): 'saved' | 'empty' | 'failed' => {
    pending.current = false
    if (done.current) return 'empty'
    const key = storageKey(form)
    if (!key) return 'failed'
    try {
      if (emptyRef.current(v)) {
        localStorage.removeItem(key)
        if (!quiet) setSavedAt(null)
        return 'empty'
      }
      const at = new Date()
      localStorage.setItem(key, JSON.stringify({ v: 1, savedAt: at.toISOString(), data: v } satisfies Stored<T>))
      if (!quiet) setSavedAt(at)
      return 'saved'
    } catch {
      // Quota exceeded or storage blocked: the form still works, unsaved.
      return 'failed'
    }
  }, [form])

  // Autosave, half a second after the last keystroke.
  const serial = JSON.stringify(value)
  useEffect(() => {
    if (!enabled || !ready.current) return
    pending.current = true
    const h = setTimeout(() => { write(latest.current) }, 500)
    return () => clearTimeout(h)
  }, [serial, enabled, write])

  // Leaving inside that half second used to drop the last keystrokes: the
  // timer died with the form. Written at once when the form goes away (a menu
  // click) and when the tab or the desktop window closes.
  useEffect(() => {
    if (!enabled) return
    const flush = () => { if (pending.current && ready.current) write(latest.current, true) }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [enabled, write])

  const remove = useCallback(() => {
    pending.current = false
    const key = storageKey(form)
    try { if (key) localStorage.removeItem(key) } catch { /* nothing stored */ }
    setSavedAt(null)
    setRestoredFrom(null)
  }, [form])

  return {
    restoredFrom,
    savedAt,
    saveNow: () => (enabled ? write(latest.current) : 'empty'),
    discard: remove,
    clear: () => { done.current = true; remove() },
  }
}
