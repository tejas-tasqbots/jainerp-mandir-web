import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, IndianRupee, Receipt, Hotel, ShoppingBag,
  Heart, Utensils, Calendar, BarChart2, Award, BookMarked, Settings,
  ChevronDown, ChevronRight, Bell, HelpCircle, Users, Landmark,
  UserCheck, Sparkles
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { canSee } from '../../lib/rbac'
import { useAuthStore } from '../../store/authStore'
import { useProfileStore } from '../../store/profileStore'

interface NavItem {
  label: string
  icon: React.ReactNode
  to?: string
  children?: Array<{ label: string; to: string }>
}

const navItems: NavItem[] = [
  { label: 'Dashboard', icon: <LayoutDashboard size={18} />, to: '/dashboard' },
  { label: 'Donations', icon: <IndianRupee size={18} />, to: '/donations' },
  { label: 'Expenses', icon: <Receipt size={18} />, to: '/expenses' },
  {
    label: 'Dharamshala', icon: <Hotel size={18} />,
    children: [
      { label: 'Rooms', to: '/rooms' },
      { label: 'Hall', to: '/hall' },
    ],
  },
  { label: 'Prasad Counter', icon: <ShoppingBag size={18} />, to: '/prasad' },
  { label: 'Seva Donation', icon: <Heart size={18} />, to: '/seva' },
  { label: 'Bhojanshala', icon: <Utensils size={18} />, to: '/annadaan' },
  { label: 'Boli Donations', icon: <Bell size={18} />, to: '/boli' },
  { label: 'Events', icon: <Calendar size={18} />, to: '/events' },
  { label: 'Maharaj / Mataji', icon: <Sparkles size={18} />, to: '/maharaj' },
  {
    label: 'People', icon: <Users size={18} />,
    children: [
      { label: 'Connected Devotees', to: '/devotees' },
      { label: 'Donors / Guests', to: '/donors' },
      { label: 'Creditors (Udhaar)', to: '/creditors' },
    ],
  },
  {
    label: 'Masters', icon: <UserCheck size={18} />,
    children: [
      { label: 'Vendors / Suppliers', to: '/masters/vendors' },
      { label: 'Priests', to: '/masters/priests' },
      { label: 'Employees & Volunteers', to: '/masters/employees' },
      { label: 'Inventory', to: '/masters/inventory' },
    ],
  },
  {
    label: 'Accounts', icon: <Landmark size={18} />,
    children: [
      { label: 'Cash/Bank Transfer', to: '/accounts/contra' },
      { label: 'Fixed Assets', to: '/accounts/fixed-assets' },
      { label: 'Loans', to: '/accounts/loans' },
      { label: 'Cash Book', to: '/accounts/cash-book' },
      { label: 'Bank Book', to: '/accounts/bank-book' },
      { label: 'Day Book', to: '/accounts/day-book' },
      { label: 'Ledger', to: '/accounts/ledger' },
      { label: 'Trial Balance', to: '/accounts/trial-balance' },
      { label: 'Receipts & Payments', to: '/accounts/receipts-payments' },
      { label: 'Income & Expenditure', to: '/accounts/income-expenditure' },
      { label: 'Balance Sheet', to: '/accounts/balance-sheet' },
    ],
  },
  { label: 'Reports', icon: <BarChart2 size={18} />, to: '/reports' },
  { label: 'Certificates & TDS', icon: <Award size={18} />, to: '/certificates' },
  {
    label: 'Registers', icon: <BookMarked size={18} />,
    children: [
      { label: 'Lost & Found', to: '/registers/lost-found' },
      { label: 'Visitor Count', to: '/registers/visitor-count' },
    ],
  },
  { label: 'Settings', icon: <Settings size={18} />, to: '/settings' },
  { label: 'User Guide', icon: <HelpCircle size={18} />, to: '/help' },
]

function NavGroup({ item }: { item: NavItem }) {
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
        <span className="flex-1 text-left truncate">{item.label}</span>
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
              {child.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const { profile } = useProfileStore()
  const roles = useAuthStore(s => s.user?.roles)

  // Hide modules the logged-in role can't work in (doc M1). The server
  // enforces real permissions — this only keeps the workspace uncluttered.
  const visibleItems = navItems
    .map(item => {
      if (item.children) {
        const children = item.children.filter(c => canSee(c.to, roles))
        return children.length ? { ...item, children } : null
      }
      return canSee(item.to!, roles) ? item : null
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
            <NavGroup key={item.label} item={item} />
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
              <span className="truncate">{item.label}</span>
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
