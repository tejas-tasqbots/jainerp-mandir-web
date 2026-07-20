import { useProfileStore } from '../../store/profileStore'

/**
 * Letterhead shown ONLY when printing a list/register screen (window.print).
 * Renders the temple identity + report title + period so a printout stands on
 * its own as an official register page.
 */
export function PrintLetterhead({ title, subtitle }: { title: string; subtitle?: string }) {
  const { profile } = useProfileStore()
  const address = [profile?.address, profile?.city, profile?.state].filter(Boolean).join(', ')
  return (
    <div className="print-only print-letterhead">
      <div className="print-letterhead-name">{profile?.name || 'Temple'}</div>
      {address && <div className="print-letterhead-address">{address}</div>}
      <div className="print-letterhead-title">
        {title}
        {subtitle ? ` — ${subtitle}` : ''}
      </div>
    </div>
  )
}
