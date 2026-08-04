import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save } from 'lucide-react'
import { api } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { useToast } from '../../components/kit/Toast'

interface Cattle {
  id: string
  tag_number: string
  name: string | null
  category: string
  breed: string | null
  sex: string | null
  date_of_birth: string | null
  is_milking: boolean
  status: string
  notes: string | null
}

const CATEGORIES = ['cow', 'bull', 'calf', 'ox', 'buffalo'] as const
const STATUSES = ['active', 'sick', 'adopted_out', 'deceased'] as const

/**
 * The Gaushala register — every animal the shelter cares for.
 *
 * Runs on the generic resource endpoint (`/cattle`), like the other master
 * registers: these are record-keeping tables with no bespoke workflow, so the
 * server-side module gate and audit trail come for free. Money never appears
 * here — a sponsorship payment is an ordinary donation, so 80G and gapless
 * receipt numbering keep working with no special case.
 */
export function CattleList() {
  const { t } = useTranslation()
  const toast = useToast()
  const [rows, setRows] = useState<Cattle[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const limit = 50

  const [form, setForm] = useState({
    tag_number: '', name: '', category: 'cow', breed: '', sex: 'female',
    date_of_birth: '', acquired_from: '', is_milking: false, notes: '',
  })

  useEffect(() => { load() }, [page, search, filterState])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (search) params.set('q', search)
      for (const [k, v] of Object.entries(filterState)) {
        if (v?.values?.length) params.set(k, v.values.join(','))
      }
      const { data } = await api.get(`/cattle?${params}`)
      setRows(data.data ?? [])
      setTotal(data.meta?.total ?? 0)
    } catch {
      // the empty state explains itself
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!form.tag_number.trim()) { toast.error(t('gaushala.tagRequired', { defaultValue: 'Tag number is required' })); return }
    setSaving(true)
    try {
      await api.post('/cattle', {
        ...form,
        name: form.name || null,
        breed: form.breed || null,
        date_of_birth: form.date_of_birth || null,
        acquired_from: form.acquired_from || null,
        notes: form.notes || null,
      })
      toast.success(t('gaushala.added', { defaultValue: 'Animal added to the register' }))
      setShowForm(false)
      setForm({ tag_number: '', name: '', category: 'cow', breed: '', sex: 'female', date_of_birth: '', acquired_from: '', is_milking: false, notes: '' })
      load()
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message ?? 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnDef<Cattle>[] = [
    { key: 'tag_number', label: t('gaushala.tag', { defaultValue: 'Tag' }), render: c => <span className="font-medium">{c.tag_number}</span> },
    { key: 'name', label: t('common.name', { defaultValue: 'Name' }), render: c => c.name || '—' },
    {
      key: 'category', label: t('gaushala.category', { defaultValue: 'Type' }),
      filter: { kind: 'enum', param: 'category', options: CATEGORIES.map(c => ({ value: c, label: c })) },
      render: c => <span className="capitalize">{c.category}</span>,
    },
    { key: 'breed', label: t('gaushala.breed', { defaultValue: 'Breed' }), render: c => c.breed || '—' },
    {
      key: 'is_milking', label: t('gaushala.milking', { defaultValue: 'Milking' }),
      render: c => (c.is_milking ? t('common.yes', { defaultValue: 'Yes' }) : '—'),
    },
    {
      key: 'status', label: t('common.status', { defaultValue: 'Status' }),
      filter: { kind: 'enum', param: 'status', options: STATUSES.map(s => ({ value: s, label: s.replace(/_/g, ' ') })) },
      render: c => (
        <span className={`badge ${c.status === 'active' ? 'badge-green' : c.status === 'sick' ? 'badge-yellow' : 'badge-slate'}`}>
          {c.status.replace(/_/g, ' ')}
        </span>
      ),
    },
  ]

  const stats: SummaryStat[] = [
    { label: t('gaushala.total', { defaultValue: 'Animals' }), value: String(total) },
    { label: t('gaushala.milkingCount', { defaultValue: 'Milking' }), value: String(rows.filter(r => r.is_milking).length) },
    { label: t('gaushala.sick', { defaultValue: 'Under treatment' }), value: String(rows.filter(r => r.status === 'sick').length) },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">{t('nav.gaushala', { defaultValue: 'Gaushala' })}</h1>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary btn-sm">
          <Plus size={14} /> {t('gaushala.add', { defaultValue: 'Add animal' })}
        </button>
      </div>

      <SummaryStrip stats={stats} />

      {showForm && (
        <div className="card p-4">
          <div className="grid grid-cols-3 gap-3">
            <label className="field">
              <span>{t('gaushala.tag', { defaultValue: 'Tag' })} *</span>
              <input value={form.tag_number} onChange={e => setForm({ ...form, tag_number: e.target.value })} />
            </label>
            <label className="field">
              <span>{t('common.name', { defaultValue: 'Name' })}</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span>{t('gaushala.category', { defaultValue: 'Type' })}</span>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t('gaushala.breed', { defaultValue: 'Breed' })}</span>
              <input value={form.breed} onChange={e => setForm({ ...form, breed: e.target.value })} />
            </label>
            <label className="field">
              <span>{t('gaushala.sex', { defaultValue: 'Sex' })}</span>
              <select value={form.sex} onChange={e => setForm({ ...form, sex: e.target.value })}>
                <option value="female">female</option>
                <option value="male">male</option>
              </select>
            </label>
            <label className="field">
              <span>{t('gaushala.dob', { defaultValue: 'Date of birth' })}</span>
              <input type="date" value={form.date_of_birth} onChange={e => setForm({ ...form, date_of_birth: e.target.value })} />
            </label>
            <label className="field col-span-2">
              <span>{t('gaushala.acquiredFrom', { defaultValue: 'Received from' })}</span>
              <input value={form.acquired_from} onChange={e => setForm({ ...form, acquired_from: e.target.value })}
                placeholder={t('gaushala.acquiredHint', { defaultValue: 'Donor, rescue or purchase' })} />
            </label>
            <label className="field-check mt-6">
              <input type="checkbox" checked={form.is_milking} onChange={e => setForm({ ...form, is_milking: e.target.checked })} />
              <span>{t('gaushala.milking', { defaultValue: 'Milking' })}</span>
            </label>
          </div>
          <button onClick={save} disabled={saving} className="btn-primary btn-sm mt-2">
            <Save size={14} /> {saving ? t('common.saving', { defaultValue: 'Saving…' }) : t('common.save', { defaultValue: 'Save' })}
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        loading={loading}
        searchValue={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder={t('gaushala.searchHint', { defaultValue: 'Search by tag, name or breed' })}
        onExportXlsx={() => exportXlsx({
          title: t('nav.gaushala', { defaultValue: 'Gaushala' }),
          subtitle: t('gaushala.registerSubtitle', { defaultValue: 'Cattle register' }),
          columns: [
            { header: 'Tag' }, { header: 'Name' }, { header: 'Type' },
            { header: 'Breed' }, { header: 'Sex' }, { header: 'Milking' }, { header: 'Status' },
          ],
          rows: rows.map(r => [r.tag_number, r.name ?? '', r.category, r.breed ?? '', r.sex ?? '', r.is_milking ? 'Yes' : '', r.status]),
          filename: 'cattle-register',
        })}
        filterState={filterState}
        onFilterChange={(k, s) => { setFilterState(p => ({ ...p, [k]: s as ColumnFilterState })); setPage(1) }}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        viewKey="cattle-list"
        emptyMessage={t('gaushala.empty', { defaultValue: 'No animals recorded yet.' })}
        emptyAction={{ label: t('gaushala.add', { defaultValue: 'Add animal' }), onClick: () => setShowForm(true) }}
      />
    </div>
  )
}
