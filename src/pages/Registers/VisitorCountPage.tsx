import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Save, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../components/kit/DataTable'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { VisitorCount } from '../../types'

export function VisitorCountPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const [counts, setCounts] = useState<VisitorCount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [today] = useState(new Date().toISOString().slice(0, 10))
  const [todayRecord, setTodayRecord] = useState<VisitorCount | null>(null)
  const [form, setForm] = useState({ morning_count: '', evening_count: '', notes: '' })

  const columns: ColumnDef<VisitorCount>[] = useMemo(() => [
    {
      key: 'date', label: t('registers.date'),
      render: c => <span className="text-sm">{new Date(c.count_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>,
    },
    { key: 'morning', label: t('registers.morning'), align: 'right', render: c => <>{c.morning_count || '—'}</> },
    { key: 'evening', label: t('registers.evening'), align: 'right', render: c => <>{c.evening_count || '—'}</> },
    { key: 'total', label: t('registers.totalCol'), align: 'right', render: c => <span className="font-bold">{c.total_count}</span> },
    { key: 'notes', label: t('registers.notes'), render: c => <span className="text-slate-400 text-xs">{c.notes || '—'}</span> },
     
  ], [t])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/visitor-counts?limit=60`)
      const all: VisitorCount[] = data.data || []
      setCounts(all)
      const tr = all.find(c => c.count_date === today)
      if (tr) {
        setTodayRecord(tr)
        setForm({
          morning_count: String(tr.morning_count || ''),
          evening_count: String(tr.evening_count || ''),
          notes: tr.notes || '',
        })
      }
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
          { header: t('registers.notes'), width: 30 },
        ],
        rows: counts.map(c => [
          new Date(c.count_date).toLocaleDateString('en-IN'),
          c.morning_count ?? 0, c.evening_count ?? 0, c.total_count, c.notes ?? '',
        ]),
        totals: [
          t('kit.total'),
          counts.reduce((s, c) => s + (c.morning_count ?? 0), 0),
          counts.reduce((s, c) => s + (c.evening_count ?? 0), 0),
          counts.reduce((s, c) => s + c.total_count, 0), '',
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
      await api.post('/visitor-counts', {
        count_date: today,
        morning_count: form.morning_count ? parseInt(form.morning_count) : undefined,
        evening_count: form.evening_count ? parseInt(form.evening_count) : undefined,
        notes: form.notes || undefined,
      })
      toast.success(t('registers.countSaved'))
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('registers.visitorCountTitle')} />

      <h1 className="text-xl font-bold text-navy-900 no-print">{t('registers.visitorCountTitle')}</h1>

      {/* Today's count entry */}
      <div className="card no-print">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
            <Users size={15} /> {t('registers.todaysCount', { date: new Date(today).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) })}
          </h3>
          {todayRecord && <span className="badge-blue">{t('registers.total', { count: todayRecord.total_count })}</span>}
        </div>
        <form onSubmit={save} className="card-body">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="form-label">{t('registers.morningCount')}</label>
              <input type="number" min="0" className="form-input" placeholder="0"
                value={form.morning_count} onChange={e => setForm(f => ({ ...f, morning_count: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('registers.eveningCount')}</label>
              <input type="number" min="0" className="form-input" placeholder="0"
                value={form.evening_count} onChange={e => setForm(f => ({ ...f, evening_count: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">{t('registers.notes')}</label>
              <input className="form-input" placeholder={t('registers.notesOptional')} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
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
        onPrint={() => window.print()}
        graphData={counts.slice().reverse().map(c => ({
          label: new Date(c.count_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
          value: c.total_count,
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
