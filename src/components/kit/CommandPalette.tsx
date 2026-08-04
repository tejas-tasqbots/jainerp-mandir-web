import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Search, CornerDownLeft, ArrowRight, Users, IndianRupee, Receipt,
  Hotel, Calendar, UserCheck, Heart, X,
} from 'lucide-react'
import { api } from '../../lib/api'
import { canSee } from '../../lib/rbac'
import { useAuthStore } from '../../store/authStore'

/* ── Static navigation targets (jump to a screen by name) ─────────────────── */

interface ScreenTarget { route: string; labelKey: string }

const SCREENS: ScreenTarget[] = [
  { route: '/dashboard', labelKey: 'nav.dashboard' },
  { route: '/donations', labelKey: 'nav.donations' },
  { route: '/boli', labelKey: 'pledges.title' },
  { route: '/expenses', labelKey: 'nav.expenses' },
  { route: '/expenses/recurring', labelKey: 'expenses.recurringTitle' },
  { route: '/rooms', labelKey: 'nav.rooms' },
  { route: '/hall', labelKey: 'nav.hall' },
  { route: '/prasad', labelKey: 'nav.prasad' },
  { route: '/seva', labelKey: 'nav.seva' },
  { route: '/annadaan', labelKey: 'nav.bhojanshala' },
  { route: '/events', labelKey: 'nav.events' },
  { route: '/sant', labelKey: 'nav.sant' },
  { route: '/devotees', labelKey: 'nav.connectedDevotees' },
  { route: '/donors', labelKey: 'nav.donors' },
  { route: '/creditors', labelKey: 'nav.creditors' },
  { route: '/masters/vendors', labelKey: 'nav.vendors' },
  { route: '/masters/priests', labelKey: 'nav.priests' },
  { route: '/masters/employees', labelKey: 'nav.employees' },
  { route: '/masters/inventory', labelKey: 'nav.inventory' },
  { route: '/accounts/cash-bank', labelKey: 'nav.cashBank' },
  { route: '/accounts/reconciliation', labelKey: 'nav.reconciliation' },
  { route: '/accounts/cheques', labelKey: 'nav.cheques' },
  { route: '/accounts/day-book', labelKey: 'nav.dayBook' },
  { route: '/accounts/ledger', labelKey: 'nav.ledger' },
  { route: '/accounts/trial-balance', labelKey: 'nav.trialBalance' },
  { route: '/accounts/balance-sheet', labelKey: 'nav.balanceSheet' },
  { route: '/reports', labelKey: 'nav.reports' },
  { route: '/certificates', labelKey: 'nav.certificates' },
  { route: '/registers/lost-found', labelKey: 'nav.lostFound' },
  { route: '/registers/visitor-count', labelKey: 'nav.visitorCount' },
  { route: '/registers/recycle-bin', labelKey: 'nav.recycleBin' },
  { route: '/registers/activity-log', labelKey: 'nav.activityLog' },
  { route: '/settings', labelKey: 'nav.settings' },
]

/* ── Entity-group metadata ────────────────────────────────────────────────── */

interface SearchItem { id: string; title: string; subtitle?: string; route: string }
interface SearchGroup { type: string; items: SearchItem[] }

const TYPE_META: Record<string, { icon: React.ReactNode; labelKey: string }> = {
  donor: { icon: <Users size={15} />, labelKey: 'nav.donors' },
  donation: { icon: <IndianRupee size={15} />, labelKey: 'nav.donations' },
  boli: { icon: <Heart size={15} />, labelKey: 'pledges.title' },
  vendor: { icon: <UserCheck size={15} />, labelKey: 'nav.vendors' },
  expense: { icon: <Receipt size={15} />, labelKey: 'nav.expenses' },
  room: { icon: <Hotel size={15} />, labelKey: 'nav.rooms' },
  event: { icon: <Calendar size={15} />, labelKey: 'nav.events' },
}

/** A single flattened, selectable row. */
interface Row { key: string; route: string; icon: React.ReactNode; title: string; subtitle?: string }

export function CommandPalette() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const roles = useAuthStore(s => s.user?.roles)
  const modules = useAuthStore(s => s.modules)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<SearchGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Ctrl/⌘+K and Ctrl+F open the palette from anywhere; the top-bar search box
  // opens it via a custom event so it needs no shared state.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    function onOpen() { setOpen(true) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpen)
    }
  }, [])

  // Reset each time it opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setGroups([])
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  // Debounced server search (entity hits). Screens filter locally.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) { setGroups([]); setLoading(false); return }
    setLoading(true)
    const handle = setTimeout(() => {
      api.get('/search', { params: { q } })
        .then(r => setGroups(r.data.data?.groups ?? []))
        .catch(() => setGroups([]))
        .finally(() => setLoading(false))
    }, 220)
    return () => clearTimeout(handle)
  }, [query, open])

  // Screens that match the query AND the user's role.
  const screenRows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    return SCREENS
      .filter(s => canSee(s.route, roles, modules))
      .map(s => ({ ...s, label: t(s.labelKey) }))
      .filter(s => !q || s.label.toLowerCase().includes(q))
      .slice(0, q ? 6 : 8)
      .map(s => ({
        key: `screen:${s.route}`,
        route: s.route,
        icon: <ArrowRight size={15} className="text-slate-400" />,
        title: s.label,
      }))
  }, [query, roles, modules, t])

  // Flatten screens + entity groups into one keyboard-navigable list.
  const sections = useMemo(() => {
    const out: { heading: string; rows: Row[] }[] = []
    if (screenRows.length) out.push({ heading: t('palette.screens'), rows: screenRows })
    for (const g of groups) {
      const meta = TYPE_META[g.type]
      if (!meta) continue
      out.push({
        heading: t(meta.labelKey),
        rows: g.items.map(it => ({
          key: `${g.type}:${it.id}`,
          route: it.route,
          icon: meta.icon,
          title: it.title,
          subtitle: it.subtitle,
        })),
      })
    }
    return out
  }, [screenRows, groups, t])

  const flatRows = useMemo(() => sections.flatMap(s => s.rows), [sections])

  // Keep the active index in range as results change.
  useEffect(() => { setActive(a => Math.min(a, Math.max(0, flatRows.length - 1))) }, [flatRows.length])

  function go(row: Row) {
    setOpen(false)
    navigate(row.route)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, flatRows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (flatRows[active]) go(flatRows[active]) }
  }

  // Scroll the active row into view.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  if (!open) return null

  let runningIdx = -1

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] px-4 bg-black/40 no-print"
      onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden" onKeyDown={onKeyDown}>
        {/* Input */}
        <div className="flex items-center gap-2.5 px-4 border-b border-slate-200">
          <Search size={17} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 py-3.5 text-sm outline-none placeholder:text-slate-400"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0) }}
          />
          <button type="button" onClick={() => setOpen(false)} className="text-slate-300 hover:text-slate-500 flex-shrink-0" aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {query.trim().length >= 2 && loading && flatRows.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">{t('common.loading')}</p>
          )}
          {query.trim().length >= 2 && !loading && flatRows.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">{t('palette.noResults', { q: query })}</p>
          )}
          {sections.map(section => (
            <div key={section.heading} className="mb-1">
              <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{section.heading}</p>
              {section.rows.map(row => {
                runningIdx++
                const idx = runningIdx
                const isActive = idx === active
                return (
                  <button
                    key={row.key}
                    data-idx={idx}
                    type="button"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(row)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                      isActive ? 'bg-navy-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex-shrink-0 text-slate-500">{row.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-navy-900 truncate">{row.title}</span>
                      {row.subtitle && <span className="block text-xs text-slate-400 truncate">{row.subtitle}</span>}
                    </span>
                    {isActive && <CornerDownLeft size={13} className="text-slate-300 flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          ))}
          {query.trim().length < 2 && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">{t('palette.hint')}</p>
          )}
        </div>

        {/* Footer legend */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-slate-100 font-sans">↑↓</kbd> {t('palette.navigate')}</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-slate-100 font-sans">↵</kbd> {t('palette.open')}</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded bg-slate-100 font-sans">esc</kbd> {t('palette.close')}</span>
        </div>
      </div>
    </div>
  )
}
