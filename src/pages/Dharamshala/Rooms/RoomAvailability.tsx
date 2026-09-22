import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BedDouble, Search, Users } from 'lucide-react'
import { api, fmtPaise } from '../../../lib/api'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'
import { buildingNames, buildingOf, groupRooms, type RoomGroup } from '../../../lib/roomOrder'

/**
 * "Which rooms are free right now, and book one."
 *
 * The rooms section only had a bookings LIST — to take a booking the cashier
 * had to already know a free room number and type it into a form. This shows
 * the floor plan as cards: free rooms are clickable and carry straight into
 * the check-in form with the room pre-selected; occupied ones say so.
 */

/**
 * The card describes a room by its `name` — the Rooms master's "Name / Type"
 * field — and never by `rooms.room_type`. No screen writes `room_type`, so
 * every room carries the column default `non_ac`, and the board read "non ac"
 * under an AC Deluxe and an AC Suite alike.
 */
interface RoomRow {
  id: string
  room_number: string
  name: string | null
  floor: number | null
  /** Building or wing, as the trust names it (tenant migration 053). */
  building: string | null
  capacity_persons: number | null
  tariff_paise: number
  /** Lettable for the window asked for: no live booking, and housekeeping has released it. */
  available: boolean
  /** A guest is physically in the room right now. */
  occupied: boolean
  housekeeping_status: 'ready' | 'dirty' | 'cleaning' | 'maintenance'
  /** Free now but sold from this date - the gap the clerk is selling into. */
  next_booking_from: string | null
}

/**
 * Why a room cannot be let, in the order the clerk needs to hear it.
 *
 * The board used to derive everything from `available` alone, so a room that
 * was empty, cleaned and merely booked for next Friday read "Occupied" - which
 * is what the field reported as "everything is checked out and still occupied".
 * Four different facts were wearing one label:
 *
 *   occupied    - somebody is in it. Nothing to do but wait.
 *   dirty       - empty, and housekeeping has it. Minutes away.
 *   maintenance - empty, and it is broken. Days away.
 *   booked      - empty and clean, but sold for these dates. Try other dates.
 *
 * Only the first is "Occupied". Conflating them costs beds, because a clerk who
 * reads Occupied stops looking.
 */
type RoomState = 'available' | 'occupied' | 'dirty' | 'cleaning' | 'maintenance' | 'booked'

function roomState(r: RoomRow): RoomState {
  // `available` first, because it is the API's verdict and the API is the one
  // that decides. A housekeeping hold only blocks a stay starting today, so a
  // board asked about next month can legitimately return a dirty room as
  // lettable; reading the status column before the verdict would grey out a
  // card the server just said yes to.
  if (r.available) return 'available'
  if (r.occupied) return 'occupied'
  if (r.housekeeping_status && r.housekeeping_status !== 'ready') return r.housekeeping_status
  return 'booked'
}

const STATE_STYLE: Record<RoomState, { dot: string; text: string; card: string }> = {
  available:   { dot: 'bg-emerald-500', text: 'text-emerald-700', card: 'hover:border-brand-green hover:shadow-sm cursor-pointer' },
  occupied:    { dot: 'bg-rose-500',    text: 'text-rose-700',    card: 'opacity-70 cursor-not-allowed bg-slate-50' },
  dirty:       { dot: 'bg-amber-500',   text: 'text-amber-700',   card: 'opacity-70 cursor-not-allowed bg-amber-50/60' },
  cleaning:    { dot: 'bg-amber-500',   text: 'text-amber-700',   card: 'opacity-70 cursor-not-allowed bg-amber-50/60' },
  maintenance: { dot: 'bg-slate-500',   text: 'text-slate-600',   card: 'opacity-70 cursor-not-allowed bg-slate-100' },
  booked:      { dot: 'bg-sky-500',     text: 'text-sky-700',     card: 'opacity-70 cursor-not-allowed bg-sky-50/60' },
}

/** "26 Sep" - short enough for a card, unambiguous enough to act on. */
function fmtDay(iso: string): string {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00+05:30')
  return Number.isNaN(d.getTime())
    ? String(iso).slice(0, 10)
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const GRID = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3'

export function RoomAvailability() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'free' | 'busy' | 'held'>('all')
  const [floor, setFloor] = useState<string>('all')
  const [building, setBuilding] = useState<string>('all')
  const [kind, setKind] = useState<string>('all')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/rooms/availability')
      setRooms(data.data ?? [])
    } catch {
      setRooms([])
    } finally {
      setLoading(false)
    }
  }

  const floors = useMemo(
    () => [...new Set(rooms.map(r => r.floor).filter(f => f != null))].sort((a, b) => Number(a) - Number(b)),
    [rooms],
  )
  // Offered only when there is a choice to make: a one-building trust never
  // sees a Building filter, a trust that has not recorded floors never sees a
  // Floor one. A filter that can only ever say "All" is clutter.
  const buildings = useMemo(
    () => [...buildingNames(rooms).values()]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
    [rooms],
  )
  const kinds = useMemo(
    () => [...new Set(rooms.map(r => r.name?.trim()).filter((n): n is string => !!n))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    [rooms],
  )
  const floorLabel = (f: number) => (f === 0 ? t('dharamshala.groundFloor') : t('dharamshala.floorN', { n: f }))

  const shown = useMemo(() => rooms.filter(r => {
    const st = roomState(r)
    if (only === 'free' && st !== 'available') return false
    if (only === 'busy' && st !== 'occupied') return false
    if (only === 'held' && st !== 'dirty' && st !== 'cleaning' && st !== 'maintenance') return false
    if (floor !== 'all' && String(r.floor) !== floor) return false
    if (building !== 'all' && (buildingOf(r) ?? '').toLowerCase() !== building.toLowerCase()) return false
    if (kind !== 'all' && (r.name?.trim() ?? '') !== kind) return false
    const term = q.trim().toLowerCase()
    if (!term) return true
    return r.room_number.toLowerCase().includes(term)
      || (r.name ?? '').toLowerCase().includes(term)
  }), [rooms, q, only, floor, building, kind])

  // Building, then floor (or the numbers' own hundreds), then room number read
  // as a number - see lib/roomOrder.ts. Headers only when there is more than
  // one group; a trust with one short series of rooms sees a plain grid.
  const groups = useMemo(() => groupRooms(shown), [shown])

  // "Total minus available" was the old occupied count, and it swept the
  // cleaning queue and next week's bookings in with the guests actually here.
  const count = (st: RoomState) => rooms.filter(r => roomState(r) === st).length
  const held = count('dirty') + count('cleaning') + count('maintenance')
  const stats: SummaryStat[] = [
    { label: t('dharamshala.totalRooms'), value: String(rooms.length) },
    { label: t('dharamshala.availableNow'), value: String(count('available')) },
    { label: t('dharamshala.occupiedNow'), value: String(count('occupied')) },
    { label: t('dharamshala.reservedAhead'), value: String(count('booked')) },
    { label: t('dharamshala.heldForCleaning'), value: String(held) },
  ]

  function groupLabel(g: RoomGroup<RoomRow>): string {
    const level = g.level.kind === 'floor' ? floorLabel(g.level.floor)
      : g.level.kind === 'series'
        ? (g.level.from === g.level.to
          ? t('dharamshala.roomOne', { n: g.level.from })
          : t('dharamshala.roomRange', { from: g.level.from, to: g.level.to }))
        : ''
    return [g.building, level].filter(Boolean).join(' · ') || t('dharamshala.otherRooms')
  }

  const card = (r: RoomRow) => {
    const st = roomState(r)
    const sty = STATE_STYLE[st]
    return (
      <button
        key={r.id}
        disabled={st !== 'available'}
        onClick={() => navigate(`/rooms/checkin?room_id=${r.id}`)}
        title={t(`dharamshala.stateHint.${st}`)}
        className={`card p-3 text-left transition-all ${sty.card}`}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="text-lg font-bold text-navy-900">{r.room_number}</span>
          <span className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${sty.dot}`} />
        </div>
        <p className="text-[11px] text-slate-500 truncate">{r.name?.trim() || '—'}</p>
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-400">
          {r.capacity_persons != null && (
            <span className="inline-flex items-center gap-0.5"><Users size={10} /> {r.capacity_persons}</span>
          )}
          <span className="font-medium text-slate-600">₹{fmtPaise(r.tariff_paise)}</span>
        </div>
        <p className={`text-[10px] font-semibold mt-1 ${sty.text}`}>
          {t(`dharamshala.state.${st}`)}
        </p>
        {/* The gap being sold into. A free room with a booking on Friday
            is a room you can let until Friday - say the date, or the
            clerk has to open the bookings list to find it out. */}
        {st === 'available' && r.next_booking_from && (
          <p className="text-[10px] text-sky-700 mt-0.5">
            {t('dharamshala.freeUntil', { date: fmtDay(r.next_booking_from) })}
          </p>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('dharamshala.availabilityTitle')} />

      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-navy-900">{t('dharamshala.availabilityTitle')}</h1>
          <p className="text-sm text-slate-500">{t('dharamshala.availabilitySubtitle')}</p>
        </div>
        <button onClick={() => navigate('/rooms/checkin')} className="btn-primary">
          {t('dharamshala.newBooking')}
        </button>
      </div>

      <SummaryStrip stats={stats} />

      <div className="flex flex-wrap gap-2 no-print">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="form-input pl-9"
            placeholder={t('dharamshala.searchRoom')}
            value={q}
            onChange={e => setQ(e.target.value)}
            aria-label={t('dharamshala.searchRoom')}
          />
        </div>
        <select className="form-select w-40" value={only}
          onChange={e => setOnly(e.target.value as typeof only)}
          aria-label={t('dharamshala.filterStatus')}>
          <option value="all">{t('dharamshala.allRooms')}</option>
          <option value="free">{t('dharamshala.availableOnly')}</option>
          <option value="busy">{t('dharamshala.occupiedOnly')}</option>
          <option value="held">{t('dharamshala.heldOnly')}</option>
        </select>
        {buildings.length > 0 && (
          <select className="form-select w-40" value={building}
            onChange={e => setBuilding(e.target.value)}
            aria-label={t('dharamshala.filterBuilding')}>
            <option value="all">{t('dharamshala.allBuildings')}</option>
            {buildings.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        {floors.length > 1 && (
          <select className="form-select w-36" value={floor}
            onChange={e => setFloor(e.target.value)}
            aria-label={t('dharamshala.filterFloor')}>
            <option value="all">{t('dharamshala.allFloors')}</option>
            {floors.map(f => (
              <option key={String(f)} value={String(f)}>{floorLabel(Number(f))}</option>
            ))}
          </select>
        )}
        {kinds.length > 1 && (
          <select className="form-select w-40" value={kind}
            onChange={e => setKind(e.target.value)}
            aria-label={t('dharamshala.filterType')}>
            <option value="all">{t('dharamshala.allTypes')}</option>
            {kinds.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="card h-28 animate-pulse" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="card py-12 text-center">
          <BedDouble size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">{t('dharamshala.noRoomsMatch')}</p>
        </div>
      ) : groups.length === 1 ? (
        <div className={GRID}>{groups[0].rooms.map(card)}</div>
      ) : (
        <div className="space-y-5">
          {groups.map(g => {
            const free = g.rooms.filter(r => roomState(r) === 'available').length
            return (
              <section key={g.key} aria-label={groupLabel(g)}>
                {/* One row per floor, the way a clerk walks the building. The
                    free count is the question they came with. */}
                <div className="flex items-baseline justify-between gap-3 mb-2 pb-1 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-navy-900">{groupLabel(g)}</h2>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {t('dharamshala.groupFree', { free, total: g.rooms.length })}
                  </span>
                </div>
                <div className={GRID}>{g.rooms.map(card)}</div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
