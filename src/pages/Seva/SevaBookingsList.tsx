import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, FileDown, Search, XCircle, Receipt, Ban } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { rsFmt } from '../../lib/downloadReport'
import { downloadRowsPdf } from '../../lib/pdfTable'
import { printDonationReceipt } from '../../lib/printReceipt'
import type { SevaBooking } from '../../types'
import { useConfirm } from '../../components/ConfirmDialog'

export function SevaBookingsList() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [bookings, setBookings] = useState<SevaBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState('')   // empty = all dates
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null)

  useEffect(() => { load() }, [dateFilter, statusFilter, search])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (dateFilter) params.set('date', dateFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search) params.set('q', search)
      const { data } = await api.get(`/seva-bookings?${params}`)
      setBookings(data.data || [])
    } catch {
      setBookings([])
    } finally {
      setLoading(false)
    }
  }

  async function openReceipt(id: string) {
    setReceiptLoading(id)
    try {
      // seva receipt payload is shape-compatible with the donation receipt renderer
      await printDonationReceipt(id, '/seva-bookings')
    } catch {
      alert('Could not load receipt. Please try again.')
    } finally {
      setReceiptLoading(null)
    }
  }

  async function cancelBooking(id: string) {
    if (!(await confirm({ title: 'Cancel booking', message: 'Cancel this seva booking?', confirmLabel: 'Cancel booking', cancelLabel: 'Keep', danger: true }))) return
    try {
      await api.patch(`/seva-bookings/${id}`, { status: 'cancelled' })
      load()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      alert(e.response?.data?.error?.message || 'Cancel failed')
    }
  }

  function exportCsv() {
    const params = new URLSearchParams({ limit: '1000' })
    if (dateFilter) params.set('date', dateFilter)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    api.get(`/seva-bookings?${params}`).then(r => {
      const rows: SevaBooking[] = r.data.data || []
      if (!rows.length) { alert('No bookings to export'); return }
      const headers = ['Date', 'Devotee', 'Mobile', 'Seva', 'Slot', 'Amount', 'Mode', 'Status']
      const csv = [headers.join(',')].concat(
        rows.map(b => [
          b.booking_date, `"${(b.devotee_name || '').replace(/"/g, '""')}"`, b.devotee_mobile ?? '',
          `"${(b.seva_name || '').replace(/"/g, '""')}"`, b.slot_time ?? '', b.amount_paise / 100,
          b.payment_mode, b.status,
        ].join(','))
      ).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'seva-bookings.csv'; a.click()
      URL.revokeObjectURL(url)
    }).catch(() => alert('Export failed'))
  }

  function exportPdf() {
    const params = new URLSearchParams({ limit: '1000' })
    if (dateFilter) params.set('date', dateFilter)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    api.get(`/seva-bookings?${params}`).then(r => {
      const rows: SevaBooking[] = r.data.data || []
      const total = rows.reduce((s, b) => s + b.amount_paise, 0)
      downloadRowsPdf('seva-bookings.pdf', 'Seva Bookings',
        ['Date', 'Devotee', 'Mobile', 'Seva', 'Slot', 'Amount', 'Mode', 'Status'],
        rows.map(b => [
          b.booking_date, b.devotee_name ?? '', b.devotee_mobile ?? '',
          b.seva_name ?? '', b.slot_time ?? '', rsFmt(b.amount_paise), b.payment_mode, b.status,
        ]),
        { subtitle: dateFilter || 'All dates', totals: ['Total', '', '', '', '', rsFmt(total), '', ''] })
    }).catch(() => alert('Export failed'))
  }

  function statusBadge(s: string) {
    if (s === 'booked') return <span className="badge-yellow">Booked</span>
    if (s === 'confirmed') return <span className="badge-blue">Confirmed</span>
    if (s === 'completed') return <span className="badge-green">Completed</span>
    if (s === 'cancelled') return <span className="badge-red">Cancelled</span>
    return <span className="badge-gray">{s}</span>
  }

  async function markCompleted(id: string) {
    await api.patch(`/seva-bookings/${id}`, { status: 'completed' })
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Seva Bookings</h1>
        <div className="flex gap-2">
          <button type="button" onClick={exportPdf} className="btn-secondary btn-sm"><FileDown size={14} /> Export PDF</button>
          <button type="button" onClick={exportCsv} className="btn-secondary btn-sm"><Download size={14} /> Export CSV</button>
          <button type="button" onClick={() => navigate('/seva/add')} className="btn-primary btn-sm">
            <Plus size={14} /> New Booking
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="form-input pl-9" placeholder="Search devotee, seva..."
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <XCircle size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="seva-date" className="text-sm text-slate-600">Date:</label>
          <input id="seva-date" type="date" title="Filter by date" className="form-input w-40" value={dateFilter}
            onChange={e => setDateFilter(e.target.value)} />
          {dateFilter && (
            <button type="button" onClick={() => setDateFilter('')} className="text-xs text-slate-400 hover:text-red-500">All dates</button>
          )}
        </div>
        <div className="flex gap-2">
          {['all', 'booked', 'confirmed', 'completed', 'cancelled'].map(s => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs rounded-md font-medium capitalize transition-colors ${statusFilter === s ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Devotee</th>
                <th>Seva</th>
                <th>Date</th>
                <th>Slot</th>
                <th>Amount</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">Loading...</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">No seva bookings found</td></tr>
              ) : bookings.map(b => (
                <tr key={b.id}>
                  <td>
                    <p className="font-medium">{b.devotee_name}</p>
                    <p className="text-xs text-slate-400">{b.devotee_mobile}</p>
                    {b.gotra && <p className="text-xs text-slate-300">Gotra: {b.gotra}</p>}
                  </td>
                  <td className="text-slate-700">{b.seva_name || '—'}</td>
                  <td className="text-xs">{new Date(b.booking_date).toLocaleDateString('en-IN')}</td>
                  <td className="text-slate-500 text-xs">{b.slot_time || '—'}</td>
                  <td className="font-semibold">₹{fmtPaise(b.amount_paise)}</td>
                  <td><span className="badge-gray">{b.payment_mode}</span></td>
                  <td>{statusBadge(b.status)}</td>
                  <td>
                    <div className="flex gap-1 flex-wrap items-center">
                      {b.status === 'booked' && (
                        <button type="button" onClick={async () => { await api.patch(`/seva-bookings/${b.id}`, { status: 'confirmed' }); load() }}
                          className="btn-secondary btn-sm text-xs">Confirm</button>
                      )}
                      {(b.status === 'booked' || b.status === 'confirmed') && (
                        <button type="button" onClick={() => markCompleted(b.id)} className="btn-success btn-sm text-xs">
                          Mark Done
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openReceipt(b.id)}
                        title="Print Receipt"
                        aria-label="Print Receipt"
                        disabled={receiptLoading === b.id}
                        className="p-1 text-slate-400 hover:text-brand-blue rounded disabled:opacity-40"
                      >
                        <Receipt size={14} className={receiptLoading === b.id ? 'animate-pulse' : ''} />
                      </button>
                      {b.status !== 'cancelled' && b.status !== 'completed' && (
                        <button
                          type="button"
                          onClick={() => cancelBooking(b.id)}
                          title="Cancel booking"
                          aria-label="Cancel booking"
                          className="p-1 text-slate-400 hover:text-brand-red rounded"
                        >
                          <Ban size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
