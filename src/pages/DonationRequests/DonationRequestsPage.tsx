import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, CloudOff, Eye, FileSpreadsheet, FileText, Landmark, Loader2, Printer, RefreshCw, Search, Share2, ShieldCheck, XCircle } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { useToast } from '../../components/kit/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useIsOnline } from '../../lib/useIsOnline'
import { printDonationReceipt, shareReceiptPdf } from '../../lib/printReceipt'

type RequestStatus = 'pending' | 'approved' | 'rejected'

interface DonationRequest {
  id: string
  devotee_id: string
  devotee_mobile: string
  devotee_verified: boolean
  amount_paise: number
  category?: string | null
  payment_mode: string
  utr_number?: string | null
  paid_at?: string | null
  is_80g: boolean
  remarks?: string | null
  status: string
  donor_name?: string | null
  donor_pan_masked?: string | null
  donor_address?: string | null
  donor_city?: string | null
  donor_state?: string | null
  donor_pincode?: string | null
  donation_id?: string | null
  receipt_no?: string | null
  review_note?: string | null
  reviewed_at?: string | null
  created_at: string
  has_proof: boolean
}

interface DetailModal { open: boolean; loading: boolean; request: (DonationRequest & { proof_image_base64?: string | null }) | null }
interface RejectModal { open: boolean; id: string; reason: string; loading: boolean; error: string }

const TABS: { key: RequestStatus; labelKey: string }[] = [
  { key: 'pending', labelKey: 'donationRequests.pending' },
  { key: 'approved', labelKey: 'donationRequests.approved' },
  { key: 'rejected', labelKey: 'donationRequests.rejected' },
]

/**
 * Inbox for devotee bank/UPI donation requests (devotee portal → temple).
 * Approve creates the real receipted donation via the normal donation
 * pipeline; Reject records a reason. Online-only: the queue lives on the
 * central server, so the desktop app gates this page when offline.
 */
export function DonationRequestsPage() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const toast = useToast()
  const online = useIsOnline()
  const [tab, setTab] = useState<RequestStatus>('pending')
  const [rows, setRows] = useState<DonationRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailModal>({ open: false, loading: false, request: null })
  const [rejectModal, setRejectModal] = useState<RejectModal>({ open: false, id: '', reason: '', loading: false, error: '' })

  const fetchRows = useCallback(async () => {
    if (online === false) return
    setLoading(true)
    try {
      const { data } = await api.get('/donation-requests', { params: { status: tab, limit: 100 } })
      setRows(data.data || [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [tab, online])

  useEffect(() => { fetchRows() }, [fetchRows])

  async function viewDetail(id: string) {
    setDetail({ open: true, loading: true, request: null })
    try {
      const { data } = await api.get(`/donation-requests/${id}`)
      setDetail({ open: true, loading: false, request: data.data })
    } catch {
      setDetail({ open: false, loading: false, request: null })
    }
  }

  async function approve(r: DonationRequest) {
    const ok = await confirm({
      title: 'Approve donation',
      message: `Verify ₹${fmtPaise(r.amount_paise)} from ${r.donor_name || r.devotee_mobile}${r.utr_number ? ` (UTR ${r.utr_number})` : ''} against your bank/UPI statement, then approve to issue the receipt${r.is_80g ? ' (80G)' : ''}.`,
      confirmLabel: 'Approve & create receipt',
    })
    if (!ok) return
    setActionId(r.id)
    try {
      const { data } = await api.patch(`/donation-requests/${r.id}/approve`)
      const donationId = data.data?.donation_id
      setDetail({ open: false, loading: false, request: null })
      await fetchRows()
      if (donationId) {
        const print = await confirm({
          title: `Receipt ${data.data?.receipt_number ?? ''} created`,
          message: 'The devotee has been notified on WhatsApp and in the app. Print the receipt now?',
          confirmLabel: 'Print receipt',
          cancelLabel: 'Later',
        })
        if (print) printDonationReceipt(donationId).catch(() => {})
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      await confirm({
        title: 'Could not approve',
        message: err.response?.data?.error?.message || 'Approval failed. Please retry.',
        confirmLabel: 'OK',
      })
    } finally {
      setActionId(null)
    }
  }

  async function submitReject() {
    if (!rejectModal.reason.trim()) {
      setRejectModal(m => ({ ...m, error: 'A reason is required — the devotee sees it.' }))
      return
    }
    setRejectModal(m => ({ ...m, loading: true, error: '' }))
    try {
      await api.patch(`/donation-requests/${rejectModal.id}/reject`, { reason: rejectModal.reason.trim() })
      setRejectModal({ open: false, id: '', reason: '', loading: false, error: '' })
      setDetail({ open: false, loading: false, request: null })
      await fetchRows()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } }
      setRejectModal(m => ({ ...m, loading: false, error: err.response?.data?.error?.message || 'Reject failed' }))
    }
  }

  // Desktop offline gate — this queue lives on the central server.
  if (online === false) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-bold text-navy-900">{t('donationRequests.title')}</h1>
        <div className="card py-16 text-center">
          <CloudOff size={36} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium text-sm">{t('donationRequests.offlineTitle')}</p>
          <p className="text-slate-400 text-xs mt-1">{t('donationRequests.offlineBody')}</p>
        </div>
      </div>
    )
  }

  const donorLocation = (r: DonationRequest) =>
    [r.donor_city, r.donor_state].filter(Boolean).join(', ')

  const visible = search
    ? rows.filter(r => {
        const needle = search.toLowerCase()
        return (r.donor_name ?? '').toLowerCase().includes(needle)
          || r.devotee_mobile.includes(search)
          || (r.utr_number ?? '').toLowerCase().includes(needle)
          || (r.receipt_no ?? '').toLowerCase().includes(needle)
      })
    : rows

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('donationRequests.title'),
        subtitle: t(TABS.find(x => x.key === tab)?.labelKey ?? ''),
        filename: `donation-requests-${tab}`,
        columns: [
          { header: t('common.date'), type: 'date' },
          { header: t('donationRequests.devotee'), width: 24 },
          { header: t('devoteesPage.mobile'), width: 16 },
          { header: t('common.amount'), type: 'money' },
          { header: t('donationRequests.paidVia'), width: 12 },
          { header: t('donationRequests.reference'), width: 20 },
          { header: '80G', width: 8 },
          { header: t('common.status'), width: 12 },
        ],
        rows: visible.map(r => [
          new Date(r.created_at).toLocaleDateString('en-IN'),
          r.donor_name ?? '', r.devotee_mobile, r.amount_paise, r.payment_mode,
          r.utr_number ?? r.receipt_no ?? '', r.is_80g ? t('common.yes') : t('common.no'), r.status,
        ]),
        totals: [t('kit.total'), '', '', visible.reduce((s, r) => s + r.amount_paise, 0), '', '', '', ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-navy-900">{t('donationRequests.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('donationRequests.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="btn-icon !text-green-700 hover:!bg-green-50" title={t('kit.exportExcel')} aria-label={t('kit.exportExcel')}>
            <FileSpreadsheet size={16} />
          </button>
          <button onClick={fetchRows} className="btn-secondary btn-sm" title={t('ui.refresh')}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative w-64">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="form-input pl-9" placeholder={t('donationRequests.searchPlaceholder')}
          value={search} onChange={e => setSearch(e.target.value)} />
        {search && (
          <button type="button" title={t('kit.clearSearch')} aria-label={t('kit.clearSearch')} onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <XCircle size={14} />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(tabItem => (
          <button
            key={tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === tabItem.key
                ? 'border-brand-red text-brand-red'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t(tabItem.labelKey)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">{t('common.loading')}</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            {tab === 'pending' && t('donationRequests.noPending')}
            {tab === 'approved' && t('donationRequests.noApproved')}
            {tab === 'rejected' && t('donationRequests.noRejected')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('donationRequests.devotee')}</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">{t('common.amount')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('donationRequests.paidVia')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('donationRequests.reference')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('common.date')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{r.donor_name || '—'}</span>
                      {r.devotee_verified && (
                        <span title={t('ui.otpVerified')}><ShieldCheck size={14} className="text-green-600 flex-shrink-0" /></span>
                      )}
                      {r.is_80g && <span className="badge-green text-[10px]">80G</span>}
                    </div>
                    <div className="text-xs text-slate-400 tabular-nums">{r.devotee_mobile}{donorLocation(r) ? ` · ${donorLocation(r)}` : ''}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800 tabular-nums">₹{fmtPaise(r.amount_paise)}</td>
                  <td className="px-4 py-3">
                    <span className="uppercase text-xs font-medium text-slate-600">{r.payment_mode}</span>
                    <div className="text-xs text-slate-400">{r.category || 'General'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-slate-600">{r.utr_number || '—'}</div>
                    {r.has_proof && (
                      <button onClick={() => viewDetail(r.id)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-0.5">
                        <Eye size={11} /> {t('donationRequests.viewProof')}
                      </button>
                    )}
                    {tab === 'approved' && r.receipt_no && (
                      <div className="text-xs text-green-700 font-mono mt-0.5">{r.receipt_no}</div>
                    )}
                    {tab === 'rejected' && r.review_note && (
                      <div className="text-xs text-red-500 mt-0.5 max-w-[180px] truncate" title={r.review_note}>{r.review_note}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    {r.paid_at && <div className="text-slate-400">paid {new Date(r.paid_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {r.status === 'pending' && (
                        <>
                          <button
                            onClick={() => viewDetail(r.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
                          >
                            <Eye size={12} /> {t('donationRequests.review')}
                          </button>
                          <button
                            onClick={() => approve(r)}
                            disabled={actionId === r.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {actionId === r.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} {t('donationRequests.approve')}
                          </button>
                          <button
                            onClick={() => setRejectModal({ open: true, id: r.id, reason: '', loading: false, error: '' })}
                            disabled={actionId === r.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                          >
                            <XCircle size={12} /> {t('donationRequests.reject')}
                          </button>
                        </>
                      )}
                      {r.status === 'approved' && r.donation_id && (
                        <>
                          <button
                            onClick={() => printDonationReceipt(r.donation_id!).catch(() => {})}
                            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            title={t('donationRequests.printReceipt')}
                          >
                            <Printer size={14} />
                          </button>
                          <button
                            onClick={() => shareReceiptPdf(r.donation_id!).catch(() => {})}
                            className="p-1.5 rounded text-slate-400 hover:text-green-700 hover:bg-green-50"
                            title={t('donationRequests.shareReceipt')}
                          >
                            <Share2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail / proof modal */}
      {detail.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={() => setDetail({ open: false, loading: false, request: null })}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            {detail.loading || !detail.request ? (
              <div className="py-10 text-center text-slate-400 text-sm">{t('common.loading')}</div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-bold text-navy-900 flex items-center gap-2">
                      <Landmark size={16} className="text-brand-red" /> ₹{fmtPaise(detail.request.amount_paise)}
                      {detail.request.is_80g && <span className="badge-green text-[10px]">80G</span>}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5 uppercase">{detail.request.payment_mode} · {detail.request.category || t('donationRequests.general')}</p>
                  </div>
                  <button onClick={() => setDetail({ open: false, loading: false, request: null })} className="p-1 text-slate-400 hover:text-slate-700">
                    <XCircle size={18} />
                  </button>
                </div>

                <div className="text-sm space-y-1.5 bg-slate-50 rounded-lg p-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1"><FileText size={11} /> {t('donationRequests.receiptDetails')}</p>
                  <p><span className="text-slate-500">{t('donationRequests.donorLabel')}</span> <b>{detail.request.donor_name || '—'}</b> · {detail.request.devotee_mobile}</p>
                  {detail.request.donor_pan_masked && <p><span className="text-slate-500">{t('donationRequests.panLabel')}</span> <span className="font-mono">{detail.request.donor_pan_masked}</span></p>}
                  {(detail.request.donor_address || detail.request.donor_city) && (
                    <p><span className="text-slate-500">{t('donationRequests.addressLabel')}</span> {[detail.request.donor_address, detail.request.donor_city, detail.request.donor_state, detail.request.donor_pincode].filter(Boolean).join(', ')}</p>
                  )}
                  {detail.request.utr_number && <p><span className="text-slate-500">{t('donationRequests.utrLabel')}</span> <span className="font-mono">{detail.request.utr_number}</span></p>}
                  {detail.request.paid_at && <p><span className="text-slate-500">{t('donationRequests.paidOnLabel')}</span> {new Date(detail.request.paid_at).toLocaleDateString('en-IN')}</p>}
                  {detail.request.remarks && <p><span className="text-slate-500">{t('donationRequests.remarksLabel')}</span> {detail.request.remarks}</p>}
                  {detail.request.is_80g && (!detail.request.donor_pan_masked || !detail.request.donor_address) && (
                    <p className="text-amber-600 text-xs">{t('donationRequests.eightyGIncomplete')}</p>
                  )}
                </div>

                {detail.request.proof_image_base64 ? (
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{t('donationRequests.paymentScreenshot')}</p>
                    <img src={detail.request.proof_image_base64} alt={t('ui.paymentProof')} className="w-full rounded-lg border border-slate-200" />
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">{t('donationRequests.noScreenshot')}</p>
                )}

                {detail.request.status === 'pending' && (
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => setRejectModal({ open: true, id: detail.request!.id, reason: '', loading: false, error: '' })}
                      className="btn-secondary"
                    >
                      <XCircle size={14} /> {t('donationRequests.reject')}
                    </button>
                    <button
                      onClick={() => approve(detail.request!)}
                      disabled={actionId === detail.request.id}
                      className="btn-primary"
                    >
                      <CheckCircle size={14} /> {t('donationRequests.approveAndCreateReceipt')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Reject reason modal */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-navy-900">{t('donationRequests.rejectDonationRequest')}</h2>
            <p className="text-sm text-slate-500">{t('donationRequests.rejectSubtitle')}</p>
            <div>
              <label className="form-label">{t('common.reason')} *</label>
              <textarea
                className="form-textarea"
                rows={3}
                placeholder={t('donationRequests.rejectReasonPlaceholder')}
                value={rejectModal.reason}
                onChange={e => setRejectModal(m => ({ ...m, reason: e.target.value }))}
                autoFocus
              />
              {rejectModal.error && <p className="text-red-600 text-xs mt-1">{rejectModal.error}</p>}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setRejectModal({ open: false, id: '', reason: '', loading: false, error: '' })}
                className="btn-secondary"
                disabled={rejectModal.loading}
              >
                {t('common.cancel')}
              </button>
              <button onClick={submitReject} disabled={rejectModal.loading} className="btn-primary bg-red-600 hover:bg-red-700">
                <XCircle size={14} /> {rejectModal.loading ? t('donationRequests.rejecting') : t('donationRequests.rejectRequest')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
