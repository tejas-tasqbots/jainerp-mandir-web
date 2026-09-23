import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, CheckCircle2, AlertTriangle, RefreshCw, Plus, Undo2 } from 'lucide-react'
import { api, fmtPaise, parsePaise, currentFY, todayIst } from '../../lib/api'
import { FySelect } from '../../components/FySelect'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface TBRow { code: string; account_name: string; kind: string; group?: string; debit_paise: number; credit_paise: number }
interface TB { fy: string; rows: TBRow[]; totals: { debit_paise: number; credit_paise: number; difference_paise: number; balanced: boolean } }
interface LedgerAccount { id: string; code: string; name: string; kind: string }
interface JLine { account: string; code: string; debit_paise: number; credit_paise: number }
interface JEntry {
  id: string; entry_date: string; narration: string | null
  source_table: string | null; source_leg: string | null
  is_adjustment: boolean; reverses_entry_id: string | null
  total_paise: number; posted_by_name: string | null; lines: JLine[] | null
}
interface Fund { code: string; name: string; fund_type: string; opening_paise: number; movement_paise: number; closing_paise: number }

type FormLine = { code: string; side: 'debit' | 'credit'; amount: string }

/**
 * The general ledger: the real trial balance, the fund schedule, and the
 * journal itself — including manual adjustment entries, which the platform
 * previously had nowhere to put (doc-v2/Accounting_Audit_2026-08.md B8).
 *
 * The headline is the balanced/unbalanced verdict. The old "Trial Balance"
 * screen had to drop its verdict because a cash-only listing can never balance;
 * this one is a real trial balance, so the verdict means something.
 */
export function GeneralLedger() {
  const { t } = useTranslation()
  const toast = useToast()
  const [fy, setFy] = useState(currentFY())
  const [tb, setTb] = useState<TB | null>(null)
  const [funds, setFunds] = useState<Fund[]>([])
  const [entries, setEntries] = useState<JEntry[]>([])
  const [accounts, setAccounts] = useState<LedgerAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [tab, setTab] = useState<'trial' | 'funds' | 'journal'>('trial')

  const [showForm, setShowForm] = useState(false)
  const [narration, setNarration] = useState('')
  const [entryDate, setEntryDate] = useState(todayIst())
  const [lines, setLines] = useState<FormLine[]>([
    { code: '', side: 'debit', amount: '' },
    { code: '', side: 'credit', amount: '' },
  ])
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [fy])

  async function load() {
    setLoading(true)
    try {
      const [tbRes, fRes, eRes, aRes] = await Promise.all([
        api.get(`/journal/trial-balance?fy=${fy}`),
        api.get(`/journal/fund-schedule?fy=${fy}`),
        api.get(`/journal/entries?fy=${fy}&limit=200`),
        api.get('/journal/accounts'),
      ])
      setTb(tbRes.data.data)
      setFunds(fRes.data.data?.funds || [])
      setEntries(eRes.data.data || [])
      setAccounts(aRes.data.data || [])
    } catch {
      setTb(null); setFunds([]); setEntries([]); setAccounts([])
    } finally {
      setLoading(false)
    }
  }

  async function sync() {
    setSyncing(true)
    try {
      const { data } = await api.post('/journal/sync', { fy })
      toast.success(t('ledger.syncedCount', { count: data.data?.vouchers_posted ?? 0 }))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('ledger.syncFailed'))
    } finally {
      setSyncing(false)
    }
  }

  const formDebit = lines.filter(l => l.side === 'debit').reduce((s, l) => s + (parsePaise(l.amount) || 0), 0)
  const formCredit = lines.filter(l => l.side === 'credit').reduce((s, l) => s + (parsePaise(l.amount) || 0), 0)
  const formBalanced = formDebit > 0 && formDebit === formCredit

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault()
    if (!formBalanced) { toast.error(t('ledger.mustBalance')); return }
    setSaving(true)
    try {
      await api.post('/journal/entries', {
        entry_date: entryDate,
        narration,
        lines: lines.filter(l => l.code && parsePaise(l.amount)).map(l => ({
          code: l.code,
          debit_paise: l.side === 'debit' ? parsePaise(l.amount) : 0,
          credit_paise: l.side === 'credit' ? parsePaise(l.amount) : 0,
        })),
      })
      setShowForm(false)
      setNarration('')
      setLines([{ code: '', side: 'debit', amount: '' }, { code: '', side: 'credit', amount: '' }])
      toast.success(t('ledger.entryPosted'))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('ledger.entryFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function reverse(id: string) {
    const reason = window.prompt(t('ledger.reversalReason') ?? 'Reason for reversal')
    if (!reason) return
    try {
      await api.post(`/journal/entries/${id}/reverse`, { reason })
      toast.success(t('ledger.reversed'))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('ledger.reverseFailed'))
    }
  }

  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: 'trial', label: t('ledger.trialBalance') },
    { key: 'funds', label: t('ledger.funds') },
    { key: 'journal', label: t('ledger.journal') },
  ]

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('ledger.title')} subtitle={`${t('accounts.fy')} ${fy}`} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2">
          <BookOpen size={18} /> {t('ledger.title')}
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={sync} disabled={syncing} className="btn-secondary btn-sm">
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {t('ledger.postPending')}
          </button>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm">
            <Plus size={14} /> {t('ledger.newEntry')}
          </button>
        </div>
      </div>

      <div className="no-print">
        <label className="text-sm text-slate-500 mr-2">{t('accounts.fy')}</label>
        <FySelect value={fy} onChange={setFy} />
      </div>

      {/* The verdict. A real trial balance can fail, which is the whole point. */}
      {tb && (
        <div className={`card border-l-4 ${tb.totals.balanced ? 'border-l-green-600' : 'border-l-red-600'}`}>
          <div className="card-body flex items-center gap-3">
            {tb.totals.balanced
              ? <CheckCircle2 size={22} className="text-green-600 shrink-0" />
              : <AlertTriangle size={22} className="text-red-600 shrink-0" />}
            <div>
              <p className={`font-bold ${tb.totals.balanced ? 'text-green-700' : 'text-red-700'}`}>
                {tb.totals.balanced ? t('ledger.balanced') : t('ledger.notBalanced')}
              </p>
              <p className="text-xs text-slate-500">
                {t('accounts.debit')} ₹{fmtPaise(tb.totals.debit_paise)} · {t('accounts.credit')} ₹{fmtPaise(tb.totals.credit_paise)}
                {!tb.totals.balanced && ` · ${t('ledger.difference')} ₹${fmtPaise(tb.totals.difference_paise)}`}
              </p>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="card no-print">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('ledger.newEntry')}</h3></div>
          <form onSubmit={submitEntry} className="card-body space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><label className="form-label">{t('common.date')}</label>
                <input type="date" className="form-input" value={entryDate} onChange={e => setEntryDate(e.target.value)} required /></div>
              <div className="col-span-2"><label className="form-label">{t('ledger.narration')}</label>
                <input className="form-input" value={narration} onChange={e => setNarration(e.target.value)}
                  placeholder={t('ledger.narrationPlaceholder')} required /></div>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-6"><label className="form-label !text-xs">{t('ledger.account')}</label>
                  <select className="form-select" value={l.code}
                    onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, code: e.target.value } : x))} required>
                    <option value="">{t('accounts.selectAccount')}</option>
                    {accounts.map(a => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div className="col-span-3"><label className="form-label !text-xs">{t('ledger.side')}</label>
                  <select className="form-select" value={l.side}
                    onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, side: e.target.value as 'debit' | 'credit' } : x))}>
                    <option value="debit">{t('accounts.debit')}</option>
                    <option value="credit">{t('accounts.credit')}</option>
                  </select>
                </div>
                <div className="col-span-3"><label className="form-label !text-xs">{t('accounts.amount')}</label>
                  <input type="number" step="0.01" className="form-input" value={l.amount}
                    onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} required /></div>
              </div>
            ))}
            <button type="button" className="text-xs text-brand-red hover:underline"
              onClick={() => setLines(ls => [...ls, { code: '', side: 'debit', amount: '' }])}>
              + {t('ledger.addLine')}
            </button>
            <div className={`text-sm font-medium ${formBalanced ? 'text-green-700' : 'text-red-600'}`}>
              {t('accounts.debit')} ₹{fmtPaise(formDebit)} · {t('accounts.credit')} ₹{fmtPaise(formCredit)}
              {!formBalanced && ` — ${t('ledger.mustBalance')}`}
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving || !formBalanced} className="btn-primary btn-sm">
                {saving ? t('common.saving') : t('ledger.postEntry')}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200 no-print">
        {tabs.map(x => (
          <button key={x.key} onClick={() => setTab(x.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === x.key ? 'border-brand-red text-brand-red' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {x.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-slate-400">{t('common.loading')}</p>}

      {!loading && tab === 'trial' && tb && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-navy-900 text-white">
              <tr>
                <th className="text-left px-3 py-2">{t('ledger.code')}</th>
                <th className="text-left px-3 py-2">{t('accounts.account')}</th>
                <th className="text-left px-3 py-2">{t('ledger.kind')}</th>
                <th className="text-right px-3 py-2">{t('accounts.debit')}</th>
                <th className="text-right px-3 py-2">{t('accounts.credit')}</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.map(r => (
                <tr key={r.code} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-mono text-xs text-slate-400">{r.code}</td>
                  <td className="px-3 py-1.5 font-medium">{r.account_name}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{r.kind}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.debit_paise ? `₹${fmtPaise(r.debit_paise)}` : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.credit_paise ? `₹${fmtPaise(r.credit_paise)}` : '—'}</td>
                </tr>
              ))}
              <tr className="font-bold border-t-2 border-navy-900">
                <td className="px-3 py-2" colSpan={3}>{t('kit.total')}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">₹{fmtPaise(tb.totals.debit_paise)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">₹{fmtPaise(tb.totals.credit_paise)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'funds' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-navy-900 text-white">
              <tr>
                <th className="text-left px-3 py-2">{t('ledger.fund')}</th>
                <th className="text-right px-3 py-2">{t('ledger.opening')}</th>
                <th className="text-right px-3 py-2">{t('ledger.movement')}</th>
                <th className="text-right px-3 py-2">{t('ledger.closing')}</th>
              </tr>
            </thead>
            <tbody>
              {funds.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-slate-400">{t('accounts.noDataForFy')}</td></tr>}
              {funds.map(f => (
                <tr key={f.code} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-medium">{f.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">₹{fmtPaise(f.opening_paise)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">₹{fmtPaise(f.movement_paise)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold">₹{fmtPaise(f.closing_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'journal' && (
        <div className="space-y-2">
          {entries.length === 0 && <p className="text-sm text-slate-400">{t('accounts.noDataForFy')}</p>}
          {entries.map(e => (
            <div key={e.id} className="card">
              <div className="card-body py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">
                      {e.narration}
                      {e.is_adjustment && <span className="ml-2 badge-blue">{t('ledger.adjustment')}</span>}
                      {e.reverses_entry_id && <span className="ml-2 badge-gray">{t('ledger.reversal')}</span>}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(e.entry_date).toLocaleDateString('en-IN')}
                      {e.source_table && ` · ${e.source_table}/${e.source_leg}`}
                      {e.posted_by_name && ` · ${e.posted_by_name}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-sm font-semibold">₹{fmtPaise(e.total_paise)}</span>
                    {e.is_adjustment && !e.reverses_entry_id && (
                      <button onClick={() => reverse(e.id)} className="btn-secondary btn-sm" title={t('ledger.reverse')}>
                        <Undo2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {e.lines && (
                  <div className="mt-1.5 pl-3 border-l-2 border-slate-100 space-y-0.5">
                    {e.lines.map((l, i) => (
                      <div key={i} className="flex justify-between text-xs text-slate-500">
                        <span>{l.code} — {l.account}</span>
                        <span className="font-mono tabular-nums">
                          {l.debit_paise > 0 ? `Dr ₹${fmtPaise(l.debit_paise)}` : `Cr ₹${fmtPaise(l.credit_paise)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
