import { api } from './api'

/**
 * Every row of a paged list endpoint.
 *
 * List endpoints return at most 200 rows a page (50 when no limit is sent), so
 * a picker that asked once saw only the first page: the room booking form
 * showed 50 rooms, and a dharamshala with more could not book the rest. Stops
 * at `maxPages` so a runaway list cannot hang a form.
 */
export async function fetchAllPages<T>(path: string, params: Record<string, string> = {}, maxPages = 25): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= maxPages; page++) {
    const r = await api.get(path, { params: { ...params, limit: '200', page: String(page) } })
    const rows: T[] = r.data.data || []
    out.push(...rows)
    if (rows.length < 200) break
  }
  return out
}
