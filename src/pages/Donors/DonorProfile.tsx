import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Edit2, Save, X, Award, Download, RefreshCw } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, apiErrorMessage, fmtPaise } from '../../lib/api'
import { downloadReceiptPdf } from '../../lib/printReceipt'
import { print80gCertificate } from '../../lib/print80gCertificate'
import { downloadRowsPdf } from '../../lib/pdfTable'
import { exportXlsx } from '../../lib/exportXlsx'
import { rangeCaption, type DateRange } from '../../lib/dateRanges'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../components/kit/DataTable'
import { DateRangePicker, loadStoredRange } from '../../components/kit/DateRangePicker'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { CitySelect, CountrySelect, StateSelect } from '../../components/GeoSelect'
import { isValidPhone, PhoneInput } from '../../components/PhoneInput'
import type { Donor } from '../../types'
import { DONOR_TAG_OPTIONS } from '../../lib/donorTags'
import { paymentModeLabel } from '../../lib/paymentModeLabel'
import { tPdf } from '../../lib/i18n'

interface LedgerRow {
  id: string
  txn_type: 'donation' | 'boli' | 'seva' | 'room' | 'hall' | 'gaushala' | 'event'
  invoice_no: string | null
  amount_paise: number
  payment_mode: string | null
  detail: string | null
  created_at: string
  voided: boolean
  outstanding_paise: number | null
}

interface LedgerTotals { donated_paise: number; receipts: number }

export function DonorProfile() {
  const { t } = useTranslation()
  const toast = useToast()
  const { id } = useParams()
  const navigate = useNavigate()
  const [donor, setDonor] = useState<Donor | null>(null)
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [totals, setTotals] = useState<LedgerTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', mobile: '', email: '', gotra: '', country: 'India', city: '', state: '', address: '' })
  const [range, setRange] = useState<DateRange>(() => loadStoredRange('donor-statement', 'all'))
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  useEffect(() => { if (id) load() }, [id, range])

  async function load() {
    setLoading(true)
    try {
      const ledgerParams = new URLSearchParams()
      if (range.from) ledgerParams.set('from', range.from)
      if (range.to) ledgerParams.set('to', range.to)
      const [donorResp, ledgerResp] = await Promise.allSettled([
        api.get(`/donors/${id}`),
        api.get(`/donors/${id}/ledger?${ledgerParams}`),
      ])
      if (donorResp.status === 'fulfilled') {
        const d = donorResp.value.data.data
        setDonor(d)
        setForm({
          name: d.name || '',
          mobile: d.mobile || '',
          email: d.email || '',
          gotra: d.gotra || '',
          country: d.country || 'India',
          city: d.city || '',
          state: d.state || '',
          address: d.address_line1 || '',
        })
      }
      if (ledgerResp.status === 'fulfilled') {
        const ld = ledgerResp.value.data.data
        setLedger(ld?.transactions || [])
        setTotals(ld?.totals || null)
      }
    } finally {
      setLoading(false)
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    if (form.mobile && !isValidPhone(form.mobile)) return
    setSaving(true)
    try {
      // PAN is intentionally NOT edited here — it is captured with the donor's
      // donation (needed for Form 10BD) and never shown/edited from this profile.
      await api.patch(`/donors/${id}`, {
        name: form.name,
        mobile: form.mobile || undefined,
        email: form.email || undefined,
        gotra: form.gotra || undefined,
        country: form.country || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        address_line1: form.address || undefined,
      })
      setEditing(false)
      load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('common.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  const [cert80g, setCert80g] = useState(false)
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null)
  const [tagsSaving, setTagsSaving] = useState(false)
  const [tagPicker, setTagPicker] = useState(false)
  const [customTag, setCustomTag] = useState('')

  async function saveTags(nextTags: string[]) {
    if (!id) return
    setTagsSaving(true)
    try {
      await api.patch(`/donors/${id}`, { tags: nextTags })
      setDonor(d => d ? { ...d, tags: nextTags } : d)
    } catch {
      toast.error(t('donors.tagUpdateFailed'))
    } finally {
      setTagsSaving(false)
    }
  }
  function addTag(tag: string) {
    const clean = tag.trim()
    if (!clean || donor?.tags?.includes(clean)) { setTagPicker(false); setCustomTag(''); return }
    saveTags([...(donor?.tags ?? []), clean])
    setTagPicker(false)
    setCustomTag('')
  }
  function removeTag(tag: string) {
    saveTags((donor?.tags ?? []).filter(tg => tg !== tag))
  }

  async function download80g() {
    if (!id) return
    setCert80g(true)
    try {
      await print80gCertificate(id)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      toast.error(err.response?.data?.error?.message || t('donors.no80gForYear'))
    } finally {
      setCert80g(false)
    }
  }

  /**
   * Where each kind of transaction's receipt comes from.
   *
   * Reported: "any type of transaction with receipt is not showing me there".
   * This screen could only ever download a DONATION - the button was hidden
   * for everything else - so a guest could not be handed their room bill from
   * the profile of the person who paid it.
   *
   * A boli is absent on purpose: a pledge is not a receipt. It becomes one when
   * it is paid, and that payment is a donation row of its own.
   */
  const RECEIPT_PATH: Partial<Record<LedgerRow['txn_type'], string>> = {
    donation: '/donations',
    room: '/room-bookings',
    hall: '/hall-bookings',
    seva: '/seva-bookings',
    gaushala: '/cow-sponsorships',
  }

  const hasReceipt = (row: LedgerRow) => Boolean(RECEIPT_PATH[row.txn_type] && row.invoice_no)

  async function downloadReceipt(row: LedgerRow) {
    const base = RECEIPT_PATH[row.txn_type]
    if (!base) return
    setReceiptBusy(row.id)
    try {
      await downloadReceiptPdf(row.id, base)
    } catch {
      toast.error(t('donors.receiptFailed'))
    } finally {
      setReceiptBusy(null)
    }
  }

  const txnBadge = (type: string) => {
    if (type === 'donation' || type === 'gaushala') return 'badge-green'
    if (type === 'seva' || type === 'event') return 'badge-blue'
    // A stay or a hall is a SALE, not a gift. Slate keeps the green badge
    // meaning "this was donated", which the 80G figure above depends on.
    if (type === 'room' || type === 'hall') return 'badge-gray'
    return 'badge-yellow' // boli pledge — visually distinct from a settled donation, matches BoliList's "pledged" badge
  }

  const txnLabel = (tx: LedgerRow) => {
    if (tx.txn_type === 'donation') return t('donors.txnDonation')
    if (tx.txn_type === 'seva') return t('donors.txnSeva')
    if (tx.txn_type === 'room') return t('donors.txnRoom')
    if (tx.txn_type === 'hall') return t('donors.txnHall')
    if (tx.txn_type === 'gaushala') return t('donors.txnGaushala')
    if (tx.txn_type === 'event') return t('donors.txnEvent')
    return tx.outstanding_paise === tx.amount_paise ? t('donors.txnBoliPledged') : t('donors.txnBoliPartial')
  }

  const exportHeaders = [t('donors.type'), t('donors.invoice'), t('donors.details'), t('donors.amount'), t('donors.mode'), t('donors.date')]

  // Client-side search + column filters over the loaded ledger (statement is
  // fetched whole per date range).
  const paymentModes = Array.from(new Set(ledger.map(tx => tx.payment_mode).filter((m): m is string => !!m))).sort()
  const q = search.trim().toLowerCase()
  const visible = ledger.filter(tx => {
    const typeF = filterState.type?.values
    if (typeF?.length && !typeF.includes(tx.txn_type)) return false
    const modeF = filterState.mode?.values
    if (modeF?.length && !modeF.includes(tx.payment_mode ?? '')) return false
    if (q && !(
      (tx.invoice_no ?? '').toLowerCase().includes(q) ||
      (tx.detail ?? '').toLowerCase().includes(q) ||
      (tx.payment_mode ?? '').toLowerCase().includes(q)
    )) return false
    return true
  })

  const columns: ColumnDef<LedgerRow>[] = [
    {
      key: 'type', label: t('donors.type'),
      filter: { kind: 'enum', param: 'txn_type', options: [
        { value: 'donation', label: t('donors.txnDonation') },
        { value: 'boli', label: t('donors.txnBoliPledged') },
        { value: 'seva', label: t('donors.txnSeva') },
      ] },
      render: tx => <span className={`badge ${txnBadge(tx.txn_type)}`}>{txnLabel(tx)}</span>,
    },
    { key: 'invoice', label: t('donors.invoice'), render: tx => <span className="font-mono text-xs text-brand-blue">{tx.invoice_no || '—'}</span> },
    {
      key: 'details', label: t('donors.details'),
      render: tx => (
        <div className={tx.voided ? 'opacity-40 line-through' : ''}>
          {tx.detail || '—'}
          {tx.txn_type === 'boli' && tx.outstanding_paise != null && tx.outstanding_paise < tx.amount_paise && (
            <span className="block text-xs" style={{ color: 'var(--color-brand-gold-dark)' }}>
              {t('donors.balanceDue')}: ₹{fmtPaise(tx.outstanding_paise)}
            </span>
          )}
        </div>
      ),
    },
    { key: 'amount', label: t('donors.amount'), align: 'right', render: tx => <span className="font-semibold">₹{fmtPaise(tx.amount_paise)}</span> },
    {
      key: 'mode', label: t('donors.mode'),
      filter: { kind: 'enum', param: 'payment_mode', options: paymentModes.map(m => ({ value: m, label: m })) },
      render: tx => tx.payment_mode ? <span className="badge-gray">{paymentModeLabel(t, tx.payment_mode)}</span> : <span className="text-slate-300">—</span>,
    },
    { key: 'date', label: t('donors.date'), render: tx => <span className="text-xs text-slate-400">{new Date(tx.created_at).toLocaleDateString('en-IN')}</span> },
    {
      key: 'receipt', label: t('donors.receipt'), align: 'right',
      // `hasReceipt`, not a donation test. This column was the visible half of
      // the report: a room stay that DID have an invoice number showed a dash
      // here, so even once the row appeared there was no way to get the bill.
      render: tx => hasReceipt(tx) && !tx.voided ? (
        <button
          type="button" onClick={() => downloadReceipt(tx)} disabled={receiptBusy === tx.id}
          title={t('donors.downloadReceipt')} aria-label={t('donors.downloadReceipt')}
          className="p-1 text-slate-400 hover:text-navy-900 rounded disabled:opacity-40"
        >
          {receiptBusy === tx.id ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
        </button>
      ) : <span className="text-slate-300">—</span>,
    },
  ]

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      const total = visible.filter(tx => !tx.voided).reduce((s, tx) => s + tx.amount_paise, 0)
      await exportXlsx({
        title: t('donors.statementTitle', { name: donor?.name ?? '' }),
        subtitle: rangeCaption(range, t('dateRange.all')),
        filename: `${donor?.name || 'donor'}-statement`,
        columns: [
          { header: t('donors.type'), width: 14 },
          { header: t('donors.invoice'), width: 14 },
          { header: t('donors.details'), width: 30 },
          { header: t('common.amount'), type: 'money' },
          { header: t('donors.mode'), width: 12 },
          { header: t('donors.date'), type: 'date' },
        ],
        rows: visible.map(tx => [
          txnLabel(tx), tx.invoice_no || '', tx.detail || '', tx.amount_paise,
          tx.payment_mode || '', new Date(tx.created_at).toLocaleDateString('en-IN'),
        ]),
        totals: [t('kit.total'), '', '', total, '', ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function exportPdf() {
    downloadRowsPdf(
      `${donor?.name || 'donor'}-statement.pdf`,
      tPdf('donors.statementTitle', { name: donor?.name ?? '' }),
      exportHeaders,
      visible.map(tx => [
        txnLabel(tx), tx.invoice_no || '', tx.detail || '',
        `₹${fmtPaise(tx.amount_paise)}`, tx.payment_mode || '',
        new Date(tx.created_at).toLocaleDateString('en-IN'),
      ]),
      { subtitle: rangeCaption(range, tPdf('dateRange.all')) },
    )
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-cta border-t-transparent rounded-full animate-spin" /></div>
  if (!donor) return <div className="text-center py-20 text-slate-400">{t('donors.donorNotFound')}</div>

  return (
    <div className="space-y-6 max-w-4xl">
      <PrintLetterhead title={t('donors.statementTitle', { name: donor.name })} subtitle={rangeCaption(range, t('dateRange.all'))} />

      <div className="flex items-center gap-4 no-print">
        <button onClick={() => navigate('/donors')} className="btn-icon"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold text-navy-900">{donor.name}</h1>
        {donor.is_active ? <span className="badge-green">{t('donors.active')}</span> : <span className="badge-gray">{t('donors.inactive')}</span>}
        <div className="ml-auto">
          {editing ? (
            <button onClick={() => setEditing(false)} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-secondary btn-sm"><Edit2 size={14} /> {t('common.edit')}</button>
          )}
        </div>
      </div>

      {editing ? (
        <form onSubmit={saveEdit} className="card">
          <div className="card-header"><h3 className="font-semibold text-sm">{t('donors.editDonor')}</h3></div>
          <div className="card-body space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="form-label" htmlFor="donor-profile-name">{t('donors.fullName')}</label>
                <input id="donor-profile-name" className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">{t('donors.mobile')}</label>
                <PhoneInput value={form.mobile} onChange={v => setForm(f => ({ ...f, mobile: v }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="donor-profile-email">{t('donors.email')}</label>
                <input id="donor-profile-email" type="email" className="form-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="donor-profile-gotra">{t('donors.gotra')}</label>
                <input id="donor-profile-gotra" className="form-input" value={form.gotra} onChange={e => setForm(f => ({ ...f, gotra: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">{t('donors.country')}</label>
                <CountrySelect value={form.country} onChange={c => setForm(f => ({ ...f, country: c, state: '', city: '' }))} />
              </div>
              {(!form.country || form.country === 'India') ? (
                <>
                  <div>
                    <label className="form-label">{t('donors.state')}</label>
                    <StateSelect value={form.state} onChange={sv => setForm(f => ({ ...f, state: sv, city: '' }))} />
                  </div>
                  <div>
                    <label className="form-label">{t('donors.city')}</label>
                    <CitySelect state={form.state} value={form.city} onChange={c => setForm(f => ({ ...f, city: c }))} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="form-label" htmlFor="donor-profile-state">{t('donors.stateProvince')}</label>
                    <input id="donor-profile-state" className="form-input" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="donor-profile-city">{t('donors.city')}</label>
                    <input id="donor-profile-city" className="form-input" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                  </div>
                </>
              )}
              <div className="col-span-2">
                <label className="form-label" htmlFor="donor-profile-address">{t('donors.address')}</label>
                <input id="donor-profile-address" className="form-input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary">
                <Save size={14} /> {saving ? t('common.saving') : t('donors.saveChanges')}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="btn-secondary">{t('common.cancel')}</button>
            </div>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm">{t('donors.profile')}</h3></div>
            <div className="card-body space-y-3">
              {[
                [t('donors.mobile'), donor.mobile || '—'],
                [t('donors.email'), donor.email || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
              {/* PAN is intentionally not shown here — it is captured with the
                  donor's donation (for Form 10BD) and never displayed/edited from
                  this profile. */}
              {[
                [t('donors.gotra'), donor.gotra || '—'],
                [t('donors.city'), donor.city ? `${donor.city}${donor.state ? `, ${donor.state}` : ''}` : '—'],
                [t('donors.pincode'), donor.pincode || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}

              {/* Tags */}
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs text-slate-400 mb-1.5">{t('donors.tags')}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(donor.tags ?? []).map(tag => (
                    <span key={tag} className="badge-blue inline-flex items-center gap-1">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} disabled={tagsSaving} aria-label={t('donors.removeTag', { tag })} className="hover:text-red-600">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <div className="relative">
                    <button
                      type="button" onClick={() => setTagPicker(o => !o)} disabled={tagsSaving}
                      className="text-xs text-brand-blue hover:underline disabled:opacity-50"
                    >
                      + {t('donors.addTag')}
                    </button>
                    {tagPicker && (
                      <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-2 w-48">
                        {DONOR_TAG_OPTIONS.filter(tg => !donor.tags?.includes(tg)).map(tg => (
                          <button
                            key={tg} type="button" onClick={() => addTag(tg)}
                            className="w-full text-left px-2 py-1 rounded text-xs text-slate-700 hover:bg-slate-50"
                          >
                            {tg}
                          </button>
                        ))}
                        <form onSubmit={e => { e.preventDefault(); addTag(customTag) }} className="flex gap-1 mt-1 pt-1 border-t border-slate-100">
                          <input
                            autoFocus className="form-input !py-1 !text-xs flex-1"
                            placeholder={t('donors.customTagPlaceholder')}
                            value={customTag} onChange={e => setCustomTag(e.target.value)}
                          />
                          <button type="submit" className="text-xs font-semibold text-white bg-navy-900 hover:bg-navy-800 rounded px-2">{t('kit.apply')}</button>
                        </form>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="font-semibold text-sm">{t('donors.givingSummary')}</h3></div>
            <div className="card-body space-y-3">
              <div className="text-center">
                <p className="text-3xl font-bold text-green-700">
                  ₹{fmtPaise(totals?.donated_paise ?? donor.cumulative_amount_current_fy_paise ?? 0)}
                </p>
                <p className="text-sm text-slate-400 mt-1">{t('donors.totalDonated')}</p>
              </div>
              {totals && totals.receipts > 0 && (
                <div className="text-center text-sm text-slate-500">
                  {t('donors.receiptsIssued', { count: totals.receipts })}
                </div>
              )}
              <button
                type="button"
                onClick={download80g}
                disabled={cert80g}
                className="btn-secondary btn-sm w-full justify-center"
              >
                {cert80g ? <RefreshCw size={14} className="animate-spin" /> : <Award size={14} />}
                {t('donors.download80g')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h3 className="font-semibold text-sm text-navy-900">{t('donors.transactionHistory')}</h3>
          <div className="no-print"><DateRangePicker value={range} onChange={setRange} storageKey="donor-statement" /></div>
        </div>
        <DataTable
          viewKey="donor-statement"
          columns={columns}
          rows={visible}
          rowKey={tx => tx.id}
          loading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('donors.searchTransactions')}
          onExportXlsx={exportExcel}
          onExportPdf={exportPdf}
          onPrint={() => printCurrentView()}
          filterState={filterState}
          onFilterChange={(key, s) => {
            setFilterState(prev => { const next = { ...prev }; if (s) next[key] = s; else delete next[key]; return next })
          }}
          page={1}
          limit={visible.length || 1}
          total={visible.length}
          onPageChange={() => {}}
          emptyMessage={t('donors.noTransactions')}
          onClearFilters={() => setFilterState({})}
        />
      </div>

    </div>
  )
}
