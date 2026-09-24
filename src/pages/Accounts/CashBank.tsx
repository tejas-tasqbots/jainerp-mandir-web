import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Landmark, Wallet, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, fmtPaise, parsePaise, todayIst } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import { DataTable, type ColumnDef } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface AccountBalance {
  id: string
  name: string
  type: 'cash' | 'bank'
  bank_name?: string | null
  is_default_cash: boolean
  is_default_bank: boolean
  balance_paise: number
}

interface LedgerEntry {
  date: string
  description: string
  reference?: string | null
  debit_paise: number
  credit_paise: number
  balance_paise: number
}

type MoveDirection = 'deposit' | 'withdraw'

/**
 * Cash & Bank master-detail: every account with its live balance on the
 * left, the selected account's transactions on the right. Deposit/Withdraw
 * is a friendlier front door onto the existing contra-entries transfer —
 * same POST, just framed as "money in/out of this account" instead of
 * "pick a from and a to account".
 */
export function CashBank() {
  const { t } = useTranslation()
  const toast = useToast()

  const [accounts, setAccounts] = useState<AccountBalance[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('cash-bank', 'thisMonth'))

  const [moveModal, setMoveModal] = useState<MoveDirection | null>(null)
  const [moveOtherAccountId, setMoveOtherAccountId] = useState('')
  const [moveAmount, setMoveAmount] = useState('')
  const [moveNarration, setMoveNarration] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState('')

  useEffect(() => { loadAccounts() }, [])

  async function loadAccounts() {
    setAccountsLoading(true)
    try {
      const { data } = await api.get('/accounting/account-balances')
      const list: AccountBalance[] = data.data || []
      setAccounts(list)
      setSelectedId(prev => prev && list.some(a => a.id === prev) ? prev : (list[0]?.id ?? null))
    } catch {
      setAccounts([])
    } finally {
      setAccountsLoading(false)
    }
  }

  useEffect(() => { if (selectedId) loadEntries() }, [selectedId, range])

  async function loadEntries() {
    if (!selectedId) return
    setEntriesLoading(true)
    try {
      const params = new URLSearchParams({ account_id: selectedId })
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const { data } = await api.get(`/accounting/ledger?${params}`)
      setEntries(data.data || [])
    } catch {
      setEntries([])
    } finally {
      setEntriesLoading(false)
    }
  }

  const selected = accounts.find(a => a.id === selectedId) ?? null
  const otherAccounts = accounts.filter(a => a.id !== selectedId)

  const columns: ColumnDef<LedgerEntry>[] = useMemo(() => [
    { key: 'date', label: t('common.date'), render: e => <span className="text-xs">{new Date(e.date).toLocaleDateString('en-IN')}</span> },
    { key: 'description', label: t('accounts.description'), render: e => <span className="font-medium">{e.description}</span> },
    { key: 'reference', label: t('accounts.reference'), render: e => <span className="font-mono text-xs text-slate-400">{e.reference || '—'}</span> },
    { key: 'debit', label: t('accounts.debit'), align: 'right', render: e => <span className="text-green-700">{e.debit_paise ? `₹${fmtPaise(e.debit_paise)}` : '—'}</span> },
    { key: 'credit', label: t('accounts.credit'), align: 'right', render: e => <span className="text-red-600">{e.credit_paise ? `₹${fmtPaise(e.credit_paise)}` : '—'}</span> },
    { key: 'balance', label: t('accounts.balance'), align: 'right', render: e => <span className={`font-semibold ${e.balance_paise < 0 ? 'text-red-600' : ''}`}>₹{fmtPaise(e.balance_paise)}</span> },
     
  ], [t])

  // Totals stay on the full set (running balance is cumulative); search only
  // narrows which rows are shown.
  const q = search.trim().toLowerCase()
  const visibleEntries = q
    ? entries.filter(e => e.description?.toLowerCase().includes(q) || e.reference?.toLowerCase().includes(q))
    : entries

  const totalDebit = entries.reduce((s, e) => s + e.debit_paise, 0)
  const totalCredit = entries.reduce((s, e) => s + e.credit_paise, 0)
  const stats: SummaryStat[] = selected ? [
    { label: t('accounts.currentBalance'), value: `₹${fmtPaise(selected.balance_paise)}`, tone: selected.balance_paise < 0 ? 'expense' : 'income' },
    // Debit is money IN since the 2026-08 convention fix; these two tiles read
    // the opposite columns before it and would now be exactly reversed.
    { label: t('accounts.moneyIn'), value: `₹${fmtPaise(totalDebit)}`, tone: 'income' },
    { label: t('accounts.moneyOut'), value: `₹${fmtPaise(totalCredit)}`, tone: 'expense' },
  ] : []

  async function exportExcel() {
    if (!selected || !entries.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: `${t('accounts.cashBankTitle')} — ${selected.name}`,
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: `${selected.name}-transactions`,
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('accounts.description'), width: 30 },
          { header: t('accounts.reference'), width: 16 },
          { header: t('accounts.debit'), type: 'money' },
          { header: t('accounts.credit'), type: 'money' },
          { header: t('accounts.balance'), type: 'money' },
        ],
        rows: entries.map(e => [
          new Date(e.date).toLocaleDateString('en-IN'), e.description, e.reference ?? '',
          e.debit_paise, e.credit_paise, e.balance_paise,
        ]),
        totals: [t('kit.total'), '', '', totalDebit, totalCredit, ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function openMove(direction: MoveDirection) {
    setMoveModal(direction)
    setMoveOtherAccountId(otherAccounts[0]?.id ?? '')
    setMoveAmount('')
    setMoveNarration('')
    setMoveError('')
  }

  async function submitMove(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || !moveModal) return
    const amountPaise = parsePaise(moveAmount)
    if (!amountPaise || amountPaise <= 0) { setMoveError(t('creditors.enterValidAmount')); return }
    if (!moveOtherAccountId) { setMoveError(t('accounts.selectOtherAccount')); return }
    setMoving(true); setMoveError('')
    try {
      await api.post('/contra-entries', {
        entry_date: todayIst(),
        from_account_id: moveModal === 'deposit' ? moveOtherAccountId : selected.id,
        to_account_id: moveModal === 'deposit' ? selected.id : moveOtherAccountId,
        amount_paise: amountPaise,
        narration: moveNarration || undefined,
      })
      setMoveModal(null)
      toast.success(moveModal === 'deposit' ? t('accounts.depositSuccess') : t('accounts.withdrawSuccess'))
      loadAccounts()
      loadEntries()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      setMoveError(ex.response?.data?.error?.message || t('accounts.moveFailed'))
    } finally {
      setMoving(false)
    }
  }

  return (
    <div className="flex flex-col xl:flex-row gap-6 xl:items-start">
      {/* Rail — accounts with live balance */}
      <nav className="w-64 flex-shrink-0 space-y-3 no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('accounts.cashBankTitle')}</h1>
        {accountsLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />)}
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-slate-400">{t('accounts.noAccountsFound')}</p>
        ) : (
          <div className="space-y-1.5">
            {accounts.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedId(a.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  selectedId === a.id
                    ? 'bg-navy-900 border-navy-900 text-white'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {a.type === 'cash' ? <Wallet size={14} className="flex-shrink-0" /> : <Landmark size={14} className="flex-shrink-0" />}
                  <span className="text-sm font-medium truncate">{a.name}</span>
                </div>
                <p className={`text-base font-bold tabular-nums mt-0.5 ${selectedId === a.id ? 'text-white' : a.balance_paise < 0 ? 'text-red-600' : 'text-navy-900'}`}>
                  ₹{fmtPaise(a.balance_paise)}
                </p>
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* Detail — selected account's transactions */}
      <div className="flex-1 min-w-0 space-y-4">
        {!selected ? (
          <p className="text-slate-400 text-sm">{t('accounts.selectAnAccount')}</p>
        ) : (
          <>
            <PrintLetterhead title={`${t('accounts.cashBankTitle')} — ${selected.name}`} subtitle={rangeCaption(range, t('dateRange.all'))} />

            <div className="flex items-center justify-between no-print">
              <h2 className="text-lg font-bold text-navy-900">{selected.name}</h2>
              <div className="flex gap-2">
                <button type="button" onClick={() => openMove('deposit')} className="btn-secondary btn-sm">
                  <ArrowDownToLine size={14} /> {t('accounts.deposit')}
                </button>
                <button type="button" onClick={() => openMove('withdraw')} className="btn-secondary btn-sm">
                  <ArrowUpFromLine size={14} /> {t('accounts.withdraw')}
                </button>
              </div>
            </div>

            <div className="no-print">
              <DateRangePicker value={range} onChange={setRange} storageKey="cash-bank" />
            </div>

            <SummaryStrip stats={stats} />

            <DataTable
              viewKey="cash-bank-detail"
              columns={columns}
              rows={visibleEntries}
              rowKey={(e, i) => `${e.date}-${i}`}
              loading={entriesLoading}
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder={t('accounts.searchDescRef')}
              onExportXlsx={exportExcel}
              onPrint={() => printCurrentView()}
              filterState={{}}
              onFilterChange={() => {}}
              page={1}
              limit={visibleEntries.length || 1}
              total={visibleEntries.length}
              onPageChange={() => {}}
              emptyMessage={search ? t('accounts.noEntriesMatchSearch') : t('accounts.noTransactionsInRange')}
            />
          </>
        )}
      </div>

      {/* Deposit / Withdraw modal */}
      {moveModal && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-bold text-navy-900 mb-1">
              {moveModal === 'deposit' ? t('accounts.depositTo', { account: selected.name }) : t('accounts.withdrawFrom', { account: selected.name })}
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              {moveModal === 'deposit' ? t('accounts.depositHint') : t('accounts.withdrawHint')}
            </p>
            <form onSubmit={submitMove} className="space-y-4">
              <div>
                <label className="form-label">{moveModal === 'deposit' ? t('accounts.fromAccount') : t('accounts.toAccount')}</label>
                <select className="form-select" value={moveOtherAccountId} onChange={e => setMoveOtherAccountId(e.target.value)} required>
                  <option value="">{t('accounts.select')}</option>
                  {otherAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">{t('accounts.amount')}</label>
                <input type="number" min="0.01" step="0.01" className="form-input" autoFocus required
                  value={moveAmount} onChange={e => { setMoveAmount(e.target.value); setMoveError('') }} />
              </div>
              <div>
                <label className="form-label">{t('accounts.narration')}</label>
                <input className="form-input" value={moveNarration} onChange={e => setMoveNarration(e.target.value)} />
              </div>
              {moveError && <p className="text-sm text-red-600">{moveError}</p>}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setMoveModal(null)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={moving} className="btn-primary">
                  {moving ? t('common.saving') : moveModal === 'deposit' ? t('accounts.deposit') : t('accounts.withdraw')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
