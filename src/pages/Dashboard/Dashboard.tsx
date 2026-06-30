import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IndianRupee, TrendingUp, TrendingDown, Hotel, Plus, AlertTriangle,
  Users, ShoppingBag, Bell
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend
} from 'recharts'
import { api, fmtPaise } from '../../lib/api'
import type { DashboardOverview } from '../../types'

const COLORS = ['#2176AE', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

type Period = 'day' | 'week' | 'month' | 'year'

export function Dashboard() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>('month')
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [period])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/dashboard?period=${period}`)
      setOverview(data.data)
    } catch {
      // keep previous data
    } finally {
      setLoading(false)
    }
  }

  const statCards = overview ? [
    {
      label: 'Total Donations',
      value: `₹${fmtPaise(overview.donations.total_paise)}`,
      sub: `${overview.donations.count} transactions`,
      icon: <IndianRupee size={20} />,
      color: 'green',
    },
    {
      label: 'Total Expenses',
      value: `₹${fmtPaise(overview.expenses.total_paise)}`,
      sub: `${overview.expenses.count} entries`,
      icon: <TrendingDown size={20} />,
      color: 'orange',
    },
    {
      label: 'Net Income',
      value: `₹${fmtPaise(overview.donations.total_paise - overview.expenses.total_paise)}`,
      sub: 'Donations minus expenses',
      icon: <TrendingUp size={20} />,
      color: 'blue',
    },
    {
      label: 'Rooms Available',
      value: String(overview.rooms_available),
      sub: `${overview.donors} donors total`,
      icon: <Hotel size={20} />,
      color: 'purple',
    },
  ] : []

  const colorMap: Record<string, string> = {
    green:  'bg-green-50 text-green-700 border-green-200',
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-900">Dashboard</h1>
        <div className="flex gap-2">
          {(['day','week','month','year'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize ${
                period === p
                  ? 'bg-navy-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {p}
            </button>
          ))}
          <button onClick={() => navigate('/donations/add')} className="btn-primary btn-sm ml-2">
            <Plus size={14} /> New Donation
          </button>
          <button onClick={() => navigate('/expenses/add')} className="btn-secondary btn-sm">
            <Plus size={14} /> Expense
          </button>
          <button onClick={() => navigate('/prasad')} className="btn-secondary btn-sm">
            <ShoppingBag size={14} /> Prasad Bill
          </button>
        </div>
      </div>

      {loading && !overview && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-cta border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className={`card border-l-4 ${colorMap[card.color]}`}>
            <div className="card-body flex items-start justify-between py-4 px-5">
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">{card.label}</p>
                <p className="text-xl font-bold">{card.value}</p>
                <p className="text-xs text-slate-400 mt-1">{card.sub}</p>
              </div>
              <div className={`p-2 rounded-lg ${colorMap[card.color]}`}>{card.icon}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Boli / Upcoming events alerts */}
      {overview && (
        <div className="grid grid-cols-3 gap-4">
          {/* Outstanding Boli */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
                <Bell size={15} className="text-orange-400" /> Outstanding Bolis
              </h3>
              <span className="badge-yellow">{overview.bolis.open}</span>
            </div>
            <div className="card-body py-3">
              <p className="text-lg font-bold text-orange-600">₹{fmtPaise(overview.bolis.outstanding_paise)}</p>
              <p className="text-xs text-slate-400 mt-1">{overview.bolis.open} pending pledges</p>
              <button onClick={() => navigate('/boli')} className="btn-secondary btn-sm mt-3">
                View Bolis
              </button>
            </div>
          </div>

          {/* Upcoming Events */}
          <div className="card col-span-2">
            <div className="card-header">
              <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
                <AlertTriangle size={15} className="text-blue-400" /> Upcoming Events
              </h3>
              <span className="badge-blue">{overview.events.upcoming.length}</span>
            </div>
            <div className="card-body py-3">
              {overview.events.upcoming.length === 0 ? (
                <p className="text-slate-400 text-sm">No upcoming events</p>
              ) : (
                <div className="space-y-2">
                  {overview.events.upcoming.slice(0, 3).map(e => (
                    <div key={e.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{e.name}</span>
                      <span className="text-slate-500 text-xs">{new Date(e.start_date).toLocaleDateString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Charts placeholder */}
      <DashboardCharts period={period} />

      {/* Quick stats footer */}
      {overview && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <div className="card-body py-3 flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg"><Users size={18} className="text-blue-600" /></div>
              <div>
                <p className="text-xs text-slate-400">Total Donors</p>
                <p className="font-bold text-lg">{overview.donors}</p>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-body py-3 flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg"><IndianRupee size={18} className="text-green-600" /></div>
              <div>
                <p className="text-xs text-slate-400">Total Visitors</p>
                <p className="font-bold text-lg">{overview.visitors}</p>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-body py-3 flex items-center gap-3">
              <div className="p-2 bg-purple-50 rounded-lg"><Hotel size={18} className="text-purple-600" /></div>
              <div>
                <p className="text-xs text-slate-400">Employees</p>
                <p className="font-bold text-lg">{overview.employees}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DashboardCharts({ period }: { period: Period }) {
  const [barData, setBarData] = useState<{ month: string; donations: number; expenses: number }[]>([])
  const [pieData, setPieData] = useState<{ name: string; value: number }[]>([])
  const [lineData, setLineData] = useState<{ date: string; amount: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadCharts()
  }, [period])

  async function loadCharts() {
    setLoading(true)
    try {
      const fy = getCurrentFY()
      const [trends, topDonors, dailyResp] = await Promise.allSettled([
        api.get(`/reports/analytics/donation-trends?granularity=monthly&fy=${fy}`),
        api.get(`/reports/analytics/top-donors?fy=${fy}&limit=5`),
        api.get(`/reports/daily-collection?date=${new Date().toISOString().slice(0,10)}`),
      ])

      if (trends.status === 'fulfilled') {
        // API returns { fy, granularity, points: [{ bucket, amount_paise, receipts }] }
        const d = trends.value.data.data
        const points = Array.isArray(d) ? d : (d?.points ?? [])
        if (Array.isArray(points) && points.length) {
          setBarData(points.map((m: { bucket?: string; month?: string; amount_paise?: number; total_paise?: number; expense_paise?: number }) => ({
            month: m.month ?? (m.bucket ? new Date(m.bucket).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : ''),
            donations: Math.round((m.amount_paise ?? m.total_paise ?? 0) / 100),
            expenses: Math.round((m.expense_paise || 0) / 100),
          })))
        }
      }

      if (topDonors.status === 'fulfilled') {
        const d = topDonors.value.data.data
        if (Array.isArray(d)) {
          // API returns amount_paise (older builds used total_paise)
          setPieData(d.slice(0,5).map((td: { name: string; amount_paise?: number; total_paise?: number }) => ({
            name: td.name,
            value: Math.round((td.amount_paise ?? td.total_paise ?? 0) / 100),
          })))
        }
      }

      if (dailyResp.status === 'fulfilled') {
        const d = dailyResp.value.data.data
        if (d?.daily_breakdown) {
          setLineData(d.daily_breakdown.map((e: { date: string; total_paise: number }) => ({
            date: e.date.slice(5),
            amount: Math.round(e.total_paise / 100),
          })))
        }
      }
    } catch {
      // ignore chart errors
    } finally {
      setLoading(false)
    }
  }

  function getCurrentFY() {
    const now = new Date()
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    return `${year}-${String(year + 1).slice(-2)}`
  }

  if (loading && barData.length === 0) return null

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        {/* Bar chart */}
        <div className="card col-span-2">
          <div className="card-header">
            <h3 className="font-semibold text-sm text-navy-900">Donations vs Expenses (Monthly)</h3>
          </div>
          <div className="card-body">
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData} barSize={16}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => `₹${v.toLocaleString('en-IN')}`} />
                  <Legend />
                  <Bar dataKey="donations" name="Donations" fill="#2176AE" radius={[3,3,0,0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-slate-400 text-sm text-center py-8">No chart data available</p>
            )}
          </div>
        </div>

        {/* Pie chart */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-sm text-navy-900">Top Donors (This FY)</h3>
          </div>
          <div className="card-body flex flex-col items-center">
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={35} outerRadius={60}
                      dataKey="value" paddingAngle={2}>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => `₹${v.toLocaleString('en-IN')}`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="w-full space-y-1 mt-1">
                  {pieData.map((d, i) => (
                    <div key={`${d.name}-${i}`} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="text-slate-600 truncate max-w-[80px]">{d.name}</span>
                      </div>
                      <span className="font-medium">₹{d.value.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-slate-400 text-sm text-center py-8">No donor data</p>
            )}
          </div>
        </div>
      </div>

      {/* Line chart */}
      {lineData.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-sm text-navy-900">Daily Collection Trend</h3>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => `₹${v.toLocaleString('en-IN')}`} />
                <Line type="monotone" dataKey="amount" stroke="#2176AE" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </>
  )
}
