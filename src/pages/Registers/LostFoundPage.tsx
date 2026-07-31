import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save, PackageCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DataTable, filterStateToParams, type ColumnDef, type ColumnFilterState, type RowAction } from '../../components/kit/DataTable'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { LostFoundItem } from '../../types'

const STATUSES = ['unclaimed', 'claimed', 'donated', 'disposed'] as const

export function LostFoundPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const [items, setItems] = useState<LostFoundItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    description: '',
    found_date: new Date().toISOString().slice(0, 10),
    found_location: '',
    notes: '',
  })
  const [claimModal, setClaimModal] = useState<{ id: string } | null>(null)
  const [claimForm, setClaimForm] = useState({ name: '', mobile: '' })

  function statusBadge(s: string) {
    if (s === 'unclaimed') return <span className="badge-yellow">{t('registers.statusUnclaimed')}</span>
    if (s === 'claimed') return <span className="badge-green">{t('registers.statusClaimed')}</span>
    if (s === 'donated') return <span className="badge-blue">{t('registers.statusDonated')}</span>
    return <span className="badge-gray">{t('registers.statusDisposed')}</span>
  }

  const statusLabel: Record<string, string> = {
    unclaimed: t('registers.statusUnclaimed'),
    claimed: t('registers.statusClaimed'),
    donated: t('registers.statusDonated'),
    disposed: t('registers.statusDisposed'),
  }

  const columns: ColumnDef<LostFoundItem>[] = useMemo(() => [
    { key: 'description', label: t('registers.descriptionCol'), render: i => <span className="font-medium">{i.description}</span> },
    {
      key: 'found_date', label: t('registers.foundDateCol'),
      render: i => <span className="text-xs">{new Date(i.found_date).toLocaleDateString('en-IN')}</span>,
    },
    { key: 'location', label: t('registers.location'), render: i => <span className="text-slate-500">{i.found_location || '—'}</span> },
    {
      key: 'status', label: t('registers.status'),
      filter: { kind: 'enum', param: 'status', options: STATUSES.map(s => ({ value: s, label: statusLabel[s] })) },
      render: i => statusBadge(i.status),
    },
    { key: 'claimant', label: t('registers.claimant'), render: i => <>{i.claimant_name || '—'}</> },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t])

  useEffect(() => { load() }, [search, filterState])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (search) params.set('q', search)
      for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
      const { data } = await api.get(`/lost-found?${params}`)
      setItems(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function exportExcel() {
    if (!items.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('registers.lostFoundTitle'),
        filename: 'lost-found',
        columns: [
          { header: t('registers.foundDateCol'), type: 'date' },
          { header: t('registers.descriptionCol'), width: 32 },
          { header: t('registers.location'), width: 20 },
          { header: t('registers.status'), width: 12 },
          { header: t('registers.claimant'), width: 22 },
        ],
        rows: items.map(i => [
          new Date(i.found_date).toLocaleDateString('en-IN'), i.description,
          i.found_location ?? '', statusLabel[i.status] ?? i.status, i.claimant_name ?? '',
        ]),
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/lost-found', {
        description: form.description,
        found_date: form.found_date,
        found_location: form.found_location || undefined,
        notes: form.notes || undefined,
      })
      setForm({ description: '', found_date: new Date().toISOString().slice(0, 10), found_location: '', notes: '' })
      setShowForm(false)
      toast.success(t('registers.itemRecorded'))
      load()
    } finally {
      setSaving(false)
    }
  }

  async function submitClaim(e: React.FormEvent) {
    e.preventDefault()
    if (!claimModal || !claimForm.name.trim()) return
    try {
      await api.patch(`/lost-found/${claimModal.id}/claim`, {
        claimant_name: claimForm.name.trim(),
        claimant_mobile: claimForm.mobile || undefined,
      })
      setClaimModal(null)
      toast.success(t('registers.claimRecorded'))
      load()
    } catch {
      toast.error(t('registers.claimFailed'))
    }
  }

  const stats: SummaryStat[] = [
    { label: t('lostFound.title'), value: String(items.length) },
    { label: t('lostFound.statusUnclaimed'), value: String(items.filter(i => i.status === 'unclaimed').length), tone: 'expense' },
  ]

  function rowActions(i: LostFoundItem): RowAction[] {
    // Nothing to do once an item has been handed back.
    if (i.status !== 'unclaimed') return []
    return [{
      label: t('registers.markClaimed'), icon: <PackageCheck size={13} />,
      onClick: () => { setClaimForm({ name: '', mobile: '' }); setClaimModal({ id: i.id }) },
    }]
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('registers.lostFoundTitle')} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('registers.lostFoundTitle')}</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm">
          <Plus size={14} /> {t('registers.reportFoundItem')}
        </button>
      </div>

      {showForm && (
        <div className="card no-print">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('registers.reportFoundItem')}</h3></div>
          <form onSubmit={submit} className="card-body space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">{t('registers.description')}</label>
                <input className="form-input" placeholder={t('registers.descriptionPlaceholder')} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('registers.foundDate')}</label>
                <input type="date" className="form-input" value={form.found_date}
                  onChange={e => setForm(f => ({ ...f, found_date: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">{t('registers.locationFound')}</label>
                <input className="form-input" placeholder={t('registers.locationPlaceholder')} value={form.found_location}
                  onChange={e => setForm(f => ({ ...f, found_location: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">{t('registers.notes')}</label>
                <input className="form-input" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary btn-sm"><Save size={14} /> {saving ? t('common.saving') : t('common.save')}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="lost-found-list"
        columns={columns}
        rows={items}
        rowKey={i => i.id}
        rowActions={rowActions}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('registers.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
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
        total={items.length}
        onPageChange={() => {}}
        emptyMessage={t('registers.noItemsInRegister')}
        emptyAction={{ label: t('registers.reportFoundItem'), onClick: () => setShowForm(true) }}
        onClearFilters={() => setFilterState({})}
      />

      {/* Claim modal — replaces the old window.prompt flow */}
      {claimModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-4">{t('registers.markClaimed')}</h3>
            <form onSubmit={submitClaim} className="space-y-4">
              <div>
                <label className="form-label">{t('registers.claimantName')} *</label>
                <input className="form-input" autoFocus value={claimForm.name}
                  onChange={e => setClaimForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('registers.claimantMobile')}</label>
                <input type="tel" className="form-input" value={claimForm.mobile}
                  onChange={e => setClaimForm(f => ({ ...f, mobile: e.target.value }))} />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setClaimModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={!claimForm.name.trim()} className="btn-success">{t('registers.markClaimed')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
