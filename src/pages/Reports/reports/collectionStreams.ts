import type { TFunction } from 'i18next'

export interface StreamRow {
  label: string
  amount_paise: number
  emphasis?: 'total' | 'net'
}

/**
 * The per-stream figures of a collection report.
 *
 * Every stream is optional on purpose: the API measures only the streams the
 * trust actually runs — a donation-only trust gets `donations_paise` and
 * nothing else — and names what it sent in `included_streams`.
 */
export interface CollectionStreams {
  donations_paise?: number
  seva_paise?: number
  prasad_paise?: number
  bhojanshala_paise?: number
  room_advance_paise?: number
  hall_advance_paise?: number
  included_streams?: string[]
  total_collection_paise: number
  expenses_paise: number
  net_paise: number
}

const STREAMS: [keyof CollectionStreams, string][] = [
  ['donations_paise', 'reports.streamDonations'],
  ['seva_paise', 'reports.streamSeva'],
  ['prasad_paise', 'reports.streamPrasad'],
  ['bhojanshala_paise', 'reports.streamBhojanshala'],
  ['room_advance_paise', 'reports.streamRoomAdvance'],
  ['hall_advance_paise', 'reports.streamHallAdvance'],
]

/**
 * Build the stream rows for the Daily Collection and Collection Summary
 * reports, which show the same breakdown for a day and for a range.
 *
 * Shows a stream only where the trust runs it. Both screens used to list all
 * six unconditionally against a payload that omits the ones a trust never
 * bought, so `fmtPaise(undefined)` printed "₹NaN" down the page — and once that
 * is fixed to 0, "Prasad ₹0" beside real figures still reads as a takings
 * shortfall rather than a module the trust does not have. Older APIs did not
 * send `included_streams`; fall back to whichever keys are present.
 */
export function buildStreamRows(data: CollectionStreams, t: TFunction): StreamRow[] {
  const rows: StreamRow[] = []
  for (const [key, labelKey] of STREAMS) {
    const amount = data[key] as number | undefined
    const show = data.included_streams ? data.included_streams.includes(key) : amount != null
    if (show) rows.push({ label: t(labelKey), amount_paise: amount ?? 0 })
  }
  rows.push(
    { label: t('reports.streamTotalCollection'), amount_paise: data.total_collection_paise, emphasis: 'total' },
    { label: t('reports.streamExpenses'), amount_paise: data.expenses_paise },
    { label: t('reports.streamNet'), amount_paise: data.net_paise, emphasis: 'net' },
  )
  return rows
}
