import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CalendarDays, Clock, Loader2, Moon, Send, Users } from 'lucide-react'
import { api, apiErrorMessage, fmtPaise, todayIst } from '../../../lib/api'
import { useApiGet } from '../../../lib/useApiGet'
import { useToast } from '../../../components/kit/Toast'
import { WhatsAppBubble } from './whatsappText'

interface HeadTotal { key: string; amount_paise: number; count: number }
interface SideTotals { total_paise: number; cash_paise: number; bank_paise: number; heads: HeadTotal[] }

interface Overview {
  enabled: boolean
  send_time: string
  language: string
  date: string
  summary: {
    date: string
    received: SideTotals
    paid: SideTotals
    closing: { cash_paise: number; bank_paise: number }
    movements: number
  }
  message: { header: string; body: string; footer: string }
  recipients: { name: string | null; mobile: string }[]
  runs: { summary_date: string; status: string; recipients: number; detail: string | null; trigger: string; finished_at: string | null }[]
  awaiting_approval: boolean
}

const RUN_BADGE: Record<string, string> = {
  sent: 'badge-green', skipped: 'badge-gray', failed: 'badge-red', sending: 'badge-yellow',
}

function yesterdayIst(): string {
  const d = new Date(`${todayIst()}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Settings → Messages → the midnight summary.
 *
 * Every night at 12, each temple admin gets the day's money on WhatsApp:
 * received and paid by head, cash vs bank, and the closing cash and bank
 * balances — in the trust's message language (the dropdown above). This card
 * is where a trust decides whether it wants that: it shows exactly what
 * tonight's message would say, who it goes to, sends a test to the admin
 * looking at it, and how the last week of nights went.
 *
 * The on/off switch is the same one as in the template list below; the tab
 * owns it, so the two can never disagree on screen.
 */
export function DailySummaryCard({ enabled, onToggle, saving, languageName }: {
  enabled: boolean | null
  onToggle: () => void
  saving: boolean
  languageName: string
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [date, setDate] = useState(yesterdayIst)
  const [sending, setSending] = useState(false)
  const req = useApiGet<{ data?: Overview }>(`/comms/daily-summary?date=${date}`)
  const data = req.data?.data ?? null
  const loading = req.loading
  const error = req.failed ? apiErrorMessage(req.error, t('dailySummary.loadFailed')) : ''

  async function sendTest() {
    setSending(true)
    try {
      const { data: res } = await api.post('/comms/daily-summary/test', { date })
      const r = res.data
      if (r.sent) toast.success(t('dailySummary.testSent', { to: r.to }))
      else toast.error(r.error || t('dailySummary.testFailed'))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('dailySummary.testFailed')))
    } finally {
      setSending(false)
    }
  }

  const s = data?.summary
  const on = enabled ?? data?.enabled ?? true

  return (
    <div className="card" data-testid="daily-summary-card">
      <div className="card-header">
        <div>
          <h3 className="font-semibold text-sm inline-flex items-center gap-1.5"><Moon size={15} /> {t('dailySummary.heading')}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{t('dailySummary.subheading', { language: languageName })}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-emerald-600' : 'bg-slate-300'}`}>
            <input type="checkbox" className="sr-only" checked={on} disabled={saving || enabled === null} onChange={onToggle}
              aria-label={t('dailySummary.heading')} data-testid="daily-summary-toggle" />
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
          {on ? t('settings.messages.on') : t('settings.messages.off')}
        </label>
      </div>

      <div className="card-body space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Fact icon={<Clock size={14} />} label={t('dailySummary.when')} value={t('dailySummary.midnight')} />
          <Fact icon={<Users size={14} />} label={t('dailySummary.toWhom')}
            value={data ? t('dailySummary.admins', { count: data.recipients.length }) : '—'} />
          <Fact icon={<CalendarDays size={14} />} label={t('dailySummary.covers')} value={t('dailySummary.previousDay')} />
        </div>

        {data?.awaiting_approval && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t('dailySummary.awaitingApproval')}
          </p>
        )}
        {data && !data.recipients.length && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t('dailySummary.noRecipients')}
          </p>
        )}
        {data && data.recipients.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.recipients.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                {r.name || t('dailySummary.admin')} <span className="text-slate-400">{r.mobile}</span>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="form-label" htmlFor="daily-summary-date">{t('dailySummary.previewFor')}</label>
            <input id="daily-summary-date" type="date" className="form-input" value={date} max={todayIst()}
              onChange={e => e.target.value && setDate(e.target.value)} />
          </div>
          <button type="button" className="btn-secondary" onClick={() => void sendTest()} disabled={sending || loading || !!error}
            data-testid="daily-summary-test">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {t('dailySummary.sendTest')}
          </button>
        </div>

        {loading ? (
          <div className="h-48 rounded-lg bg-slate-100 animate-pulse" />
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : data && s && (
          <div className="grid gap-4 lg:grid-cols-2">
            <WhatsAppBubble header={data.message.header} body={data.message.body} footer={data.message.footer} />
            <div className="space-y-3 text-sm">
              <Figures title={t('dailySummary.received')} side={s.received} tone="text-emerald-700" />
              <Figures title={t('dailySummary.paid')} side={s.paid} tone="text-rose-700" />
              <div className="grid grid-cols-2 gap-2">
                <Balance label={t('dailySummary.cashInHand')} paise={s.closing.cash_paise} />
                <Balance label={t('dailySummary.bankBalance')} paise={s.closing.bank_paise} />
              </div>
            </div>
          </div>
        )}

        {data && data.runs.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{t('dailySummary.lastNights')}</h4>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  {data.runs.map(r => (
                    <tr key={r.summary_date}>
                      <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">
                        {new Date(`${r.summary_date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </td>
                      <td className="px-3 py-1.5"><span className={RUN_BADGE[r.status] ?? 'badge-gray'}>{t(`dailySummary.status.${r.status}`, r.status)}</span></td>
                      <td className="px-3 py-1.5 text-slate-500">
                        {r.status === 'sent' ? t('dailySummary.sentTo', { count: r.recipients }) : (r.detail ?? '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{icon} {label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  )
}

function Figures({ title, side, tone }: { title: string; side: SideTotals; tone: string }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="font-medium text-slate-700">{title}</span>
        <span className={`font-bold tabular-nums ${tone}`}>₹{fmtPaise(side.total_paise)}</span>
      </div>
      {side.heads.length ? (
        <ul className="divide-y divide-slate-50 px-3 py-1">
          {side.heads.map(h => (
            <li key={h.key} className="flex items-center justify-between py-1 text-xs">
              <span className="text-slate-600">{h.key.startsWith('expense:') ? h.key.slice(8) : t(`dailySummary.heads.${h.key}`, h.key)}</span>
              <span className="tabular-nums text-slate-800">₹{fmtPaise(h.amount_paise)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2 text-xs text-slate-400">{t('dailySummary.nothing')}</p>
      )}
      <div className="flex justify-between border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
        <span>{t('dailySummary.cash')} ₹{fmtPaise(side.cash_paise)}</span>
        <span>{t('dailySummary.bank')} ₹{fmtPaise(side.bank_paise)}</span>
      </div>
    </div>
  )
}

function Balance({ label, paise }: { label: string; paise: number }) {
  return (
    <div className="rounded-lg bg-navy-900 px-3 py-2 text-white">
      <p className="text-[11px] text-navy-200">{label}</p>
      <p className="text-base font-bold tabular-nums">₹{fmtPaise(paise)}</p>
    </div>
  )
}
