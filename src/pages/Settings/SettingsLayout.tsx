import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom'
import { Building2, Users, BedDouble, BookOpen, Heart, Layers, CreditCard, Scale, FileText, DatabaseBackup, Key } from 'lucide-react'

const settingsNav = [
  { label: 'Kshetra Profile', to: '/settings/profile', icon: <Building2 size={15} /> },
  { label: 'Users', to: '/settings/users', icon: <Users size={15} /> },
  { label: 'Rooms', to: '/settings/rooms', icon: <BedDouble size={15} /> },
  { label: 'Halls', to: '/settings/halls', icon: <BookOpen size={15} /> },
  { label: 'Sevas', to: '/settings/sevas', icon: <Heart size={15} /> },
  { label: 'Categories', to: '/settings/categories', icon: <Layers size={15} /> },
  { label: 'Bank Accounts', to: '/settings/bank-accounts', icon: <CreditCard size={15} /> },
  { label: 'Accounting Rules', to: '/settings/accounting-rules', icon: <Scale size={15} /> },
  { label: 'Receipt & Invoice', to: '/settings/receipt', icon: <FileText size={15} /> },
  { label: 'Backup & Restore', to: '/settings/backup', icon: <DatabaseBackup size={15} /> },
  { label: 'License', to: '/settings/license', icon: <Key size={15} /> },
]

export function SettingsLayout() {
  const location = useLocation()
  if (location.pathname === '/settings' || location.pathname === '/settings/') {
    return <Navigate to="/settings/profile" replace />
  }
  return (
    <div className="flex gap-6">
      <aside className="w-44 flex-shrink-0">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-2 mb-2">Settings</p>
        <nav className="space-y-0.5">
          {settingsNav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                  isActive
                    ? 'bg-navy-900 text-white font-medium'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-navy-900'
                }`
              }
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
