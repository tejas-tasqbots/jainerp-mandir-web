import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import type { TFunction } from 'i18next'
import {
  ArchiveRestore, ArrowRight, Check, ChevronLeft, ChevronRight, Copy, FileSpreadsheet, Filter, History,
  Loader2, MessageSquareQuote, Printer, RotateCcw, Search, X,
} from 'lucide-react'
import { api, apiErrorMessage, istDate, istDayBefore, todayIst } from '../../lib/api'
import { useApiGet } from '../../lib/useApiGet'
import { printCurrentView } from '../../lib/downloadReport'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import {
  ENTITY_GROUPS, FILTER_ACTIONS, TONE_CLASSES, actionLabel, actionTone, avatarColour, entityLabel, groupOf, humanise, initials, roleLabel,
} from '../../lib/auditLabels'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { DetailDrawer } from '../../components/kit/DataTable'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuthStore } from '../../store/authStore'

interface AuditChange { field: string; from: string | null; to: string | null }
interface AuditField { field: string; value: string }

interface AuditRow {
  id: number
  entity_type: string
  entity_id: string
  action: string
  occurred_at: string
  actor_id: string | null
  actor_name: string | null
  actor_role: string | null
  /** What the record IS, in one line — built by the API from the audit payloads. */
  summary?: string
  changes?: AuditChange[]
  reason?: string | null
  effects?: AuditField[]
}

interface AuditDetail extends AuditRow {
  ip_address: string | null
  actor_mobile: string | null
  record: AuditField[]
  bin: { source: 'entry' | 'resource'; type: string } | null
}

interface Counts { created: number; edited: number; removed: number; restored: number; other: number }
interface Actor { id: string; name: string; role: string | null }

const PAGE_SIZE = 40
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

/** The summary tiles double as quick filters — "show me every delete this week". */
const TILES: { key: keyof Counts | 'all'; actions: string }[] = [
  { key: 'all', actions: '' },
  { key: 'created', actions: 'create' },
  { key: 'edited', actions: 'update' },
  { key: 'removed', actions: 'delete,void,cancel' },
  { key: 'restored', actions: 'restore' },
]

/** The IST day an event happened on — not the PC's day. */
function dayKey(iso: string): string {
  return istDate(iso)
}

function dayHeading(t: TFunction, key: string, lang: string): string {
  const today = todayIst()
  if (key === today) return t('activityLog.today')
  if (key === istDayBefore(today)) return t('activityLog.yesterday')
  return new Date(`${key}T12:00:00+05:30`).toLocaleDateString(lang === 'en' ? 'en-IN' : `${lang}-IN`, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/**
 * Activity Log — who did what, when, to which record, and why.
 *
 * A register a trustee can read and an auditor can rely on: every entry names
 * the record in words ("Room booking", not `room_bookings`), says what the
 * record was ("₹25,000 · Rishabh Shah · DON/2026-27/000042"), what moved on an
 * edit, and the reason on a delete. Grouped by day like any audit trail, with
 * the full before/after one click away, and — when the record was deleted —
 * a way back to it through the Recycle Bin.
 */
export function ActivityLogPage() {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('activity-log', 'thisWeek'))
  const [actions, setActions] = useState('')
  const [entityType, setEntityType] = useState(params.get('entity_type') ?? '')
  const [actorId, setActorId] = useState('')
  const entityId = params.get('entity_id') ?? ''
  const [entityTypes, setEntityTypes] = useState<string[]>([])
  const [actors, setActors] = useState<Actor[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    api.get('/audit-log/entity-types').then(r => setEntityTypes(r.data.data || [])).catch(() => {})
    api.get('/audit-log/actors').then(r => setActors(r.data.data || [])).catch(() => {})
  }, [])

  // Search waits for the typing to stop — every keystroke used to be a query.
  useEffect(() => {
    const h = setTimeout(() => { setSearch(searchInput.trim()); setPage(1) }, 300)
    return () => clearTimeout(h)
  }, [searchInput])

  const buildParams = useCallback((forPage: number, limit: number) => {
    const p = new URLSearchParams({ page: String(forPage), limit: String(limit) })
    if (search) p.set('q', search)
    // One record's history is its whole life, whatever range is selected.
    if (range.from && !entityId) p.set('from', range.from)
    if (range.to && !entityId) p.set('to', range.to)
    if (actions) p.set('action', actions)
    if (entityType) p.set('entity_type', entityType.startsWith('group:') ? (ENTITY_GROUPS[entityType.slice(6)] ?? []).join(',') : entityType)
    if (actorId) p.set('actor_id', actorId)
    if (entityId) p.set('entity_id', entityId)
    return p
  }, [search, range, actions, entityType, actorId, entityId])

  type ListResponse = { data?: AuditRow[]; meta?: { total?: number; counts?: Counts } }
  const list = useApiGet<ListResponse>(`/audit-log?${buildParams(page, PAGE_SIZE)}`)
  const rows = useMemo(() => list.data?.data ?? [], [list.data])
  const total = list.data?.meta?.total ?? 0
  const counts: Counts = list.data?.meta?.counts ?? { created: 0, edited: 0, removed: 0, restored: 0, other: 0 }
  const loading = list.loading
  const failed = list.failed

  const grouped = useMemo(() => {
    const out: { key: string; rows: AuditRow[] }[] = []
    for (const r of rows) {
      const key = dayKey(r.occurred_at)
      const last = out[out.length - 1]
      if (last && last.key === key) last.rows.push(r)
      else out.push({ key, rows: [r] })
    }
    return out
  }, [rows])

  // The record-type picker, grouped by area, listing only types that occur.
  const typeOptions = useMemo(() => {
    const byGroup = new Map<string, string[]>()
    for (const type of entityTypes) {
      const g = groupOf(type)
      byGroup.set(g, [...(byGroup.get(g) ?? []), type])
    }
    return [...byGroup.entries()]
      .map(([g, types]) => ({ group: g, types: types.sort((a, b) => entityLabel(t, a).localeCompare(entityLabel(t, b))) }))
      .sort((a, b) => t(`audit.group.${a.group}`).localeCompare(t(`audit.group.${b.group}`)))
  }, [entityTypes, t])

  const anyFilter = !!(search || actions || entityType || actorId || entityId)
  const allCount = counts.created + counts.edited + counts.removed + counts.restored + counts.other

  function clearFilters() {
    setSearchInput(''); setSearch(''); setActions(''); setEntityType(''); setActorId('')
    if (entityId || params.get('entity_type')) {
      params.delete('entity_id'); params.delete('entity_type')
      setParams(params, { replace: true })
    }
    setPage(1)
  }

  async function exportExcel() {
    setExporting(true)
    try {
      const { data } = await api.get(`/audit-log?${buildParams(1, 200)}`)
      let all: AuditRow[] = data.data || []
      const pages = Math.min(Math.ceil((data.meta?.total || 0) / 200), 10)
      for (let p = 2; p <= pages; p++) {
        const more = await api.get(`/audit-log?${buildParams(p, 200)}`)
        all = all.concat(more.data.data || [])
      }
      await exportXlsx({
        title: t('activityLog.title'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'activity-log',
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('activityLog.time'), width: 10 },
          { header: t('activityLog.actor'), width: 20 },
          { header: t('activityLog.role'), width: 16 },
          { header: t('activityLog.action'), width: 16 },
          { header: t('activityLog.entity'), width: 20 },
          { header: t('activityLog.details'), width: 44 },
          { header: t('activityLog.reason'), width: 28 },
          { header: t('activityLog.changes'), width: 44 },
        ],
        rows: all.map(r => [
          dayKey(r.occurred_at), timeOf(r.occurred_at),
          r.actor_name || t('activityLog.system'), roleLabel(t, r.actor_role),
          actionLabel(t, r.action), entityLabel(t, r.entity_type),
          r.summary ?? '', r.reason ?? '',
          (r.changes ?? []).map(c => `${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join('; '),
        ]),
      })
    } finally {
      setExporting(false)
    }
  }

  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0
  const to = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('activityLog.title')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><History size={18} /> {t('activityLog.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5 max-w-2xl">{t('activityLog.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/registers/recycle-bin" className="btn-secondary btn-sm"><ArchiveRestore size={14} /> {t('recycleBin.title')}</Link>
          <button type="button" className="btn-secondary btn-sm" onClick={() => void exportExcel()} disabled={exporting || !total}>
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} {t('activityLog.export')}
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => printCurrentView()}>
            <Printer size={14} /> {t('common.print')}
          </button>
        </div>
      </div>

      <div className="no-print">
        <DateRangePicker value={range} onChange={v => { setRange(v); setPage(1) }} storageKey="activity-log" />
      </div>

      {/* Summary tiles — each is also a one-click filter. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 no-print" role="tablist" aria-label={t('activityLog.action')}>
        {TILES.map(tile => {
          const value = tile.key === 'all' ? allCount : counts[tile.key]
          const active = actions === tile.actions
          const tone = tile.key === 'created' ? 'green' : tile.key === 'edited' ? 'blue' : tile.key === 'removed' ? 'red' : tile.key === 'restored' ? 'amber' : 'slate'
          return (
            <button
              key={tile.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => { setActions(tile.actions); setPage(1) }}
              className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${active ? 'border-navy-900 bg-navy-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
              data-testid={`activity-tile-${tile.key}`}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <span className={`h-2 w-2 rounded-full ${TONE_CLASSES[tone].dot}`} />
                {t(`activityLog.tiles.${tile.key}`)}
              </span>
              <span className="block text-xl font-bold text-slate-900 tabular-nums">{value.toLocaleString('en-IN')}</span>
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card p-3 no-print">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[14rem]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="form-input pl-9"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={t('activityLog.search')}
              aria-label={t('activityLog.search')}
            />
          </div>
          <select className="form-select w-auto min-w-[11rem]" value={entityType} onChange={e => { setEntityType(e.target.value); setPage(1) }} aria-label={t('activityLog.entity')}>
            <option value="">{t('activityLog.allRecords')}</option>
            {typeOptions.map(g => (
              <optgroup key={g.group} label={t(`audit.group.${g.group}`)}>
                <option value={`group:${g.group}`}>{t('activityLog.allIn', { area: t(`audit.group.${g.group}`) })}</option>
                {g.types.map(type => <option key={type} value={type}>{entityLabel(t, type)}</option>)}
              </optgroup>
            ))}
          </select>
          <select className="form-select w-auto min-w-[10rem]" value={actions} onChange={e => { setActions(e.target.value); setPage(1) }} aria-label={t('activityLog.action')}>
            <option value="">{t('activityLog.allActions')}</option>
            {TILES.filter(x => x.actions.includes(',')).map(x => (
              <option key={x.key} value={x.actions}>{t(`activityLog.tiles.${x.key}`)}</option>
            ))}
            {FILTER_ACTIONS.map(a => <option key={a} value={a}>{actionLabel(t, a)}</option>)}
          </select>
          <select className="form-select w-auto min-w-[10rem]" value={actorId} onChange={e => { setActorId(e.target.value); setPage(1) }} aria-label={t('activityLog.actor')}>
            <option value="">{t('activityLog.everyone')}</option>
            {actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {anyFilter && (
            <button type="button" className="btn-secondary btn-sm" onClick={clearFilters}>
              <X size={13} /> {t('activityLog.clearFilters')}
            </button>
          )}
        </div>
        {entityId && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2.5 py-1 text-xs text-sky-800">
            <Filter size={12} /> {t('activityLog.oneRecord')}
          </p>
        )}
      </div>

      {/* Timeline */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3 px-4 py-4">
                <div className="h-9 w-9 rounded-full bg-slate-100 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-2/3 rounded bg-slate-100 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : failed ? (
          <EmptyState icon={<History size={22} />} title={t('activityLog.loadFailed')} />
        ) : !rows.length ? (
          <EmptyState
            icon={<History size={22} />}
            title={t('activityLog.empty')}
            action={anyFilter ? <button type="button" className="btn-secondary btn-sm" onClick={clearFilters}>{t('activityLog.clearFilters')}</button> : null}
          />
        ) : (
          grouped.map(g => (
            <section key={g.key}>
              <h2 className="sticky top-0 z-[1] bg-slate-50/95 backdrop-blur px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 border-y border-slate-100 first:border-t-0">
                {dayHeading(t, g.key, i18n.language)}
              </h2>
              <ul className="divide-y divide-slate-100">
                {g.rows.map(r => <ActivityRow key={r.id} row={r} onOpen={() => setOpenId(r.id)} />)}
              </ul>
            </section>
          ))
        )}
        {!loading && total > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-sm text-slate-500 no-print">
            <span>{t('activityLog.showing', { from, to, total })}</span>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label={t('common.prev')}><ChevronLeft size={16} /></button>
              <span className="tabular-nums text-xs">{page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
              <button type="button" className="btn-icon" disabled={to >= total} onClick={() => setPage(p => p + 1)} aria-label={t('common.next')}><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>

      {openId != null && (
        <ActivityDrawer key={openId} id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />
      )}
    </div>
  )
}

function EmptyState({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icon}</span>
      <p className="text-sm text-slate-500">{title}</p>
      {action}
    </div>
  )
}

export function ActionBadge({ action }: { action: string }) {
  const { t } = useTranslation()
  const tone = TONE_CLASSES[actionTone(action)]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {actionLabel(t, action)}
    </span>
  )
}

export function Avatar({ name, id, size = 'md' }: { name: string | null; id?: string | null; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'
  return (
    <span className={`flex ${cls} shrink-0 items-center justify-center rounded-full font-semibold ${avatarColour(id ?? name)}`} aria-hidden>
      {initials(name)}
    </span>
  )
}

/**
 * What one row says the record IS.
 *
 * Almost always the API's own summary. The exception is a Settings → Messages
 * switch, whose record is a template KEY (`daily_summary`) — the only place a
 * raw key would otherwise reach the screen, and the screen that exists to not
 * show raw keys.
 */
function summaryOf(t: TFunction, row: AuditRow): string {
  const key = row.entity_type === 'comms_tenant_prefs' && /Template key (\w+)/.exec(row.summary ?? '')?.[1]
  if (key) return t(`settings.messages.tpl.${key}`, { defaultValue: humanise(key) }) as string
  return row.summary ?? ''
}

function ActivityRow({ row, onOpen }: { row: AuditRow; onOpen: () => void }) {
  const { t } = useTranslation()
  const changes = row.changes ?? []
  const summary = summaryOf(t, row)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
        data-testid="activity-row"
      >
        <Avatar name={row.actor_name || t('activityLog.system')} id={row.actor_id} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ActionBadge action={row.action} />
            <span className="text-sm font-semibold text-slate-800">{entityLabel(t, row.entity_type)}</span>
          </div>
          {summary && <p className="mt-0.5 text-sm text-slate-700 break-words">{summary}</p>}
          {row.reason && (
            <p className="mt-1 inline-flex max-w-full items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
              <MessageSquareQuote size={13} className="mt-px shrink-0" />
              <span className="break-words">{row.reason}</span>
            </p>
          )}
          {changes.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {changes.slice(0, 3).map((c, i) => (
                <li key={i} className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  <span className="text-slate-500">{c.field}:</span>
                  {c.from != null && <span className="line-through text-slate-400 truncate max-w-[8rem]">{c.from}</span>}
                  {c.from != null && <ArrowRight size={10} className="text-slate-400" />}
                  <span className="font-medium text-slate-700 truncate max-w-[10rem]">{c.to ?? '—'}</span>
                </li>
              ))}
              {changes.length > 3 && <li className="text-[11px] text-slate-400 self-center">{t('activityLog.moreChanges', { count: changes.length - 3 })}</li>}
            </ul>
          )}
          <p className="mt-1 text-xs text-slate-400">
            {row.actor_name || t('activityLog.system')}
            {row.actor_role && <> · {roleLabel(t, row.actor_role)}</>}
          </p>
        </div>
        <time className="shrink-0 text-xs text-slate-500 tabular-nums" dateTime={row.occurred_at}>{timeOf(row.occurred_at)}</time>
      </button>
    </li>
  )
}

/** One entry in full — the before/after, the reason, the record's own history, and a way back from the bin. */
function ActivityDrawer({ id, onClose, onOpen }: { id: number; onClose: () => void; onOpen: (id: number) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const roles = useAuthStore(s => s.user?.roles) ?? []
  const detailReq = useApiGet<{ data?: AuditDetail }>(`/audit-log/${id}`)
  const loaded = detailReq.loading ? null : detailReq.data?.data ?? null
  // Restoring from the drawer clears `bin` without refetching the entry.
  const [restoredId, setRestoredId] = useState<number | null>(null)
  const detail: AuditDetail | null = loaded && restoredId === loaded.id ? { ...loaded, bin: null } : loaded
  const error = detailReq.failed ? apiErrorMessage(detailReq.error, t('activityLog.loadFailed')) : ''
  const entityId = detail && detail.entity_id !== NIL_UUID ? detail.entity_id : null
  const historyReq = useApiGet<{ data?: AuditRow[] }>(entityId ? `/audit-log?entity_id=${entityId}&limit=50` : null)
  const history = historyReq.data?.data ?? []
  const [copied, setCopied] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [showRecord, setShowRecord] = useState(false)

  const canRestore = !!detail?.bin && (roles.includes('temple_admin') || (detail.bin.source === 'resource' && (roles.includes('cashier') || roles.includes('accountant'))))

  async function restore() {
    if (!detail?.bin) return
    if (!(await confirm({
      title: t('recycleBin.restoreTitle'),
      message: t('recycleBin.restoreMessage', { item: detail.summary || entityLabel(t, detail.entity_type) }),
      confirmLabel: t('recycleBin.restore'),
    }))) return
    setRestoring(true)
    try {
      const path = detail.bin.source === 'entry'
        ? `/entries/${detail.bin.type}/${detail.entity_id}/restore`
        : `/${detail.bin.type}/${detail.entity_id}/restore`
      await api.post(path, {})
      toast.success(t('recycleBin.restored'))
      setRestoredId(detail.id)
    } catch (e) {
      toast.error(apiErrorMessage(e, t('recycleBin.restoreFailed')))
    } finally {
      setRestoring(false)
    }
  }

  const when = detail ? new Date(detail.occurred_at) : null

  return (
    <DetailDrawer title={detail ? `${actionLabel(t, detail.action)} · ${entityLabel(t, detail.entity_type)}` : t('activityLog.title')} onClose={onClose} wide>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !detail ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> {t('common.loading')}</div>
      ) : (
        <div className="space-y-5 text-sm" data-testid="activity-drawer">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ActionBadge action={detail.action} />
              <span className="font-semibold text-slate-800">{entityLabel(t, detail.entity_type)}</span>
            </div>
            {summaryOf(t, detail) && <p className="mt-1.5 text-base font-medium text-slate-900 break-words">{summaryOf(t, detail)}</p>}
          </div>

          {detail.bin && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="flex items-center gap-1.5 font-medium text-amber-900"><ArchiveRestore size={15} /> {t('activityLog.inBin')}</p>
              {canRestore ? (
                <button type="button" className="btn-primary btn-sm mt-2" onClick={() => void restore()} disabled={restoring}>
                  {restoring ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} {t('recycleBin.restore')}
                </button>
              ) : (
                <p className="mt-1 text-xs text-amber-800">{t('recycleBin.adminRestores')}</p>
              )}
            </div>
          )}

          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2">
            <dt className="text-slate-500">{t('activityLog.when')}</dt>
            <dd className="text-slate-800">
              {when?.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}
            </dd>
            <dt className="text-slate-500">{t('activityLog.actor')}</dt>
            <dd className="flex items-center gap-2 text-slate-800">
              <Avatar name={detail.actor_name || t('activityLog.system')} id={detail.actor_id} size="sm" />
              <span>
                {detail.actor_name || t('activityLog.system')}
                {detail.actor_role && <span className="text-slate-500"> · {roleLabel(t, detail.actor_role)}</span>}
              </span>
            </dd>
            {detail.entity_id !== NIL_UUID && (
              <>
                <dt className="text-slate-500">{t('activityLog.recordId')}</dt>
                <dd className="flex items-center gap-1.5">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 break-all">{detail.entity_id}</code>
                  <button
                    type="button"
                    className="btn-icon p-1"
                    title={t('activityLog.copy')}
                    aria-label={t('activityLog.copy')}
                    onClick={() => { void navigator.clipboard?.writeText(detail.entity_id); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                  >
                    {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                  </button>
                </dd>
              </>
            )}
            {detail.ip_address && (
              <>
                <dt className="text-slate-500">{t('activityLog.ip')}</dt>
                <dd className="text-slate-800 font-mono text-xs">{detail.ip_address}</dd>
              </>
            )}
          </dl>

          {detail.reason && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('activityLog.reason')}</h4>
              <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900 break-words">{detail.reason}</p>
            </div>
          )}

          {(detail.changes ?? []).length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('activityLog.changes')}</h4>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">{t('activityLog.field')}</th>
                      <th className="px-3 py-1.5 text-left font-medium">{t('activityLog.before')}</th>
                      <th className="px-3 py-1.5 text-left font-medium">{t('activityLog.after')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.changes!.map((c, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 text-slate-600">{c.field}</td>
                        <td className="px-3 py-1.5 text-rose-700 break-words">{c.from ?? '—'}</td>
                        <td className="px-3 py-1.5 text-emerald-700 break-words font-medium">{c.to ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(detail.effects ?? []).length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('activityLog.effects')}</h4>
              <FieldList fields={detail.effects!} />
            </div>
          )}

          {detail.record.length > 0 && (
            <div>
              <button type="button" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-blue hover:underline" onClick={() => setShowRecord(s => !s)}>
                {showRecord ? t('activityLog.hideRecord') : t(detail.action === 'create' ? 'activityLog.showCreated' : 'activityLog.showRecord')}
              </button>
              {showRecord && <FieldList fields={detail.record} />}
            </div>
          )}

          {history.length > 1 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('activityLog.history')}</h4>
              <ol className="relative ml-2 border-l border-slate-200">
                {history.map(h => (
                  <li key={h.id} className="ml-4 pb-3 last:pb-0">
                    <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${TONE_CLASSES[actionTone(h.action)].dot}`} />
                    <button type="button" onClick={() => onOpen(h.id)} className={`text-left ${h.id === detail.id ? 'font-semibold text-slate-900' : 'text-slate-700 hover:underline'}`}>
                      {actionLabel(t, h.action)}
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        {new Date(h.occurred_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        {' · '}{h.actor_name || t('activityLog.system')}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </DetailDrawer>
  )
}

function FieldList({ fields }: { fields: AuditField[] }) {
  return (
    <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
      {fields.map((f, i) => (
        <div key={i} className="grid grid-cols-[10rem_1fr] gap-3 px-3 py-1.5">
          <dt className="text-slate-500">{f.field}</dt>
          <dd className="text-slate-800 break-words">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}
