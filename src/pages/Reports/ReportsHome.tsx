import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Download, RefreshCw } from 'lucide-react'
import { currentFY } from '../../lib/api'
import { useAuthStore } from '../../store/authStore'
import { downloadReport } from '../../lib/downloadReport'
import { DailyCollectionReport } from './reports/DailyCollectionReport'
import { CollectionSummaryReport } from './reports/CollectionSummaryReport'
import { AllTransactionsReport } from './reports/AllTransactionsReport'
import { CashFlowReport } from './reports/CashFlowReport'
import { EventCollectionReport } from './reports/EventCollectionReport'
import { DonationRegisterReport } from './reports/DonationRegisterReport'
import { DonationByCategoryReport } from './reports/DonationByCategoryReport'
import { ExpenseRegisterReport } from './reports/ExpenseRegisterReport'
import { ExpenseByCategoryReport } from './reports/ExpenseByCategoryReport'
import { PledgeRegisterReport } from './reports/PledgeRegisterReport'
import { CreditorAgingReport } from './reports/CreditorAgingReport'
import { DonationTrendsReport } from './reports/DonationTrendsReport'
import { DonationYoYReport } from './reports/DonationYoYReport'
import { TopDonorsReport } from './reports/TopDonorsReport'
import { GstSummaryReport } from './reports/GstSummaryReport'
import { DepreciationScheduleReport } from './reports/DepreciationScheduleReport'
import { LoanScheduleReport } from './reports/LoanScheduleReport'
import { ServiceRegisterReport } from './reports/ServiceRegisterReport'
import { FundUtilisationReport } from './reports/FundUtilisationReport'

type ReportKey =
  | 'daily-collection' | 'collection-summary' | 'all-transactions' | 'donation-register' | 'donation-by-category'
  | 'expense-register' | 'expense-by-category' | 'pledge-register' | 'creditor-aging'
  | 'donation-trends' | 'donation-yoy' | 'top-donors' | 'cash-flow' | 'event-collection' | 'gst-summary'
  | 'depreciation-schedule' | 'loan-schedule' | 'service-register' | 'fund-utilisation'

/**
 * `modules` names the entitlements a report needs — ANY one of them is enough,
 * matching the API's `@RequiresModule(...)`. The sidebar already hides screens a
 * trust has not bought (lib/rbac canSee), but this rail did not — so a
 * donation-only trust was offered Pledge Register, Creditor Aging, Service
 * Registers, Event-wise Collection and the Depreciation Schedule, and every one
 * of them answered 403. Core reports carry none and are always shown.
 *
 * "Any of" matters for Service Registers in particular: it covers six counters,
 * and gating it on `seva` alone hid the Room Register from a Dharamshala trust
 * that does run rooms — the opposite failure to the one this rail fixes.
 */
interface RailItem { key: ReportKey; labelKey: string; modules?: string[] }
interface RailGroup { groupKey: string; items: RailItem[] }

const RAIL: RailGroup[] = [
  {
    groupKey: 'reports.groupDaily',
    items: [
      { key: 'daily-collection', labelKey: 'reports.dailyCollection' },
      { key: 'collection-summary', labelKey: 'reports.collectionSummary' },
      { key: 'all-transactions', labelKey: 'reports.allTransactions' },
      { key: 'donation-register', labelKey: 'reports.donationRegister' },
      { key: 'expense-register', labelKey: 'reports.expenseRegister' },
      { key: 'pledge-register', labelKey: 'reports.pledgeRegister', modules: ['bolis'] },
      { key: 'creditor-aging', labelKey: 'reports.creditorAging', modules: ['creditors'] },
      {
        key: 'service-register', labelKey: 'reports.serviceRegister',
        modules: ['seva', 'dharamshala', 'prasad', 'bhojanshala', 'annadaan'],
      },
    ],
  },
  {
    groupKey: 'reports.groupBreakdown',
    items: [
      { key: 'donation-by-category', labelKey: 'reports.donationByCategory' },
      { key: 'expense-by-category', labelKey: 'reports.expenseByCategory' },
    ],
  },
  {
    groupKey: 'reports.groupAnalytics',
    items: [
      { key: 'donation-trends', labelKey: 'reports.donationTrends' },
      { key: 'donation-yoy', labelKey: 'reports.donationYoY' },
      { key: 'top-donors', labelKey: 'reports.topDonors' },
      { key: 'cash-flow', labelKey: 'reports.cashFlow' },
      { key: 'event-collection', labelKey: 'reports.eventCollection', modules: ['events'] },
    ],
  },
  {
    groupKey: 'reports.groupStatutory',
    items: [
      { key: 'gst-summary', labelKey: 'reports.gstSummary' },
      { key: 'depreciation-schedule', labelKey: 'reports.depreciationSchedule', modules: ['fixed_assets'] },
      { key: 'loan-schedule', labelKey: 'reports.loanSchedule' },
      { key: 'fund-utilisation', labelKey: 'reports.fundUtilisation' },
    ],
  },
]

const REPORT_COMPONENTS: Record<ReportKey, React.ComponentType> = {
  'daily-collection': DailyCollectionReport,
  'collection-summary': CollectionSummaryReport,
  'all-transactions': AllTransactionsReport,
  'cash-flow': CashFlowReport,
  'event-collection': EventCollectionReport,
  'donation-register': DonationRegisterReport,
  'donation-by-category': DonationByCategoryReport,
  'expense-register': ExpenseRegisterReport,
  'expense-by-category': ExpenseByCategoryReport,
  'pledge-register': PledgeRegisterReport,
  'creditor-aging': CreditorAgingReport,
  'donation-trends': DonationTrendsReport,
  'donation-yoy': DonationYoYReport,
  'top-donors': TopDonorsReport,
  'gst-summary': GstSummaryReport,
  'depreciation-schedule': DepreciationScheduleReport,
  'loan-schedule': LoanScheduleReport,
  'service-register': ServiceRegisterReport,
  'fund-utilisation': FundUtilisationReport,
}

export function ReportsHome() {
  const { t } = useTranslation()
  const modules = useAuthStore(s => s.modules)
  const [selected, setSelected] = useState<ReportKey>('daily-collection')
  const [caPackLoading, setCaPackLoading] = useState(false)

  const Active = REPORT_COMPONENTS[selected]

  // `modules === null` means "not known yet" (a cold desktop boot) — show
  // everything rather than blanking the rail on a guess, exactly as the sidebar
  // does. An entitlement is not a permission, so this applies to temple_admin.
  const rail = RAIL
    .map(g => ({
      ...g,
      items: g.items.filter(i => !i.modules || !modules || i.modules.some(m => modules.includes(m))),
    }))
    .filter(g => g.items.length > 0)

  async function downloadCaPack() {
    setCaPackLoading(true)
    try {
      await downloadReport('ca-pack', { fy: currentFY() }, 'csv')
    } finally {
      setCaPackLoading(false)
    }
  }

  return (
    <div className="flex gap-6 items-start">
      {/* Rail */}
      <nav className="w-56 flex-shrink-0 space-y-5 no-print">
        <h1 className="text-xl font-bold text-navy-900">{t('reports.title')}</h1>
        {rail.map(group => (
          <div key={group.groupKey}>
            <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {t(group.groupKey)}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelected(item.key)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-left transition-colors ${
                    selected === item.key
                      ? 'bg-navy-900 text-white font-semibold'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <FileText size={13} className="flex-shrink-0" />
                  <span className="truncate">{t(item.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* CA pack — a server ZIP, not an on-screen report */}
        <div className="pt-1 border-t border-slate-200">
          <p className="px-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {t('reports.charteredAccountant')}
          </p>
          <button
            type="button"
            onClick={downloadCaPack}
            disabled={caPackLoading}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-left text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
            title={t('reports.caPackLabel')}
          >
            {caPackLoading ? <RefreshCw size={13} className="animate-spin flex-shrink-0" /> : <Download size={13} className="flex-shrink-0" />}
            <span className="truncate">{t('reports.caPackShort')}</span>
          </button>
        </div>
      </nav>

      {/* Selected report */}
      <div className="flex-1 min-w-0">
        <Active />
      </div>
    </div>
  )
}
