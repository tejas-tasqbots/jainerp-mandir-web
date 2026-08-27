import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Building2, Phone, Mail, FileText, Landmark, Sheet, Printer } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, fmtPaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface VendorDetail {
  id: string
  name: string
  contact_person?: string
  mobile?: string
  email?: string
  gstin?: string
  pan_masked?: string
  bank_account?: string
  bank_ifsc?: string
  tds_section?: string
  annual_payment_paise?: number
  notes?: string
  is_active: boolean
  created_at: string
}

interface ExpenseRow {
  id: string
  description: string
  bill_number?: string
  bill_date?: string
  amount_paise: number
  gst_paid_paise?: number
  payment_mode: string
  is_on_credit: boolean
  tds_deducted?: boolean
  tds_amount_paise?: number
  category?: string
  created_at: string
}

interface CreditorRow {
  id: string
  description: string
  original_amount_paise: number
  paid_amount_paise: number
  outstanding_paise: number
  status: string
  due_date?: string
  created_at: string
}

interface Profile {
  vendor: VendorDetail
  totals: { total_billed_paise: number; outstanding_paise: number; expense_count: number; open_payables: number }
  expenses: ExpenseRow[]
  creditors: CreditorRow[]
}

export function VendorProfile() {
  const { t } = useTranslation()
  const toast = useToast()
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api.get(`/vendors/${id}/profile`)
      .then(r => setData(r.data.data))
      .catch(() => setError(t('vendors.couldNotLoad')))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-center py-16 text-slate-400">{t('vendors.loadingVendor')}</div>
  if (error || !data) return <div className="text-center py-16 text-red-500">{error || t('vendors.notFound')}</div>

  const v = data.vendor

  async function exportExcel() {
    if (!data) return
    if (!data.expenses.length && !data.creditors.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('vendors.statementTitle', { name: v.name }),
        subtitle: t('donors.fullHistory'),
        filename: `${v.name}-statement`,
        columns: [
          { header: t('vendors.date'), type: 'date' },
          { header: t('vendors.description'), width: 30 },
          { header: t('vendors.category'), width: 16 },
          { header: t('vendors.billNo'), width: 14 },
          { header: t('vendors.amount'), type: 'money' },
          { header: 'GST', type: 'money' },
          { header: t('vendors.tdsCol'), type: 'money' },
          { header: t('vendors.mode'), width: 10 },
          { header: t('vendors.type'), width: 10 },
        ],
        rows: data.expenses.map(e => [
          new Date(e.bill_date || e.created_at).toLocaleDateString('en-IN'), e.description, e.category ?? '',
          e.bill_number ?? '', e.amount_paise, e.gst_paid_paise ?? 0, e.tds_amount_paise ?? 0,
          e.payment_mode, e.is_on_credit ? t('vendors.credit') : t('vendors.statusPaid'),
        ]),
        totals: [
          t('kit.total'), '', '', '',
          data.expenses.reduce((s, e) => s + e.amount_paise, 0),
          data.expenses.reduce((s, e) => s + (e.gst_paid_paise ?? 0), 0),
          data.expenses.reduce((s, e) => s + (e.tds_amount_paise ?? 0), 0),
          '', '',
        ],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <PrintLetterhead title={t('vendors.statementTitle', { name: v.name })} subtitle={t('donors.fullHistory')} />

      <div className="flex items-center justify-between no-print">
        <button type="button" onClick={() => navigate('/masters/vendors')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={15} /> {t('vendors.backToVendors')}
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={exportExcel} className="btn-secondary btn-sm"><Sheet size={14} /> {t('kit.exportExcel')}</button>
          <button type="button" onClick={() => printCurrentView()} className="btn-secondary btn-sm"><Printer size={14} /> {t('donors.print')}</button>
        </div>
      </div>

      {/* Header card */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-navy-50 flex items-center justify-center flex-shrink-0">
            <Building2 size={26} className="text-navy-900" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-navy-900">{v.name}</h1>
              {v.is_active ? <span className="badge-green">{t('vendors.active')}</span> : <span className="badge-gray">{t('vendors.inactive')}</span>}
            </div>
            {v.contact_person && <p className="text-sm text-slate-500 mt-0.5">{t('vendors.contact', { name: v.contact_person })}</p>}
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-slate-600">
              {v.mobile && <span className="flex items-center gap-1"><Phone size={13} className="text-slate-400" /> {v.mobile}</span>}
              {v.email && <span className="flex items-center gap-1"><Mail size={13} className="text-slate-400" /> {v.email}</span>}
              {v.gstin && <span className="flex items-center gap-1"><FileText size={13} className="text-slate-400" /> {t('vendors.gstin')}: <span className="font-mono">{v.gstin}</span></span>}
              {v.pan_masked && <span className="flex items-center gap-1">{t('vendors.pan')}: <span className="font-mono">{v.pan_masked}</span></span>}
              {v.tds_section && <span>{t('vendors.tds', { section: v.tds_section })}</span>}
              {(v.bank_account || v.bank_ifsc) && (
                <span className="flex items-center gap-1"><Landmark size={13} className="text-slate-400" /> {[v.bank_account, v.bank_ifsc].filter(Boolean).join(' / ')}</span>
              )}
            </div>
            {v.notes && <p className="text-xs text-slate-400 mt-2">{v.notes}</p>}
          </div>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-3"><p className="text-xs text-slate-400">{t('vendors.totalBilled')}</p><p className="text-lg font-bold text-navy-900">₹{fmtPaise(data.totals.total_billed_paise)}</p></div>
        <div className="card p-3"><p className="text-xs text-slate-400">{t('vendors.outstanding')}</p><p className="text-lg font-bold text-red-600">₹{fmtPaise(data.totals.outstanding_paise)}</p></div>
        <div className="card p-3"><p className="text-xs text-slate-400">{t('vendors.bills')}</p><p className="text-lg font-bold text-navy-900">{data.totals.expense_count}</p></div>
        <div className="card p-3"><p className="text-xs text-slate-400">{t('vendors.openPayables')}</p><p className="text-lg font-bold text-amber-600">{data.totals.open_payables}</p></div>
      </div>

      {/* Outstanding payables */}
      {data.creditors.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">{t('vendors.payablesTitle')}</h3>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{t('vendors.description')}</th><th>{t('vendors.original')}</th><th>{t('vendors.paid')}</th><th>{t('vendors.outstanding')}</th><th>{t('vendors.due')}</th><th>{t('vendors.status')}</th></tr></thead>
                <tbody>
                  {data.creditors.map(c => (
                    <tr key={c.id}>
                      <td className="text-slate-600">{c.description}</td>
                      <td>₹{fmtPaise(c.original_amount_paise)}</td>
                      <td className="text-green-700">₹{fmtPaise(c.paid_amount_paise)}</td>
                      <td className={c.outstanding_paise > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>₹{fmtPaise(c.outstanding_paise)}</td>
                      <td className="text-xs text-slate-400">{c.due_date ? new Date(c.due_date).toLocaleDateString('en-IN') : '—'}</td>
                      <td>
                        {c.status === 'paid' ? <span className="badge-green">{t('vendors.statusPaid')}</span>
                          : c.status === 'partially_paid' ? <span className="badge-yellow">{t('vendors.statusPartial')}</span>
                          : <span className="badge-red">{t('vendors.statusPending')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Expense history */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">{t('vendors.transactionHistoryExpenses')}</h3>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>{t('vendors.date')}</th><th>{t('vendors.description')}</th><th>{t('vendors.category')}</th><th>{t('vendors.billNo')}</th><th>{t('vendors.amount')}</th><th>{t('vendors.tdsCol')}</th><th>{t('vendors.mode')}</th><th>{t('vendors.type')}</th></tr></thead>
              <tbody>
                {data.expenses.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">{t('vendors.noTransactionsYet')}</td></tr>
                ) : data.expenses.map(e => (
                  <tr key={e.id}>
                    <td className="text-xs text-slate-500">{new Date(e.bill_date || e.created_at).toLocaleDateString('en-IN')}</td>
                    <td className="font-medium">{e.description}</td>
                    <td className="text-slate-500">{e.category || '—'}</td>
                    <td className="font-mono text-xs text-slate-400">{e.bill_number || '—'}</td>
                    <td className="font-semibold">
                      ₹{fmtPaise(e.amount_paise)}
                      {!!e.gst_paid_paise && <span className="block text-xs text-slate-400 font-normal">+GST ₹{fmtPaise(e.gst_paid_paise)}</span>}
                    </td>
                    <td>{e.tds_deducted ? <span className="badge-blue">₹{fmtPaise(e.tds_amount_paise ?? 0)}</span> : <span className="text-slate-300">—</span>}</td>
                    <td><span className="badge-gray">{e.payment_mode}</span></td>
                    <td>{e.is_on_credit ? <span className="badge-red">{t('vendors.credit')}</span> : <span className="badge-green">{t('vendors.statusPaid')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
