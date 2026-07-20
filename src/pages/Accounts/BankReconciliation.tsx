import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface Account { id: string; name: string; type: 'cash' | 'bank' }
interface BookEntry {
  date: string
  description: string
  reference?: string | null
  debit_paise: number
  credit_paise: number
}
interface StatementRow { date: string; description: string; amount_paise: number /** +credit, -debit */ }

interface MatchedRow { book: BookEntry; statement: StatementRow }

/**
 * Bank reconciliation — paste/upload the bank's own statement CSV and match
 * it against our Bank Book for the same period. Matching (same date ±2 days,
 * same amount and side) and the reconciliation result are computed entirely
 * in the browser and not persisted — this is a point-in-time check, run it
 * again whenever you want a fresh comparison. No new tables, no server load.
 */
export function BankReconciliation() {
  const { t } = useTranslation()
  const toast = useToast()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('bank-recon', 'thisMonth'))
  const [bookEntries, setBookEntries] = useState<BookEntry[]>([])
  const [loadingBook, setLoadingBook] = useState(false)

  const [csvText, setCsvText] = useState('')
  const [statementRows, setStatementRows] = useState<StatementRow[]>([])
  const [parseError, setParseError] = useState('')

  useEffect(() => {
    api.get('/accounting/account-balances').then(r => {
      const list: Account[] = (r.data.data || []).filter((a: Account) => a.type === 'bank')
      setAccounts(list)
      setAccountId(prev => prev || list[0]?.id || '')
    }).catch(() => {})
  }, [])

  useEffect(() => { if (accountId) loadBook() }, [accountId, range])

  async function loadBook() {
    setLoadingBook(true)
    try {
      const params = new URLSearchParams({ account_id: accountId })
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const { data } = await api.get(`/accounting/ledger?${params}`)
      setBookEntries(data.data || [])
    } catch {
      setBookEntries([])
    } finally {
      setLoadingBook(false)
    }
  }

  function parseCsv(text: string) {
    setParseError('')
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) { setStatementRows([]); return }
    const splitLine = (line: string) => line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const headers = splitLine(lines[0]).map(h => h.toLowerCase())
    const dateIdx = headers.findIndex(h => h.includes('date'))
    const descIdx = headers.findIndex(h => h.includes('desc') || h.includes('narration') || h.includes('particular'))
    const debitIdx = headers.findIndex(h => h.includes('debit') || h.includes('withdrawal'))
    const creditIdx = headers.findIndex(h => h.includes('credit') || h.includes('deposit'))
    const amountIdx = headers.findIndex(h => h === 'amount')
    if (dateIdx === -1 || (debitIdx === -1 && creditIdx === -1 && amountIdx === -1)) {
      setParseError(t('bankRecon.csvFormatError'))
      setStatementRows([])
      return
    }
    const rows: StatementRow[] = []
    for (const line of lines.slice(1)) {
      const cells = splitLine(line)
      const rawDate = cells[dateIdx]
      if (!rawDate) continue
      const date = normalizeDate(rawDate)
      if (!date) continue
      let amount = 0
      if (amountIdx !== -1) {
        amount = Math.round(parseFloat(cells[amountIdx] || '0') * 100)
      } else {
        const debit = parseFloat(cells[debitIdx] || '0') || 0
        const credit = parseFloat(cells[creditIdx] || '0') || 0
        amount = Math.round((credit - debit) * 100)
      }
      if (!amount) continue
      rows.push({ date, description: descIdx !== -1 ? cells[descIdx] || '' : '', amount_paise: amount })
    }
    setStatementRows(rows)
  }

  function normalizeDate(raw: string): string | null {
    // Accept yyyy-mm-dd or dd/mm/yyyy (common Indian bank export format).
    const iso = /^\d{4}-\d{2}-\d{2}$/
    if (iso.test(raw)) return raw
    const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    if (dmy) {
      const [, d, m, y] = dmy
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }
    return null
  }

  function onFile(f: File | undefined) {
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => { const text = String(reader.result ?? ''); setCsvText(text); parseCsv(text) }
    reader.readAsText(f)
  }

  // ── Matching: same side (debit/credit), same amount, date within 2 days ──
  const { matched, unmatchedBook, unmatchedStatement } = useMemo(() => {
    const bookPool = bookEntries.map((e, i) => ({ ...e, _idx: i, _used: false }))
    const matches: MatchedRow[] = []
    const leftoverStatement: StatementRow[] = []

    for (const s of statementRows) {
      const sDate = new Date(s.date).getTime()
      const candidate = bookPool.find(b => {
        if (b._used) return false
        const bAmount = b.credit_paise > 0 ? b.credit_paise : -b.debit_paise
        if (bAmount !== s.amount_paise) return false
        const bDate = new Date(b.date).getTime()
        return Math.abs(bDate - sDate) <= 2 * 86_400_000
      })
      if (candidate) {
        candidate._used = true
        matches.push({ book: candidate, statement: s })
      } else {
        leftoverStatement.push(s)
      }
    }
    return {
      matched: matches,
      unmatchedBook: bookPool.filter(b => !b._used),
      unmatchedStatement: leftoverStatement,
    }
  }, [bookEntries, statementRows])

  const stats: SummaryStat[] = statementRows.length ? [
    { label: t('bankRecon.matched'), value: String(matched.length), tone: 'income' },
    { label: t('bankRecon.unmatchedInBooks'), value: String(unmatchedBook.length), tone: unmatchedBook.length ? 'expense' : 'default' },
    { label: t('bankRecon.unmatchedInStatement'), value: String(unmatchedStatement.length), tone: unmatchedStatement.length ? 'expense' : 'default' },
  ] : []

  async function exportReport() {
    const account = accounts.find(a => a.id === accountId)
    if (!matched.length && !unmatchedBook.length && !unmatchedStatement.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('bankRecon.title'),
        subtitle: `${account?.name ?? ''} — ${rangeCaption(range, t('dateRange.all'))}`,
        filename: 'bank-reconciliation',
        columns: [
          { header: t('common.status'), width: 14 },
          { header: t('common.date'), type: 'date' },
          { header: t('accounts.description'), width: 30 },
          { header: t('common.amount'), type: 'money' },
        ],
        rows: [
          ...matched.map(m => [t('bankRecon.matched'), m.book.date, m.book.description, (m.book.credit_paise || -m.book.debit_paise)]),
          ...unmatchedBook.map(b => [t('bankRecon.unmatchedInBooks'), b.date, b.description, (b.credit_paise || -b.debit_paise)]),
          ...unmatchedStatement.map(s => [t('bankRecon.unmatchedInStatement'), s.date, s.description, s.amount_paise]),
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('bankRecon.title')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('bankRecon.title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('bankRecon.subtitle')}</p>
      </div>

      <div className="flex items-end gap-3 flex-wrap no-print">
        <div>
          <label className="form-label !text-xs !mb-0.5">{t('accounts.select')}</label>
          <select className="form-select !py-1.5 !text-xs w-56" value={accountId} onChange={e => setAccountId(e.target.value)}>
            {accounts.length === 0 && <option value="">{t('accounts.noAccountsFound')}</option>}
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <DateRangePicker value={range} onChange={setRange} storageKey="bank-recon" />
      </div>

      <div className="card no-print">
        <div className="card-header"><h3 className="font-semibold text-sm">{t('bankRecon.uploadTitle')}</h3></div>
        <div className="card-body space-y-3">
          <p className="text-xs text-slate-500">{t('bankRecon.uploadHint')}</p>
          <div className="flex items-center gap-3">
            <label className="btn-secondary btn-sm cursor-pointer">
              <Upload size={14} /> {t('bankRecon.uploadCsv')}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
            </label>
            <span className="text-xs text-slate-400">{t('bankRecon.orPasteBelow')}</span>
          </div>
          <textarea
            className="form-input font-mono text-xs" rows={5}
            placeholder={'Date,Description,Debit,Credit\n05/07/2026,NEFT-DONOR,,5100\n07/07/2026,CHQ-VENDOR,3200,'}
            value={csvText}
            onChange={e => { setCsvText(e.target.value); parseCsv(e.target.value) }}
          />
          {parseError && <p className="text-sm text-red-600">{parseError}</p>}
          {statementRows.length > 0 && <p className="text-xs text-green-700">{t('bankRecon.parsedCount', { count: statementRows.length })}</p>}
        </div>
      </div>

      {statementRows.length > 0 && (
        <>
          <SummaryStrip stats={stats} />

          <div className="flex justify-end no-print">
            <button type="button" onClick={exportReport} className="btn-secondary btn-sm">
              <FileSpreadsheet size={14} /> {t('kit.exportExcel')}
            </button>
          </div>

          {unmatchedStatement.length > 0 && (
            <div className="card">
              <div className="card-header flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" />
                <h3 className="font-semibold text-sm">{t('bankRecon.unmatchedInStatement')}</h3>
                <span className="badge-yellow">{unmatchedStatement.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>{t('common.date')}</th><th>{t('accounts.description')}</th><th className="text-right">{t('common.amount')}</th></tr></thead>
                  <tbody>
                    {unmatchedStatement.map((s, i) => (
                      <tr key={i}>
                        <td className="text-xs">{new Date(s.date).toLocaleDateString('en-IN')}</td>
                        <td className="text-slate-600">{s.description || '—'}</td>
                        <td className={`text-right font-semibold tabular-nums ${s.amount_paise < 0 ? 'text-red-600' : 'text-green-700'}`}>₹{fmtPaise(Math.abs(s.amount_paise))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {unmatchedBook.length > 0 && (
            <div className="card">
              <div className="card-header flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" />
                <h3 className="font-semibold text-sm">{t('bankRecon.unmatchedInBooks')}</h3>
                <span className="badge-yellow">{unmatchedBook.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>{t('common.date')}</th><th>{t('accounts.description')}</th><th className="text-right">{t('common.amount')}</th></tr></thead>
                  <tbody>
                    {unmatchedBook.map((b, i) => (
                      <tr key={i}>
                        <td className="text-xs">{new Date(b.date).toLocaleDateString('en-IN')}</td>
                        <td className="text-slate-600">{b.description}</td>
                        <td className={`text-right font-semibold tabular-nums ${b.debit_paise > 0 ? 'text-red-600' : 'text-green-700'}`}>
                          ₹{fmtPaise(b.debit_paise > 0 ? b.debit_paise : b.credit_paise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header flex items-center gap-2">
              <CheckCircle2 size={14} className="text-green-600" />
              <h3 className="font-semibold text-sm">{t('bankRecon.matched')}</h3>
              <span className="badge-green">{matched.length}</span>
            </div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="data-table">
                <thead><tr><th>{t('common.date')}</th><th>{t('accounts.description')}</th><th className="text-right">{t('common.amount')}</th></tr></thead>
                <tbody>
                  {matched.length === 0 ? (
                    <tr><td colSpan={3} className="text-center py-6 text-slate-400">{t('bankRecon.noneMatchedYet')}</td></tr>
                  ) : matched.map((m, i) => (
                    <tr key={i}>
                      <td className="text-xs">{new Date(m.book.date).toLocaleDateString('en-IN')}</td>
                      <td className="text-slate-600">{m.book.description}</td>
                      <td className="text-right font-semibold tabular-nums text-green-700">
                        ₹{fmtPaise(m.book.credit_paise || m.book.debit_paise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
