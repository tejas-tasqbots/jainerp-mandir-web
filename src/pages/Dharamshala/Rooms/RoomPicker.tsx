import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Search, X } from 'lucide-react'
import { fmtPaise } from '../../../lib/api'
import { buildingNames, buildingOf, groupRooms, type RoomGroup } from '../../../lib/roomOrder'
import type { Room } from '../../../types'

/**
 * Pick one or several rooms for the same guest, for the dates being booked.
 *
 * It was a flat grid of large cards in the order the API happened to return
 * them - 101, 102, 201, A·205, B·104 - with no idea which rooms were already
 * sold for the dates: a clerk found out from the 409 after pressing Confirm.
 * At a dharamshala with 5 wings x 10 floors that is several hundred cards to
 * scroll ("if we have 100+ rooms and 5 wings 10 floor in each how it will
 * select", 2026-09-25).
 *
 * Now, the way a hotel front desk picks rooms:
 *  - the rooms come from `GET /rooms/availability` for the stay's dates, so a
 *    room booked, occupied or held by housekeeping for those nights is shown
 *    greyed with the reason - or hidden, with "Free only" (the default when a
 *    trust has many rooms);
 *  - wing and floor chips, each saying how many rooms are free, narrow 500
 *    rooms to a floor of ten in two clicks; a room type filter and a search
 *    that picks a room outright when its number is typed and Enter pressed;
 *  - rooms grouped wing -> floor in natural order (lib/roomOrder.ts), compact
 *    tiles, headers that say "8 of 10 free";
 *  - the choice as removable chips on top, with beds against guests and the
 *    nightly total, so nothing selected is ever scrolled out of sight.
 */

export type PickerRoom = Room & {
  /** The API's verdict for the window asked for (rooms/availability). */
  available?: boolean
  /** A guest is in the room now. */
  occupied?: boolean
  /** Free for the window, but sold from this date. */
  next_booking_from?: string | null
}

type State = 'free' | 'occupied' | 'held' | 'booked'
function stateOf(r: PickerRoom): State {
  // The API's `available` is the verdict; the rest only explains a "no".
  if (r.available !== false) return 'free'
  if (r.occupied) return 'occupied'
  if (r.housekeeping_status && r.housekeeping_status !== 'ready') return 'held'
  return 'booked'
}

const MANY = 24

export function RoomPicker({ rooms, selected, onChange, persons, loading }: {
  rooms: PickerRoom[]
  selected: string[]
  onChange: (ids: string[]) => void
  /** Guests on the booking, to say whether the chosen rooms sleep them. */
  persons?: number
  loading?: boolean
}) {
  const { t } = useTranslation()
  const many = rooms.length > MANY
  const [q, setQ] = useState('')
  const [wing, setWing] = useState<string>('all')
  const [floor, setFloor] = useState<string>('all')
  const [kind, setKind] = useState<string>('all')
  const [freeOnly, setFreeOnly] = useState<boolean>(many)
  // The rooms arrive after the first render, so "many" was false when the
  // default was taken. Turn "Free only" on once a large list has arrived,
  // unless the clerk has already set it themselves.
  const touched = useRef(false)
  useEffect(() => { if (many && !touched.current) setFreeOnly(true) }, [many])

  const floorLabel = (f: number) => (f === 0 ? t('dharamshala.groundFloor') : t('dharamshala.floorN', { n: f }))
  const wings = useMemo(() => [...buildingNames(rooms).values()]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })), [rooms])
  const inWing = (r: PickerRoom) => wing === 'all' || (buildingOf(r) ?? '').toLowerCase() === wing.toLowerCase()
  const floors = useMemo(() => [...new Set(rooms.filter(inWing).map(r => Number(r.floor ?? 0)))].sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rooms, wing])
  const kinds = useMemo(() => [...new Set(rooms.map(r => r.name?.trim()).filter((n): n is string => !!n))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })), [rooms])
  const freeCount = (pred: (r: PickerRoom) => boolean) => rooms.filter(r => pred(r) && stateOf(r) === 'free').length

  const needle = q.trim().toLowerCase()
  const squash = (v: string) => v.toLowerCase().replace(/\b(wing|block|building|bldg)\b/g, '').replace(/[^a-z0-9]/g, '')
  const key = squash(q)
  // A wing's short name: "B Wing" -> "b", so "B-305", "B305" and "B 305" all
  // find B Wing's room 305.
  const code = (r: PickerRoom) => `${squash(buildingOf(r) ?? '')}${squash(r.room_number)}`
  const matches = (r: PickerRoom) => !needle
    || r.room_number.toLowerCase().includes(needle)
    || (key.length > 0 && code(r).includes(key))
    || (r.name ?? '').toLowerCase().includes(needle)
  const shown = rooms.filter(r =>
    inWing(r)
    && (floor === 'all' || String(Number(r.floor ?? 0)) === floor)
    && (kind === 'all' || (r.name?.trim() ?? '') === kind)
    // A room already chosen stays in view whatever the filters say.
    && (!freeOnly || stateOf(r) === 'free' || selected.includes(r.id))
    && matches(r))
  // At a trust with wings, the rooms that name none are ONE "Other rooms"
  // group, not one header per number ("Room N193 - 1 of 1 free").
  const groups = useMemo(() => {
    const gs = groupRooms(shown)
    if (!wings.length) return gs
    const loose = gs.filter(g => !g.building)
    if (loose.length < 2) return gs
    const merged: RoomGroup<PickerRoom> = { key: 'other', building: null, level: { kind: 'all' }, rooms: loose.flatMap(g => g.rooms) }
    return [merged, ...gs.filter(g => g.building)]
  }, [shown, wings.length])

  const byId = useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms])
  const chosen = selected.map(id => byId.get(id)).filter((r): r is PickerRoom => !!r)
  const beds = chosen.reduce((s, r) => s + Number(r.capacity_persons || 0), 0)
  const nightly = chosen.reduce((s, r) => s + Number(r.tariff_paise || 0), 0)
  const clash = chosen.filter(r => stateOf(r) !== 'free')

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  const label = (r: PickerRoom) => (buildingOf(r) ? `${buildingOf(r)} · ${r.room_number}` : r.room_number)
  const reason = (r: PickerRoom) => {
    const s = stateOf(r)
    if (s === 'occupied') return t('dharamshala.state.occupied')
    if (s === 'held') return t(`housekeeping.status.${r.housekeeping_status}`)
    if (s === 'booked') return t('dharamshala.state.booked')
    return ''
  }
  function groupLabel(g: RoomGroup<PickerRoom>): string {
    const level = g.level.kind === 'floor' ? floorLabel(g.level.floor)
      : g.level.kind === 'series'
        ? (g.level.from === g.level.to ? t('dharamshala.roomOne', { n: g.level.from }) : t('dharamshala.roomRange', { from: g.level.from, to: g.level.to }))
        : ''
    return [g.building, level].filter(Boolean).join(' · ') || t('dharamshala.otherRooms')
  }
  // Enter on an exact room number picks it: "205" or "A-205".
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const byCode = shown.filter(r => code(r) === key)
    const byNumber = shown.filter(r => r.room_number.toLowerCase() === needle)
    const exact = byCode.length ? byCode : byNumber
    const pick = exact.length === 1 ? exact[0] : shown.length === 1 ? shown[0] : null
    if (pick && stateOf(pick) === 'free' && !selected.includes(pick.id)) {
      onChange([...selected, pick.id])
      setQ('')
    }
  }

  const chip = (on: boolean) => `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
    on ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`

  return (
    <div data-testid="room-picker" className="space-y-2">
      {/* What is chosen, always in view. */}
      <div className="flex flex-wrap items-center gap-1.5 min-h-[28px]" data-testid="rooms-chosen">
        {chosen.map(r => (
          <span key={r.id} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
            stateOf(r) === 'free' ? 'bg-blue-50 text-brand-blue ring-1 ring-brand-blue/40' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-300'}`}>
            {label(r)}
            <button type="button" onClick={() => toggle(r.id)} aria-label={t('dharamshala.picker.remove', { room: label(r) })} className="hover:opacity-70">
              <X size={12} />
            </button>
          </span>
        ))}
        <span className="text-xs text-slate-500 ml-auto" data-testid="rooms-selected">
          {t('dharamshala.roomsSelected', { count: selected.length })}
          {chosen.length > 0 && <> · {t('dharamshala.picker.beds', { beds })}{persons ? ` / ${t('dharamshala.personsN', { count: persons })}` : ''} · ₹{fmtPaise(nightly)}{t('dharamshala.perNightSuffix')}</>}
        </span>
      </div>
      {clash.length > 0 && (
        <p className="text-xs text-rose-700" role="alert" data-testid="rooms-clash">
          {t('dharamshala.picker.clash', { rooms: clash.map(label).join(', ') })}
        </p>
      )}

      {/* Narrowing. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[10rem] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="form-input pl-8 py-1.5 text-sm" value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey}
            placeholder={t('dharamshala.picker.search')} aria-label={t('dharamshala.findRoom')} data-testid="room-search" />
        </div>
        {kinds.length > 1 && (
          <select className="form-select py-1.5 text-sm w-auto" value={kind} onChange={e => setKind(e.target.value)} aria-label={t('dharamshala.allTypes')}>
            <option value="all">{t('dharamshala.allTypes')}</option>
            {kinds.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={freeOnly} onChange={e => { touched.current = true; setFreeOnly(e.target.checked) }} data-testid="free-only" />
          {t('dharamshala.picker.freeOnly')}
        </label>
      </div>
      {wings.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label={t('dharamshala.filterBuilding')} data-testid="wing-chips">
          <button type="button" className={chip(wing === 'all')} onClick={() => { setWing('all'); setFloor('all') }}>
            {t('dharamshala.allBuildings')} <span className="opacity-70">{freeCount(() => true)}</span>
          </button>
          {wings.map(w => (
            <button key={w} type="button" className={chip(wing.toLowerCase() === w.toLowerCase())} onClick={() => { setWing(w); setFloor('all') }}>
              {w} <span className="opacity-70">{freeCount(r => (buildingOf(r) ?? '').toLowerCase() === w.toLowerCase())}</span>
            </button>
          ))}
        </div>
      )}
      {floors.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label={t('dharamshala.filterFloor')} data-testid="floor-chips">
          <button type="button" className={chip(floor === 'all')} onClick={() => setFloor('all')}>{t('dharamshala.allFloors')}</button>
          {floors.map(f => (
            <button key={f} type="button" className={chip(floor === String(f))} onClick={() => setFloor(String(f))}>
              {floorLabel(f)} <span className="opacity-70">{freeCount(r => inWing(r) && Number(r.floor ?? 0) === f)}</span>
            </button>
          ))}
        </div>
      )}

      {/* The rooms, wing -> floor. */}
      {loading ? (
        <p className="text-sm text-slate-500 py-3">{t('common.loading')}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-500 py-3">{t('dharamshala.noRoomsFree')}</p>
      ) : (
        <div className="max-h-80 overflow-y-auto pr-1 space-y-3 rounded-lg border border-slate-100 p-2">
          {groups.map(g => {
            // Counted over EVERY room on that floor, not only the ones still
            // shown: with "Free only" on, "2 of 2 free" hid that the floor has 4.
            const all = g.level.kind === 'floor'
              ? rooms.filter(r => (buildingOf(r) ?? '').toLowerCase() === (g.building ?? '').toLowerCase()
                && Number(r.floor ?? 0) === (g.level as { floor: number }).floor)
              : g.rooms
            const free = all.filter(r => stateOf(r) === 'free').length
            return (
              <div key={g.key}>
                {groups.length > 1 && (
                  <p className="sticky top-0 z-[1] bg-white/95 backdrop-blur py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
                    {groupLabel(g)}
                    <span className="font-normal normal-case tracking-normal text-slate-400">{t('dharamshala.picker.freeOf', { free, total: all.length })}</span>
                  </p>
                )}
                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))' }}>
                  {g.rooms.map(r => {
                    const on = selected.includes(r.id)
                    const st = stateOf(r)
                    const blocked = st !== 'free'
                    return (
                      <button
                        key={r.id} type="button" disabled={blocked && !on} onClick={() => toggle(r.id)}
                        data-testid="room-tile" data-room-id={r.id} data-state={st} aria-pressed={on}
                        title={[r.name, reason(r)].filter(Boolean).join(' · ')}
                        className={`relative text-left rounded-md border px-2 py-1.5 transition-colors ${
                          on ? (blocked ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-400' : 'border-brand-blue bg-blue-50 ring-1 ring-brand-blue')
                            : blocked ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                              : 'border-slate-200 bg-white hover:border-slate-400'
                        }`}
                      >
                        {on && <Check size={13} className="absolute right-1.5 top-1.5 text-brand-blue" />}
                        <p className="font-bold text-navy-900 text-sm leading-tight">{r.room_number}</p>
                        <p className="text-[11px] text-slate-500 truncate leading-tight">{r.name?.trim() || t('dharamshala.room')}</p>
                        <p className="text-[11px] text-slate-600 leading-tight">
                          ₹{fmtPaise(r.tariff_paise).replace(/\.00$/, '')} · {t('dharamshala.sleepsN', { n: r.capacity_persons })}
                        </p>
                        {blocked
                          ? <p className="text-[10px] font-medium text-amber-700 leading-tight">{reason(r)}</p>
                          : r.next_booking_from && <p className="text-[10px] text-sky-700 leading-tight">{t('dharamshala.picker.bookedFrom', { date: String(r.next_booking_from).slice(5, 10).split('-').reverse().join('/') })}</p>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
