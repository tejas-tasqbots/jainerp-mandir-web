import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useAuthStore } from '../store/authStore'

/**
 * First-run product tour.
 *
 * SHAPE, per common product-tour practice:
 *  - SKIPPABLE from step one and every step after. Skippable tours complete
 *    materially more often than forced ones, and a tour nobody can escape is a
 *    tour people click through without reading.
 *  - 1–2 sentences per step, written as a benefit ("record a donation and print
 *    an 80G receipt in one screen"), not a UI label.
 *  - Anchored to real elements via `data-tour`, dimming the rest, so the user
 *    is looking at the thing being described. A step whose anchor is missing —
 *    because that module is not granted — is skipped rather than pointing at
 *    nothing.
 *  - Shown once. Completion is stored per user+tenant, so a second staff member
 *    at the same mandir still gets their own tour, and one person joining two
 *    mandirs is not re-toured for the second.
 *  - Re-runnable on demand from Help, because the one time it matters most is
 *    the time somebody skipped it.
 */

export interface TourStep {
  /** Matches `data-tour="..."` on the element to highlight. Omit for a centred card. */
  anchor?: string
  titleKey: string
  bodyKey: string
  /** Only show when the tenant holds this module. */
  module?: string
}

const STORAGE_PREFIX = 'jainerp_tour_done'

function tourKey(name: string, userId: string, tenantId: string) {
  return `${STORAGE_PREFIX}:${name}:${tenantId}:${userId}`
}

export function hasSeenTour(name: string, userId: string, tenantId: string): boolean {
  try { return localStorage.getItem(tourKey(name, userId, tenantId)) === '1' } catch { return true }
}

export function markTourSeen(name: string, userId: string, tenantId: string) {
  try { localStorage.setItem(tourKey(name, userId, tenantId), '1') } catch { /* private mode */ }
}

/** Clear so Help → "Replay the tour" works. */
export function resetTour(name: string, userId: string, tenantId: string) {
  try { localStorage.removeItem(tourKey(name, userId, tenantId)) } catch { /* ignore */ }
}

export function Walkthrough({
  name,
  steps,
  open,
  onClose,
}: {
  name: string
  steps: TourStep[]
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { user, tenant, modules } = useAuthStore()
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  // Drop steps this trust cannot see: a step pointing at a Dharamshala menu
  // item that is not rendered would highlight empty space and read as a bug.
  const visible = useMemo(
    () => steps.filter(s => {
      if (s.module && !(modules ?? []).includes(s.module)) return false
      if (s.anchor && !document.querySelector(`[data-tour="${s.anchor}"]`)) return false
      return true
    }),
    [steps, modules, open],
  )

  const step = visible[i]

  useEffect(() => {
    if (!open || !step) return
    if (!step.anchor) { setRect(null); return }
    const el = document.querySelector(`[data-tour="${step.anchor}"]`)
    if (!el) { setRect(null); return }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // Measure after the scroll settles, or the spotlight lands where the
    // element used to be.
    const timer = setTimeout(() => setRect(el.getBoundingClientRect()), 320)
    return () => clearTimeout(timer)
  }, [open, step, i])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') setI(n => Math.max(0, n - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!open || !step) return null

  function finish() {
    if (user?.id && tenant?.id) markTourSeen(name, user.id, tenant.id)
    setI(0)
    onClose()
  }
  function next() {
    if (i >= visible.length - 1) finish()
    else setI(n => n + 1)
  }

  // Card sits under the anchor when there is room, else above it.
  const pad = 8
  const cardTop = rect
    ? rect.bottom + 260 > window.innerHeight ? Math.max(12, rect.top - 200) : rect.bottom + 12
    : window.innerHeight / 2 - 110
  const cardLeft = rect
    ? Math.min(Math.max(12, rect.left), window.innerWidth - 360)
    : window.innerWidth / 2 - 175

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
      {/* Dim everything, cut a hole around the anchor. A big box-shadow is the
          cheapest spotlight that still lets the real UI show through. */}
      <div
        className="absolute inset-0 bg-black/50 transition-all"
        style={rect ? {
          clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0,
            ${rect.left - pad}px ${rect.top - pad}px,
            ${rect.left - pad}px ${rect.bottom + pad}px,
            ${rect.right + pad}px ${rect.bottom + pad}px,
            ${rect.right + pad}px ${rect.top - pad}px,
            ${rect.left - pad}px ${rect.top - pad}px)`,
        } : undefined}
        onClick={finish}
      />
      {rect && (
        <div
          className="absolute rounded-lg ring-2 ring-brand-red pointer-events-none transition-all"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      )}

      <div
        className="absolute w-[350px] max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-2xl p-4"
        style={{ top: cardTop, left: cardLeft }}
      >
        <div className="flex items-start justify-between gap-3">
          <h4 className="font-bold text-navy-900 text-sm">{t(step.titleKey)}</h4>
          <button onClick={finish} className="text-slate-300 hover:text-slate-600 shrink-0" aria-label={t('tour.skip')}>
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{t(step.bodyKey)}</p>

        <div className="flex items-center justify-between mt-4">
          <div className="flex gap-1" aria-hidden>
            {visible.map((_, n) => (
              <span key={n} className={`h-1.5 rounded-full transition-all ${
                n === i ? 'w-4 bg-brand-red' : 'w-1.5 bg-slate-200'
              }`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {/* Skip is present on EVERY step, not just the first. */}
            <button onClick={finish} className="text-xs text-slate-400 hover:text-slate-600">
              {t('tour.skip')}
            </button>
            {i > 0 && (
              <button onClick={() => setI(n => n - 1)} className="btn-secondary !px-2 !py-1">
                <ChevronLeft size={14} />
              </button>
            )}
            <button onClick={next} className="btn-primary !px-3 !py-1.5 text-xs">
              {i >= visible.length - 1 ? t('tour.done') : t('tour.next')}
              {i < visible.length - 1 && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The mandir staff tour. One step per thing a temple office actually does,
 * in the order a new user meets them.
 *
 * Module-gated steps disappear for trusts that do not hold them, so a
 * donation-only trust gets a five-step tour rather than fourteen steps of
 * things it cannot use.
 */
export const MANDIR_TOUR: TourStep[] = [
  { titleKey: 'tour.welcome.title', bodyKey: 'tour.welcome.body' },
  { anchor: 'nav-dashboard', titleKey: 'tour.dashboard.title', bodyKey: 'tour.dashboard.body' },
  { anchor: 'nav-donations', titleKey: 'tour.donations.title', bodyKey: 'tour.donations.body' },
  { anchor: 'nav-expenses', titleKey: 'tour.expenses.title', bodyKey: 'tour.expenses.body' },
  { anchor: 'nav-people', titleKey: 'tour.donors.title', bodyKey: 'tour.donors.body' },
  { anchor: 'nav-dharamshala', titleKey: 'tour.dharamshala.title', bodyKey: 'tour.dharamshala.body', module: 'dharamshala' },
  { anchor: 'nav-prasad', titleKey: 'tour.prasad.title', bodyKey: 'tour.prasad.body', module: 'prasad' },
  { anchor: 'nav-seva', titleKey: 'tour.seva.title', bodyKey: 'tour.seva.body', module: 'seva' },
  { anchor: 'nav-gaushala', titleKey: 'tour.gaushala.title', bodyKey: 'tour.gaushala.body', module: 'gaushala' },
  { anchor: 'nav-accounts', titleKey: 'tour.accounts.title', bodyKey: 'tour.accounts.body' },
  { anchor: 'nav-reports', titleKey: 'tour.reports.title', bodyKey: 'tour.reports.body' },
  { anchor: 'nav-settings', titleKey: 'tour.settings.title', bodyKey: 'tour.settings.body' },
  { anchor: 'setup-checklist', titleKey: 'tour.setup.title', bodyKey: 'tour.setup.body' },
  { titleKey: 'tour.help.title', bodyKey: 'tour.help.body' },
]
