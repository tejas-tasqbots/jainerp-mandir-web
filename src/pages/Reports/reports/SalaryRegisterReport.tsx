import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { printCurrentView } from '../../../lib/downloadReport'
import { api, fmtPaise } from '../../../lib/api'
import { exportXlsx } from '../../../lib/exportXlsx'
import { DataTable, type ColumnDef } from '../../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { useToast } from '../../../components/kit/Toast'

interface SalaryRow {
  id: string
  employee_name: string
  designation: string | null
  days_present: number
  days_absent: number
  days_in_month: number
  gross_paise: number
  advance_recovered_paise: number
  other_deductions_paise: number
  deductions_paise: number
  net_paise: number
  is_paid: boolean
}

interface SalaryData {
  month: string
  rows: SalaryRow[]
  totals: { staff: number; gross_paise: number; advance_recovered_paise: number; deductions_paise: number; net_paise: number }
  unpaid_paise: number
}

const thisMonth = () => new Date().toISOString().slice(0, 7)

/**
 * The salary register for one month.
 *
 * Shows the attendance the pay was computed FROM, not just the amount. A
 * register an auditor cannot reconcile to days worked is the first thing they
 * query, and until the payroll engine existed those two numbers were typed in
 * separately and could disagree.
 */
export function SalaryRegisterReport() {
  const { t } = useTranslation()
  const toast = useToast()
  const [month, setMonth] = useState(thisMonth())
  const [data, setData] = useState<SalaryData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [month])

  async function load() {
    setLoading(true)
    try {
      const { data: res } = await api.get('/reports/salary-register', { params: { month } })
      setData(res.data ?? null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const rows = data?.rows ?? []

  const columns: ColumnDef<SalaryRow>[] = [
    {
      key: 'name', label: t('reports.employee'),
      render: r => (
        <div>
          <span className="font-medium">{r.employee_name}</span>
          {r.designation && <span className="block text-xs text-slate-500">{r.designation}</span>}
        </div>
      ),
    },
    {
      key: 'days', label: t('reports.daysWorked'), align: 'right',
      render: r => <span className="tabular-nums">{r.days_present}<span className="text-slate-400"> / {r.days_in_month}</span></span>,
    },
    { key: 'gross', label: t('reports.gross'), align: 'right', render: r => <span className="tabular-nums">₹{fmtPaise(r.gross_paise)}</span> },
    {
      key: 'advance', label: t('reports.advanceRecovered'), align: 'right',
      render: r => r.advance_recovered_paise
        ? <span className="tabular-nums text-red-600">−₹{fmtPaise(r.advance_recovered_paise)}</span>
        : <span className="text-slate-400">—</span>,
    },
    { key: 'net', label: t('reports.net'), align: 'right', render: r => <span className="tabular-nums font-semibold">₹{fmtPaise(r.net_paise)}</span> },
    {
      key: 'status', label: t('common.status'),
      // A computed-but-unpaid row is a liability, not an omission — it is shown
      // rather than filtered, or month-end would understate what is owed.
      render: r => r.is_paid
        ? <span className="badge-green">{t('reports.paid')}</span>
        : <span className="badge-yellow">{t('reports.computedNotPaid')}</span>,
    },
  ]

  const stats: SummaryStat[] = data ? [
    { label: t('reports.staff'), value: String(data.totals.staff) },
    { label: t('reports.gross'), value: `₹${fmtPaise(data.totals.gross_paise)}`, tone: 'expense' },
    { label: t('reports.advanceRecovered'), value: `₹${fmtPaise(data.totals.advance_recovered_paise)}` },
    { label: t('reports.netPayable'), value: `₹${fmtPaise(data.totals.net_paise)}`, tone: 'expense' },
  ] : []

  async function exportExcel() {
    if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('reports.salaryRegister'),
        subtitle: month,
        filename: `salary-register-${month}`,
        columns: [
          { header: t('reports.employee'), width: 24 },
          { header: t('reports.daysWorked'), width: 12 },
          { header: t('reports.gross'), type: 'money' },
          { header: t('reports.advanceRecovered'), type: 'money' },
          { header: t('reports.net'), type: 'money' },
          { header: t('common.status'), width: 12 },
        ],
        rows: rows.map(r => [
          r.employee_name, `${r.days_present}/${r.days_in_month}`,
          r.gross_paise, r.advance_recovered_paise, r.net_paise,
          r.is_paid ? t('reports.paid') : t('reports.computedNotPaid'),
        ]),
        totals: [t('kit.total'), '', data?.totals.gross_paise ?? 0,
          data?.totals.advance_recovered_paise ?? 0, data?.totals.net_paise ?? 0, ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.salaryRegister')} subtitle={month} />

      <div className="card no-print">
        <div className="card-body">
          <label className="form-label" htmlFor="sr-month">{t('reports.month')}</label>
          <input id="sr-month" type="month" className="form-input w-auto"
            value={month} onChange={e => setMonth(e.target.value)} />
        </div>
      </div>

      <SummaryStrip stats={stats} />

      {!!data?.unpaid_paise && (
        <div className="card border-l-4 border-amber-500">
          <div className="card-body text-sm">
            <b>{t('reports.stillOwed')}</b>{' '}
            <span className="text-slate-600">{t('reports.stillOwedHint', { amount: fmtPaise(data.unpaid_paise) })}</span>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        loading={loading}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={rows.length || 1}
        total={rows.length}
        onPageChange={() => {}}
        emptyMessage={t('reports.noSalaryForMonth')}
      />
    </div>
  )
}
