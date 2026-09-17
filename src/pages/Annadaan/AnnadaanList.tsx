import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save, RefreshCw, Receipt } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, apiErrorMessage, fmtPaise, parsePaise } from '../../lib/api'
import { PhoneInput } from '../../components/PhoneInput'
import { autoPrintSlip, printDonationReceipt } from '../../lib/printReceipt'
import { exportXlsx } from '../../lib/exportXlsx'
import { splitBy } from '../../lib/chartData'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import type { BhojanshalaSale } from '../../types'

const MEALS = ['breakfast', 'lunch', 'dinner'] as const

export function AnnadaanList() {
  const { t } = useTranslation()
  const toast = useToast()
  const [sales, setSales] = useState<BhojanshalaSale[]>([])
  const [loading, setLoading] = useState(true)
  // The bhojanshala counter works one day at a time (daily summary + token
  // redemption are day-scoped), so this screen keeps a single-date filter.
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10))
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState<{ tokens: number; collection_paise: number } | null>(null)
  const [redeemId, setRedeemId] = useState<string | null>(null)
  const [redeemTokens, setRedeemTokens] = useState('')
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null)

  const [form, setForm] = useState({
    meal_type: 'lunch',
    tokens: '',
    rate: '20',
    payment_mode: 'cash',
    reference_no: '',
    devotee_mobile: '',
    buyer_name: '',
  })

  const mealLabel: Record<string, string> = {
    breakfast: t('bhojanshala.breakfast'),
    lunch: t('bhojanshala.lunch'),
    dinner: t('bhojanshala.dinner'),
  }

  // Meal filter + buyer search apply to the loaded day's sales (small set, day-scoped API).
  const mealFilter = filterState.meal?.values ?? []
  const q = search.trim().toLowerCase()
  const visible = sales.filter(s => {
    if (mealFilter.length && !mealFilter.includes(s.meal_type)) return false
    if (q && !(s.buyer_name?.toLowerCase().includes(q) || s.buyer_mobile?.toLowerCase().includes(q))) return false
    return true
  })

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
          </div>
        )
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, redeemId, redeemTokens, saving, receiptLoading])

  useEffect(() => { load() }, [dateFilter])

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
        ],
        rows: visible.map(s => [
          new Date(s.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
          s.buyer_name ?? '', mealLabel[s.meal_type] ?? s.meal_type,
          s.plates, s.tokens_redeemed ?? 0, s.rate_per_plate_paise, s.total_paise, s.payment_mode,
        ]),
        totals: [
          t('kit.total'), '', '',
          visible.reduce((sum, s) => sum + s.plates, 0),
          visible.reduce((sum, s) => sum + (s.tokens_redeemed ?? 0), 0),
          '', visible.reduce((sum, s) => sum + s.total_paise, 0), '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  async function recordSale(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const { data } = await api.post('/bhojanshala/sales', {
        meal_type: form.meal_type,
        tokens: parseInt(form.tokens),
        rate_paise: parsePaise(form.rate),
        payment_mode: form.payment_mode,
        reference_no: form.reference_no.trim() || undefined,
        devotee_mobile: form.devotee_mobile || undefined,
        buyer_name: form.buyer_name || undefined,
        sale_date: dateFilter,
      })
      // Auto-print the token, when the trust has asked for it. Not awaited and
      // never fatal: the tokens are already sold, and a print failure must not
      // read as a failed sale (see autoPrintSlip).
      if (data?.data?.id) void autoPrintSlip(data.data.id, '/bhojanshala/sales')
      setForm({ meal_type: 'lunch', tokens: '', rate: '20', payment_mode: 'cash', reference_no: '', devotee_mobile: '', buyer_name: '' })
      setShowForm(false)
      toast.success(t('bhojanshala.saleRecorded'))
      load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setSaving(false)
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
          <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm">
            <Plus size={14} /> {t('bhojanshala.recordSale')}
          </button>
        </div>
      </div>

      <SummaryStrip stats={stats} />

      {/* Add form */}
      {showForm && (
        <div className="card no-print">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('bhojanshala.recordSaleTitle')}</h3></div>
          <form onSubmit={recordSale} className="card-body">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="form-label">{t('bhojanshala.buyerName')}</label>
                <input className="form-input" value={form.buyer_name}
                  onChange={e => setForm(f => ({ ...f, buyer_name: e.target.value }))} placeholder={t('bhojanshala.optional')} />
              </div>
              <div>
                <label className="form-label">{t('bhojanshala.mealType')}</label>
                <select className="form-select" value={form.meal_type} onChange={e => setForm(f => ({ ...f, meal_type: e.target.value }))}>
                  <option value="breakfast">{t('bhojanshala.breakfast')}</option>
                  <option value="lunch">{t('bhojanshala.lunch')}</option>
                  <option value="dinner">{t('bhojanshala.dinner')}</option>
                </select>
              </div>
              <div>
                <label className="form-label">{t('bhojanshala.tokens')}</label>
                <input type="number" min="1" className="form-input" value={form.tokens}
                  onChange={e => setForm(f => ({ ...f, tokens: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('bhojanshala.ratePerToken')}</label>
                <input type="number" min="0" step="0.01" className="form-input" value={form.rate}
                  onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">{t('bhojanshala.paymentMode')}</label>
                <select className="form-select" value={form.payment_mode} onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                  <option value="cash">{t('common.cash')}</option>
                  <option value="upi">{t('common.upi')}</option>
                  <option value="free">{t('bhojanshala.free')}</option>
                </select>
              </div>
              {/* A non-cash sale had nowhere to record its UTR/txn id, so an
                  online collection could not be reconciled against the bank
                  later. Sent as reference_no, which PaymentsService.normalize
                  puts on the tender itself rather than a parallel scalar. */}
              {form.payment_mode !== 'cash' && form.payment_mode !== 'free' && (
                <div>
                  <label className="form-label" htmlFor="annadaan-ref">
                    {t('bhojanshala.reference', { defaultValue: 'Reference' })}
                  </label>
                  <input
                    id="annadaan-ref" className="form-input"
                    value={form.reference_no}
                    onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))}
                    placeholder={t('bhojanshala.referenceHint', { defaultValue: 'UPI / txn reference (optional)' })}
                  />
                </div>
              )}
              <div>
                <label className="form-label">{t('bhojanshala.mobileOptional')}</label>
                <PhoneInput value={form.devotee_mobile} onChange={v => setForm(f => ({ ...f, devotee_mobile: v }))} />
              </div>
            </div>
            {form.tokens && form.rate && (
              <p className="text-sm font-semibold text-green-700 mb-3">
                {t('bhojanshala.totalAmount', { amount: fmtPaise(parseInt(form.tokens || '0') * parsePaise(form.rate)) })}
              </p>
            )}
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary btn-sm">
                <Save size={14} /> {saving ? t('common.saving') : t('bhojanshala.record')}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

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
        emptyAction={{ label: t('bhojanshala.recordSale'), onClick: () => setShowForm(true) }}
        onClearFilters={() => setFilterState({})}
      />
    </div>
  )
}
