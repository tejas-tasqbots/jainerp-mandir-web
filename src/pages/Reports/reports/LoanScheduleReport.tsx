import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface LoanRow {
  id: string
  loan_type: 'taken' | 'given'
  party_name: string
  party_mobile: string | null
  account_name: string | null
  principal_paise: number
  repaid_paise: number
  outstanding_paise: number
  interest_rate: number
  days_elapsed: number
  interest_accrued_paise: number
  payable_paise: number
  start_date: string
  end_date: string | null
  status: string
}

interface Bucket { count: number; outstanding_paise: number; interest_accrued_paise: number }

/** Loans taken / given with interest accrued to date (plan §03). */
export function LoanScheduleReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [rows, setRows] = useState<LoanRow[]>([])
  const [totals, setTotals] = useState<{ taken: Bucket; given: Bucket } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data: res } = await api.get('/reports/loan-schedule')
      setRows(res.data?.rows ?? [])
      setTotals(res.data?.totals ?? null)
    } catch {
      setRows([])
      setTotals(null)
    } finally {
      setLoading(false)
    }
  }

  // Loans are few, so the column filters run client-side.
  const visible = rows.filter(r => {
    const q = search.trim().toLowerCase()
    if (q && !`${r.party_name} ${r.party_mobile ?? ''}`.toLowerCase().includes(q)) return false
    const pick = (key: string, value: string) => {
      const vals = filterState[key]?.values
      return !vals?.length || vals.includes(value)
    }
    return pick('loan_type', r.loan_type) && pick('status', r.status)
  })

  const columns: ColumnDef<LoanRow>[] = [
    {
      key: 'party_name', label: t('loans.party'),
      render: r => (
        <div>
          <span className="font-medium">{r.party_name}</span>
          {r.party_mobile && <div className="text-xs text-slate-400">{r.party_mobile}</div>}
        </div>
      ),
    },
    {
      key: 'loan_type', label: t('common.type'),
      filter: { kind: 'enum', param: 'loan_type', options: [{ value: 'taken', label: t('loans.taken') }, { value: 'given', label: t('loans.given') }] },
      render: r => r.loan_type === 'taken'
        ? <span className="badge-red">{t('loans.taken')}</span>
        : <span className="badge-green">{t('loans.given')}</span>,
    },
    { key: 'principal', label: t('loans.principal'), align: 'right', render: r => `₹${fmtPaise(r.principal_paise)}` },
    { key: 'repaid', label: t('loans.repaid'), align: 'right', render: r => `₹${fmtPaise(r.repaid_paise)}` },
    {
      key: 'outstanding', label: t('reports.outstandingPrincipal'), align: 'right',
      render: r => <span className="font-semibold">₹{fmtPaise(r.outstanding_paise)}</span>,
    },
    {
      key: 'interest', label: t('reports.interestAccrued'), align: 'right',
      render: r => (
        <span title={t('reports.interestBasis', { rate: r.interest_rate, days: r.days_elapsed })}>
          ₹{fmtPaise(r.interest_accrued_paise)}
        </span>
      ),
    },
    {
      key: 'payable', label: t('reports.totalPayable'), align: 'right',
      render: r => <span className="font-semibold">₹{fmtPaise(r.payable_paise)}</span>,
    },
    {
      key: 'status', label: t('common.status'),
      filter: { kind: 'enum', param: 'status', options: [{ value: 'active', label: t('loans.active') }, { value: 'closed', label: t('loans.closed') }] },
      render: r => r.status === 'active'
        ? <span className="badge-yellow">{t('loans.active')}</span>
        : <span className="badge-gray">{t('loans.closed')}</span>,
    },
  ]

  const stats: SummaryStat[] = totals ? [
    { label: t('reports.loansTakenOutstanding'), value: `₹${fmtPaise(totals.taken.outstanding_paise)}`, sub: `${totals.taken.count} ${t('reports.entries')}`, tone: 'expense' },
    { label: t('reports.loansGivenOutstanding'), value: `₹${fmtPaise(totals.given.outstanding_paise)}`, sub: `${totals.given.count} ${t('reports.entries')}`, tone: 'income' },
    { label: t('reports.interestAccrued'), value: `₹${fmtPaise(totals.taken.interest_accrued_paise + totals.given.interest_accrued_paise)}` },
  ] : []

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.loanSchedule'),
        filename: 'loan-schedule',
        columns: [
          { header: t('loans.party'), width: 26 },
          { header: t('common.type'), width: 10 },
          { header: t('loans.principal'), type: 'money' },
          { header: t('loans.repaid'), type: 'money' },
          { header: t('reports.outstandingPrincipal'), type: 'money' },
          { header: t('reports.interestAccrued'), type: 'money' },
          { header: t('reports.totalPayable'), type: 'money' },
          { header: t('common.status'), width: 12 },
        ],
        rows: visible.map(r => [
          r.party_name, r.loan_type === 'taken' ? t('loans.taken') : t('loans.given'),
          r.principal_paise, r.repaid_paise, r.outstanding_paise,
          r.interest_accrued_paise, r.payable_paise, r.status,
        ]),
        totals: [
          t('kit.total'), '',
          visible.reduce((s, r) => s + r.principal_paise, 0),
          visible.reduce((s, r) => s + r.repaid_paise, 0),
          visible.reduce((s, r) => s + r.outstanding_paise, 0),
          visible.reduce((s, r) => s + r.interest_accrued_paise, 0),
          visible.reduce((s, r) => s + r.payable_paise, 0),
          '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.loanSchedule')} />

      <SummaryStrip stats={stats} />

      <p className="text-xs text-slate-400 no-print">{t('reports.loanInterestNote')}</p>

      <DataTable
        columns={columns}
        rows={visible}
        rowKey={r => r.id}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('loans.searchPlaceholder')}
        filterState={filterState}
        onFilterChange={(key, st) => {
          setFilterState(prev => { const next = { ...prev }; if (st) next[key] = st; else delete next[key]; return next })
        }}
        onClearFilters={() => { setFilterState({}); setSearch('') }}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        page={1}
        limit={visible.length || 1}
        total={visible.length}
        onPageChange={() => {}}
        viewKey="report-loan-schedule"
        emptyMessage={t('reports.noData')}
      />
    </div>
  )
}
