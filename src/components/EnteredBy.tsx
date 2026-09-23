import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import type { EnteredByFields } from '../lib/enteredBy'

/** Who entered a row, as a register cell — see lib/enteredBy for the column and filter. */
export function EnteredByCell({ row }: { row: object }) {
  const { t } = useTranslation()
  const r = row as EnteredByFields
  if (r.entered_by_name) return <span className="text-sm text-slate-700 whitespace-nowrap">{r.entered_by_name}</span>
  if (r.entered_online) {
    return (
      <span className="badge-blue inline-flex items-center gap-1 whitespace-nowrap">
        <Globe size={11} aria-hidden /> {t('enteredBy.online')}
      </span>
    )
  }
  // Written before the trust kept an operator on this kind of entry.
  return <span className="text-slate-300" title={t('enteredBy.notRecorded')}>—</span>
}
