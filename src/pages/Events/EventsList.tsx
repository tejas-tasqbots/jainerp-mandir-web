import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import type { Event } from '../../types'
import { useConfirm } from '../../components/ConfirmDialog'

const eventTypes = ['festival', 'pravachan', 'utsav', 'camp', 'yatra', 'bhajan', 'annadan', 'other'] as const
const eventTypeKeys: Record<typeof eventTypes[number], string> = {
  festival: 'events.typeFestival', pravachan: 'events.typePravachan', utsav: 'events.typeUtsav',
  camp: 'events.typeCamp', yatra: 'events.typeYatra', bhajan: 'events.typeBhajan',
  annadan: 'events.typeAnnadan', other: 'events.typeOther',
}

const emptyForm = {
  name: '', event_type: 'festival',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  estimated_budget: '', allow_registration: false, description: '',
}

export function EventsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { load() }, [statusFilter])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const { data } = await api.get(`/events?${params}`)
      setEvents(data.data || [])
    } catch {
      setEvents([])
    } finally {
      setLoading(false)
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
        load()
      } else {
        const { data } = await api.post('/events', body)
        closeForm()
        navigate(`/events/${data.data.id}`)
      }
    } finally {
      setSaving(false)
    }
  }

  async function deleteEvent(id: string, name: string) {
    if (!(await confirm({ title: t('events.deleteEvent'), message: t('events.deleteEventWarning', { name }), confirmLabel: t('events.delete'), danger: true }))) return
    setDeletingId(id)
    try {
      await api.delete(`/events/${id}`)
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e.response?.data?.error?.message || 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  function statusBadge(s: string) {
    if (s === 'planned') return <span className="badge-blue">{t('events.statusPlanned')}</span>
    if (s === 'executing') return <span className="badge-yellow">{t('events.statusOngoing')}</span>
    if (s === 'completed') return <span className="badge-green">{t('events.statusCompleted')}</span>
    return <span className="badge-red">{t('events.statusCancelled')}</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('events.title')}</h1>
        <button onClick={() => { setEditId(null); setForm(emptyForm); setShowForm(true) }} className="btn-primary btn-sm">
          <Plus size={14} /> {t('events.newEvent')}
        </button>
      </div>

      {showForm && (
        <div className="card">
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

      <div className="flex gap-2">
        {(['all', 'planned', 'executing', 'completed', 'cancelled'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 text-xs rounded-md font-medium capitalize ${statusFilter === s ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {{
              all: t('events.filterAll'),
              planned: t('events.filterPlanned'),
              executing: t('events.filterExecuting'),
              completed: t('events.filterCompleted'),
              cancelled: t('events.filterCancelled'),
            }[s]}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>{t('events.eventCol')}</th><th>{t('events.typeCol')}</th><th>{t('events.dates')}</th><th>{t('events.budgetCol')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">{t('common.loading')}</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">{t('events.noEventsFound')}</td></tr>
              ) : events.map(ev => (
                <tr key={ev.id} className="cursor-pointer" onClick={() => navigate(`/events/${ev.id}`)}>
                  <td className="font-medium">{ev.name}</td>
                  <td className="capitalize text-slate-600">{ev.event_type}</td>
                  <td className="text-xs text-slate-500">
                    {new Date(ev.start_date).toLocaleDateString('en-IN')} — {new Date(ev.end_date).toLocaleDateString('en-IN')}
                  </td>
                  <td>{ev.estimated_budget_paise ? `₹${fmtPaise(ev.estimated_budget_paise)}` : '—'}</td>
                  <td>{statusBadge(ev.status)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(ev)} className="p-1 text-slate-400 hover:text-brand-blue rounded" title={t('events.edit')}>
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => deleteEvent(ev.id, ev.name)}
                        disabled={deletingId === ev.id}
                        className="p-1 text-slate-400 hover:text-brand-red rounded"
                        title={t('events.delete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
