import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Minus, Pencil, Plus, Save, Trash2, Users, X } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, apiErrorMessage, istDate, todayIst } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { DataTable, type ColumnDef, type ColumnFilterState, type RowAction } from '../../components/kit/DataTable'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { SummaryStrip } from '../../components/kit/SummaryStrip'
import { useToast } from '../../components/kit/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { PhoneInput, isValidPhone } from '../../components/PhoneInput'
import type { VisitorCount, VisitorDay, VisitorEntry, VisitorMember } from '../../types'

/**
 * The day's footfall.
 *
 * `visitor_counts.total_count` is a plain column that nothing ever writes — it
 * is not generated and no caller sets it — so it reads 0 on every row ever
 * recorded, which made the Total column, the day badge, the trend graph and the
 * Excel export all show zero. Derive it from the two counts that are actually
 * captured instead. `peak_count` is a concurrent-occupancy reading, not a
 * footfall tally, so it is deliberately not added in.
 */
function totalOf(c: VisitorCount): number {
  return (c.morning_count ?? 0) + (c.evening_count ?? 0)
}

type Tab = 'register' | 'count'

/**
 * Visitors: two registers a trust keeps at the gate.
 *
 *  - The visitor register (tenant migration 066): who came, with their party -
 *    men, women and children counted, the children (or anyone) named. Only the
 *    visitor's own name is required. Asked for by a trust that writes this in
 *    a paper yatri register today.
 *  - The daily headcount: a morning and an evening tally at the door.
 *
 * They are kept apart and never added: a family that signs the register also
 * walked through the door the headcount counts. The headcount's history shows
 * the register's people beside it, and the dashboard takes the larger of the
 * two for each day.
 */
export function VisitorCountPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('register')

  return (
    <div className="space-y-4">
      <PrintLetterhead title={tab === 'register' ? t('visitors.registerTitle') : t('registers.visitorCountTitle')} />

      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('visitors.title')}</h1>
        <div className="flex gap-2" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'register'}
            className={tab === 'register' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setTab('register')}>
            <ClipboardList size={14} /> {t('visitors.tabRegister')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'count'}
            className={tab === 'count' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setTab('count')}>
            <Users size={14} /> {t('visitors.tabCount')}
          </button>
        </div>
      </div>

      {tab === 'register' ? <VisitorRegister /> : <DailyCount />}
    </div>
  )
}

// ─── the visitor register ────────────────────────────────────────────────────

interface EntryForm {
  name: string
  mobile: string
  city: string
  purpose: string
  male: number
  female: number
  child: number
  members: (VisitorMember & { key: string })[]
  notes: string
}

const blankEntry = (): EntryForm => ({
  name: '', mobile: '', city: '', purpose: '', male: 0, female: 0, child: 0, members: [], notes: '',
})
const rowKey = () => Math.random().toString(36).slice(2)

/** A count with − and + beside it: tapped far more often than typed. */
function Stepper({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (n: number) => void }) {
  const { t } = useTranslation()
  return (
    <div>
      <label className="form-label" htmlFor={id}>{label}</label>
      <div className="flex">
        <button type="button" className="btn-secondary rounded-r-none px-2.5" aria-label={t('visitors.less', { what: label })}
          onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>
          <Minus size={14} />
        </button>
        <input id={id} type="number" min="0" max="999" inputMode="numeric"
          className="form-input rounded-none text-center w-16 border-x-0"
          value={value} onChange={e => onChange(Math.min(999, Math.max(0, parseInt(e.target.value) || 0)))} />
        <button type="button" className="btn-secondary rounded-l-none px-2.5" aria-label={t('visitors.more', { what: label })}
          onClick={() => onChange(Math.min(999, value + 1))}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}

function VisitorRegister() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const [day, setDay] = useState(todayIst())
  const [rows, setRows] = useState<VisitorEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<EntryForm>(blankEntry)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [day, search])

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = { visit_date: day, limit: '200', sort: 'created_at', order: 'desc' }
      if (search.trim()) params.q = search.trim()
      const { data } = await api.get('/visitors', { params })
      setRows(data.data || [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  // Names listed raise the matching count, the way the API stores it, so the
  // total shown is the total saved.
  const named = (k: VisitorMember['kind']) => form.members.filter(m => m.kind === k && m.name.trim()).length
  const male = Math.max(form.male, named('male'))
  const female = Math.max(form.female, named('female'))
  const child = Math.max(form.child, named('child'))
  const people = Math.max(male + female + child, 1)

  function setMember(key: string, patch: Partial<VisitorMember>) {
    setForm(f => ({ ...f, members: f.members.map(m => m.key === key ? { ...m, ...patch } : m) }))
  }

  function startEdit(v: VisitorEntry) {
    setEditId(v.id)
    setError('')
    setForm({
      name: v.name, mobile: v.mobile ?? '', city: v.city ?? '', purpose: v.purpose ?? '',
      male: v.male_count ?? 0, female: v.female_count ?? 0, child: v.child_count ?? 0,
      members: (Array.isArray(v.members) ? v.members : []).map(m => ({ ...m, key: rowKey() })),
      notes: v.notes ?? '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditId(null)
    setForm(blankEntry())
    setError('')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError(t('visitors.nameRequired')); return }
    if (form.mobile && !isValidPhone(form.mobile)) { setError(t('visitors.mobileInvalid')); return }
    setSaving(true)
    setError('')
    const body = {
      name: form.name.trim(),
      mobile: form.mobile || undefined,
      city: form.city.trim() || undefined,
      purpose: form.purpose.trim() || undefined,
      male_count: form.male,
      female_count: form.female,
      child_count: form.child,
      members: form.members.filter(m => m.name.trim()).map(m => ({ name: m.name.trim(), kind: m.kind })),
      notes: form.notes.trim() || undefined,
    }
    try {
      if (editId) await api.patch(`/visitors/${editId}/entry`, body)
      // Entered against the day on screen, so a register written up the next
      // morning lands on the day the visitors came.
      else await api.post('/visitors/register', { ...body, visit_date: day })
      toast.success(editId ? t('visitors.updated') : t('visitors.saved'))
      setEditId(null)
      setForm(blankEntry())
      load()
    } catch (err) {
      setError(apiErrorMessage(err, t('common.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function remove(v: VisitorEntry) {
    if (!(await confirm({ message: t('visitors.deleteConfirm', { name: v.name }), confirmLabel: t('common.delete'), danger: true }))) return
    try {
      await api.delete(`/visitors/${v.id}`)
      if (editId === v.id) cancelEdit()
      toast.success(t('visitors.deleted'))
      load()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('visitors.deleteFailed')))
    }
  }

  const totals = useMemo(() => rows.reduce((s, r) => ({
    male: s.male + (r.male_count ?? 0),
    female: s.female + (r.female_count ?? 0),
    child: s.child + (r.child_count ?? 0),
    people: s.people + (r.party_size ?? 1),
  }), { male: 0, female: 0, child: 0, people: 0 }), [rows])

  const kindLabel = (k: VisitorMember['kind']) => t(`visitors.kind_${k}`)

  const columns: ColumnDef<VisitorEntry>[] = useMemo(() => [
    {
      key: 'time', label: t('visitors.time'),
      render: v => <span className="text-xs text-slate-500 tabular-nums">{new Date(v.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span>,
    },
    {
      key: 'name', label: t('visitors.name'),
      render: v => (
        <div>
          <span className="font-medium">{v.name}</span>
          {(v.city || v.purpose) && <span className="block text-xs text-slate-500">{[v.city, v.purpose].filter(Boolean).join(' · ')}</span>}
        </div>
      ),
    },
    { key: 'mobile', label: t('visitors.mobile'), render: v => <span className="tabular-nums">{v.mobile || '—'}</span> },
    { key: 'male', label: t('visitors.men'), align: 'right', render: v => <>{v.male_count || '—'}</> },
    { key: 'female', label: t('visitors.women'), align: 'right', render: v => <>{v.female_count || '—'}</> },
    { key: 'child', label: t('visitors.children'), align: 'right', render: v => <>{v.child_count || '—'}</> },
    { key: 'total', label: t('visitors.people'), align: 'right', render: v => <span className="font-bold">{v.party_size}</span> },
    {
      key: 'members', label: t('visitors.namesInParty'),
      render: v => {
        const list = Array.isArray(v.members) ? v.members : []
        if (!list.length) return <span className="text-slate-400">—</span>
        return (
          <span className="text-xs text-slate-600">
            {list.map(m => `${m.name} (${kindLabel(m.kind)})`).join(', ')}
          </span>
        )
      },
    },
  ], [t])

  function rowActions(v: VisitorEntry): RowAction[] {
    return [
      { label: t('common.edit'), icon: <Pencil size={14} />, primary: true, onClick: () => startEdit(v) },
      { label: t('common.delete'), icon: <Trash2 size={14} />, danger: true, onClick: () => remove(v) },
    ]
  }

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: `${t('visitors.registerTitle')} — ${new Date(day).toLocaleDateString('en-IN')}`,
        filename: `visitor-register-${day}`,
        columns: [
          { header: t('visitors.time'), width: 10 },
          { header: t('visitors.name'), width: 26 },
          { header: t('visitors.mobile'), width: 16 },
          { header: t('visitors.city'), width: 16 },
          { header: t('visitors.purpose'), width: 16 },
          { header: t('visitors.men'), type: 'number' },
          { header: t('visitors.women'), type: 'number' },
          { header: t('visitors.children'), type: 'number' },
          { header: t('visitors.people'), type: 'number' },
          { header: t('visitors.namesInParty'), width: 40 },
          { header: t('registers.notes'), width: 24 },
        ],
        rows: rows.map(v => [
          new Date(v.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
          v.name, v.mobile ?? '', v.city ?? '', v.purpose ?? '',
          v.male_count ?? 0, v.female_count ?? 0, v.child_count ?? 0, v.party_size ?? 1,
          (Array.isArray(v.members) ? v.members : []).map(m => `${m.name} (${kindLabel(m.kind)})`).join(', '),
          v.notes ?? '',
        ]),
        totals: [t('kit.total'), '', '', '', '', totals.male, totals.female, totals.child, totals.people, '', ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  const today = todayIst()

  return (
    <div className="space-y-4">
      {/* Entry */}
      <form onSubmit={save} className="card no-print" data-testid="visitor-entry">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
            <ClipboardList size={15} /> {editId ? t('visitors.editEntry') : t('visitors.addEntry')}
          </h3>
          <span className="badge-blue" data-testid="visitor-party-total">{t('visitors.partyTotal', { count: people })}</span>
        </div>
        <div className="card-body space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="form-label" htmlFor="visitor-name">{t('visitors.nameLabel')}</label>
              <input id="visitor-name" className="form-input" value={form.name} maxLength={255} autoComplete="off"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('visitors.namePlaceholder')} />
            </div>
            <div>
              <span className="form-label">{t('visitors.mobileOptional')}</span>
              <PhoneInput value={form.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="visitor-city">{t('visitors.cityOptional')}</label>
              <input id="visitor-city" className="form-input" value={form.city} maxLength={100}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-end gap-4">
              <Stepper id="visitor-men" label={t('visitors.men')} value={male} onChange={n => setForm(f => ({ ...f, male: n }))} />
              <Stepper id="visitor-women" label={t('visitors.women')} value={female} onChange={n => setForm(f => ({ ...f, female: n }))} />
              <Stepper id="visitor-children" label={t('visitors.children')} value={child} onChange={n => setForm(f => ({ ...f, child: n }))} />
            </div>
            <p className="text-xs text-slate-500 mt-1.5">{t('visitors.countHint')}</p>
          </div>

          {/* Names in the party: optional, children's names most often. */}
          <div>
            <span className="form-label">{t('visitors.namesInPartyOptional')}</span>
            {form.members.length > 0 && (
              <div className="space-y-2 mb-2">
                {form.members.map(m => (
                  <div key={m.key} className="flex gap-2 items-center" data-testid="visitor-member">
                    <input className="form-input flex-1" value={m.name} maxLength={100} aria-label={t('visitors.memberName')}
                      placeholder={t('visitors.memberName')} onChange={e => setMember(m.key, { name: e.target.value })} />
                    <select className="form-select w-36" value={m.kind} aria-label={t('visitors.memberKind')}
                      onChange={e => setMember(m.key, { kind: e.target.value as VisitorMember['kind'] })}>
                      <option value="child">{t('visitors.kind_child')}</option>
                      <option value="male">{t('visitors.kind_male')}</option>
                      <option value="female">{t('visitors.kind_female')}</option>
                    </select>
                    <button type="button" className="p-1.5 text-slate-400 hover:text-brand-red rounded" title={t('visitors.removeName')}
                      aria-label={t('visitors.removeName')}
                      onClick={() => setForm(f => ({ ...f, members: f.members.filter(x => x.key !== m.key) }))}>
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="text-sm text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 disabled:opacity-40"
              disabled={form.members.length >= 50}
              onClick={() => setForm(f => ({ ...f, members: [...f.members, { key: rowKey(), name: '', kind: 'child' }] }))}>
              <Plus size={14} /> {t('visitors.addName')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="visitor-purpose">{t('visitors.purposeOptional')}</label>
              <input id="visitor-purpose" className="form-input" value={form.purpose} maxLength={100} list="visitor-purposes"
                onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} />
              <datalist id="visitor-purposes">
                {(['darshan', 'yatra', 'stay', 'puja', 'event'] as const).map(p => <option key={p} value={t(`visitors.purpose_${p}`)} />)}
              </datalist>
            </div>
            <div>
              <label className="form-label" htmlFor="visitor-notes">{t('registers.notes')}</label>
              <input id="visitor-notes" className="form-input" value={form.notes} maxLength={1000} placeholder={t('registers.notesOptional')}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          {error && <p className="text-sm text-brand-red">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary">
              <Save size={16} /> {saving ? t('common.saving') : editId ? t('visitors.saveChanges') : t('visitors.save')}
            </button>
            {editId && <button type="button" className="btn-secondary" onClick={cancelEdit}>{t('common.cancel')}</button>}
          </div>
        </div>
      </form>

      {/* The day */}
      <div className="flex flex-wrap items-end gap-3 no-print">
        <div>
          <label className="form-label" htmlFor="visitor-day">{t('visitors.day')}</label>
          <input id="visitor-day" type="date" className="form-input w-auto" value={day} max={today}
            onChange={e => e.target.value && setDay(e.target.value)} />
        </div>
        {day !== today && (
          <button type="button" className="btn-secondary btn-sm mb-0.5" onClick={() => setDay(today)}>{t('visitors.today')}</button>
        )}
      </div>

      <SummaryStrip stats={[
        { label: t('visitors.parties'), value: String(rows.length) },
        { label: t('visitors.men'), value: String(totals.male) },
        { label: t('visitors.women'), value: String(totals.female) },
        { label: t('visitors.children'), value: String(totals.child) },
        { label: t('visitors.people'), value: String(totals.people) },
      ]} />

      <DataTable
        viewKey="visitor-register"
        columns={columns}
        rows={rows}
        rowKey={v => v.id}
        rowActions={rowActions}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('visitors.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        filterState={filterState}
        onFilterChange={(key, st) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (st) next[key] = st
            else delete next[key]
            return next
          })
        }}
        page={1}
        limit={200}
        total={rows.length}
        onPageChange={() => {}}
        emptyMessage={t('visitors.noneThisDay')}
      />
    </div>
  )
}

// ─── the daily headcount ─────────────────────────────────────────────────────

function DailyCount() {
  const { t } = useTranslation()
  const toast = useToast()
  const [counts, setCounts] = useState<VisitorCount[]>([])
  const [registered, setRegistered] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [today] = useState(todayIst())
  const [todayRecord, setTodayRecord] = useState<VisitorCount | null>(null)
  const [form, setForm] = useState({ morning_count: '', evening_count: '', notes: '' })

  const columns: ColumnDef<VisitorCount>[] = useMemo(() => [
    {
      key: 'date', label: t('registers.date'),
      render: c => <span className="text-sm">{new Date(c.count_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>,
    },
    { key: 'morning', label: t('registers.morning'), align: 'right', render: c => <>{c.morning_count || '—'}</> },
    { key: 'evening', label: t('registers.evening'), align: 'right', render: c => <>{c.evening_count || '—'}</> },
    { key: 'total', label: t('registers.totalCol'), align: 'right', render: c => <span className="font-bold">{totalOf(c)}</span> },
    // Beside, not added: the people in the visitor register that day.
    {
      key: 'registered', label: t('visitors.inRegister'), align: 'right',
      render: c => <span className="text-slate-500">{registered[istDate(c.count_date)] ?? '—'}</span>,
    },
    { key: 'notes', label: t('registers.notes'), render: c => <span className="text-slate-400 text-xs">{c.notes || '—'}</span> },
  ], [t, registered])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/visitor-counts?limit=60`)
      const all: VisitorCount[] = data.data || []
      setCounts(all)
      const tr = all.find(c => istDate(c.count_date) === today)
      setTodayRecord(tr ?? null)
      if (tr) {
        setForm({
          morning_count: String(tr.morning_count || ''),
          evening_count: String(tr.evening_count || ''),
          notes: tr.notes || '',
        })
      }
      const oldest = all.length ? istDate(all[all.length - 1].count_date) : today
      api.get('/visitors/days', { params: { from: oldest, to: today } })
        .then(r => {
          const days: VisitorDay[] = r.data.data ?? r.data ?? []
          setRegistered(Object.fromEntries(days.map(d => [d.visit_date, d.people])))
        })
        .catch(() => setRegistered({}))
    } finally {
      setLoading(false)
    }
  }

  async function exportExcel() {
    if (!counts.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('registers.visitorCountTitle'),
        filename: 'visitor-counts',
        columns: [
          { header: t('registers.date'), type: 'date' },
          { header: t('registers.morning'), type: 'number' },
          { header: t('registers.evening'), type: 'number' },
          { header: t('registers.totalCol'), type: 'number' },
          { header: t('visitors.inRegister'), type: 'number' },
          { header: t('registers.notes'), width: 30 },
        ],
        rows: counts.map(c => [
          new Date(c.count_date).toLocaleDateString('en-IN'),
          c.morning_count ?? 0, c.evening_count ?? 0, totalOf(c), registered[istDate(c.count_date)] ?? 0, c.notes ?? '',
        ]),
        totals: [
          t('kit.total'),
          counts.reduce((s, c) => s + (c.morning_count ?? 0), 0),
          counts.reduce((s, c) => s + (c.evening_count ?? 0), 0),
          counts.reduce((s, c) => s + totalOf(c), 0),
          counts.reduce((s, c) => s + (registered[istDate(c.count_date)] ?? 0), 0), '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        morning_count: form.morning_count ? parseInt(form.morning_count) : undefined,
        evening_count: form.evening_count ? parseInt(form.evening_count) : undefined,
        notes: form.notes || undefined,
      }
      // One row per day: the morning count is entered in the morning and the
      // evening count added later against the same row. Posting again would hit
      // the UNIQUE(count_date) index and the day's second entry could never be
      // saved, so update the row once it exists.
      if (todayRecord) await api.patch(`/visitor-counts/${todayRecord.id}`, body)
      else await api.post('/visitor-counts', { count_date: today, ...body })
      toast.success(t('registers.countSaved'))
      load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Today's count entry */}
      <div className="card no-print">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
            <Users size={15} /> {t('registers.todaysCount', { date: new Date(today).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) })}
          </h3>
          {todayRecord && <span className="badge-blue">{t('registers.total', { count: totalOf(todayRecord) })}</span>}
        </div>
        <form onSubmit={save} className="card-body">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="form-label" htmlFor="visitor-count-page-morning-count">{t('registers.morningCount')}</label>
              <input id="visitor-count-page-morning-count" type="number" min="0" className="form-input" placeholder="0"
                value={form.morning_count} onChange={e => setForm(f => ({ ...f, morning_count: e.target.value }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="visitor-count-page-evening-count">{t('registers.eveningCount')}</label>
              <input id="visitor-count-page-evening-count" type="number" min="0" className="form-input" placeholder="0"
                value={form.evening_count} onChange={e => setForm(f => ({ ...f, evening_count: e.target.value }))} />
            </div>
            <div>
              <label className="form-label" htmlFor="visitor-count-page-notes">{t('registers.notes')}</label>
              <input id="visitor-count-page-notes" className="form-input" placeholder={t('registers.notesOptional')} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">{t('visitors.headcountHint')}</p>
          <div className="mt-4">
            <button type="submit" disabled={saving} className="btn-primary">
              <Save size={16} /> {saving ? t('common.saving') : todayRecord ? t('registers.updateCount') : t('registers.saveCount')}
            </button>
          </div>
        </form>
      </div>

      {/* History */}
      <DataTable
        columns={columns}
        rows={counts}
        rowKey={c => c.id}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        graphData={counts.slice().reverse().map(c => ({
          label: new Date(c.count_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
          value: totalOf(c),
        }))}
        graphFormat="count"
        filterState={filterState}
        onFilterChange={(key, st) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (st) next[key] = st
            else delete next[key]
            return next
          })
        }}
        page={1}
        limit={60}
        total={counts.length}
        onPageChange={() => {}}
        emptyMessage={t('registers.noRecords')}
      />
    </div>
  )
}
