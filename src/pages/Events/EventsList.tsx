import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, apiErrorMessage, fmtPaise, todayIst } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState, type RowAction,
} from '../../components/kit/DataTable'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { Event } from '../../types'
import { useConfirm } from '../../components/ConfirmDialog'

const PAGE_SIZE = 20
const STATUSES = ['planned', 'executing', 'completed', 'cancelled'] as const

const eventTypes = ['festival', 'pravachan', 'utsav', 'camp', 'yatra', 'bhajan', 'annadan', 'other'] as const
const eventTypeKeys: Record<typeof eventTypes[number], string> = {
  festival: 'events.typeFestival', pravachan: 'events.typePravachan', utsav: 'events.typeUtsav',
  camp: 'events.typeCamp', yatra: 'events.typeYatra', bhajan: 'events.typeBhajan',
  annadan: 'events.typeAnnadan', other: 'events.typeOther',
}

const emptyForm = {
  name: '', event_type: 'festival',
  start_date: todayIst(),
  end_date: todayIst(),
  estimated_budget: '', allow_registration: false, description: '',
}

/** List rows carry aggregates the events API computes per event. */
type EventRow = Event & { spent_paise?: number; registrations?: number }

export function EventsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const [events, setEvents] = useState<EventRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('events', 'thisFY'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function statusBadge(s: string) {
    if (s === 'planned') return <span className="badge-blue">{t('events.statusPlanned')}</span>
    if (s === 'executing') return <span className="badge-yellow">{t('events.statusOngoing')}</span>
    if (s === 'completed') return <span className="badge-green">{t('events.statusCompleted')}</span>
    return <span className="badge-red">{t('events.statusCancelled')}</span>
  }

  const statusLabel: Record<string, string> = {
    planned: t('events.filterPlanned'),
    executing: t('events.filterExecuting'),
    completed: t('events.filterCompleted'),
    cancelled: t('events.filterCancelled'),
  }

  const columns: ColumnDef<EventRow>[] = useMemo(() => [
    { key: 'name', label: t('events.eventCol'), render: ev => <span className="font-medium">{ev.name}</span> },
    { key: 'type', label: t('events.typeCol'), render: ev => <span className="capitalize text-slate-600">{ev.event_type}</span> },
    {
      key: 'dates', label: t('events.dates'),
      render: ev => (
        <span className="text-xs text-slate-500">
          {new Date(ev.start_date).toLocaleDateString('en-IN')} — {new Date(ev.end_date).toLocaleDateString('en-IN')}
        </span>
      ),
    },
    {
      key: 'budget', label: t('events.budgetCol'), align: 'right',
      render: ev => <>{ev.estimated_budget_paise ? `₹${fmtPaise(ev.estimated_budget_paise)}` : '—'}</>,
    },
    {
      key: 'spent', label: t('events.spent'), align: 'right',
      render: ev => {
        const spent = Number(ev.spent_paise ?? 0)
        if (!spent) return <span className="text-slate-300">—</span>
        const over = !!ev.estimated_budget_paise && spent > ev.estimated_budget_paise
        return <span className={over ? 'text-red-600 font-semibold' : 'text-slate-600'}>₹{fmtPaise(spent)}</span>
      },
    },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'status', options: STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: ev => statusBadge(ev.status),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, deletingId])

  function buildParams(limit: number, forPage = 1): URLSearchParams {
    const params = new URLSearchParams({ page: String(forPage), limit: String(limit) })
    if (search) params.set('q', search)
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, search, range, filterState])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/events?${buildParams(PAGE_SIZE, page)}`)
      setEvents(data.data || [])
      setTotal(data.meta?.total || 0)
    } catch {
      setEvents([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  function resetPageAnd<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1) }
  }

  function rowActions(ev: EventRow): RowAction[] {
    return [
      { label: t('events.edit'), icon: <Pencil size={14} />, primary: true, onClick: () => openEdit(ev) },
      {
        label: t('events.delete'), icon: <Trash2 size={13} />, danger: true,
        onClick: () => deleteEvent(ev.id, ev.name), disabled: deletingId === ev.id,
      },
    ]
  }

  async function exportExcel() {
    try {
      const { data } = await api.get(`/events?${buildParams(1000)}`)
      const rows: EventRow[] = data.data || []
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('events.title'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'events',
        columns: [
          { header: t('events.eventCol'), width: 28 },
          { header: t('events.typeCol'), width: 12 },
          { header: t('events.startDate'), type: 'date' },
          { header: t('events.endDate'), type: 'date' },
          { header: t('events.budgetCol'), type: 'money' },
          { header: t('events.spent'), type: 'money' },
          { header: t('common.status'), width: 12 },
        ],
        rows: rows.map(ev => [
          ev.name, ev.event_type,
          new Date(ev.start_date).toLocaleDateString('en-IN'),
          new Date(ev.end_date).toLocaleDateString('en-IN'),
          ev.estimated_budget_paise ?? 0, Number(ev.spent_paise ?? 0),
          statusLabel[ev.status] ?? ev.status,
        ]),
        totals: [
          t('kit.total'), '', '', '',
          rows.reduce((s, ev) => s + (ev.estimated_budget_paise ?? 0), 0),
          rows.reduce((s, ev) => s + Number(ev.spent_paise ?? 0), 0),
          '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function openEdit(ev: Event) {
    setEditId(ev.id)
    setForm({
      name: ev.name,
      event_type: ev.event_type,
      start_date: ev.start_date,
      end_date: ev.end_date,
      estimated_budget: ev.estimated_budget_paise ? String(ev.estimated_budget_paise / 100) : '',
      allow_registration: ev.allow_registration,
      description: ev.description || '',
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditId(null)
    setForm(emptyForm)
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        name: form.name,
        event_type: form.event_type,
        start_date: form.start_date,
        end_date: form.end_date,
        estimated_budget_paise: form.estimated_budget ? Math.round(parseFloat(form.estimated_budget) * 100) : undefined,
        allow_registration: form.allow_registration,
        description: form.description || undefined,
      }
      if (editId) {
        await api.patch(`/events/${editId}`, body)
        closeForm()
        toast.success(t('events.updatedToast'))
        load()
      } else {
        const { data } = await api.post('/events', body)
        closeForm()
        navigate(`/events/${data.data.id}`)
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function deleteEvent(id: string, name: string) {
    if (!(await confirm({ title: t('events.deleteEvent'), message: t('events.deleteEventWarning', { name }), confirmLabel: t('events.delete'), danger: true }))) return
    setDeletingId(id)
    try {
      await api.delete(`/events/${id}`)
      toast.success(t('events.deletedToast'))
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message || t('events.deleteFailed'))
    } finally {
      setDeletingId(null)
    }
  }

  // Event budget vs spend per plan §08 (collections vs expenses for that festival).
  const budgetTotal = events.reduce((s2, e) => s2 + (e.estimated_budget_paise ?? 0), 0)
  const spentTotal = events.reduce((s2, e) => s2 + ((e as { spent_paise?: number }).spent_paise ?? 0), 0)
  const stats: SummaryStat[] = [
    { label: t('events.summaryEvents'), value: String(events.length) },
    { label: t('events.summaryBudget'), value: `₹${fmtPaise(budgetTotal)}` },
    { label: t('events.summarySpent'), value: `₹${fmtPaise(spentTotal)}`, tone: 'expense', invert: true },
  ]

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('events.title')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('events.title')}</h1>
        <button onClick={() => { setEditId(null); setForm(emptyForm); setShowForm(true) }} className="btn-primary btn-sm">
          <Plus size={14} /> {t('events.newEvent')}
        </button>
      </div>

      {showForm && (
        <div className="card no-print">
          <div className="card-header flex items-center justify-between">
            <h3 className="font-semibold text-sm">{editId ? t('events.editEvent') : t('events.createNewEvent')}</h3>
            <button onClick={closeForm} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>
          <form onSubmit={submitForm} className="card-body space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">{t('events.eventName')}</label>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('events.type')}</label>
                <select className="form-select" value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
                  {eventTypes.map(et => <option key={et} value={et}>{t(eventTypeKeys[et])}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="form-label">{t('events.startDate')}</label>
                <input type="date" className="form-input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">{t('events.endDate')}</label>
                <input type="date" className="form-input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">{t('events.budget')}</label>
                <input type="number" className="form-input" value={form.estimated_budget} onChange={e => setForm(f => ({ ...f, estimated_budget: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="form-label">{t('events.description')}</label>
              <textarea className="form-input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="reg" checked={form.allow_registration} onChange={e => setForm(f => ({ ...f, allow_registration: e.target.checked }))} className="w-4 h-4" />
              <label htmlFor="reg" className="text-sm">{t('events.allowRegistration')}</label>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary btn-sm">
                <Plus size={14} /> {saving ? t('common.saving') : (editId ? t('events.updateEvent') : t('events.createEvent'))}
              </button>
              <button type="button" onClick={closeForm} className="btn-secondary btn-sm">{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="no-print">
        <DateRangePicker value={range} onChange={resetPageAnd(setRange)} storageKey="events" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="events-list"
        columns={columns}
        rows={events}
        rowKey={ev => ev.id}
        rowActions={rowActions}
        loading={loading}
        searchValue={search}
        onSearchChange={resetPageAnd(setSearch)}
        searchPlaceholder={t('events.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
          })
          setPage(1)
        }}
        page={page}
        limit={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        emptyMessage={t('events.noEventsFound')}
        emptyAction={{ label: t('events.newEvent'), onClick: () => { setEditId(null); setForm(emptyForm); setShowForm(true) } }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
        onRowClick={ev => navigate(`/events/${ev.id}`)}
      />
    </div>
  )
}
