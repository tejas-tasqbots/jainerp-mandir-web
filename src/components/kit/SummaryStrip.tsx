import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface SummaryStat {
  label: string
  value: string
  sub?: string
  /**
   * % change vs the previous equal period (already computed by the page).
   * null/undefined hides the delta; `invert` marks metrics where an increase
   * is bad (e.g. expenses) so the tint flips.
   */
  deltaPct?: number | null
  invert?: boolean
  tone?: 'default' | 'income' | 'expense'
}

/** Compute % change safely; null when there is no previous-period baseline. */
export function deltaPct(current: number, previous: number | null | undefined): number | null {
  if (previous == null) return null
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

const VALUE_TONE: Record<NonNullable<SummaryStat['tone']>, string> = {
  default: 'text-navy-900',
  income: 'text-green-700',
  expense: 'text-red-600',
}

export function SummaryStrip({ stats }: { stats: SummaryStat[] }) {
  const { t } = useTranslation()
  if (!stats.length) return null
  return (
    // auto-fit, not a fixed count: the strip is 4 across on a desktop, 2 on a
    // phone and never wider than the page it sits on.
    <div
      className="grid gap-3 no-print"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(150px, 100%), 1fr))`, gridTemplateRows: 'auto' }}
      data-stats={Math.min(stats.length, 4)}
    >
      {stats.map(stat => {
        const d = stat.deltaPct
        const good = d != null && (stat.invert ? d <= 0 : d >= 0)
        return (
          <div key={stat.label} className="card px-4 py-3">
            <p className="text-xs text-slate-400">{stat.label}</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className={`text-lg font-bold tabular-nums ${VALUE_TONE[stat.tone ?? 'default']}`}>{stat.value}</p>
              {d != null && (
                <span
                  className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${good ? 'text-green-600' : 'text-red-500'}`}
                  title={t('kit.vsPrevPeriod')}
                >
                  {d > 0 ? <TrendingUp size={11} /> : d < 0 ? <TrendingDown size={11} /> : <Minus size={11} />}
                  {`${d > 0 ? '+' : ''}${d.toFixed(1)}%`}
                </span>
              )}
            </div>
            {stat.sub && <p className="text-[11px] text-slate-400 mt-0.5">{stat.sub}</p>}
          </div>
        )
      })}
    </div>
  )
}
