import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BedDouble, Search, Users } from 'lucide-react'
import { api, fmtPaise } from '../../../lib/api'
import { SummaryStrip, type SummaryStat } from '../../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../../components/kit/PrintLetterhead'

/**
 * "Which rooms are free right now, and book one."
 *
 * The rooms section only had a bookings LIST — to take a booking the cashier
 * had to already know a free room number and type it into a form. This shows
 * the floor plan as cards: free rooms are clickable and carry straight into
 * the check-in form with the room pre-selected; occupied ones say so.
 */

interface RoomRow {
  id: string
  room_number: string
  name: string | null
  floor: number | null
  room_type: string | null
  capacity_persons: number | null
  tariff_paise: number
  available: boolean
}

const TYPE_LABELS: Record<string, string> = {
  ac_single: 'AC Single', ac_double: 'AC Double', ac_family: 'AC Family',
  non_ac_single: 'Non-AC Single', non_ac_double: 'Non-AC Double',
  non_ac_family: 'Non-AC Family', dorm: 'Dormitory', hall: 'Hall',
}
const typeLabel = (t?: string | null) =>
  !t ? '—' : (TYPE_LABELS[t] ?? t.replace(/_/g, ' '))

export function RoomAvailability() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'free' | 'busy'>('all')
  const [floor, setFloor] = useState<string>('all')

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

  const shown = useMemo(() => rooms.filter(r => {
    if (only === 'free' && !r.available) return false
    if (only === 'busy' && r.available) return false
    if (floor !== 'all' && String(r.floor) !== floor) return false
    const term = q.trim().toLowerCase()
    if (!term) return true
    return r.room_number.toLowerCase().includes(term)
      || (r.name ?? '').toLowerCase().includes(term)
      || typeLabel(r.room_type).toLowerCase().includes(term)
  }), [rooms, q, only, floor])

  const free = rooms.filter(r => r.available).length
  const stats: SummaryStat[] = [
    { label: t('dharamshala.totalRooms'), value: String(rooms.length) },
    { label: t('dharamshala.availableNow'), value: String(free) },
    { label: t('dharamshala.occupiedNow'), value: String(rooms.length - free) },
  ]

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
        </select>
        {floors.length > 1 && (
          <select className="form-select w-36" value={floor}
            onChange={e => setFloor(e.target.value)}
            aria-label={t('dharamshala.filterFloor')}>
            <option value="all">{t('dharamshala.allFloors')}</option>
            {floors.map(f => (
              <option key={String(f)} value={String(f)}>{t('dharamshala.floorN', { n: f })}</option>
            ))}
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
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {shown.map(r => (
            <button
              key={r.id}
              disabled={!r.available}
              onClick={() => navigate(`/rooms/checkin?room_id=${r.id}`)}
              title={r.available ? t('dharamshala.clickToBook') : t('dharamshala.roomOccupied')}
              className={`card p-3 text-left transition-all ${
                r.available
                  ? 'hover:border-brand-green hover:shadow-sm cursor-pointer'
                  : 'opacity-60 cursor-not-allowed bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between gap-1">
                <span className="text-lg font-bold text-navy-900">{r.room_number}</span>
                <span className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${
                  r.available ? 'bg-brand-green' : 'bg-brand-red'
                }`} />
              </div>
              <p className="text-[11px] text-slate-500 truncate">{typeLabel(r.room_type)}</p>
              <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-400">
                {r.capacity_persons != null && (
                  <span className="inline-flex items-center gap-0.5"><Users size={10} /> {r.capacity_persons}</span>
                )}
                <span className="font-medium text-slate-600">₹{fmtPaise(r.tariff_paise)}</span>
              </div>
              <p className={`text-[10px] font-semibold mt-1 ${
                r.available ? 'text-brand-green' : 'text-brand-red'
              }`}>
                {r.available ? t('dharamshala.available') : t('dharamshala.occupied')}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
