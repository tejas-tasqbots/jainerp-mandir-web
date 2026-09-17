import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SetupChecklist } from '../../components/SetupChecklist'
import { MANDIR_TOUR, Walkthrough, hasSeenTour } from '../../components/Walkthrough'
import { fetchSetup } from '../../components/SetupChecklist'
import { hasBeenOfferedWizard, markWizardOffered } from '../Setup/SetupWizard'
import {
  IndianRupee, TrendingUp, TrendingDown, Hotel, Plus, AlertTriangle,
  Users, ShoppingBag, Bell, Lock, Footprints, Briefcase
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Legend
} from 'recharts'
import { api, fmtPaise } from '../../lib/api'
import { useAuthStore } from '../../store/authStore'
import type { DashboardOverview, DashboardTrend } from '../../types'

const COLORS = ['#2176AE', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

type Period = 'day' | 'week' | 'month' | 'year'

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // RouteGuard redirects here when a page is out of reach, and says why. Landing
  // on the dashboard with no explanation reads as a bug, so the reason is shown.
  const location = useLocation()
  const denied = location.state as
    | { deniedPath?: string; deniedReason?: 'role' | 'module'; deniedModule?: string; roleLabel?: string }
    | null
  const [period, setPeriod] = useState<Period>('month')
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)

  // First-run tour. Started once the dashboard has actually rendered, because
  // the tour anchors to real elements — opening it against a loading skeleton
  // would spotlight nothing.
  const { user, tenant } = useAuthStore()
  const [tourOpen, setTourOpen] = useState(false)

  // A newly onboarded trust is taken through setup step by step ONCE, the same
  // shape as the registration it just finished. Offered, not enforced: the
  // wizard is skippable throughout and this never fires again, after which the
  // checklist card below carries the same work.
  useEffect(() => {
    if (!tenant?.id || hasBeenOfferedWizard(tenant.id)) return
    let cancelled = false
    fetchSetup().then(setup => {
      if (cancelled || !setup || setup.complete || setup.dismissed) return
      markWizardOffered(tenant.id)
      navigate('/setup', { replace: true })
    })
    return () => { cancelled = true }
  }, [tenant?.id])
  useEffect(() => {
    if (loading || !user?.id || !tenant?.id) return
    if (hasSeenTour('mandir', user.id, tenant.id)) return
    const timer = setTimeout(() => setTourOpen(true), 600)
    return () => clearTimeout(timer)
  }, [loading, user?.id, tenant?.id])

  // Help → "Show me around" replays it without a reload.
  useEffect(() => {
    const replay = () => setTourOpen(true)
    window.addEventListener('jainerp:replay-tour', replay)
    return () => window.removeEventListener('jainerp:replay-tour', replay)
  }, [])

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

  // Tiles come from the server's `tiles` list (migration 031) so a trust that
  // never bought Dharamshala is not shown "0 rooms available" forever — a zero
  // is a statement, and it is the wrong one when the counter does not exist.
  const showsTile = (key: string) =>
    !overview?.tiles || overview.tiles.includes(key)

  const statCards = overview ? [
    {
      label: t('dashboard.totalDonations'),
      value: `₹${fmtPaise(overview.donations.total_paise)}`,
      sub: t('dashboard.transactions', { count: overview.donations.count }),
      icon: <IndianRupee size={20} />,
      color: 'green',
    },
    {
      label: t('dashboard.totalExpenses'),
      value: `₹${fmtPaise(overview.expenses.total_paise)}`,
      sub: t('dashboard.entries', { count: overview.expenses.count }),
      icon: <TrendingDown size={20} />,
      color: 'orange',
    },
    {
      label: t('dashboard.netIncome'),
      value: `₹${fmtPaise(overview.donations.total_paise - overview.expenses.total_paise)}`,
      sub: t('dashboard.donationsMinusExpenses'),
      icon: <TrendingUp size={20} />,
      color: 'blue',
    },
    ...(showsTile('rooms_available')
      ? [{
          label: t('dashboard.roomsAvailable'),
          value: String(overview.rooms_available ?? 0),
          // This said "3 donors total" — the donors count, under a rooms
          // figure. "0 available" means nothing without "of how many".
          sub: overview.rooms_total != null
            ? t('dashboard.roomsOfTotal', { count: overview.rooms_total })
            : t('dashboard.roomsFreeToday'),
          icon: <Hotel size={20} />,
          color: 'purple',
        }]
      : [{
          label: t('dashboard.donors', { defaultValue: 'Donors' }),
          value: String(overview.donors ?? 0),
          sub: t('dashboard.donorsTotal', { count: overview.donors }),
          icon: <Users size={20} />,
          color: 'purple',
        }]),
  ] : []

  const colorMap: Record<string, string> = {
    green:  'bg-green-50 text-green-700 border-green-200',
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
  }

  return (
    <div className="space-y-6">
      <Walkthrough name="mandir" steps={MANDIR_TOUR} open={tourOpen} onClose={() => setTourOpen(false)} />

      {/* Setup completion. Renders itself away at 100% or once dismissed —
          which is also why the tour anchor lives inside it, not on a wrapper
          here: an empty wrapper would still match and spotlight nothing. */}
      <SetupChecklist />

      {denied?.deniedPath && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Lock size={16} className="mt-0.5 shrink-0" />
          <div>
            {denied.deniedReason === 'module' ? (
              <>
                <strong>{t('rbac.moduleTitle', { defaultValue: 'Not part of your plan' })}</strong>{' '}
                {t('rbac.moduleBody', {
                  defaultValue:
                    'This trust does not use that feature. Ask your JainERP administrator to enable it.',
                })}
              </>
            ) : (
              <>
                <strong>{t('rbac.roleTitle', { defaultValue: 'No access' })}</strong>{' '}
                {t('rbac.roleBody', {
                  defaultValue: 'That page is not available to {{role}}.',
                  role: denied.roleLabel ?? 'your role',
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-navy-900">{t('dashboard.title')}</h1>
        <div className="flex flex-wrap gap-2">
          {(['day','week','month','year'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                period === p
                  ? 'bg-navy-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t(`dashboard.${p}`)}
            </button>
          ))}
          <button onClick={() => navigate('/donations/add')} className="btn-primary btn-sm ml-2">
            <Plus size={14} /> {t('dashboard.newDonation')}
          </button>
          <button onClick={() => navigate('/expenses/add')} className="btn-secondary btn-sm">
            <Plus size={14} /> {t('dashboard.expense')}
          </button>
          {(overview?.quick_actions ?? []).includes('prasad_sale') && (
            <button onClick={() => navigate('/prasad')} className="btn-secondary btn-sm">
              <ShoppingBag size={14} /> {t('dashboard.prasadBill')}
            </button>
          )}
        </div>
      </div>

      {loading && !overview && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-cta border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
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

      {/* Pledges (Boli) / Upcoming events alerts — each only when the trust runs it */}
      {overview && (showsTile('bolis') || showsTile('events')) && (
        <div className="grid grid-cols-3 gap-4">
          {/* Outstanding Pledges */}
          {overview.bolis && showsTile('bolis') && (
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
                <Bell size={15} className="text-orange-400" /> {t('dashboard.outstandingPledges')}
              </h3>
              <span className="badge-yellow">{overview.bolis.open}</span>
            </div>
            <div className="card-body py-3">
              <p className="text-lg font-bold text-orange-600">₹{fmtPaise(overview.bolis.outstanding_paise)}</p>
              <p className="text-xs text-slate-400 mt-1">{t('dashboard.pendingPledges', { count: overview.bolis.open })}</p>
              <button onClick={() => navigate('/donations?tab=pledges')} className="btn-secondary btn-sm mt-3">
                {t('dashboard.viewPledges')}
              </button>
            </div>
          </div>
          )}

          {/* Upcoming Events */}
          {overview.events && showsTile('events') && (
          <div className={overview.bolis && showsTile('bolis') ? 'card col-span-2' : 'card col-span-3'}>
            <div className="card-header">
              <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
                <AlertTriangle size={15} className="text-blue-400" /> {t('dashboard.upcomingEvents')}
              </h3>
              <span className="badge-blue">{overview.events.upcoming.length}</span>
            </div>
            <div className="card-body py-3">
              {overview.events.upcoming.length === 0 ? (
                <p className="text-slate-400 text-sm">{t('dashboard.noUpcomingEvents')}</p>
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
          )}
        </div>
      )}

      {/* Charts placeholder */}
      <DashboardCharts period={period} />

      {/* Quick stats footer. Visitors and Employees come only with their
          tiles: the Employees card used to render with no number at all for a
          trust with no staff on record, because the API omits a zero. */}
      {overview && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <div className="card-body py-3 flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg"><Users size={18} className="text-blue-600" /></div>
              <div>
                <p className="text-xs text-slate-400">{t('dashboard.totalDonors')}</p>
                <p className="font-bold text-lg">{overview.donors}</p>
              </div>
            </div>
          </div>
          {showsTile('visitors') && overview.visitors != null && (
            <div className="card">
              <div className="card-body py-3 flex items-center gap-3">
                <div className="p-2 bg-green-50 rounded-lg"><Footprints size={18} className="text-green-600" /></div>
                <div>
                  <p className="text-xs text-slate-400">{t('dashboard.totalVisitors')}</p>
                  <p className="font-bold text-lg">{overview.visitors}</p>
                </div>
              </div>
            </div>
          )}
          {showsTile('employees') && overview.employees != null && (
            <div className="card">
              <div className="card-body py-3 flex items-center gap-3">
                <div className="p-2 bg-purple-50 rounded-lg"><Briefcase size={18} className="text-purple-600" /></div>
                <div>
                  <p className="text-xs text-slate-400">{t('dashboard.employees')}</p>
                  <p className="font-bold text-lg">{overview.employees}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * ₹ for an axis tick, in the Indian units a committee reads: ₹300, ₹7.6k,
 * ₹4.5L, ₹1.2Cr. The old formatter divided everything by 1,000 and rounded,
 * so a ₹300 expense sat on an axis labelled ₹0k.
 */
function inrCompact(rupees: number): string {
  const abs = Math.abs(rupees)
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''))
  if (abs >= 1e7) return `₹${trim(rupees / 1e7)}Cr`
  if (abs >= 1e5) return `₹${trim(rupees / 1e5)}L`
  if (abs >= 1e3) return `₹${trim(rupees / 1e3)}k`
  return `₹${Math.round(rupees)}`
}

const inrFull = (rupees: number) =>
  `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** A bucket's x-axis label, in the reader's language. */
function bucketLabel(from: string, granularity: DashboardTrend['granularity'], locale: string): string {
  const [y, m, d] = from.split('-').map(Number)
  // Built from the parts, not parsed: `new Date('2026-09-01')` is UTC
  // midnight, which is still 31 August for anyone west of Greenwich.
  const date = new Date(y, m - 1, d)
  switch (granularity) {
    case 'fy': return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
    case 'month': return date.toLocaleDateString(locale, { month: 'short', year: '2-digit' })
    default: return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  }
}

const LOCALE: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' }

interface TrendPoint {
  label: string
  donations: number
  expenses: number
  donationsCount: number
  expensesCount: number
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: TrendPoint }[] }) {
  const { t } = useTranslation()
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const net = p.donations - p.expenses
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold text-navy-900">{p.label}</p>
      <p className="flex justify-between gap-4">
        <span className="text-[#2176AE]">{t('dashboard.donationsSeries')} ({p.donationsCount})</span>
        <span className="font-medium">{inrFull(p.donations)}</span>
      </p>
      <p className="flex justify-between gap-4">
        <span className="text-[#dc2626]">{t('dashboard.expensesSeries')} ({p.expensesCount})</span>
        <span className="font-medium">{inrFull(p.expenses)}</span>
      </p>
      <p className="mt-1 flex justify-between gap-4 border-t border-slate-100 pt-1">
        <span className="text-slate-500">{t('dashboard.net')}</span>
        <span className={`font-semibold ${net < 0 ? 'text-red-600' : 'text-green-700'}`}>{inrFull(net)}</span>
      </p>
    </div>
  )
}

function DashboardCharts({ period }: { period: Period }) {
  const { t, i18n } = useTranslation()
  const [trend, setTrend] = useState<DashboardTrend | null>(null)
  const [trendFailed, setTrendFailed] = useState(false)
  const [pieData, setPieData] = useState<{ name: string; value: number }[]>([])

  // Donations AND expenses, per bucket, from one endpoint that zero-fills the
  // buckets and follows the period buttons. The chart this replaces drew from
  // a donations-only report: its Expenses series read a field that report
  // never sent, so expenses were always zero, and it plotted only months that
  // had donations — one lonely bar for a trust's first month.
  useEffect(() => {
    let cancelled = false
    setTrendFailed(false)
    api.get(`/dashboard/trend?period=${period}`)
      .then(r => { if (!cancelled) setTrend(r.data.data) })
      .catch(() => { if (!cancelled) setTrendFailed(true) })
    return () => { cancelled = true }
  }, [period])

  // Top donors are this FY's whatever the period, so they load once.
  useEffect(() => {
    const now = new Date()
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    const fy = `${year}-${String(year + 1).slice(-2)}`
    api.get(`/reports/analytics/top-donors?fy=${fy}&limit=5`)
      .then(r => {
        const d = r.data.data
        if (Array.isArray(d)) {
          // API returns amount_paise (older builds used total_paise)
          setPieData(d.slice(0, 5).map((td: { name: string; amount_paise?: number; total_paise?: number }) => ({
            name: td.name,
            value: Math.round((td.amount_paise ?? td.total_paise ?? 0) / 100),
          })))
        }
      })
      .catch(() => { /* the card says "No donor data" */ })
  }, [])

  const locale = LOCALE[i18n.language] ?? 'en-IN'
  const points: TrendPoint[] = (trend?.buckets ?? []).map(b => ({
    label: bucketLabel(b.from, trend!.granularity, locale),
    donations: b.donations_paise / 100,
    expenses: b.expenses_paise / 100,
    donationsCount: b.donations_count,
    expensesCount: b.expenses_count,
  }))
  const totals = points.reduce(
    (s, p) => ({ donations: s.donations + p.donations, expenses: s.expenses + p.expenses }),
    { donations: 0, expenses: 0 },
  )
  const empty = points.length > 0 && totals.donations === 0 && totals.expenses === 0
  // A small, non-zero bar next to a big one — ₹300 of expenses beside ₹7,664
  // of donations — rounds down to nothing on the axis. Keep it visible without
  // drawing a sliver for a real zero.
  const minBar = (v: number | null | undefined) => (v && v > 0 ? 3 : 0)

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        {/* Bar chart */}
        <div className="card col-span-2" data-testid="trend-card">
          <div className="card-header flex-wrap gap-2">
            <h3 className="font-semibold text-sm text-navy-900">{t(`dashboard.trendTitle.${period}`)}</h3>
            {points.length > 0 && !empty && (
              <p className="text-xs text-slate-500" data-testid="trend-totals">
                <span className="text-[#2176AE] font-medium">{inrFull(totals.donations)}</span>
                {' − '}
                <span className="text-[#dc2626] font-medium">{inrFull(totals.expenses)}</span>
                {' = '}
                <span className={`font-semibold ${totals.donations - totals.expenses < 0 ? 'text-red-600' : 'text-green-700'}`}>
                  {inrFull(totals.donations - totals.expenses)}
                </span>
              </p>
            )}
          </div>
          <div className="card-body">
            {trendFailed ? (
              <p className="text-slate-400 text-sm text-center py-16">{t('dashboard.chartLoadFailed')}</p>
            ) : !trend ? (
              <div className="h-[220px] animate-pulse rounded-md bg-slate-50" />
            ) : empty ? (
              <p className="text-slate-400 text-sm text-center py-16" data-testid="trend-empty">{t('dashboard.noTrendData')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={points} barGap={2} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={inrCompact} width={52} tickLine={false} axisLine={false} />
                  <Tooltip content={<TrendTooltip />} cursor={{ fill: '#f8fafc' }} />
                  <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="donations" name={t('dashboard.donationsSeries')} fill="#2176AE" radius={[3, 3, 0, 0]}
                    maxBarSize={28} minPointSize={minBar} />
                  <Bar dataKey="expenses" name={t('dashboard.expensesSeries')} fill="#f87171" radius={[3, 3, 0, 0]}
                    maxBarSize={28} minPointSize={minBar} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Pie chart */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-sm text-navy-900">{t('dashboard.topDonors')}</h3>
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
                    <div key={`${d.name}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                      {/* The name takes the room there is; it was cut at 80px
                          ("Srushti Kast…") with half the card empty. */}
                      <div className="flex min-w-0 items-center gap-1.5">
                        <div className="w-2.5 h-2.5 shrink-0 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="text-slate-600 truncate" title={d.name}>{d.name}</span>
                      </div>
                      <span className="shrink-0 font-medium">₹{d.value.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-slate-400 text-sm text-center py-8">{t('dashboard.noDonorData')}</p>
            )}
          </div>
        </div>
      </div>

      {/* The "Daily Collection Trend" line chart that sat here read a
          `daily_breakdown` no endpoint returns, so it never drew. Day on the
          period buttons above now shows the last 14 days, per day. */}
    </>
  )
}
