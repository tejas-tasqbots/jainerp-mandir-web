import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Search } from 'lucide-react'
import { fmtPaise } from '../../../lib/api'
import type { Room } from '../../../types'

/**
 * Pick one or several rooms for the same guest.
 *
 * Replaces a dropdown for the first room, chips for the rest and a SECOND
 * dropdown to add more - three controls for one choice, reported as "not
 * proper". A room is a tile: its number, name, beds and rate, click to add or
 * remove. A room housekeeping is holding stays visible but cannot be picked,
 * with the reason on it, so the clerk looking for 104 is told why.
 */
export function RoomPicker({ rooms, selected, onChange, isHeld, heldLabel }: {
  rooms: Room[]
  selected: string[]
  onChange: (ids: string[]) => void
  /** Housekeeping hold for the date being booked. */
  isHeld: (r: Room) => boolean
  heldLabel: (r: Room) => string
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? rooms.filter(r => [r.room_number, r.name, r.building].some(v => String(v ?? '').toLowerCase().includes(needle)))
    : rooms
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])

  return (
    <div data-testid="room-picker">
      <div className="flex items-center gap-3 mb-2">
        {rooms.length > 8 && (
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="form-input pl-8 py-1.5 text-sm" value={q} onChange={e => setQ(e.target.value)}
              placeholder={t('dharamshala.findRoom')} aria-label={t('dharamshala.findRoom')} />
          </div>
        )}
        <span className="text-xs text-slate-500 ml-auto" data-testid="rooms-selected">
          {t('dharamshala.roomsSelected', { count: selected.length })}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500 py-3">{t('dharamshala.noRoomsFree')}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
          {shown.map(r => {
            const on = selected.includes(r.id)
            const held = isHeld(r)
            return (
              <button
                key={r.id} type="button" disabled={held && !on} onClick={() => toggle(r.id)}
                data-testid="room-tile" data-room-id={r.id} aria-pressed={on}
                className={`relative text-left rounded-lg border px-3 py-2 transition-colors ${
                  on ? 'border-brand-blue bg-blue-50 ring-1 ring-brand-blue'
                    : held ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                      : 'border-slate-200 bg-white hover:border-slate-400'
                }`}
              >
                {on && <Check size={14} className="absolute right-2 top-2 text-brand-blue" />}
                <p className="font-semibold text-navy-900 text-sm">
                  {r.building?.trim() ? <span className="text-slate-400 font-normal">{r.building.trim()} · </span> : null}
                  {r.room_number}
                </p>
                <p className="text-xs text-slate-500 truncate">{r.name?.trim() || t('dharamshala.room')}</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  ₹{fmtPaise(r.tariff_paise)}{t('dharamshala.perNightSuffix')} · {t('dharamshala.sleepsN', { n: r.capacity_persons })}
                </p>
                {held && <p className="text-[11px] text-amber-700 mt-0.5">{heldLabel(r)}</p>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
