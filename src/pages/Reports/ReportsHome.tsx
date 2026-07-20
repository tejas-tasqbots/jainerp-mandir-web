import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Download, RefreshCw } from 'lucide-react'
import { currentFY } from '../../lib/api'
import { downloadReport } from '../../lib/downloadReport'
import { DailyCollectionReport } from './reports/DailyCollectionReport'
import { DonationRegisterReport } from './reports/DonationRegisterReport'
import { ExpenseRegisterReport } from './reports/ExpenseRegisterReport'
import { PledgeRegisterReport } from './reports/PledgeRegisterReport'
import { CreditorAgingReport } from './reports/CreditorAgingReport'
import { DonationTrendsReport } from './reports/DonationTrendsReport'
import { DonationYoYReport } from './reports/DonationYoYReport'
import { TopDonorsReport } from './reports/TopDonorsReport'
import { GstSummaryReport } from './reports/GstSummaryReport'

type ReportKey =
  | 'daily-collection' | 'donation-register' | 'expense-register' | 'pledge-register' | 'creditor-aging'
  | 'donation-trends' | 'donation-yoy' | 'top-donors' | 'gst-summary'

interface RailItem { key: ReportKey; labelKey: string }
interface RailGroup { groupKey: string; items: RailItem[] }

const RAIL: RailGroup[] = [
  {
    groupKey: 'reports.groupDaily',
    items: [
      { key: 'daily-collection', labelKey: 'reports.dailyCollection' },
      { key: 'donation-register', labelKey: 'reports.donationRegister' },
      { key: 'expense-register', labelKey: 'reports.expenseRegister' },
      { key: 'pledge-register', labelKey: 'reports.pledgeRegister' },
      { key: 'creditor-aging', labelKey: 'reports.creditorAging' },
    ],
  },
  {
    groupKey: 'reports.groupAnalytics',
    items: [
      { key: 'donation-trends', labelKey: 'reports.donationTrends' },
      { key: 'donation-yoy', labelKey: 'reports.donationYoY' },
      { key: 'top-donors', labelKey: 'reports.topDonors' },
    ],
  },
  {
    groupKey: 'reports.groupStatutory',
    items: [
      { key: 'gst-summary', labelKey: 'reports.gstSummary' },
    ],
  },
]

const REPORT_COMPONENTS: Record<ReportKey, React.ComponentType> = {
  'daily-collection': DailyCollectionReport,
  'donation-register': DonationRegisterReport,
  'expense-register': ExpenseRegisterReport,
  'pledge-register': PledgeRegisterReport,
  'creditor-aging': CreditorAgingReport,
  'donation-trends': DonationTrendsReport,
  'donation-yoy': DonationYoYReport,
  'top-donors': TopDonorsReport,
  'gst-summary': GstSummaryReport,
}

export function ReportsHome() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ReportKey>('daily-collection')
  const [caPackLoading, setCaPackLoading] = useState(false)

  const Active = REPORT_COMPONENTS[selected]

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
        {RAIL.map(group => (
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
