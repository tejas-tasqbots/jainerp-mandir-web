import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brush, CheckCircle2, Wrench } from 'lucide-react'
import { api } from '../../../lib/api'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { useToast } from '../../../components/kit/Toast'
import { useConfirm } from '../../../components/ConfirmDialog'

/**
 * "Which rooms need cleaning, and mark one ready."
 *
 * ── WHY THIS SCREEN EXISTS ──────────────────────────────────────────────────
 * Checkout truncates `check_out_date` to the real departure date, so the
 * remaining nights came back through the date range itself — the moment a guest
 * walked out, the room was offered to the next one. There was no state for
 * "needs cleaning" and no way to hold a room for a repair short of retiring it
 * in the Rooms master.
 *
 * So a room now goes to `dirty` at checkout (unless the trust switched the hold
 * off in Settings) and is not offered by either API — the counter or the
 * devotee app — until somebody marks it ready here.
 *
 * Separate from the availability board next door on purpose: that one answers
 * "what can I sell for these dates", this one answers "what needs doing now",
 * so it shows the rooms that are NOT sellable, which are the work.
 */

type Status = 'ready' | 'dirty' | 'cleaning' | 'maintenance'

interface RoomRow {
  id: string
  room_number: string
  name: string | null
  floor: number | null
  /** Building or wing (tenant migration 053) - where to send the cleaner. */
  building: string | null
  is_available: boolean
  housekeeping_status: Status
  housekeeping_note: string | null
  housekeeping_updated_at: string | null
  housekeeping_updated_by_name: string | null
  /** A guest is still checked in — this is not work, it is an occupied room. */
  occupied: boolean
}

const ORDER: Status[] = ['dirty', 'cleaning', 'maintenance', 'ready']

export function Housekeeping() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [only, setOnly] = useState<'todo' | 'all'>('todo')

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await api.get('/rooms/housekeeping')
      setRooms(r.data.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function setStatus(room: RoomRow, status: Status) {
    // A note is required for maintenance and meaningless for the rest: "what
    // is wrong with it" is the only reason a room is held indefinitely, and a
    // held room with no reason is one nobody dares release.
    let note: string | null = null
    if (status === 'maintenance') {
      const answer = window.prompt(t('housekeeping.maintenanceReason'))
      // Cancelled — not an empty reason. Leave the room as it was.
      if (answer === null) return
      note = answer.trim() || null
    }
    // Releasing a room puts it back on sale in both apps, including online
    // booking. That is worth one question.
    if (status === 'ready' && !(await confirm({
      title: t('housekeeping.confirmReadyTitle'),
      message: t('housekeeping.confirmReady', { room: room.room_number }),
      confirmLabel: t('housekeeping.markReady'),
    }))) return

    setBusy(room.id)
    try {
      await api.patch(`/rooms/${room.id}/housekeeping`, { status, note })
      toast.success(t('housekeeping.saved', { room: room.room_number }))
      await load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg || t('housekeeping.failed'))
    } finally {
      setBusy(null)
    }
  }

  const shown = useMemo(
    () => rooms.filter(r => only === 'all' || r.housekeeping_status !== 'ready'),
    [rooms, only],
  )

  const stats: SummaryStat[] = ORDER.map(s => ({
    label: t(`housekeeping.status.${s}`),
    value: String(rooms.filter(r => r.housekeeping_status === s).length),
  }))

  const badge: Record<Status, string> = {
    ready: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dirty: 'bg-amber-50 text-amber-700 ring-amber-200',
    cleaning: 'bg-sky-50 text-sky-700 ring-sky-200',
    maintenance: 'bg-red-50 text-red-700 ring-red-200',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">{t('housekeeping.heading')}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t('housekeeping.subheading')}</p>
        </div>
        <div className="flex rounded-md bg-slate-100 p-0.5 text-xs">
          {(['todo', 'all'] as const).map(v => (
            <button
              key={v} type="button" onClick={() => setOnly(v)}
              data-testid={`housekeeping-filter-${v}`}
              className={`rounded px-2.5 py-1 font-medium ${only === v ? 'bg-white shadow-sm text-navy-900' : 'text-slate-500'}`}
            >{t(`housekeeping.filter.${v}`)}</button>
          ))}
        </div>
      </div>

      <SummaryStrip stats={stats} />

      {loading ? (
        <p className="text-sm text-slate-400">{t('common.loading')}</p>
      ) : !shown.length ? (
        // The good state, and worth saying out loud rather than showing an
        // empty grid: every room is clean.
        <div className="card">
          <div className="card-body text-center py-10">
            <CheckCircle2 className="mx-auto text-emerald-500" size={28} />
            <p className="mt-2 text-sm font-medium text-slate-700">{t('housekeeping.allClear')}</p>
            <p className="text-xs text-slate-400">{t('housekeeping.allClearHint')}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(room => (
            <div key={room.id} className="card" data-testid={`housekeeping-room-${room.room_number}`}>
              <div className="card-body space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-sm">
                      {room.room_number}
                      {room.name ? <span className="font-normal text-slate-500"> · {room.name}</span> : null}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {[
                        room.building?.trim() || null,
                        room.floor == null ? null
                          : room.floor === 0 ? t('dharamshala.groundFloor') : t('dharamshala.floorN', { n: room.floor }),
                      ].filter(Boolean).join(' · ')}
                      {room.housekeeping_updated_at
                        ? ` · ${new Date(room.housekeeping_updated_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}`
                        : ''}
                      {room.housekeeping_updated_by_name ? ` · ${room.housekeeping_updated_by_name}` : ''}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${badge[room.housekeeping_status]}`}>
                    {t(`housekeeping.status.${room.housekeeping_status}`)}
                  </span>
                </div>

                {room.housekeeping_note ? (
                  <p className="text-[11px] text-slate-600 bg-slate-50 rounded px-2 py-1.5">{room.housekeeping_note}</p>
                ) : null}

                {/* An occupied room is not housekeeping's problem yet, and
                    offering "mark ready" on it would put a room with someone's
                    luggage in it back on sale. */}
                {room.occupied ? (
                  <p className="text-[11px] text-slate-500">{t('housekeeping.occupied')}</p>
                ) : !room.is_available ? (
                  // Retired in the Rooms master. Housekeeping cannot bring a
                  // room back into service — that is a different decision.
                  <p className="text-[11px] text-slate-500">{t('housekeeping.outOfService')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {room.housekeeping_status !== 'cleaning' && room.housekeeping_status !== 'ready' && (
                      <button
                        type="button" disabled={busy === room.id}
                        onClick={() => void setStatus(room, 'cleaning')}
                        className="btn-secondary btn-sm"
                      ><Brush size={13} /> {t('housekeeping.startCleaning')}</button>
                    )}
                    {room.housekeeping_status !== 'ready' && (
                      <button
                        type="button" disabled={busy === room.id}
                        onClick={() => void setStatus(room, 'ready')}
                        className="btn-success btn-sm"
                      ><CheckCircle2 size={13} /> {t('housekeeping.markReady')}</button>
                    )}
                    {room.housekeeping_status !== 'maintenance' && (
                      <button
                        type="button" disabled={busy === room.id}
                        onClick={() => void setStatus(room, 'maintenance')}
                        className="btn-secondary btn-sm"
                      ><Wrench size={13} /> {t('housekeeping.markMaintenance')}</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
