import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Inbox, IndianRupee, Landmark } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { canSeeRoles, DONATIONS_TAB_ROLES } from '../../lib/rbac'
import { useIsOnline } from '../../lib/useIsOnline'
import { api } from '../../lib/api'
import { DonationsList } from './DonationsList'
import { DonationRequestsPage } from '../DonationRequests/DonationRequestsPage'
import { BoliList } from '../Boli/BoliList'

type TabKey = 'donations' | 'requests' | 'pledges'

/**
 * `module` is the entitlement a tab needs. Donations and Requests are core;
 * Pledges is the `bolis` module, and because this hub lives at `/donations` —
 * a core route — the sidebar's module gate never reached it. A trust without
 * bolis was shown the tab and got MODULE_NOT_ENABLED from `/bolis` on click.
 */
const TABS: { key: TabKey; labelKey: string; icon: React.ReactNode; module?: string }[] = [
  { key: 'donations', labelKey: 'donationsHub.donations', icon: <IndianRupee size={15} /> },
  { key: 'requests', labelKey: 'donationsHub.requests', icon: <Inbox size={15} /> },
  { key: 'pledges', labelKey: 'donationsHub.pledges', icon: <Landmark size={15} />, module: 'bolis' },
]

/** Sidebar badge count, mirrored here so the Requests tab itself shows it too. */
function usePendingRequestCount(): number {
  const online = useIsOnline()
  const [count, setCount] = useState(0)

  useEffect(() => {
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

export function DonationsHub() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const roles = useAuthStore(s => s.user?.roles)
  const modules = useAuthStore(s => s.modules)
  const pendingRequests = usePendingRequestCount()

  // `modules === null` means "not known yet" (a cold desktop boot) — show
  // everything rather than blanking a tab on a guess, exactly as the sidebar
  // does. An entitlement is not a permission, so this applies to temple_admin.
  const visibleTabs = TABS.filter(tab =>
    canSeeRoles(DONATIONS_TAB_ROLES[tab.key], roles) &&
    (!tab.module || !modules || modules.includes(tab.module)),
  )
  const requested = params.get('tab') as TabKey | null
  const active: TabKey = visibleTabs.some(t => t.key === requested)
    ? (requested as TabKey)
    : (visibleTabs[0]?.key ?? 'donations')

  function selectTab(key: TabKey) {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', key)
      return next
    }, { replace: true })
  }

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4 px-1 no-print">
        {visibleTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => selectTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              active === tab.key
                ? 'border-brand-red text-brand-red'
                : 'border-transparent text-slate-500 hover:text-navy-900'
            }`}
          >
            {tab.icon}
            {t(tab.labelKey)}
            {tab.key === 'requests' && pendingRequests > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                {pendingRequests > 99 ? '99+' : pendingRequests}
              </span>
            )}
          </button>
        ))}
      </div>

      {active === 'donations' && <DonationsList />}
      {active === 'requests' && <DonationRequestsPage />}
      {active === 'pledges' && <BoliList />}
    </div>
  )
}
