import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Upload, Receipt, Ban, Award, Pencil, FileDown, XCircle, Trash2 } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { printDonationReceipt, downloadReceiptPdf } from '../../lib/printReceipt'
import { print80gCertificate } from '../../lib/print80gCertificate'
import { downloadReport, printCurrentView } from '../../lib/downloadReport'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import {
  DataTable, filterStateToParams,
  type ColumnDef, type ColumnFilterState, type SortState, type RowAction,
} from '../../components/kit/DataTable'
import { DonationDetail } from './DonationDetail'
import { SummaryStrip, deltaPct, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { useChequeLifecycle } from '../../components/ChequeLifecycle'
import { useCanDeleteEntries, useDeleteEntry } from '../../components/deleteEntry'
import type { Donation, DonationCategory } from '../../types'
import { enteredByColumn, enteredByText, useEnteredByOptions } from '../../lib/enteredBy'

const PAYMENT_MODES = ['cash', 'upi', 'cheque', 'netbanking', 'online']
const PAGE_SIZE = 20

interface ListMeta {
  total: number
  total_amount_paise: number
  prev_period_amount_paise: number | null
  mode_breakdown?: Record<string, number>
  day_totals?: { date: string; amount_paise: number }[]
}

export function DonationsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const canDelete = useCanDeleteEntries()
  const deleteEntry = useDeleteEntry()

  const [donations, setDonations] = useState<Donation[]>([])
  const [meta, setMeta] = useState<ListMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('donations'))
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [sort, setSort] = useState<SortState | undefined>()

  const [voidModal, setVoidModal] = useState<{ id: string; invoiceNo: string } | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [categories, setCategories] = useState<DonationCategory[]>([])
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState<string | null>(null)
  const [certLoading, setCertLoading] = useState<string | null>(null)
  const { chequeActions, bounceModal } = useChequeLifecycle('donations', () => { void load() })

  useEffect(() => {
    api.get('/donation-categories', { params: { is_active: 'true' } })
      .then(r => setCategories(r.data.data || [])).catch(() => {})
  }, [])

  function paymentModeBadge(mode: string) {
    const map: Record<string, string> = {
      cash: 'badge-green', upi: 'badge-blue',
      cheque: 'badge-yellow', netbanking: 'badge-blue', online: 'badge-blue',
    }
    return map[mode] || 'badge-gray'
  }

  const enteredByOptions = useEnteredByOptions()
  const columns: ColumnDef<Donation>[] = useMemo(() => [
    {
      key: 'invoice', label: t('donations.invoiceNo'), sortable: true,
      render: d => <span className="font-mono text-xs text-brand-blue">{d.invoice_no}</span>,
    },
    {
      key: 'donor', label: t('donations.donor'), sortable: true,
      render: d => (
        <div>
          <p className="font-medium">{d.donor_name || '—'}</p>
          {d.donor_mobile && <p className="text-xs text-slate-400">{d.donor_mobile}</p>}
          {d.is_anonymous && (
            <p className="text-xs text-slate-400 italic">
              {d.anonymous_category === 'dan_peti' ? t('donations.danPeti') : t('donations.anonymousGuptDan')}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'category', label: t('donations.category'), sortable: true,
      filter: { kind: 'enum', param: 'category', options: categories.map(c => ({ value: c.name, label: c.name })) },
      render: d => <span className="text-slate-600">{d.category_name || '—'}</span>,
    },
    {
      key: 'amount', label: t('common.amount'), align: 'right', sortable: true,
      filter: { kind: 'amount', gteParam: 'amount_gte', lteParam: 'amount_lte' },
      render: d => <span className="font-semibold">₹{fmtPaise(d.amount_paise)}</span>,
    },
    {
      key: 'mode', label: t('donations.mode'),
      filter: { kind: 'enum', param: 'payment_mode', options: PAYMENT_MODES.map(m => ({ value: m, label: t(`common.${m}`) })) },
      render: d => <span className={paymentModeBadge(d.payment_mode)}>{d.payment_mode}</span>,
    },
    {
      key: 'eightyG', label: t('donations.eightyG'),
      filter: {
        kind: 'enum', param: 'is_80g',
        options: [
          { value: 'true', label: t('donations.eightyGOnly') },
          { value: 'false', label: t('donations.nonEightyG') },
        ],
      },
      render: d => d.is_80g_eligible
        ? <span className="badge-green">{t('common.yes')}</span>
        : <span className="badge-gray">{t('common.no')}</span>,
    },
    {
      key: 'date', label: t('common.date'), sortable: true,
      render: d => <span className="text-slate-500 text-xs">{new Date(d.created_at).toLocaleDateString('en-IN')}</span>,
    },
    enteredByColumn<Donation>(t, enteredByOptions),
    {
      key: 'status', label: t('common.status'),
      render: d => d.is_voided
        ? <span className="badge-red">{t('donations.voided')}</span>
        : <span className="badge-green">{t('common.active')}</span>,
    },
    // The actions column is rendered by the kit from `rowActions` below — the
    // print button stays visible, everything else collapses behind ⋮.
     
  ], [t, enteredByOptions, categories])

  function rowActions(d: Donation): RowAction[] {
    const actions: RowAction[] = [
      {
        label: t('donations.printReceipt'), icon: <Receipt size={14} />, primary: true,
        onClick: () => openReceipt(d.id), disabled: receiptLoading === d.id,
      },
      { label: t('donations.downloadPdf'), icon: <FileDown size={13} />, onClick: () => savePdf(d.id), disabled: pdfLoading === d.id },
    ]
    if (d.is_80g_eligible && d.donor_id && !d.is_anonymous) {
      actions.push({
        label: t('donations.download80gCertificate'), icon: <Award size={13} />,
        onClick: () => download80g(d.donor_id!), disabled: certLoading === d.donor_id,
      })
    }
    if (!d.is_voided) {
      // Cheque deposit/clear/bounce, previously only reachable from
      // Accounts ▸ Cheques even though the row here shows the cheque status.
      actions.push(...chequeActions(d))
      actions.push({ label: t('donations.editVoidReissue'), icon: <Pencil size={13} />, onClick: () => navigate(`/donations/${d.id}/edit`) })
      actions.push({ label: t('donations.voidDonation'), icon: <Ban size={13} />, danger: true, onClick: () => setVoidModal({ id: d.id, invoiceNo: d.invoice_no }) })
    }
    // Delete is separate from void: a void keeps the receipt on the register
    // marked cancelled; a delete takes a mistaken entry out altogether (it
    // stays restorable in the Recycle Bin). temple_admin only.
    if (canDelete) {
      actions.push({
        label: t('entries.delete'), icon: <Trash2 size={13} />, danger: true,
        onClick: async () => {
          if (await deleteEntry({
            kind: 'donation', id: d.id,
            title: d.is_anonymous ? t('recycleBin.anonymous') : (d.donor_name ?? null),
            detail: d.category_name ?? null, reference: d.invoice_no,
            amountPaise: d.amount_paise, date: d.created_at,
          })) void load()
        },
      })
    }
    return actions
  }

  function buildParams(limit: number, forPage = 1): URLSearchParams {
    const params = new URLSearchParams({ page: String(forPage), limit: String(limit) })
    if (search) params.set('q', search)
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    if (sort) params.set('sort', `${sort.key}:${sort.dir}`)
    for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
    return params
  }

  useEffect(() => { load() }, [page, search, range, filterState, sort, categories.length])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/donations?${buildParams(PAGE_SIZE, page)}`)
      setDonations(data.data || [])
      setMeta(data.meta || null)
    } catch {
      setDonations([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }

  function resetPageAnd<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1) }
  }

  const stats: SummaryStat[] = meta ? [
    {
      label: t('donations.title'),
      value: `₹${fmtPaise(meta.total_amount_paise)}`,
      deltaPct: deltaPct(meta.total_amount_paise, meta.prev_period_amount_paise),
      sub: t('kit.vsPrevPeriodSub'),
      tone: 'income',
    },
    { label: t('kit.receipts'), value: String(meta.total) },
    { label: t('common.cash'), value: `₹${fmtPaise(meta.mode_breakdown?.cash ?? 0)}` },
    {
      label: t('kit.digital'),
      value: `₹${fmtPaise((meta.mode_breakdown?.upi ?? 0) + (meta.mode_breakdown?.online ?? 0) + (meta.mode_breakdown?.netbanking ?? 0))}`,
    },
  ] : []

  async function exportExcel() {
    try {
      const { data } = await api.get(`/donations?${buildParams(1000)}`)
      const rows: Donation[] = data.data || []
      if (!rows.length) { toast.info(t('kit.nothingToExport')); return }
      await exportXlsx({
        title: t('reports.donationRegister'),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: 'donation-register',
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('donations.invoiceNo') },
          { header: t('donations.donor'), width: 26 },
          { header: t('donations.category') },
          { header: t('donations.mode'), width: 12 },
          { header: t('common.amount'), type: 'money' },
          { header: t('donations.eightyG'), width: 8 },
          { header: t('common.status'), width: 10 },
          { header: t('enteredBy.column'), width: 18 },
        ],
        rows: rows.map(d => [
          new Date(d.created_at).toLocaleDateString('en-IN'), d.invoice_no, d.donor_name ?? '',
          d.category_name ?? '', d.payment_mode, d.amount_paise,
          d.is_80g_eligible ? t('common.yes') : t('common.no'),
          d.is_voided ? t('donations.voided') : t('common.active'),
          enteredByText(d, t),
        ]),
        totals: [t('kit.total'), '', '', '', '', rows.filter(d => !d.is_voided).reduce((s, d) => s + d.amount_paise, 0), '', '', ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function exportPdf() {
    const p: Record<string, string> = {}
    buildParams(1000).forEach((v, k) => { if (!['page', 'limit', 'sort'].includes(k)) p[k] = v })
    downloadReport('donation-register', p, 'pdf')
  }

  async function openReceipt(id: string) {
    setReceiptLoading(id)
    try { await printDonationReceipt(id) }
    catch { toast.error(t('donations.receiptLoadFailed')) }
    finally { setReceiptLoading(null) }
  }

  async function savePdf(id: string) {
    setPdfLoading(id)
    try { await downloadReceiptPdf(id) }
    catch { toast.error(t('donations.pdfGenerateFailed')) }
    finally { setPdfLoading(null) }
  }

  async function download80g(donorId: string) {
    setCertLoading(donorId)
    try { await print80gCertificate(donorId) }
    catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('donations.no80gThisYear'))
    } finally { setCertLoading(null) }
  }

  async function confirmVoid() {
    if (!voidModal || !voidReason.trim()) return
    setVoiding(true)
    try {
      await api.patch(`/donations/${voidModal.id}/void`, { reason: voidReason })
      toast.success(t('donations.voidSuccess', { invoiceNo: voidModal.invoiceNo }))
      setVoidModal(null)
      setVoidReason('')
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('donations.voidFailed'))
    } finally {
      setVoiding(false)
    }
  }

  const graphData = (meta?.day_totals ?? []).map(d => ({
    label: new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    value: d.amount_paise / 100,
  }))

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('reports.donationRegister')} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('donations.title')}</h1>
        <div className="flex gap-2">
          <button onClick={() => setImportOpen(true)} className="btn-secondary btn-sm">
            <Upload size={14} /> {t('donations.importOldRegister')}
          </button>
          <button onClick={() => navigate('/donations/add')} className="btn-primary btn-sm">
            <Plus size={14} /> {t('donations.newDonation')}
          </button>
        </div>
      </div>

      {importOpen && <BulkImportModal onClose={ok => { setImportOpen(false); if (ok) load() }} />}

      <div className="no-print">
        <DateRangePicker value={range} onChange={resetPageAnd(setRange)} storageKey="donations" />
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="donations-list"
        columns={columns}
        rows={donations}
        rowKey={d => d.id}
        loading={loading}
        searchValue={search}
        onSearchChange={resetPageAnd(setSearch)}
        searchPlaceholder={t('donations.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onExportPdf={exportPdf}
        onPrint={() => printCurrentView()}
        graphData={graphData}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
          })
          setPage(1)
        }}
        sort={sort}
        onSortChange={resetPageAnd(setSort)}
        page={page}
        limit={PAGE_SIZE}
        total={meta?.total ?? 0}
        onPageChange={setPage}
        emptyMessage={t('donations.noDonationsFound')}
        emptyAction={{ label: t('donations.newDonation'), onClick: () => navigate('/donations/add') }}
        onClearFilters={() => { setFilterState({}); setPage(1) }}
        rowActions={rowActions}
        detailTitle={d => `${t('donations.title')} · ${d.invoice_no}`}
        renderDetail={d => <DonationDetail donation={d} onChanged={load} />}
      />

      {/* Void confirmation modal */}
      {voidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-bold text-navy-900 mb-1">{t('donations.voidDonation')}</h3>
            <p className="text-sm text-slate-500 mb-4">
              {t('donations.voidModalWarning', { invoiceNo: voidModal.invoiceNo })}
            </p>
            <div className="mb-4">
              <label className="form-label">{t('donations.reasonForVoiding')}</label>
              <textarea
                className="form-input"
                rows={3}
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                placeholder={t('donations.enterReason')}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setVoidModal(null); setVoidReason('') }} className="btn-secondary">{t('common.cancel')}</button>
              <button
                onClick={confirmVoid}
                disabled={!voidReason.trim() || voiding}
                className="btn-danger"
              >
                {voiding ? t('donations.voiding') : t('donations.voidDonation')}
              </button>
            </div>
          </div>
        </div>
      )}
      {bounceModal}
    </div>
  )
}

/**
 * Import an old donation register (doc §M4 bulk import). Accepts CSV pasted or
 * chosen as a file with the header:
 *   date,donor_name,mobile,category,amount_rupees,payment_mode,is_80g,pan,remarks
 * Rows are parsed client-side and posted to POST /donations/bulk-import.
 */
function BulkImportModal({ onClose }: { onClose: (imported: boolean) => void }) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ total: number; imported: number; failed: number; errors: { row: number; message: string }[] } | null>(null)
  const [err, setErr] = useState('')

  function parseCsv(src: string): Record<string, string>[] {
    const lines = src.trim().split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return []
    const parseLine = (line: string): string[] => {
      const out: string[] = []
      let cur = ''
      let quoted = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
          else if (ch === '"') quoted = false
          else cur += ch
        } else if (ch === '"') quoted = true
        else if (ch === ',') { out.push(cur); cur = '' }
        else cur += ch
      }
      out.push(cur)
      return out
    }
    const headers = parseLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    return lines.slice(1).map(l => {
      const vals = parseLine(l)
      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim() })
      return row
    })
  }

  async function run() {
    setErr(''); setResult(null)
    const parsed = parseCsv(text)
    if (!parsed.length) { setErr('Paste CSV data with a header row first.'); return }
    const rows = parsed.map(r => ({
      donor_name: r.donor_name || r.donor || r.name,
      mobile: r.mobile || undefined,
      category: r.category || undefined,
      amount_rupees: r.amount_rupees || r.amount || undefined,
      payment_mode: r.payment_mode || r.mode || 'cash',
      date: r.date || undefined,
      is_80g: ['yes', 'true', '1', 'y'].includes((r.is_80g || '').toLowerCase()),
      pan: r.pan || undefined,
      remarks: r.remarks || undefined,
    }))
    setBusy(true)
    try {
      const { data } = await api.post('/donations/bulk-import', { rows })
      setResult(data.data)
    } catch (e: unknown) {
      const ex = e as { response?: { data?: { error?: { message?: string } } } }
      setErr(ex.response?.data?.error?.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  function onFile(f: File | undefined) {
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(f)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-navy-900">{t('donations.importTitle')}</h3>
          <button onClick={() => onClose(!!result && result.imported > 0)} className="text-slate-400 hover:text-slate-600"><XCircle size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-500">{t('ui.uploadCsv')}<code className="mx-1 text-xs bg-slate-100 px-1 py-0.5 rounded">date, donor_name, mobile, category, amount_rupees, payment_mode, is_80g, pan, remarks</code>
            (header row required — save your Excel register as CSV). Each row becomes a receipted donation. Max 2000 rows per import.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={e => onFile(e.target.files?.[0])} className="text-sm" />
          <textarea
            className="form-input font-mono text-xs"
            rows={8}
            placeholder={'date,donor_name,mobile,category,amount_rupees,payment_mode,is_80g\n2024-04-12,Rakesh Jain,9876543210,General,5100,cash,no'}
            value={text}
            onChange={e => setText(e.target.value)}
          />
          {err && <p className="text-sm text-red-600">{err}</p>}
          {result && (
            <div className={`rounded-md px-4 py-3 text-sm ${result.failed ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-green-50 border border-green-200 text-green-700'}`}>
              <p className="font-medium">{result.imported} of {result.total} rows imported{result.failed ? `, ${result.failed} failed` : ''}.</p>
              {result.errors?.slice(0, 8).map(e2 => (
                <p key={e2.row} className="text-xs mt-1">Row {e2.row}: {e2.message}</p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={() => onClose(!!result && result.imported > 0)} className="btn-secondary">{t('common.close')}</button>
            <button onClick={run} disabled={busy || !text.trim()} className="btn-primary">
              {busy ? t('donations.importing') : t('donations.importRows')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
