import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useToast } from './Toast'
import { FileClock, Save, Trash2 } from 'lucide-react'
import type { FormDraft } from '../../lib/formDraft'

const time = (d: Date) => d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })

/**
 * The draft's state above an entry form: "Draft from 11 Oct, 10:42 pm -
 * Discard" when one was put back, "Draft saved 10:43 pm" while typing, and a
 * Save draft button for the clerk who is called away and wants to be sure.
 */
export function DraftBar({ draft, onDiscard, leaveTo, note }: {
  draft: FormDraft
  /** What the draft does not keep, said when one is restored ("ID documents are taken again"). */
  note?: string
  /** Reset the form to blank (the bar has already thrown the draft away). */
  onDiscard: () => void
  /** Where Save draft goes once the draft is stored (the form's list). */
  leaveTo: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  // Said only when something was stored; and if the browser refused it, the
  // clerk stays on the form - leaving would lose what was typed.
  function saveAndLeave() {
    const r = draft.saveNow()
    if (r === 'failed') { toast.error(t('drafts.saveFailed')); return }
    if (r === 'saved') toast.success(t('drafts.savedToast'))
    navigate(leaveTo)
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs no-print" data-testid="draft-bar">
      {draft.restoredFrom && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-900" data-testid="draft-restored">
          <FileClock size={12} /> {t('drafts.restored', { when: time(draft.restoredFrom) })}
        </span>
      )}
      {draft.restoredFrom && note && <span className="text-amber-800">{note}</span>}
      {!draft.restoredFrom && draft.savedAt && (
        <span className="text-slate-500" data-testid="draft-saved">{t('drafts.savedAt', { when: time(draft.savedAt) })}</span>
      )}
      <button type="button" className="btn-secondary btn-sm" onClick={saveAndLeave} data-testid="draft-save">
        <Save size={13} /> {t('drafts.saveDraft')}
      </button>
      {(draft.restoredFrom || draft.savedAt) && (
        <button type="button" className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600" data-testid="draft-discard"
          onClick={() => { draft.discard(); onDiscard() }}>
          <Trash2 size={12} /> {t('drafts.discard')}
        </button>
      )}
    </div>
  )
}
