import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Search, XCircle, Filter, ArrowUp, ArrowDown, BarChart2,
  FileSpreadsheet, FileDown, Printer, Inbox, Columns3, BookmarkPlus, Bookmark, X, Trash2,
  MoreVertical,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'

/* ── Filter model ──────────────────────────────────────────────────────────
   Column filters are SERVER-driven: each filterable column declares which
   query params it maps to, the page collects `filterParams` and sends them
   with the list request. Nothing is filtered client-side, so totals and
   pagination always agree with what's visible. */

export type ColumnFilter =
  | { kind: 'enum'; param: string; options: { value: string; label: string }[] }
  | { kind: 'text'; param: string }
  | { kind: 'amount'; gteParam: string; lteParam: string }

export interface ColumnFilterState {
  values?: string[]
  text?: string
  min?: string
  max?: string
}

export interface ColumnDef<T> {
  key: string
  label: string
  align?: 'left' | 'right'
  render?: (row: T, index: number) => React.ReactNode
  sortable?: boolean
  filter?: ColumnFilter
}

export interface SortState { key: string; dir: 'asc' | 'desc' }

/** Flatten column-filter UI state into API query params. */
export function filterStateToParams<T>(
  columns: ColumnDef<T>[],
  state: Record<string, ColumnFilterState>,
): Record<string, string> {
  const params: Record<string, string> = {}
  for (const col of columns) {
    const f = col.filter
    const s = state[col.key]
    if (!f || !s) continue
    if (f.kind === 'enum' && s.values?.length) params[f.param] = s.values.join(',')
    if (f.kind === 'text' && s.text?.trim()) params[f.param] = s.text.trim()
    if (f.kind === 'amount') {
      if (s.min) params[f.gteParam] = String(Math.round(Number(s.min) * 100))
      if (s.max) params[f.lteParam] = String(Math.round(Number(s.max) * 100))
    }
  }
  return params
}

function isFilterActive(s: ColumnFilterState | undefined): boolean {
  return !!s && (!!s.values?.length || !!s.text?.trim() || !!s.min || !!s.max)
}

/* ── Column-header filter dropdown ────────────────────────────────────────── */

const FILTER_WIDTH = 240

function FilterDropdown({
  filter, state, onApply,
}: {
  filter: ColumnFilter
  state: ColumnFilterState | undefined
  onApply: (s: ColumnFilterState | null) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ColumnFilterState>(state ?? {})
  // Narrows a long option list (cities, states) inside the filter popover.
  const [optQuery, setOptQuery] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const active = isFilterActive(state)

  useEffect(() => { setDraft(state ?? {}) }, [state, open])

  /* Portalled for the same reason RowMenu is: `position:absolute` put this
     inside the table's `card overflow-hidden` > `overflow-x-auto` wrappers, so
     the popover was clipped at the card's left edge — the checkboxes and the
     first characters of every option were cut off, and on a narrow column the
     Apply button sat outside the visible area. Fixed coordinates on <body>
     escape both clips. */
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const h = popRef.current?.offsetHeight ?? 0
    const below = b.bottom + 4
    const top = h && below + h > window.innerHeight - 8 ? Math.max(8, b.top - h - 4) : below
    // Right-aligned to the button, but never off either edge of the viewport.
    const left = Math.max(8, Math.min(b.right - FILTER_WIDTH, window.innerWidth - FILTER_WIDTH - 8))
    setPos({ top, left })
  }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    // A fixed popover would be stranded away from its header on scroll/resize.
    function onReflow() { setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [open])

  function apply(next: ColumnFilterState | null) {
    setOpen(false)
    onApply(next && isFilterActive(next) ? next : null)
  }

  return (
    <span className="inline-block" onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className={`p-0.5 rounded align-middle transition-colors ${
          active ? 'text-brand-gold' : 'text-white/50 hover:text-white'
        }`}
        aria-label={t('kit.filterColumn')}
        title={t('kit.filterColumn')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Filter size={11} fill={active ? 'currentColor' : 'none'} />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: FILTER_WIDTH,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="z-[60] bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 text-left font-normal normal-case tracking-normal text-slate-700"
          onClick={e => e.stopPropagation()}
        >
          {filter.kind === 'enum' && (
            <>
              {filter.options.length > 8 && (
                <input
                  autoFocus
                  className="form-input !py-1.5 !text-xs mb-1.5"
                  placeholder={t('kit.search')}
                  value={optQuery}
                  onChange={e => setOptQuery(e.target.value)}
                  aria-label={t('kit.search')}
                />
              )}
            <div className="max-h-52 overflow-y-auto space-y-0.5">
              {filter.options
                .filter(o => !optQuery.trim() || o.label.toLowerCase().includes(optQuery.trim().toLowerCase()))
                .map(opt => {
                const checked = draft.values?.includes(opt.value) ?? false
                return (
                  <label key={opt.value} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setDraft(d => ({
                        ...d,
                        values: checked
                          ? (d.values ?? []).filter(v => v !== opt.value)
                          : [...(d.values ?? []), opt.value],
                      }))}
                      className="accent-[var(--color-cta)]"
                    />
                    {opt.label}
                  </label>
                )
              })}
              {filter.options.filter(o => !optQuery.trim() || o.label.toLowerCase().includes(optQuery.trim().toLowerCase())).length === 0 && (
                <p className="text-xs text-slate-400 px-1.5 py-2">{t('kit.noMatches')}</p>
              )}
            </div>
            </>
          )}
          {filter.kind === 'text' && (
            <input
              autoFocus
              className="form-input !py-1.5 !text-xs"
              placeholder={t('kit.contains')}
              value={draft.text ?? ''}
              onChange={e => setDraft(d => ({ ...d, text: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') apply(draft) }}
            />
          )}
          {filter.kind === 'amount' && (
            <div className="flex items-center gap-1.5">
              <input
                type="number" min="0" placeholder={t('kit.min')}
                className="form-input !py-1.5 !text-xs w-20"
                value={draft.min ?? ''}
                onChange={e => setDraft(d => ({ ...d, min: e.target.value }))}
              />
              <span className="text-slate-400 text-xs">–</span>
              <input
                type="number" min="0" placeholder={t('kit.max')}
                className="form-input !py-1.5 !text-xs w-20"
                value={draft.max ?? ''}
                onChange={e => setDraft(d => ({ ...d, max: e.target.value }))}
              />
            </div>
          )}
          <div className="flex justify-between gap-2 mt-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={() => apply(null)} className="text-xs text-slate-400 hover:text-red-500">
              {t('kit.clear')}
            </button>
            <button type="button" onClick={() => apply(draft)} className="text-xs font-semibold text-white bg-navy-900 hover:bg-navy-800 rounded px-2.5 py-1">
              {t('kit.apply')}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </span>
  )
}

/* ── Column visibility + saved views (opt-in via `viewKey`, localStorage-only) ──
   Both are per-browser preferences, not server state — deliberately, since
   they're personal "how I like to look at this list" settings rather than
   data every trustee on the account needs to share. */

function loadHiddenColumns(viewKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(`dt-columns:${viewKey}`)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}
function saveHiddenColumns(viewKey: string, hidden: Set<string>) {
  try { localStorage.setItem(`dt-columns:${viewKey}`, JSON.stringify([...hidden])) } catch { /* ignore */ }
}

export interface SavedView {
  name: string
  filterState: Record<string, ColumnFilterState>
  sort?: SortState
  searchValue?: string
}
function loadSavedViews(viewKey: string): SavedView[] {
  try {
    const raw = localStorage.getItem(`dt-views:${viewKey}`)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
function saveSavedViews(viewKey: string, views: SavedView[]) {
  try { localStorage.setItem(`dt-views:${viewKey}`, JSON.stringify(views)) } catch { /* ignore */ }
}

/** Toolbar gear: show/hide columns, at least one must stay visible. */
function ColumnChooser<T>({
  columns, hidden, onToggle,
}: { columns: ColumnDef<T>[]; hidden: Set<string>; onToggle: (key: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const visibleCount = columns.length - hidden.size

  return (
    <div className="relative" ref={ref}>
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className={`btn-icon ${hidden.size ? '!text-navy-900' : ''}`}
        title={t('kit.columns')} aria-label={t('kit.columns')}
      >
        <Columns3 size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 min-w-[190px]">
          <p className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t('kit.columns')}</p>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {columns.map(col => {
              const isHidden = hidden.has(col.key)
              const disableUncheck = !isHidden && visibleCount <= 1
              return (
                <label
                  key={col.key}
                  className={`flex items-center gap-2 px-1.5 py-1 rounded text-xs text-slate-700 ${disableUncheck ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    disabled={disableUncheck}
                    onChange={() => onToggle(col.key)}
                    className="accent-[var(--color-cta)]"
                  />
                  {col.label}
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Toolbar bookmark: save/apply/delete named filter+sort+search presets. */
function SavedViewsMenu(props: {
  views: SavedView[]
  hasActiveState: boolean
  onApply: (v: SavedView) => void
  onSave: (name: string) => void
  onDelete: (name: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setNaming(false) }
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function submitSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    props.onSave(name.trim())
    setName(''); setNaming(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className={`btn-icon ${props.views.length ? '!text-navy-900' : ''}`}
        title={t('kit.savedViews')} aria-label={t('kit.savedViews')}
      >
        <Bookmark size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 min-w-[220px]">
          <p className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t('kit.savedViews')}</p>
          {props.views.length === 0 && !naming && (
            <p className="px-1.5 py-2 text-xs text-slate-400">{t('kit.noSavedViews')}</p>
          )}
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {props.views.map(v => (
              <div key={v.name} className="flex items-center gap-1 group">
                <button
                  type="button"
                  onClick={() => { props.onApply(v); setOpen(false) }}
                  className="flex-1 text-left px-1.5 py-1.5 rounded text-xs text-slate-700 hover:bg-slate-50 truncate"
                >
                  {v.name}
                </button>
                <button
                  type="button" onClick={() => props.onDelete(v.name)}
                  className="p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                  aria-label={t('kit.deleteView')} title={t('kit.deleteView')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100">
            {naming ? (
              <form onSubmit={submitSave} className="flex items-center gap-1">
                <input
                  autoFocus
                  className="form-input !py-1 !text-xs flex-1"
                  placeholder={t('kit.viewNamePlaceholder')}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setNaming(false) }}
                />
                <button type="submit" className="p-1 text-white bg-navy-900 hover:bg-navy-800 rounded" aria-label={t('kit.apply')}>
                  <BookmarkPlus size={12} />
                </button>
                <button type="button" onClick={() => setNaming(false)} className="p-1 text-slate-400 hover:text-slate-600" aria-label={t('common.cancel')}>
                  <X size={12} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                disabled={!props.hasActiveState}
                onClick={() => setNaming(true)}
                className="w-full flex items-center gap-1.5 px-1.5 py-1 text-xs font-semibold text-brand-blue hover:underline disabled:text-slate-300 disabled:no-underline disabled:cursor-not-allowed"
              >
                <BookmarkPlus size={13} /> {t('kit.saveCurrentView')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Row overflow (⋮) menu ────────────────────────────────────────────────────
   Plan §02: keep the single most-used action visible in the row, collapse the
   rest behind ⋮ so the table stays readable. */

export interface RowAction {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  /** Pulled out of the ⋮ menu and shown as its own icon button in the row. */
  primary?: boolean
}

const MENU_WIDTH = 190

/* The menu is rendered through a PORTAL, deliberately.

   It used to be `position:absolute` inside the cell, which put it inside the
   table's `card overflow-hidden` > `overflow-x-auto` wrappers — so the popup was
   clipped at the card edge and the lower half of it simply vanished. It also
   always opened downward, so on the last rows of a page it fell below the fold.
   Portalling to <body> with fixed coordinates escapes both clips; we flip it
   above the button when there isn't room underneath. */
function RowMenu({ actions }: { actions: RowAction[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const h = menuRef.current?.offsetHeight ?? 0
    // Flip above when the menu would overflow the viewport bottom.
    const below = b.bottom + 4
    const top = h && below + h > window.innerHeight - 8 ? Math.max(8, b.top - h - 4) : below
    // Right-align to the button, but never off the left edge.
    const left = Math.max(8, Math.min(b.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
    setPos({ top, left })
  }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    // Any scroll/resize would leave the fixed menu stranded away from its row.
    function onReflow() { setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [open])

  if (!actions.length) return null
  return (
    <span onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="p-1 text-slate-400 hover:text-navy-900 hover:bg-slate-100 rounded"
        title={t('kit.moreActions')} aria-label={t('kit.moreActions')}
        aria-haspopup="menu" aria-expanded={open}
      >
        <MoreVertical size={16} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: MENU_WIDTH,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="z-[60] bg-white border border-slate-200 rounded-lg shadow-lg py-1"
          onClick={e => e.stopPropagation()}
        >
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => { setOpen(false); a.onClick() }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                a.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {a.icon}{a.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
}

/* Actions cell: `primary` actions stay visible as icon buttons (one tap, no
   hunting), everything else collapses behind ⋮. Pages that mark nothing primary
   simply get the ⋮ on its own. */
function RowActionCell({ actions }: { actions: RowAction[] }) {
  const primary = actions.filter(a => a.primary)
  const rest = actions.filter(a => !a.primary)
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      {primary.map((a, i) =>
        // An icon alone is enough for a familiar action (edit, print). A
        // workflow step like "Pay" or "Check in" has no obvious glyph, so a
        // primary action without an icon keeps its words — collapsing it to a
        // mystery icon, or into the ⋮ menu, would hide the main thing the row
        // is for.
        a.icon ? (
          <button
            key={i}
            type="button"
            disabled={a.disabled}
            onClick={e => { e.stopPropagation(); a.onClick() }}
            title={a.label} aria-label={a.label}
            className={`p-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              a.danger ? 'text-slate-400 hover:text-brand-red hover:bg-red-50'
                       : 'text-slate-400 hover:text-brand-blue hover:bg-slate-100'
            }`}
          >
            {a.icon}
          </button>
        ) : (
          <button
            key={i}
            type="button"
            disabled={a.disabled}
            onClick={e => { e.stopPropagation(); a.onClick() }}
            className={`btn-sm whitespace-nowrap ${a.danger ? 'btn-danger' : 'btn-success'}`}
          >
            {a.label}
          </button>
        ),
      )}
      <RowMenu actions={rest} />
    </span>
  )
}

/* ── Detail drawer ────────────────────────────────────────────────────────────
   Plan §02/§04: clicking a row opens a right-hand drawer (receipt preview,
   payment history, audit info) instead of doing nothing. */

function DetailDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation()
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end no-print">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-white h-full shadow-xl flex flex-col animate-[slideIn_.15s_ease-out]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h3 className="font-semibold text-navy-900 text-sm truncate">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  )
}

/* ── DataTable ─────────────────────────────────────────────────────────────── */

export interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  loading?: boolean

  /* toolbar */
  searchValue?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
  onExportXlsx?: () => void
  onExportPdf?: () => void
  onPrint?: () => void
  /** Whole-filter daily totals for the graph toggle (from list meta). */
  graphData?: { label: string; value: number }[]
  /** Value kind for the graph axis/tooltip — ₹ by default. */
  graphFormat?: 'money' | 'count'

  /* server-driven filters & sort */
  filterState: Record<string, ColumnFilterState>
  onFilterChange: (key: string, state: ColumnFilterState | null) => void
  sort?: SortState
  onSortChange?: (s: SortState | undefined) => void

  /* pagination (server) */
  page: number
  limit: number
  total: number
  onPageChange: (p: number) => void

  /* empty state */
  emptyMessage: string
  emptyAction?: { label: string; onClick: () => void }
  onClearFilters?: () => void

  /** Row click (e.g. open a detail page). Cells keep their own buttons working. */
  onRowClick?: (row: T) => void

  /**
   * Actions collapsed behind a trailing ⋮ menu (plan §02). The most-used action
   * should stay visible in its own column; everything else goes here.
   */
  rowActions?: (row: T, index: number) => RowAction[]

  /**
   * Renders the row detail drawer opened on row click (plan §04 — receipt
   * preview, payment history, audit trail). Takes precedence over onRowClick.
   */
  renderDetail?: (row: T) => React.ReactNode
  /** Drawer heading for a row. */
  detailTitle?: (row: T) => string

  /**
   * Opts this screen into the column chooser + saved views toolbar buttons,
   * persisted to localStorage under this key. Must be unique per screen
   * (e.g. "donations-list"). Omit to leave both features off.
   */
  viewKey?: string
}

export function DataTable<T>(props: DataTableProps<T>) {
  const { t } = useTranslation()
  const [showGraph, setShowGraph] = useState(false)
  const anyFilterActive = Object.values(props.filterState).some(isFilterActive)
  const { viewKey } = props

  // ── Column visibility (always-on preference, no explicit save step) ──────
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => viewKey ? loadHiddenColumns(viewKey) : new Set())
  useEffect(() => { if (viewKey) setHiddenColumns(loadHiddenColumns(viewKey)) }, [viewKey])
  function toggleColumn(key: string) {
    if (!viewKey) return
    setHiddenColumns(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveHiddenColumns(viewKey, next)
      return next
    })
  }
  const visibleColumns = hiddenColumns.size ? props.columns.filter(c => !hiddenColumns.has(c.key)) : props.columns

  // ── Saved views (explicit named snapshots of filter+sort+search) ─────────
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => viewKey ? loadSavedViews(viewKey) : [])
  useEffect(() => { if (viewKey) setSavedViews(loadSavedViews(viewKey)) }, [viewKey])
  function saveCurrentView(name: string) {
    if (!viewKey) return
    const view: SavedView = { name, filterState: props.filterState, sort: props.sort, searchValue: props.searchValue }
    setSavedViews(prev => {
      const next = [...prev.filter(v => v.name !== name), view]
      saveSavedViews(viewKey, next)
      return next
    })
  }
  function deleteView(name: string) {
    if (!viewKey) return
    setSavedViews(prev => {
      const next = prev.filter(v => v.name !== name)
      saveSavedViews(viewKey, next)
      return next
    })
  }
  function applyView(v: SavedView) {
    // Clear filters the view doesn't set, then apply the ones it does.
    for (const key of Object.keys(props.filterState)) {
      if (!(key in v.filterState)) props.onFilterChange(key, null)
    }
    for (const [key, state] of Object.entries(v.filterState)) props.onFilterChange(key, state)
    props.onSortChange?.(v.sort)
    props.onSearchChange?.(v.searchValue ?? '')
  }
  const hasActiveState = anyFilterActive || !!props.sort || !!(props.searchValue && props.searchValue.trim())

  function toggleSort(col: ColumnDef<T>) {
    if (!col.sortable || !props.onSortChange) return
    const cur = props.sort
    if (!cur || cur.key !== col.key) props.onSortChange({ key: col.key, dir: 'desc' })
    else if (cur.dir === 'desc') props.onSortChange({ key: col.key, dir: 'asc' })
    else props.onSortChange(undefined)
  }

  const [detailRow, setDetailRow] = useState<T | null>(null)
  const hasRowMenu = !!props.rowActions
  const colCount = visibleColumns.length + (hasRowMenu ? 1 : 0)
  const showingFrom = (props.page - 1) * props.limit + 1
  const showingTo = Math.min(props.page * props.limit, props.total)

  function handleRowClick(row: T) {
    if (props.renderDetail) setDetailRow(row)
    else props.onRowClick?.(row)
  }
  const rowClickable = !!props.renderDetail || !!props.onRowClick

  return (
    <div className="space-y-3">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap no-print">
        {props.onSearchChange && (
          <div className="relative w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="form-input pl-9"
              placeholder={props.searchPlaceholder ?? t('kit.search')}
              value={props.searchValue ?? ''}
              onChange={e => props.onSearchChange!(e.target.value)}
            />
            {props.searchValue && (
              <button
                type="button" aria-label={t('kit.clearSearch')} title={t('kit.clearSearch')}
                onClick={() => props.onSearchChange!('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <XCircle size={14} />
              </button>
            )}
          </div>
        )}
        <div className="flex-1" />
        {viewKey && (
          <SavedViewsMenu
            views={savedViews}
            hasActiveState={hasActiveState}
            onApply={applyView}
            onSave={saveCurrentView}
            onDelete={deleteView}
          />
        )}
        {viewKey && props.columns.length > 1 && (
          <ColumnChooser columns={props.columns} hidden={hiddenColumns} onToggle={toggleColumn} />
        )}
        {props.graphData !== undefined && (
          <button
            type="button"
            onClick={() => setShowGraph(s => !s)}
            className={`btn-icon ${showGraph ? '!bg-navy-900 !text-white' : ''}`}
            title={t('kit.graph')} aria-label={t('kit.graph')} aria-pressed={showGraph}
          >
            <BarChart2 size={16} />
          </button>
        )}
        {props.onExportXlsx && (
          <button
            type="button" onClick={props.onExportXlsx}
            className="btn-icon !text-green-700 hover:!bg-green-50"
            title={t('kit.exportExcel')} aria-label={t('kit.exportExcel')}
          >
            <FileSpreadsheet size={16} />
          </button>
        )}
        {props.onExportPdf && (
          <button
            type="button" onClick={props.onExportPdf}
            className="btn-icon !text-red-700 hover:!bg-red-50"
            title={t('kit.exportPdf')} aria-label={t('kit.exportPdf')}
          >
            <FileDown size={16} />
          </button>
        )}
        {props.onPrint && (
          <button
            type="button" onClick={props.onPrint}
            className="btn-icon"
            title={t('kit.print')} aria-label={t('kit.print')}
          >
            <Printer size={16} />
          </button>
        )}
      </div>

      {/* ── Graph panel ── */}
      {showGraph && props.graphData !== undefined && (
        <div className="card p-4 no-print">
          {props.graphData.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-8">{t('kit.noGraphData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={props.graphData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={70}
                  tickFormatter={(v: number) => props.graphFormat === 'count'
                    ? v.toLocaleString('en-IN')
                    : `₹${v.toLocaleString('en-IN')}`}
                />
                <Tooltip
                  formatter={(v: number) => [props.graphFormat === 'count'
                    ? v.toLocaleString('en-IN')
                    : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, '']}
                  separator=""
                />
                <Bar dataKey="value" fill="var(--color-brand-blue)" radius={[3, 3, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* ── Table ── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {visibleColumns.map(col => (
                  <th
                    key={col.key}
                    className={`${col.align === 'right' ? '!text-right' : ''} ${col.sortable ? 'cursor-pointer select-none' : ''}`}
                    onClick={() => toggleSort(col)}
                    aria-sort={props.sort?.key === col.key ? (props.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.sortable && props.sort?.key === col.key && (
                        props.sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                      )}
                      {col.filter && (
                        <FilterDropdown
                          filter={col.filter}
                          state={props.filterState[col.key]}
                          onApply={s => props.onFilterChange(col.key, s)}
                        />
                      )}
                    </span>
                  </th>
                ))}
                {hasRowMenu && <th className="!text-right w-px whitespace-nowrap">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {props.loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    {visibleColumns.map(col => (
                      <td key={col.key}>
                        <div className="h-3.5 bg-slate-100 rounded animate-pulse" style={{ width: `${55 + ((i * 17 + col.key.length * 7) % 40)}%` }} />
                      </td>
                    ))}
                    {hasRowMenu && <td />}
                  </tr>
                ))
              ) : props.rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount}>
                    <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                      <Inbox size={32} className="text-slate-300" />
                      <p className="text-sm">{props.emptyMessage}</p>
                      {anyFilterActive && props.onClearFilters ? (
                        <button type="button" onClick={props.onClearFilters} className="text-xs font-semibold text-brand-blue hover:underline">
                          {t('kit.clearFilters')}
                        </button>
                      ) : props.emptyAction ? (
                        <button type="button" onClick={props.emptyAction.onClick} className="btn-primary btn-sm mt-1">
                          {props.emptyAction.label}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : (
                props.rows.map((row, i) => (
                  <tr
                    key={props.rowKey(row, i)}
                    className={rowClickable ? 'cursor-pointer' : undefined}
                    onClick={rowClickable ? () => handleRowClick(row) : undefined}
                  >
                    {visibleColumns.map(col => (
                      <td key={col.key} className={col.align === 'right' ? 'text-right tabular-nums' : ''}>
                        {col.render ? col.render(row, i) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                      </td>
                    ))}
                    {hasRowMenu && (
                      <td className="text-right whitespace-nowrap">
                        <RowActionCell actions={props.rowActions!(row, i)} />
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ── */}
      {props.total > props.limit && (
        <div className="flex items-center justify-between text-sm text-slate-500 no-print">
          <span>{t('kit.showing', { from: showingFrom, to: showingTo, total: props.total })}</span>
          <div className="flex gap-2">
            <button
              disabled={props.page === 1}
              onClick={() => props.onPageChange(props.page - 1)}
              className="btn-secondary btn-sm"
            >
              {t('common.prev')}
            </button>
            <button
              disabled={props.page * props.limit >= props.total}
              onClick={() => props.onPageChange(props.page + 1)}
              className="btn-secondary btn-sm"
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      )}

      {detailRow && props.renderDetail && (
        <DetailDrawer
          title={props.detailTitle?.(detailRow) ?? t('kit.details')}
          onClose={() => setDetailRow(null)}
        >
          {props.renderDetail(detailRow)}
        </DetailDrawer>
      )}
    </div>
  )
}
