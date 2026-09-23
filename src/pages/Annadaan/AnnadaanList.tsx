import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Receipt, Trash2 } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, fmtPaise, todayIst } from '../../lib/api'
import { printDonationReceipt } from '../../lib/printReceipt'
import { exportXlsx } from '../../lib/exportXlsx'
import { splitBy } from '../../lib/chartData'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { useCanDeleteEntries, useDeleteEntry } from '../../components/deleteEntry'
import type { BhojanshalaSale } from '../../types'
import {
  BhojanshalaCounter, initialSession, type Session, type SessionRates,
} from './BhojanshalaCounter'
import { enteredByColumn, enteredByText, useEnteredByOptions } from '../../lib/enteredBy'

const MEALS = ['breakfast', 'lunch', 'dinner'] as const

export function AnnadaanList() {
  const { t } = useTranslation()
  const toast = useToast()
  const canDelete = useCanDeleteEntries()
  const deleteEntry = useDeleteEntry()
  const [reloadTick, setReloadTick] = useState(0)
  const [sales, setSales] = useState<BhojanshalaSale[]>([])
  const [loading, setLoading] = useState(true)
  // The bhojanshala counter works one day at a time (daily summary + token
  // redemption are day-scoped), so this screen keeps a single-date filter.
  const [dateFilter, setDateFilter] = useState(todayIst())
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState<{ tokens: number; collection_paise: number } | null>(null)
  const [redeemId, setRedeemId] = useState<string | null>(null)
  const [redeemTokens, setRedeemTokens] = useState('')
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null)

  // The counter's session is a mode, not a per-sale field: picked once (or
  // guessed from the clock the first time) and remembered.
  const [session, setSession] = useState<Session>(initialSession)
  const [sessionRates, setSessionRates] = useState<SessionRates>({ breakfast: 0, lunch: 0, dinner: 0 })

  useEffect(() => {
    api.get('/tenants/me').then(r => {
      const p = r.data?.data ?? r.data ?? {}
      setSessionRates({
        breakfast: Number(p.bhojanshala_rate_breakfast_paise ?? 0),
        lunch: Number(p.bhojanshala_rate_lunch_paise ?? 0),
        dinner: Number(p.bhojanshala_rate_dinner_paise ?? 0),
      })
    }).catch(() => { /* the counter says "rate not set" and links to Settings */ })
  }, [])

  const mealLabel: Record<string, string> = {
    breakfast: t('bhojanshala.breakfast'),
    lunch: t('bhojanshala.lunch'),
    dinner: t('bhojanshala.dinner'),
  }

  // Meal filter + buyer search apply to the loaded day's sales (small set, day-scoped API).
  const mealFilter = filterState.meal?.values ?? []
  const byFilter = filterState.entered_by?.values ?? []
  const q = search.trim().toLowerCase()
  const visible = sales.filter(s => {
    if (mealFilter.length && !mealFilter.includes(s.meal_type)) return false
    if (byFilter.length) {
      const who = s as { entered_by?: string | null; entered_online?: boolean | null }
      if (!(who.entered_by && byFilter.includes(who.entered_by)) && !(who.entered_online && byFilter.includes('online'))) return false
    }
    if (q && !(s.buyer_name?.toLowerCase().includes(q) || s.buyer_mobile?.toLowerCase().includes(q))) return false
    return true
  })

  const enteredByOptions = useEnteredByOptions()
  const columns: ColumnDef<BhojanshalaSale>[] = useMemo(() => [
    { key: 'buyer', label: t('bhojanshala.buyer'), render: s => <span className="font-medium">{s.buyer_name || '—'}</span> },
    {
      key: 'meal', label: t('bhojanshala.mealType'),
      filter: { kind: 'enum', param: 'meal_type', options: MEALS.map(m => ({ value: m, label: mealLabel[m] })) },
      render: s => <span className="capitalize">{mealLabel[s.meal_type] ?? s.meal_type}</span>,
    },
    { key: 'tokens', label: t('bhojanshala.tokensSold'), align: 'right', render: s => <span className="font-semibold">{s.plates}</span> },
    {
      key: 'redeemed', label: t('bhojanshala.redeemed'), align: 'right',
      render: s => (
        <span className={s.tokens_redeemed ? 'text-green-700' : 'text-slate-400'}>
          {s.tokens_redeemed ?? 0}{s.tokens_redeemed ? ` / ${s.plates}` : ''}
        </span>
      ),
    },
    { key: 'rate', label: t('bhojanshala.rate'), align: 'right', render: s => <>₹{fmtPaise(s.rate_per_plate_paise)}</> },
    { key: 'total', label: t('bhojanshala.total'), align: 'right', render: s => <span className="font-semibold">₹{fmtPaise(s.total_paise)}</span> },
    { key: 'mode', label: t('bhojanshala.mode'), render: s => <span className="badge-gray">{s.payment_mode}</span> },
    enteredByColumn<BhojanshalaSale>(t, enteredByOptions),
    {
      key: 'time', label: t('bhojanshala.time'),
      render: s => <span className="text-xs text-slate-400">{new Date(s.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>,
    },
    {
      key: 'actions', label: t('common.actions'),
      render: s => {
        const remaining = s.plates - (s.tokens_redeemed ?? 0)
        return (
          <div className="flex gap-1 items-center">
            {redeemId === s.id ? (
              <>
                <input type="number" min="1" max={remaining} title={t('bhojanshala.tokensToRedeem')} className="form-input w-16 text-xs py-0.5" autoFocus
                  value={redeemTokens} onChange={e => setRedeemTokens(e.target.value)} placeholder="qty" />
                <button type="button" onClick={() => redeemSale(s.id)} disabled={saving} className="btn-success btn-sm" aria-label={t('bhojanshala.confirmRedeem')}>
                  <RefreshCw size={12} />
                </button>
                <button type="button" onClick={() => { setRedeemId(null); setRedeemTokens('') }} className="btn-secondary btn-sm" aria-label={t('bhojanshala.cancelRedeem')}>×</button>
              </>
            ) : (
              remaining > 0 && (
                <button type="button" onClick={() => setRedeemId(s.id)} className="btn-secondary btn-sm text-xs">{t('bhojanshala.redeem')}</button>
              )
            )}
            <button
              type="button"
              onClick={() => openReceipt(s.id)}
              title={t('bhojanshala.printTokenSlip')} aria-label={t('bhojanshala.printTokenSlip')}
              disabled={receiptLoading === s.id}
              className="p-1 text-slate-400 hover:text-brand-blue rounded disabled:opacity-40"
            >
              <Receipt size={14} className={receiptLoading === s.id ? 'animate-pulse' : ''} />
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={async () => {
                  if (await deleteEntry({
                    kind: 'bhojanshala_sale', id: s.id, title: s.buyer_name || t(`bhojanshala.${s.meal_type}`),
                    detail: `${s.plates} × ${t(`bhojanshala.${s.meal_type}`)}`, reference: s.invoice_no ?? null,
                    amountPaise: s.total_paise, date: s.sale_date ?? s.created_at,
                  })) setReloadTick(n => n + 1)
                }}
                title={t('entries.delete')} aria-label={t('entries.delete')}
                className="p-1 text-slate-400 hover:text-brand-red rounded"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, enteredByOptions, redeemId, redeemTokens, saving, receiptLoading, canDelete])

  useEffect(() => { load() }, [dateFilter, reloadTick])

  async function load() {
    setLoading(true)
    try {
      const [salesResp, summaryResp] = await Promise.allSettled([
        api.get(`/bhojanshala/sales?date=${dateFilter}&limit=200`),
        api.get(`/bhojanshala/daily-summary?date=${dateFilter}`),
      ])
      if (salesResp.status === 'fulfilled') setSales(salesResp.value.data.data || [])
      // daily-summary returns { date, by_meal, totals: { tokens, collection_paise } }
      if (summaryResp.status === 'fulfilled') setSummary(summaryResp.value.data.data?.totals ?? null)
    } finally {
      setLoading(false)
    }
  }

  const stats: SummaryStat[] = summary ? [
    { label: t('bhojanshala.totalTokens'), value: String(summary.tokens ?? 0) },
    { label: t('bhojanshala.totalCollection'), value: `₹${fmtPaise(summary.collection_paise ?? 0)}`, tone: 'income' },
  ] : []

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('bhojanshala.title'),
        subtitle: new Date(dateFilter).toLocaleDateString('en-IN'),
        filename: `annadaan-${dateFilter}`,
        columns: [
          { header: t('bhojanshala.time'), width: 10 },
          { header: t('bhojanshala.buyer'), width: 24 },
          { header: t('bhojanshala.mealType'), width: 12 },
          { header: t('bhojanshala.tokensSold'), type: 'number' },
          { header: t('bhojanshala.redeemed'), type: 'number' },
          { header: t('bhojanshala.rate'), type: 'money' },
          { header: t('bhojanshala.total'), type: 'money' },
          { header: t('bhojanshala.mode'), width: 10 },
          { header: t('enteredBy.column'), width: 18 },
        ],
        rows: visible.map(s => [
          new Date(s.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
          s.buyer_name ?? '', mealLabel[s.meal_type] ?? s.meal_type,
          s.plates, s.tokens_redeemed ?? 0, s.rate_per_plate_paise, s.total_paise, s.payment_mode,
          enteredByText(s, t),
        ]),
        totals: [
          t('kit.total'), '', '',
          visible.reduce((sum, s) => sum + s.plates, 0),
          visible.reduce((sum, s) => sum + (s.tokens_redeemed ?? 0), 0),
          '', visible.reduce((sum, s) => sum + s.total_paise, 0), '', '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  async function openReceipt(id: string) {
    setReceiptLoading(id)
    try {
      await printDonationReceipt(id, '/bhojanshala/sales')
    } catch {
      toast.error(t('donations.receiptLoadFailed'))
    } finally {
      setReceiptLoading(null)
    }
  }

  async function redeemSale(id: string) {
    if (!redeemTokens) return
    setSaving(true)
    try {
      await api.patch(`/bhojanshala/sales/${id}/redeem`, { tokens_redeemed: parseInt(redeemTokens) })
      setRedeemId(null)
      setRedeemTokens('')
      toast.success(t('bhojanshala.redeemed'))
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message || t('bhojanshala.redeemFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('bhojanshala.title')} subtitle={new Date(dateFilter).toLocaleDateString('en-IN')} />

      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('bhojanshala.title')}</h1>
        <div className="flex gap-2">
          <input type="date" title={t('common.date')} className="form-input w-44" value={dateFilter}
            onChange={e => setDateFilter(e.target.value)} />
        </div>
      </div>

      <SummaryStrip stats={stats} />

      {/* ── THE COUNTER ────────────────────────────────────────────────────
          A bhojanshala window has a queue in front of it. The form this
          replaced asked, per sale, for: buyer name, session, token count,
          RATE (pre-filled "20", which is a guess about someone else's trust),
          payment mode and mobile — six fields and a Save, for a transaction
          whose real content is "four plates, cash".

          What actually varies per sale is the QUANTITY. The session changes
          three times a day and the rate belongs to the trust, so neither is
          asked here: the session is a mode the counter sits in, and the rate
          comes from Settings. Name and mobile are behind a toggle because most
          people buying a thali do not give them, and an input nobody fills is
          a field everyone tabs through. */}
      <BhojanshalaCounter
        rates={sessionRates}
        session={session}
        onSession={setSession}
        date={dateFilter}
        onSold={load}
      />


      <DataTable
        viewKey="annadaan-list"
        columns={columns}
        rows={visible}
        rowKey={s => s.id}
        loading={loading}
        graphData={splitBy(visible, 'meal_type', 'total_paise', m => mealLabel[m] ?? m)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('bhojanshala.searchBuyer')}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
          })
        }}
        page={1}
        limit={200}
        total={visible.length}
        onPageChange={() => {}}
        emptyMessage={t('bhojanshala.noSalesRecorded')}
        onClearFilters={() => setFilterState({})}
      />
    </div>
  )
}
