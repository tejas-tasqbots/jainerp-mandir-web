import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, IndianRupee, Receipt, Hotel, ShoppingBag,
  Heart, Utensils, Calendar, BarChart2, Award, BookMarked, Settings,
  ChevronDown, ChevronRight, HelpCircle, Users, Landmark,
  UserCheck, Sparkles, Beef
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { canSee } from '../../lib/rbac'
import { useIsOnline } from '../../lib/useIsOnline'
import { useAuthStore } from '../../store/authStore'
import { useProfileStore } from '../../store/profileStore'

interface NavItem {
  labelKey: string
  icon: React.ReactNode
  to?: string
  children?: Array<{ labelKey: string; to: string }>
}

const navItems: NavItem[] = [
  { labelKey: 'nav.dashboard', icon: <LayoutDashboard size={18} />, to: '/dashboard' },
  { labelKey: 'nav.donations', icon: <IndianRupee size={18} />, to: '/donations' },
  { labelKey: 'nav.expenses', icon: <Receipt size={18} />, to: '/expenses' },
  {
    labelKey: 'nav.dharamshala', icon: <Hotel size={18} />,
    children: [
      { labelKey: 'nav.roomAvailability', to: '/rooms/availability' },
      { labelKey: 'nav.rooms', to: '/rooms' },
      { labelKey: 'nav.hall', to: '/hall' },
    ],
  },
  { labelKey: 'nav.prasad', icon: <ShoppingBag size={18} />, to: '/prasad' },
  { labelKey: 'nav.seva', icon: <Heart size={18} />, to: '/seva' },
  { labelKey: 'nav.bhojanshala', icon: <Utensils size={18} />, to: '/annadaan' },
  { labelKey: 'nav.gaushala', icon: <Beef size={18} />, to: '/gaushala' },
  { labelKey: 'nav.events', icon: <Calendar size={18} />, to: '/events' },
  { labelKey: 'nav.sant', icon: <Sparkles size={18} />, to: '/sant' },
  {
    labelKey: 'nav.people', icon: <Users size={18} />,
    children: [
      { labelKey: 'nav.connectedDevotees', to: '/devotees' },
      { labelKey: 'nav.donors', to: '/donors' },
      { labelKey: 'nav.creditors', to: '/creditors' },
    ],
  },
  {
    labelKey: 'nav.masters', icon: <UserCheck size={18} />,
    children: [
      { labelKey: 'nav.vendors', to: '/masters/vendors' },
      { labelKey: 'nav.priests', to: '/masters/priests' },
      { labelKey: 'nav.employees', to: '/masters/employees' },
      { labelKey: 'nav.inventory', to: '/masters/inventory' },
    ],
  },
  {
    labelKey: 'nav.accounts', icon: <Landmark size={18} />,
    children: [
      { labelKey: 'nav.cashBank', to: '/accounts/cash-bank' },
      { labelKey: 'nav.reconciliation', to: '/accounts/reconciliation' },
      { labelKey: 'nav.cheques', to: '/accounts/cheques' },
      { labelKey: 'nav.contra', to: '/accounts/contra' },
      { labelKey: 'nav.fixedAssets', to: '/accounts/fixed-assets' },
      { labelKey: 'nav.loans', to: '/accounts/loans' },
      { labelKey: 'nav.dayBook', to: '/accounts/day-book' },
      { labelKey: 'nav.ledger', to: '/accounts/ledger' },
      { labelKey: 'nav.trialBalance', to: '/accounts/trial-balance' },
      { labelKey: 'nav.receiptsPayments', to: '/accounts/receipts-payments' },
      { labelKey: 'nav.incomeExpenditure', to: '/accounts/income-expenditure' },
      { labelKey: 'nav.balanceSheet', to: '/accounts/balance-sheet' },
    ],
  },
  { labelKey: 'nav.reports', icon: <BarChart2 size={18} />, to: '/reports' },
  { labelKey: 'nav.certificates', icon: <Award size={18} />, to: '/certificates' },
  {
    labelKey: 'nav.registers', icon: <BookMarked size={18} />,
    children: [
      { labelKey: 'nav.lostFound', to: '/registers/lost-found' },
      { labelKey: 'nav.visitorCount', to: '/registers/visitor-count' },
      { labelKey: 'nav.recycleBin', to: '/registers/recycle-bin' },
      { labelKey: 'nav.activityLog', to: '/registers/activity-log' },
    ],
  },
  { labelKey: 'nav.settings', icon: <Settings size={18} />, to: '/settings' },
  { labelKey: 'nav.userGuide', icon: <HelpCircle size={18} />, to: '/help' },
]

function NavGroup({ item }: { item: NavItem }) {
  const { t } = useTranslation()
  const location = useLocation()
  const hasActiveChild = item.children?.some(c => location.pathname.startsWith(c.to)) ?? false
  const [open, setOpen] = useState(hasActiveChild)

  useEffect(() => {
    if (hasActiveChild) setOpen(true)
  }, [location.pathname, hasActiveChild])

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-navy-900 rounded-md transition-colors"
      >
        <span className="flex-shrink-0">{item.icon}</span>
        <span className="flex-1 text-left truncate">{t(item.labelKey)}</span>
        {open
          ? <ChevronDown size={13} className="flex-shrink-0" />
          : <ChevronRight size={13} className="flex-shrink-0" />}
      </button>
      {open && (
        <div className="ml-7 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
          {item.children?.map(child => (
            <NavLink
              key={child.to}
              to={child.to}
              className={({ isActive }) =>
                `block px-2 py-1.5 text-xs rounded-md transition-colors truncate ${
                  isActive
                    ? 'bg-brand-red text-white font-semibold'
                    : 'text-slate-500 hover:text-navy-900 hover:bg-slate-100'
                }`
              }
            >
              {t(child.labelKey)}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

/** Poll the pending devotee donation-request count for the sidebar badge. */
function usePendingRequestCount(): number {
  const online = useIsOnline()
  const [count, setCount] = useState(0)

  useEffect(() => {
    // Central-server data — skip entirely while the desktop app is offline.
    if (online === false) { setCount(0); return }
    let cancelled = false
    const poll = () =>
      api.get('/donation-requests/pending-count')
        .then(r => { if (!cancelled) setCount(r.data.data?.pending ?? 0) })
        .catch(() => { if (!cancelled) setCount(0) })
    poll()
    const t = setInterval(poll, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [online])

  return count
}

export function Sidebar() {
  const { t } = useTranslation()
  const { profile } = useProfileStore()
  const roles = useAuthStore(s => s.user?.roles)
  const modules = useAuthStore(s => s.modules)
  const pendingRequests = usePendingRequestCount()

  // Hide modules the logged-in role can't work in (doc M1). The server
  // enforces real permissions — this only keeps the workspace uncluttered.
  const visibleItems = navItems
    .map(item => {
      if (item.children) {
        const children = item.children.filter(c => canSee(c.to, roles, modules))
        return children.length ? { ...item, children } : null
      }
      return canSee(item.to!, roles, modules) ? item : null
    })
    .filter((i): i is NavItem => i !== null)

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col h-full">
      <div className="px-4 py-5 border-b border-slate-200">
        <div className="text-2xl font-bold leading-none tracking-tight">
          <span className="text-navy-900">Jain</span><span className="text-brand-red">ERP</span>
        </div>
        <p className="text-slate-400 text-xs mt-1 truncate">
          {profile?.name || 'Temple Management'}
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visibleItems.map(item =>
          item.children ? (
            <NavGroup key={item.labelKey} item={item} />
          ) : (
            <NavLink
              key={item.to}
              to={item.to!}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2.5 text-sm rounded-md transition-colors ${
                  isActive
                    ? 'bg-brand-red text-white font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-navy-900'
                }`
              }
            >
              <span className="flex-shrink-0">{item.icon}</span>
              <span className="truncate flex-1">{t(item.labelKey)}</span>
              {item.to === '/donations' && pendingRequests > 0 && (
                <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {pendingRequests > 99 ? '99+' : pendingRequests}
                </span>
              )}
            </NavLink>
          )
        )}
      </nav>

      <div className="px-4 py-3 border-t border-slate-200 text-xs text-slate-400 text-center">
        Tasqbots Technologies Pvt. Ltd.
      </div>
    </aside>
  )
}
