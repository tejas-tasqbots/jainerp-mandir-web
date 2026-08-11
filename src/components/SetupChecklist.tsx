import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, CircleAlert, X, Sparkles } from 'lucide-react'
import { api } from '../lib/api'

/**
 * "Finish setting up your Mandir" — the completion meter and checklist.
 *
 * WHY IT LOOKS LIKE THIS
 * A newly onboarded trust can issue a donation receipt within a minute of
 * signing in, and that receipt will quietly be missing its 80G number, its
 * address, or the bank details a donor needs — none of which is required to
 * create a tenant. The gap is only discovered on a document that has already
 * gone to a donor. So the product states it up front instead.
 *
 * Shaped to what actually gets finished, per common SaaS onboarding practice:
 *  - A percentage, not a raw count. A meter at 40% pulls; "12 items remaining"
 *    reads as a chore.
 *  - ONE highlighted next action. The full list is collapsed behind it, so the
 *    first thing a user sees is a single decision, not a wall.
 *  - Every row says WHY, in the user's terms — "printed on every 80G receipt",
 *    not "reg_80g_number is empty".
 *  - Always dismissible, from the first render. Nothing here gates the app;
 *    forcing a checklist is how people learn to close it without reading.
 *  - Groups collapse; the whole thing disappears at 100%.
 */

interface SetupItem {
  key: string
  label: string
  why: string
  done: boolean
  route: string
  weight: number
}
interface SetupGroup {
  key: string
  title: string
  description: string
  items: SetupItem[]
  percent: number
  done: boolean
}
export interface SetupProgress {
  percent: number
  complete: boolean
  next: SetupItem | null
  remaining_count: number
  groups: SetupGroup[]
  dismissed: boolean
}

/** Shared by the dashboard card and the Settings meter. */
export async function fetchSetup(): Promise<SetupProgress | null> {
  try {
    const { data } = await api.get('/tenants/me/setup')
    return (data.data ?? data) as SetupProgress
  } catch {
    // Never let a checklist break the dashboard it sits on.
    return null
  }
}

export function SetupChecklist({ onDismissed }: { onDismissed?: () => void }) {
  const { t } = useTranslation()
  // The API decides WHICH items exist and whether each is done; the locale
  // files decide how they read. An item the translations do not know yet falls
  // back to the API's English rather than rendering a raw key.
  const label = (it: SetupItem) => t(`setup.items.${it.key}.label`, { defaultValue: it.label })
  const why = (it: SetupItem) => t(`setup.items.${it.key}.why`, { defaultValue: it.why })
  const navigate = useNavigate()
  const [setup, setSetup] = useState<SetupProgress | null>(null)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => { fetchSetup().then(setSetup) }, [])

  if (!setup || hidden || setup.complete || setup.dismissed) return null

  async function dismiss() {
    setHidden(true)
    onDismissed?.()
    try { await api.post('/tenants/me/setup/dismiss', {}) } catch { /* cosmetic */ }
  }

  return (
    <div data-tour="setup-checklist" className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-4 overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-brand-red/10 flex items-center justify-center shrink-0">
              <Sparkles size={17} className="text-brand-red" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-navy-900">{t('setup.title')}</h3>
              <p className="text-sm text-slate-500">
                {t('setup.subtitle', { count: setup.remaining_count })}
              </p>
            </div>
          </div>
          <button
            onClick={dismiss}
            title={t('setup.dismiss')}
            className="text-slate-300 hover:text-slate-500 shrink-0"
            data-testid="setup-dismiss"
          >
            <X size={18} />
          </button>
        </div>

        {/* The meter. Percentage first — it is the thing that pulls. */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-2xl font-extrabold text-navy-900">{setup.percent}%</span>
            <span className="text-xs text-slate-400">{t('setup.complete')}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-red transition-[width] duration-500"
              style={{ width: `${setup.percent}%` }}
              data-testid="setup-meter"
            />
          </div>
        </div>

        {/* ONE next action. The rest is behind "show all". */}
        {setup.next && (
          <button
            onClick={() => navigate(setup.next!.route)}
            className="mt-4 w-full text-left rounded-xl border border-slate-200 hover:border-brand-red hover:bg-red-50/40 p-3 flex items-center gap-3 transition-colors group"
            data-testid="setup-next"
          >
            <CircleAlert size={17} className="text-brand-red shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800">{label(setup.next)}</span>
              <span className="block text-xs text-slate-500">{why(setup.next)}</span>
            </span>
            <ChevronRight size={16} className="text-slate-300 group-hover:text-brand-red shrink-0" />
          </button>
        )}

        <button
          onClick={() => setOpen(o => !o)}
          className="mt-3 text-xs font-semibold text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
        >
          {open ? t('setup.hideAll') : t('setup.showAll')}
          <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {setup.groups.map(g => (
            <div key={g.key}>
              <button
                onClick={() => setExpanded(e => (e === g.key ? null : g.key))}
                className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-slate-50 text-left"
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                  g.done ? 'bg-green-100' : 'bg-slate-100'
                }`}>
                  {g.done
                    ? <Check size={12} className="text-green-700" />
                    : <span className="text-[10px] font-bold text-slate-500">{g.percent}</span>}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">{t(`setup.groups.${g.key}.title`, { defaultValue: g.title })}</span>
                  <span className="block text-xs text-slate-500">{t(`setup.groups.${g.key}.description`, { defaultValue: g.description })}</span>
                </span>
                <ChevronDown size={15} className={`text-slate-300 shrink-0 ${expanded === g.key ? 'rotate-180' : ''}`} />
              </button>

              {expanded === g.key && (
                <ul className="pb-2">
                  {g.items.map(it => (
                    <li key={it.key}>
                      <button
                        onClick={() => navigate(it.route)}
                        disabled={it.done}
                        className={`w-full flex items-start gap-3 pl-12 pr-5 py-2 text-left ${
                          it.done ? 'cursor-default' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                          it.done ? 'bg-green-500 border-green-500' : 'border-slate-300'
                        }`}>
                          {it.done && <Check size={10} className="text-white" />}
                        </span>
                        <span className="min-w-0">
                          <span className={`block text-sm ${it.done ? 'text-slate-400 line-through' : 'text-slate-700 font-medium'}`}>
                            {label(it)}
                          </span>
                          {!it.done && <span className="block text-xs text-slate-400">{why(it)}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Compact meter for Settings — stays visible even after the card is dismissed. */
export function SetupMeter() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [setup, setSetup] = useState<SetupProgress | null>(null)
  useEffect(() => { fetchSetup().then(setSetup) }, [])
  if (!setup) return null

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="h-2 w-32 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${setup.complete ? 'bg-green-500' : 'bg-brand-red'}`}
          style={{ width: `${setup.percent}%` }} />
      </div>
      <span className="font-semibold text-slate-700">{setup.percent}%</span>
      {!setup.complete && setup.next && (
        <button onClick={() => navigate(setup.next!.route)} className="text-xs font-semibold text-brand-red hover:underline">
          {t('setup.finishSetup')}
        </button>
      )}
    </div>
  )
}
