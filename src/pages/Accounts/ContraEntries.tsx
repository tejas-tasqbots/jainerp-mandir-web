import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import { DataTable, type ColumnDef } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { Account } from '../../types'

const PAGE_SIZE = 20

interface ContraEntry {
  id: string
  entry_date: string
  from_account_id: string
  to_account_id: string
  amount_paise: number
  description?: string
  created_at: string
}

export function ContraEntries() {
  const { t } = useTranslation()
  const toast = useToast()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entries, setEntries] = useState<ContraEntry[]>([])
  const [meta, setMeta] = useState<{ total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('contra-entries', 'thisMonth'))

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ from_account_id: '', to_account_id: '', amount: '', narration: '' })

  useEffect(() => {
    api.get('/accounts?is_active=true').then(r => setAccounts(r.data.data || [])).catch(() => {})
  }, [])

  useEffect(() => { load() }, [page, range])

  function buildParams(limit: number, forPage = 1): URLSearchParams {
    const params = new URLSearchParams({ page: String(forPage), limit: String(limit) })
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    return params
  }

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/contra-entries?${buildParams(PAGE_SIZE, page)}`)
      setEntries(data.data || [])
      setMeta(data.meta || null)
    } catch {
      setEntries([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }

  const accountName = useMemo(() => {
    const map = new Map(accounts.map(a => [a.id, a.name]))
    return (id: string) => map.get(id) || '—'
  }, [accounts])

  // Client-side search over the loaded page (account names / narration).
  const q = search.trim().toLowerCase()
  const visible = q ? entries.filter(e =>
    accountName(e.from_account_id).toLowerCase().includes(q) ||
    accountName(e.to_account_id).toLowerCase().includes(q) ||
    (e.description ?? '').toLowerCase().includes(q)) : entries

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (form.from_account_id === form.to_account_id) { toast.error(t('accounts.contraSameAccountError')); return }
    setSaving(true)
    try {
      await api.post('/contra-entries', {
        entry_date: new Date().toISOString().slice(0, 10),
        from_account_id: form.from_account_id,
        to_account_id: form.to_account_id,
        amount_paise: parsePaise(form.amount),
        description: form.narration || undefined,
      })
      setForm({ from_account_id: '', to_account_id: '', amount: '', narration: '' })
      setShowForm(false)
      toast.success(t('accounts.contraSuccess'))
      setPage(1)
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('accounts.contraFailed'))
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnDef<ContraEntry>[] = [
    { key: 'date', label: t('accounts.date'), render: e => <span className="text-xs text-slate-500">{new Date(e.entry_date).toLocaleDateString('en-IN')}</span> },
    { key: 'from', label: t('accounts.fromCol'), render: e => accountName(e.from_account_id) },
    { key: 'to', label: t('accounts.toCol'), render: e => accountName(e.to_account_id) },
    { key: 'amount', label: t('common.amount'), align: 'right', render: e => <span className="font-semibold">₹{fmtPaise(e.amount_paise)}</span> },
    { key: 'narration', label: t('accounts.narration'), render: e => <span className="text-slate-500">{e.description || '—'}</span> },
  ]

  const totalTransferred = entries.reduce((s, e) => s + e.amount_paise, 0)
  const stats: SummaryStat[] = meta ? [
    { label: t('accounts.totalTransferred'), value: `₹${fmtPaise(totalTransferred)}` },
    { label: t('accounts.contraTitle'), value: String(meta.total) },
  ] : []

  async function exportExcel() {
    try {
      const { data } = await api.get(`/contra-entries?${buildParams(1000)}`)
      const rows: ContraEntry[] = data.data || []
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('accounts.contraTitle'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'contra-entries',
        columns: [
          { header: t('accounts.date'), type: 'date' },
          { header: t('accounts.fromCol'), width: 20 },
          { header: t('accounts.toCol'), width: 20 },
          { header: t('common.amount'), type: 'money' },
          { header: t('accounts.narration'), width: 28 },
        ],
        rows: rows.map(e => [
          new Date(e.entry_date).toLocaleDateString('en-IN'), accountName(e.from_account_id), accountName(e.to_account_id),
          e.amount_paise, e.description ?? '',
        ]),
        totals: [t('kit.total'), '', '', rows.reduce((s, e) => s + e.amount_paise, 0), ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('accounts.contraTitle')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.contraTitle')}</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm">
          <Plus size={14} /> {t('accounts.newTransfer')}
        </button>
      </div>

      {showForm && (
        <div className="card no-print">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('accounts.recordTransfer')}</h3></div>
          <form onSubmit={submit} className="card-body space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">{t('accounts.fromAccount')}</label>
                <select className="form-select" value={form.from_account_id}
                  onChange={e => setForm(f => ({ ...f, from_account_id: e.target.value }))} required>
                  <option value="">{t('accounts.select')}</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">{t('accounts.toAccount')}</label>
                <select className="form-select" value={form.to_account_id}
                  onChange={e => setForm(f => ({ ...f, to_account_id: e.target.value }))} required>
                  <option value="">{t('accounts.select')}</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">{t('accounts.amount')}</label>
                <input type="number" min="1" step="0.01" className="form-input" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('accounts.narration')}</label>
                <input className="form-input" value={form.narration}
                  onChange={e => setForm(f => ({ ...f, narration: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary btn-sm"><Save size={14} /> {saving ? t('common.saving') : t('accounts.record')}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="no-print">
        <DateRangePicker value={range} onChange={v => { setRange(v); setPage(1) }} storageKey="contra-entries" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="contra-entries-list"
        columns={columns}
        rows={visible}
        rowKey={e => e.id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('accounts.searchTransfers')}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={{}}
        onFilterChange={() => {}}
        page={page}
        limit={PAGE_SIZE}
        total={meta?.total ?? 0}
        onPageChange={setPage}
        emptyMessage={t('accounts.noTransferEntries')}
        emptyAction={{ label: t('accounts.newTransfer'), onClick: () => setShowForm(true) }}
      />
    </div>
  )
}
