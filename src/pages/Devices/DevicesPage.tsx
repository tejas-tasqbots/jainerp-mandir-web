import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Laptop, LogOut, Monitor, RefreshCw, Shield, Smartphone, Globe, Loader2,
} from 'lucide-react'
import { api, apiErrorMessage } from '../../lib/api'
import { serverNow } from '../../lib/istClock'
import { useApiGet } from '../../lib/useApiGet'
import { roleLabel } from '../../lib/auditLabels'
import { useToast } from '../../components/kit/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { useAuthStore } from '../../store/authStore'
import { Avatar } from '../Registers/ActivityLogPage'

interface Session {
  id: string
  device_id: string | null
  device_name: string | null
  platform: string | null
  last_used_at: string | null
  created_at: string
  expires_at: string
  created_ip: string | null
  last_ip: string | null
  user_agent: string | null
  current: boolean
  // trust-wide rows only
  user_id?: string
  user_name?: string | null
  user_mobile?: string | null
  roles?: string[]
}

const PLATFORM_ICON: Record<string, typeof Laptop> = {
  web: Globe, android: Smartphone, ios: Smartphone, electron: Monitor, desktop: Monitor,
}

function platformLabel(t: TFunction, p: string | null): string {
  if (!p) return t('devices.unknownPlatform')
  return t(`devices.platform.${p}`, { defaultValue: p.charAt(0).toUpperCase() + p.slice(1) }) as string
}

/**
 * "Chrome on Windows", from the User-Agent — the name a browser session gets
 * when it has none of its own.
 *
 * Only the mobile apps and the desktop shell name themselves; a browser signs
 * in anonymously, so without this every web row read "Browser · Browser",
 * which tells a trustee nothing about which machine it is. Deliberately coarse
 * — the point is to tell one device apart from another, not to fingerprint it.
 */
function describeUserAgent(ua: string | null): string | null {
  if (!ua) return null
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : null
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : null
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os
}

/** "2 hours ago", from an ISO timestamp. Absolute date once it is older than a week. */
function lastUsed(t: TFunction, iso: string | null): string {
  if (!iso) return t('devices.never')
  const mins = Math.round((serverNow().getTime() - new Date(iso).getTime()) / 60_000)
  if (mins < 2) return t('devices.justNow')
  if (mins < 60) return t('devices.minutesAgo', { count: mins })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('devices.hoursAgo', { count: hours })
  const days = Math.round(hours / 24)
  if (days <= 7) return t('devices.daysAgo', { count: days })
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Devices & sessions — where this account is signed in, and a way to end it.
 *
 * A sign-in used to be invisible: nothing showed how many devices held a live
 * session, where they were, or how to end one, and a temple admin could not see
 * or stop a colleague's session at all. The API had the endpoints; no screen
 * ever called them.
 *
 * Everyone sees their own devices. A temple admin also sees every device signed
 * in at the trust, and can sign one out — or sign one person out everywhere,
 * which is the "they have left" action.
 */
export function DevicesPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const roles = useAuthStore(s => s.user?.roles) ?? []
  const isAdmin = roles.includes('temple_admin')
  const [busy, setBusy] = useState<string | null>(null)

  const mine = useApiGet<{ data?: Session[] }>('/auth/sessions')
  const trust = useApiGet<{ data?: Session[] }>(isAdmin ? '/auth/sessions/trust' : null)
  const mySessions = useMemo(() => mine.data?.data ?? [], [mine.data])
  const trustSessions = useMemo(() => trust.data?.data ?? [], [trust.data])

  const others = mySessions.filter(s => !s.current)

  async function act(key: string, run: () => Promise<unknown>, done: string) {
    setBusy(key)
    try {
      await run()
      toast.success(done)
      mine.refresh()
      trust.refresh()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('devices.failed')))
    } finally {
      setBusy(null)
    }
  }

  async function signOutMine(s: Session) {
    if (!(await confirm({
      title: t('devices.signOutTitle'),
      message: t('devices.signOutMessage', { device: s.device_name || platformLabel(t, s.platform) }),
      confirmLabel: t('devices.signOut'), danger: true,
    }))) return
    await act(s.id, () => api.delete(`/auth/sessions/${s.id}`), t('devices.signedOut'))
  }

  async function signOutOthers() {
    if (!(await confirm({
      title: t('devices.signOutOthersTitle'),
      message: t('devices.signOutOthersMessage', { count: others.length }),
      confirmLabel: t('devices.signOutOthers'), danger: true,
    }))) return
    await act('others', () => api.post('/auth/sessions/revoke-others', {}), t('devices.signedOutOthers'))
  }

  async function signOutTrust(s: Session) {
    if (!(await confirm({
      title: t('devices.signOutTitle'),
      message: t('devices.signOutUserMessage', {
        name: s.user_name || t('devices.thisUser'),
        device: s.device_name || platformLabel(t, s.platform),
      }),
      confirmLabel: t('devices.signOut'), danger: true,
    }))) return
    await act(s.id, () => api.delete(`/auth/sessions/trust/${s.id}`), t('devices.signedOut'))
  }

  async function signOutEverywhere(userId: string, name: string, count: number) {
    if (!(await confirm({
      title: t('devices.signOutEverywhereTitle', { name }),
      message: t('devices.signOutEverywhereMessage', { name, count }),
      confirmLabel: t('devices.signOutEverywhere'), danger: true,
    }))) return
    await act(`user:${userId}`, () => api.post(`/auth/sessions/user/${userId}/revoke-all`, {}), t('devices.signedOutUser', { name }))
  }

  // Grouped by person, because "who is signed in where" is a question about
  // people, not about rows.
  const byUser = useMemo(() => {
    const map = new Map<string, { id: string; name: string; mobile: string | null; roles: string[]; sessions: Session[] }>()
    for (const s of trustSessions) {
      const id = s.user_id ?? 'unknown'
      const entry = map.get(id) ?? {
        id, name: s.user_name || t('devices.thisUser'), mobile: s.user_mobile ?? null, roles: s.roles ?? [], sessions: [],
      }
      entry.sessions.push(s)
      map.set(id, entry)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [trustSessions, t])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Shield size={18} /> {t('devices.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5 max-w-2xl">{t('devices.subtitle')}</p>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => { mine.refresh(); trust.refresh() }}>
          <RefreshCw size={14} /> {t('devices.refresh')}
        </button>
      </div>

      {/* ── my own devices ─────────────────────────────────────────────── */}
      <section className="card">
        <div className="card-header">
          <h2 className="font-semibold text-sm">{t('devices.mine')}</h2>
          {others.length > 0 && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => void signOutOthers()} disabled={busy === 'others'}>
              {busy === 'others' ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
              {t('devices.signOutOthers')}
            </button>
          )}
        </div>
        <div className="card-body p-0">
          {mine.loading ? (
            <Skeleton />
          ) : !mySessions.length ? (
            <p className="px-4 py-6 text-sm text-slate-500">{t('devices.noneMine')}</p>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="my-sessions">
              {mySessions.map(s => (
                <SessionRow key={s.id} s={s} busy={busy === s.id}
                  onSignOut={s.current ? undefined : () => void signOutMine(s)} />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── everyone at this trust (temple admin) ──────────────────────── */}
      {isAdmin && (
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="font-semibold text-sm">{t('devices.everyone')}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{t('devices.everyoneHelp')}</p>
            </div>
            <span className="badge-gray">{t('devices.sessionCount', { count: trustSessions.length })}</span>
          </div>
          <div className="card-body p-0">
            {trust.loading ? (
              <Skeleton />
            ) : !byUser.length ? (
              <p className="px-4 py-6 text-sm text-slate-500">{t('devices.noneTrust')}</p>
            ) : (
              byUser.map(u => (
                <div key={u.id} className="border-b border-slate-100 last:border-0" data-testid="trust-user">
                  <div className="flex items-center justify-between gap-3 bg-slate-50/70 px-4 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar name={u.name} id={u.id} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{u.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">
                          {[u.mobile, (u.roles ?? []).map(r => roleLabel(t, r)).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>
                    <button type="button" className="btn-secondary btn-sm shrink-0"
                      onClick={() => void signOutEverywhere(u.id, u.name, u.sessions.length)}
                      disabled={busy === `user:${u.id}`}>
                      {busy === `user:${u.id}` ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
                      {t('devices.signOutEverywhere')}
                    </button>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {u.sessions.map(s => (
                      <SessionRow key={s.id} s={s} busy={busy === s.id} onSignOut={() => void signOutTrust(s)} />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="divide-y divide-slate-100">
      {[0, 1, 2].map(i => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-8 w-8 rounded-lg bg-slate-100 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/4 rounded bg-slate-100 animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-slate-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SessionRow({ s, busy, onSignOut }: { s: Session; busy: boolean; onSignOut?: () => void }) {
  const { t } = useTranslation()
  const Icon = PLATFORM_ICON[s.platform ?? ''] ?? Laptop
  const ip = s.last_ip || s.created_ip
  const moved = s.last_ip && s.created_ip && s.last_ip !== s.created_ip
  // A named device wins; then what the User-Agent says; only then "Browser".
  const title = s.device_name || describeUserAgent(s.user_agent) || platformLabel(t, s.platform)

  return (
    <li className="flex items-center gap-3 px-4 py-3" data-testid="session-row">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 truncate">
          {title}
          {s.current && <span className="ml-2 badge-green">{t('devices.thisDevice')}</span>}
        </p>
        <p className="text-xs text-slate-500">
          {/* Never repeat the title back as the subtitle. */}
          {title === platformLabel(t, s.platform) ? null : <>{platformLabel(t, s.platform)}{ip && ' · '}</>}
          {ip && <span className="font-mono">{ip}</span>}
          {moved && <span className="ml-1 text-amber-700">{t('devices.movedNetwork')}</span>}
        </p>
        <p className="text-[11px] text-slate-400">
          {t('devices.lastUsed', { when: lastUsed(t, s.last_used_at) })}
          {' · '}
          {t('devices.signedInOn', { when: new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) })}
        </p>
      </div>
      {onSignOut ? (
        <button type="button" className="btn-secondary btn-sm shrink-0" onClick={onSignOut} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} {t('devices.signOut')}
        </button>
      ) : (
        <span className="text-xs text-slate-400 shrink-0">{t('devices.cannotSignOutSelf')}</span>
      )}
    </li>
  )
}
