import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { DataTable, filterStateToParams, type ColumnDef, type ColumnFilterState } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { Loan } from '../../types'

const PAGE_SIZE = 20

export function Loans() {
  const { t } = useTranslation()
  const toast = useToast()
  const [loans, setLoans] = useState<Loan[]>([])
  const [meta, setMeta] = useState<{ total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    type: 'taken', party_name: '', principal: '',
    interest_rate: '0', start_date: new Date().toISOString().slice(0, 10), end_date: '',
  })

  const columns: ColumnDef<Loan>[] = [
    {
      key: 'type', label: t('accounts.type'),
      filter: { kind: 'enum', param: 'loan_type', options: [{ value: 'taken', label: t('accounts.loanTaken') }, { value: 'given', label: t('accounts.loanGiven') }] },
      render: l => <span className={l.loan_type === 'taken' ? 'badge-red' : 'badge-green'}>{l.loan_type === 'taken' ? t('accounts.typeTaken') : t('accounts.typeGiven')}</span>,
    },
    { key: 'party', label: t('accounts.party'), sortable: true, render: l => <span className="font-medium">{l.party_name}</span> },
    { key: 'principal', label: t('accounts.principal'), align: 'right', render: l => `₹${fmtPaise(l.principal_paise)}` },
    { key: 'interest', label: t('accounts.interest'), align: 'right', render: l => `${l.interest_rate}%` },
    { key: 'repaid', label: t('accounts.repaid'), align: 'right', render: l => <span className="text-green-700">₹{fmtPaise(l.repaid_paise)}</span> },
    { key: 'outstanding', label: t('accounts.outstanding'), align: 'right', render: l => l.principal_paise - l.repaid_paise > 0 ? <span className="font-semibold">₹{fmtPaise(l.principal_paise - l.repaid_paise)}</span> : '—' },
    { key: 'start', label: t('accounts.start'), render: l => <span className="text-xs text-slate-500">{new Date(l.start_date).toLocaleDateString('en-IN')}</span> },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'status', options: [{ value: 'active', label: t('accounts.active') }, { value: 'closed', label: t('accounts.closed') }] },
      render: l => l.status === 'active' ? <span className="badge-blue">{t('accounts.active')}</span> : <span className="badge-gray">{t('accounts.closed')}</span>,
    },
  ]

  function buildParams(limit: number, forPage = 1): URLSearchParams {
    const params = new URLSearchParams({ page: String(forPage), limit: String(limit) })
    if (search) params.set('q', search)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, search, filterState])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/loans?${buildParams(PAGE_SIZE, page)}`)
      setLoans(data.data || [])
      setMeta(data.meta || null)
    } catch {
      setLoans([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/loans', {
        type: form.type,
        party_name: form.party_name,
        principal_paise: parsePaise(form.principal),
        interest_rate: parseFloat(form.interest_rate),
        start_date: form.start_date,
        end_date: form.end_date || undefined,
      })
      setShowForm(false)
      setForm({ type: 'taken', party_name: '', principal: '', interest_rate: '0', start_date: new Date().toISOString().slice(0, 10), end_date: '' })
      toast.success(t('accounts.loanAdded'))
      setPage(1)
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('accounts.loanAddFailed'))
    } finally {
      setSaving(false)
    }
  }

  const stats: SummaryStat[] = meta ? [
    { label: t('accounts.principal'), value: `₹${fmtPaise(loans.reduce((s, l) => s + l.principal_paise, 0))}` },
    { label: t('accounts.repaid'), value: `₹${fmtPaise(loans.reduce((s, l) => s + l.repaid_paise, 0))}`, tone: 'income' },
    { label: t('accounts.outstanding'), value: `₹${fmtPaise(loans.reduce((s, l) => s + (l.principal_paise - l.repaid_paise), 0))}` },
  ] : []

  async function exportExcel() {
    try {
      const { data } = await api.get(`/loans?${buildParams(1000)}`)
      const rows: Loan[] = data.data || []
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('accounts.loansTitle'),
        filename: 'loans',
        columns: [
          { header: t('accounts.type'), width: 10 }, { header: t('accounts.party'), width: 22 },
          { header: t('accounts.principal'), type: 'money' }, { header: t('accounts.interest'), width: 8 },
          { header: t('accounts.repaid'), type: 'money' }, { header: t('accounts.outstanding'), type: 'money' },
          { header: t('accounts.start'), type: 'date' }, { header: t('common.status'), width: 10 },
        ],
        rows: rows.map(l => [
          l.loan_type === 'taken' ? t('accounts.typeTaken') : t('accounts.typeGiven'), l.party_name, l.principal_paise,
          l.interest_rate, l.repaid_paise, l.principal_paise - l.repaid_paise,
          new Date(l.start_date).toLocaleDateString('en-IN'), l.status === 'active' ? t('accounts.active') : t('accounts.closed'),
        ]),
        totals: [t('kit.total'), '', rows.reduce((s, l) => s + l.principal_paise, 0), '', rows.reduce((s, l) => s + l.repaid_paise, 0), rows.reduce((s, l) => s + (l.principal_paise - l.repaid_paise), 0), '', ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('accounts.loansTitle')} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.loansTitle')}</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm"><Plus size={14} /> {t('accounts.addLoan')}</button>
      </div>

      {showForm && (
        <div className="card no-print">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('accounts.recordLoan')}</h3></div>
          <form onSubmit={submit} className="card-body space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="form-label">{t('accounts.type')}</label>
                <select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="taken">{t('accounts.loanTaken')}</option><option value="given">{t('accounts.loanGiven')}</option>
                </select>
              </div>
              <div><label className="form-label">{t('accounts.partyName')}</label><input className="form-input" value={form.party_name} onChange={e => setForm(f => ({ ...f, party_name: e.target.value }))} required /></div>
              <div><label className="form-label">{t('accounts.principal')}</label><input type="number" className="form-input" value={form.principal} onChange={e => setForm(f => ({ ...f, principal: e.target.value }))} required /></div>
              <div><label className="form-label">{t('accounts.interestRate')}</label><input type="number" step="0.01" className="form-input" value={form.interest_rate} onChange={e => setForm(f => ({ ...f, interest_rate: e.target.value }))} /></div>
              <div><label className="form-label">{t('accounts.startDate')}</label><input type="date" className="form-input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
              <div><label className="form-label">{t('accounts.endDate')}</label><input type="date" className="form-input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
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
        viewKey="loans-list"
        columns={columns}
        rows={loans}
        rowKey={l => l.id}
        loading={loading}
        searchValue={search}
        onSearchChange={v => { setSearch(v); setPage(1) }}
        searchPlaceholder={t('accounts.searchLoans')}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => { const next = { ...prev }; if (s) next[key] = s; else delete next[key]; return next })
          setPage(1)
        }}
        page={page}
        limit={PAGE_SIZE}
        total={meta?.total ?? 0}
        onPageChange={setPage}
        emptyMessage={t('accounts.noLoans')}
        emptyAction={{ label: t('accounts.addLoan'), onClick: () => setShowForm(true) }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
      />
    </div>
  )
}
