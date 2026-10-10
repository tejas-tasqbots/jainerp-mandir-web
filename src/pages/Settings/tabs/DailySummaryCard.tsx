import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, Moon, Send, Users } from 'lucide-react'
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
  /** Every active temple admin; absent from an API older than migration 089's release. */
  admins?: AdminRow[]
  /** The template that goes out tonight: v2 carries the per-user line. */
  sends_as?: { template: string; language: string; per_user_line: boolean } | null
  awaiting_approval: boolean
}

interface AdminRow {
  user_id: string
  name: string | null
  mobile: string | null
  receives: boolean
  switched_off: boolean
  is_you: boolean
}

export interface SummaryRun {
  summary_date: string
  status: string
  recipients: number
  detail: string | null
  trigger: string
  finished_at: string | null
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
 * is where a trust decides whether it wants that, and who gets it: each admin
 * has their own switch (migration 089). The message itself is behind "Preview
 * the message", with a test send to the admin looking at it. How each night
 * went lives in the Message log (DailySummaryRuns), beside every other message.
 *
 * The trust-wide on/off switch is the same one as in the template list below;
 * the tab owns it, so the two can never disagree on screen.
 */
export function DailySummaryCard({ enabled, onToggle, saving, languageName, languageLabel }: {
  enabled: boolean | null
  onToggle: () => void
  saving: boolean
  languageName: string
  /** Code → display name, for the language the message actually goes out in. */
  languageLabel: (code: string) => string
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [date, setDate] = useState(yesterdayIst)
  const [sending, setSending] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  // A per-admin switch flips at once and stays flipped; only a failed save
  // flips it back. (Refetching would blank the whole card for one click.)
  const [receivesOverride, setReceivesOverride] = useState<Record<string, boolean>>({})
  const [savingAdmin, setSavingAdmin] = useState('')
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

  async function setReceives(a: AdminRow, receives: boolean) {
    const who = a.name || t('dailySummary.admin')
    setSavingAdmin(a.user_id)
    setReceivesOverride(o => ({ ...o, [a.user_id]: receives }))
    try {
      await api.patch(`/comms/daily-summary/recipients/${a.user_id}`, { receives })
      toast.success(t(receives ? 'dailySummary.receiverOn' : 'dailySummary.receiverOff', { name: who }))
    } catch (e) {
      setReceivesOverride(o => ({ ...o, [a.user_id]: !receives }))
      toast.error(apiErrorMessage(e, t('dailySummary.receiverFailed')))
    } finally {
      setSavingAdmin('')
    }
  }

  const s = data?.summary
  const on = enabled ?? data?.enabled ?? true
  const admins: AdminRow[] = (data?.admins ?? []).map(a => {
    const wanted = receivesOverride[a.user_id] ?? !a.switched_off
    return { ...a, switched_off: !wanted, receives: wanted && !!a.mobile }
  })
  const receivingCount = data?.admins ? admins.filter(a => a.receives).length : data?.recipients.length ?? 0

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
            value={!data ? '—' : data.admins && admins.length !== receivingCount
              ? t('dailySummary.toWhomCount', { receiving: receivingCount, total: admins.length })
              : t('dailySummary.admins', { count: receivingCount })} />
          <Fact icon={<CalendarDays size={14} />} label={t('dailySummary.covers')} value={t('dailySummary.previousDay')} />
        </div>

        {data?.awaiting_approval && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t('dailySummary.awaitingApproval')}
          </p>
        )}
        {data?.sends_as && !data.awaiting_approval && (
          <p className={`flex items-start gap-2 text-xs ${data.sends_as.per_user_line ? 'text-green-700' : 'text-amber-800'}`}
            data-testid="daily-summary-sends-as">
            {data.sends_as.per_user_line ? (
              <><CheckCircle2 size={14} className="mt-0.5 shrink-0" /> {t('dailySummary.sendsAsNew', { language: languageLabel(data.sends_as.language) })}</>
            ) : (
              <><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t('dailySummary.sendsAsOld')}</>
            )}
          </p>
        )}

        {/* An API from before migration 089's release sends `recipients` only. */}
        {data && !data.admins && (data.recipients.length ? (
          <div className="flex flex-wrap gap-1.5">
            {data.recipients.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                {r.name || t('dailySummary.admin')} <span className="text-slate-400">{r.mobile}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t('dailySummary.noRecipients')}
          </p>
        ))}

        {data?.admins && (
          <div data-testid="daily-summary-admins">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('dailySummary.whoGetsIt')}</h4>
            <p className="text-xs text-slate-500 mt-0.5 mb-2">{t('dailySummary.whoGetsItHelp')}</p>
            {!on && (
              <p className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{t('dailySummary.trustOff')}</p>
            )}
            {admins.every(a => !a.mobile) ? (
              <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t('dailySummary.noRecipients')}
              </p>
            ) : (
              <>
                {receivingCount === 0 && (
                  <p className="mb-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t('dailySummary.allSwitchedOff')}
                  </p>
                )}
                <ul className={`divide-y divide-slate-100 rounded-lg border border-slate-200 ${on ? '' : 'opacity-60'}`}>
                  {admins.map(a => {
                    const who = a.name || t('dailySummary.admin')
                    return (
                      <li key={a.user_id} className="flex items-center justify-between gap-3 px-3 py-2"
                        data-testid={`daily-summary-admin-${a.user_id}`}>
                        <div className="min-w-0">
                          <p className="text-sm text-slate-800 truncate">
                            {who}
                            {a.is_you && <span className="ml-1.5 text-xs text-slate-400">({t('dailySummary.you')})</span>}
                          </p>
                          <p className="text-xs text-slate-400">{a.mobile ?? t('dailySummary.noMobile')}</p>
                        </div>
                        <Switch checked={a.receives} disabled={!a.mobile || savingAdmin === a.user_id}
                          label={t('dailySummary.receiverToggle', { name: who })}
                          onChange={() => void setReceives(a, a.switched_off)} />
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        <button type="button" onClick={() => setShowPreview(v => !v)} aria-expanded={showPreview}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:underline"
          data-testid="daily-summary-preview-toggle">
          {showPreview ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {showPreview ? t('dailySummary.hidePreview') : t('dailySummary.showPreview')}
        </button>

        {showPreview && (
          <div className="space-y-4">
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
          </div>
        )}
        {!showPreview && error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  )
}

/**
 * Message log → how each night's summary went: sent to how many admins, or
 * why it was skipped. Each admin's own message is a row in the log below it.
 */
export function DailySummaryRuns() {
  const { t } = useTranslation()
  const req = useApiGet<{ data?: SummaryRun[] }>('/comms/daily-summary/runs?limit=30')
  const runs = req.data?.data ?? []
  // Staff who may not read the summary (403) simply don't get the section.
  if (req.failed) return null
  return (
    <div className="card" data-testid="daily-summary-runs">
      <div className="card-header">
        <div>
          <h3 className="font-semibold text-sm inline-flex items-center gap-1.5"><Moon size={15} /> {t('dailySummary.historyHeading')}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{t('dailySummary.historyHelp')}</p>
        </div>
      </div>
      <div className="card-body p-0">
        {req.loading ? (
          <div className="h-24 m-4 rounded bg-slate-100 animate-pulse" />
        ) : !runs.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">{t('dailySummary.noRuns')}</p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {runs.map(r => (
                  <tr key={r.summary_date}>
                    <td className="px-4 py-1.5 text-slate-600 whitespace-nowrap">
                      {new Date(`${r.summary_date}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
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
        )}
      </div>
    </div>
  )
}

/** The same pill switch as the trust-wide one in the card header. */
function Switch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return (
    <label className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-emerald-600' : 'bg-slate-300'} ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </label>
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
