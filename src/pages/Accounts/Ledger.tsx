import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, fmtPaise } from '../../lib/api'
import { rsFmt, printCurrentView } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import { DataTable, type ColumnDef } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { Account, LedgerEntry } from '../../types'

export function Ledger() {
  const { t } = useTranslation()
  const toast = useToast()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(false)
  // ?account_id= lets other statements (e.g. Trial Balance) drill straight into
  // this account's ledger — plan §07 statement drill-down.
  const [searchParams, setSearchParams] = useSearchParams()
  const [accountId, setAccountId] = useState(searchParams.get('account_id') ?? '')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('ledger', 'thisMonth'))
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.get('/accounts?is_active=true').then(r => setAccounts(r.data.data || [])).catch(() => {})
  }, [])

  useEffect(() => { if (accountId) load() }, [accountId, range])

  const account = accounts.find(a => a.id === accountId)

  const filtered = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(e =>
      e.description?.toLowerCase().includes(q) ||
      e.reference?.toLowerCase().includes(q),
    )
  }, [entries, search])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ account_id: accountId })
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const { data } = await api.get(`/accounting/ledger?${params}`)
      setEntries(data.data || [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnDef<LedgerEntry>[] = [
    { key: 'date', label: t('accounts.date'), render: e => <span className="text-xs text-slate-500">{new Date(e.date).toLocaleDateString('en-IN')}</span> },
    { key: 'description', label: t('accounts.description'), render: e => e.description },
    { key: 'reference', label: t('accounts.reference'), render: e => <span className="font-mono text-xs text-slate-400">{e.reference || '—'}</span> },
    // Debit = money into this account, credit = money out (the temple's own
    // books, not the bank's mirror of them). The colours followed the old
    // inverted convention, so a donation was painted red as a "debit".
    { key: 'debit', label: t('accounts.debit'), align: 'right', render: e => e.debit_paise > 0 ? <span className="text-green-700">₹{fmtPaise(e.debit_paise)}</span> : '—' },
    { key: 'credit', label: t('accounts.credit'), align: 'right', render: e => e.credit_paise > 0 ? <span className="text-red-600">₹{fmtPaise(e.credit_paise)}</span> : '—' },
    { key: 'balance', label: t('accounts.balance'), align: 'right', render: e => <span className="font-semibold">₹{fmtPaise(e.balance_paise)}</span> },
  ]

  const totalDebit = filtered.reduce((s, e) => s + e.debit_paise, 0)
  const totalCredit = filtered.reduce((s, e) => s + e.credit_paise, 0)
  const closingBalance = filtered.length ? filtered[filtered.length - 1].balance_paise : 0

  const stats: SummaryStat[] = accountId ? [
    { label: t('accounts.debit'), value: `₹${fmtPaise(totalDebit)}`, tone: 'income' },
    { label: t('accounts.credit'), value: `₹${fmtPaise(totalCredit)}`, tone: 'expense' },
    { label: t('accounts.closingBalance'), value: `₹${fmtPaise(closingBalance)}` },
  ] : []

  async function exportExcel() {
    if (!filtered.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('accounts.ledgerTitle'),
        subtitle: `${account?.name ?? ''} — ${rangeCaption(range, t('dateRange.all'))}`,
        filename: 'ledger',
        columns: [
          { header: t('accounts.date'), type: 'date' },
          { header: t('accounts.description'), width: 28 },
          { header: t('accounts.reference'), width: 16 },
          { header: t('accounts.debit'), type: 'money' },
          { header: t('accounts.credit'), type: 'money' },
          { header: t('accounts.balance'), type: 'money' },
        ],
        rows: filtered.map(e => [
          new Date(e.date).toLocaleDateString('en-IN'), e.description, e.reference ?? '',
          e.debit_paise, e.credit_paise, e.balance_paise,
        ]),
        totals: [t('kit.total'), '', '', totalDebit, totalCredit, closingBalance],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function exportPdf() {
    if (!filtered.length) { toast.info(t('kit.nothingToExport')); return }
    downloadRowsPdf(`ledger-${range.from}_${range.to}.pdf`, 'Account Ledger',
      ['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'],
      filtered.map(e => [new Date(e.date).toLocaleDateString('en-IN'), e.description, e.reference ?? '', rsFmt(e.debit_paise), rsFmt(e.credit_paise), rsFmt(e.balance_paise)]),
      { subtitle: `${account?.name ?? ''} — ${rangeCaption(range, t('dateRange.all'))}`, totals: ['Total', '', '', rsFmt(totalDebit), rsFmt(totalCredit), rsFmt(closingBalance)] })
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('accounts.ledgerTitle')} subtitle={accountId ? `${account?.name ?? ''} — ${rangeCaption(range, t('dateRange.all'))}` : undefined} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.ledgerTitle')}</h1>
      </div>

      <div className="flex items-end gap-3 flex-wrap no-print">
        <div>
          <label className="form-label !text-xs !mb-0.5">{t('accounts.account')}</label>
          <select
            className="form-select !py-1.5 !text-xs w-64"
            value={accountId}
            onChange={e => {
              setAccountId(e.target.value)
              // keep the URL in sync so the view is shareable/back-navigable
              if (e.target.value) setSearchParams({ account_id: e.target.value }, { replace: true })
              else setSearchParams({}, { replace: true })
            }}
          >
            <option value="">{t('accounts.selectAccount')}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
          </select>
        </div>
        <DateRangePicker value={range} onChange={setRange} storageKey="ledger" />
      </div>

      {!accountId && (
        <div className="text-center py-16 text-slate-400">{t('accounts.selectAccountPrompt')}</div>
      )}

      {accountId && (
        <>
          <SummaryStrip stats={stats} />
          <DataTable
            viewKey="ledger-list"
            columns={columns}
            rows={filtered}
            rowKey={(e, i) => `${e.date}-${i}`}
            loading={loading}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('accounts.searchDescRef')}
            onExportXlsx={exportExcel}
            onExportPdf={exportPdf}
            onPrint={() => printCurrentView()}
            filterState={{}}
            onFilterChange={() => {}}
            page={1}
            limit={filtered.length || 1}
            total={filtered.length}
            onPageChange={() => {}}
            emptyMessage={search ? t('accounts.noEntriesMatchSearch') : t('accounts.noEntriesForPeriod')}
          />
        </>
      )}
    </div>
  )
}
