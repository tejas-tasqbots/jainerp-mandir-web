/**
 * Rooms in the order a person counts them, grouped the way a front desk reads
 * a building: building, then floor, then room number.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Room numbers are text ("A-101", "G2", "Dorm 1"), and sorted as text the board
 * read 04 05 … 10 101 102 … 109 11 111 112 12 201 — "11 is somewhere, 12 is
 * somewhere". Every hotel system's room rack does the same two things instead:
 * numbers in numeric order, and a break per building and floor, so a clerk
 * finds a room by walking the building in their head.
 *
 * ── THE ORDER ───────────────────────────────────────────────────────────────
 * The same keys as `naturalSql` in mandiradmin-api/src/common/domain/room-order.ts
 * (and util/room_order.dart in the phone app): prefix · number · middle ·
 * number · raw, text case-folded, digits as numbers. qa/qa-room-order.mjs
 * holds all three to one expected order.
 *
 * ── THE GROUPS ──────────────────────────────────────────────────────────────
 *   building   Only when at least one room has one (tenant migration 053).
 *              Rooms with none come first, unlabelled.
 *   floor      When the building's rooms are on more than one recorded floor.
 *              `floor` defaults to 1, and until the Rooms master offered it no
 *              trust could set it — so "every room on floor 1" means "not
 *              recorded", not a one-storey building.
 *   series     Otherwise, the room numbers' own hundreds: 04–12, 101–112,
 *              201–212. Labelled with the RANGE, never as a floor, because
 *              numbering by floor is a convention and not a fact.
 */

export interface RoomLike {
  room_number: string
  floor?: number | null
  building?: string | null
}

type Key = [string, number | null, string | null, number | null, string]

function naturalKey(value: string): Key {
  const s = String(value ?? '')
  const m = /^(\D*)(\d+)?(\D*)(\d+)?/.exec(s)
  const prefix = (m?.[1] ?? '').toLowerCase()
  const n1 = m?.[2] != null ? Number(m[2]) : null
  // Mirrors SQL: the middle and second number exist only after a first number.
  const mid = n1 != null ? (m?.[3] ?? '').toLowerCase() : null
  const n2 = n1 != null && m?.[4] != null ? Number(m[4]) : null
  return [prefix, n1, mid, n2, s]
}

const cmpText = (a: string | null, b: string | null) =>
  a === b ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : 1   // NULLs last, as in SQL ASC
const cmpNum = (a: number | null, b: number | null) =>
  a === b ? 0 : a == null ? -1 : b == null ? 1 : a - b             // NULLS FIRST, as in the SQL

/** Compare two room numbers the way a person counts: 4 < 11 < 101 < 101A. */
export function compareRoomNumbers(a: string, b: string): number {
  const x = naturalKey(a)
  const y = naturalKey(b)
  return cmpText(x[0], y[0]) || cmpNum(x[1], y[1]) || cmpText(x[2], y[2])
    || cmpNum(x[3], y[3]) || (x[4] < y[4] ? -1 : x[4] > y[4] ? 1 : 0)
}

/** A trimmed building name, or null when the room has none. */
export function buildingOf(r: RoomLike): string | null {
  const b = (r.building ?? '').trim()
  return b ? b : null
}

/**
 * One label per building, whatever mix of case and spacing its rooms were
 * typed with: the spelling most rooms use, ties to the one that sorts first.
 * Taking the first one seen made the label depend on the order the API
 * happened to return rooms in — "A Wing" on one load, "a wing" on the next.
 */
export function buildingNames(rooms: readonly RoomLike[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const r of rooms) {
    const b = buildingOf(r)
    if (!b) continue
    const spellings = counts.get(b.toLowerCase()) ?? new Map<string, number>()
    spellings.set(b, (spellings.get(b) ?? 0) + 1)
    counts.set(b.toLowerCase(), spellings)
  }
  const out = new Map<string, string>()
  for (const [key, spellings] of counts) {
    const [best] = [...spellings.entries()].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    out.set(key, best[0])
  }
  return out
}

export type RoomLevel =
  | { kind: 'all' }
  | { kind: 'floor'; floor: number }
  | { kind: 'series'; from: string; to: string }

export interface RoomGroup<T> {
  key: string
  building: string | null
  level: RoomLevel
  rooms: T[]
}

/** Which hundred a room number belongs to: 04 → 0, 112 → 1, A-205 → A|2. */
function seriesKey(roomNumber: string): string {
  const [prefix, n1] = naturalKey(roomNumber)
  return `${prefix}|${n1 == null ? '-' : n1 >= 100 ? Math.floor(n1 / 100) : 0}`
}

/**
 * Sort and group rooms for a board. One group per building × floor (or number
 * series); a building whose rooms form one group gets `level: all`.
 */
export function groupRooms<T extends RoomLike>(rooms: readonly T[]): RoomGroup<T>[] {
  const names = buildingNames(rooms)
  const byBuilding = new Map<string, { name: string | null; rooms: T[] }>()
  for (const r of rooms) {
    const k = buildingOf(r)?.toLowerCase() ?? ''
    const entry = byBuilding.get(k) ?? { name: names.get(k) ?? null, rooms: [] }
    entry.rooms.push(r)
    byBuilding.set(k, entry)
  }
  const buildings = [...byBuilding.entries()].sort(([a], [b]) =>
    a === b ? 0 : a === '' ? -1 : b === '' ? 1 : compareRoomNumbers(a, b))

  const out: RoomGroup<T>[] = []
  for (const [bKey, { name, rooms: inBuilding }] of buildings) {
    const floors = new Set(inBuilding.map(r => r.floor ?? 1))
    const byFloor = floors.size > 1
    const sorted = [...inBuilding].sort((a, b) =>
      (byFloor ? (a.floor ?? 1) - (b.floor ?? 1) : 0) || compareRoomNumbers(a.room_number, b.room_number))

    const groups: RoomGroup<T>[] = []
    for (const r of sorted) {
      const lk = byFloor ? `f${r.floor ?? 1}` : `s${seriesKey(r.room_number)}`
      const last = groups[groups.length - 1]
      if (last && last.key === `${bKey}#${lk}`) { last.rooms.push(r); continue }
      groups.push({
        key: `${bKey}#${lk}`,
        building: name,
        level: byFloor ? { kind: 'floor', floor: r.floor ?? 1 } : { kind: 'series', from: r.room_number, to: r.room_number },
        rooms: [r],
      })
    }
    for (const g of groups) {
      if (g.level.kind === 'series') g.level.to = g.rooms[g.rooms.length - 1].room_number
    }
    if (groups.length === 1) groups[0].level = { kind: 'all' }
    out.push(...groups)
  }
  return out
}
