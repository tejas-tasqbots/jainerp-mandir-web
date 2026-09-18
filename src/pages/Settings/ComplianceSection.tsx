import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { LockedField, VerifiedBanner, type useSensitiveFields } from '../../components/SensitiveFields'
import {
  eightyGValidity,
  formatCalendarDate,
  issueKey,
  normaliseStatutory,
  panHolderHint,
  sameStatutoryValue,
  STATUTORY_EXAMPLE,
  STATUTORY_MAX_LENGTH,
  statutoryIssue,
  type StatutoryIssue,
} from '../../lib/statutoryIds'
import {
  COMPLIANCE_FIELDS, IDENTITY_FIELDS, IDENTITY_MAX_LENGTH,
  type ComplianceField, type ComplianceValues, type IdentityField, type IdentityValues,
} from './complianceFields'

/**
 * Settings → Temple Profile → Registration & Compliance.
 *
 * Two groups, because the fields are two different kinds of thing:
 *
 *   VERIFIED — PAN, 12AB, 80G and its validity. What an 80G receipt rests on.
 *     Editable until the platform verifies the trust, then locked behind a
 *     reviewed change request.
 *   OPTIONAL — GSTIN, TAN, FSSAI. Registrations only some trusts hold (most
 *     temples are not GST-registered). Always editable and clearable.
 *   IDENTITY — the registrar's own registration number and the NGO-Darpan ID.
 *     Who the body IS rather than what it may claim, so they print on every
 *     document and not only on donations. Free text: their shape varies by
 *     state and registrar, and a rule invented here would reject valid
 *     numbers.
 *
 * Before this, all four visible fields were locked alike, so a trust that had
 * typed "0" into GSTIN during onboarding could neither clear it nor request an
 * empty value — and that "0" was switching GST on. TAN, FSSAI and the 80G
 * validity date were accepted by the API and printed on receipts but had no box
 * anywhere; Receipt Settings said "edited in Temple Profile" about fields that
 * Temple Profile did not have.
 *
 * The field list and the change rule live in ./complianceFields.
 */

interface Props {
  values: ComplianceValues
  loaded: ComplianceValues
  onChange: (field: ComplianceField, value: string) => void
  /** The free-text identity registrations, and their setter. */
  identity: IdentityValues
  onIdentityChange: (field: IdentityField, value: string) => void
  sens: ReturnType<typeof useSensitiveFields>
  /** From `complianceIssues` — one per changed field that fails its rule. */
  issues: Partial<Record<ComplianceField, StatutoryIssue>>
}

export function ComplianceSection({ values, loaded, onChange, identity, onIdentityChange, sens, issues }: Props) {
  const { t } = useTranslation()

  const label: Record<ComplianceField, string> = {
    pan: t('settings.profile.pan'),
    reg_12ab_number: t('settings.profile.reg12ab'),
    reg_80g_number: t('settings.profile.reg80g'),
    reg_80g_valid_upto: t('settings.profile.reg80gValidUpto'),
    reg_12a_number: t('settings.profile.reg12a'),
    gstin: t('settings.profile.gstin'),
    tan: t('settings.profile.tan'),
    fssai_license: t('settings.profile.fssai'),
  }
  const help: Partial<Record<ComplianceField, string>> = {
    reg_12ab_number: t('settings.profile.urnHelp'),
    reg_80g_number: t('settings.profile.urnHelp'),
    gstin: t('settings.profile.gstinHelp'),
    tan: t('settings.profile.tanHelp'),
    fssai_license: t('settings.profile.fssaiHelp'),
  }

  // Warnings that hold whether the field is locked or not: they are about the
  // value on file, which the trust may need to act on either way.
  const holder = panHolderHint(values.pan)
  const validity = eightyGValidity(values.reg_80g_valid_upto)
  const warning: Partial<Record<ComplianceField, string>> = {
    ...(holder ? { pan: t(holder === 'individual' ? 'settings.profile.panHintIndividual' : 'settings.profile.panHintHuf') } : {}),
    ...(validity ? {
      reg_80g_valid_upto: t(validity === 'expired' ? 'settings.profile.eightyGExpired' : 'settings.profile.eightyGExpiring', {
        date: formatCalendarDate(values.reg_80g_valid_upto),
      }),
    } : {}),
  }
  // A SAVED value that breaks the rules — the "0" in GSTIN that started this.
  // Saving never re-judges an untouched value (legacy data must not block an
  // address edit), so without this the trust would never learn it is wrong.
  const pans = [loaded.pan]
  for (const f of COMPLIANCE_FIELDS) {
    const saved = normaliseStatutory(f, loaded[f])
    if (!saved || warning[f] || !sameStatutoryValue(f, values[f], loaded[f])) continue
    const stored = statutoryIssue(f, saved, f === 'pan' ? [] : pans)
    if (stored) warning[f] = t('settings.profile.storedInvalid', { reason: t(issueKey(stored), stored.params) })
  }

  function note(f: ComplianceField): ReactNode {
    const issue = issues[f]
    if (issue) {
      return <p className="mt-1 text-xs text-red-600" role="alert" data-testid={`issue-${f}`}>{t(issueKey(issue), issue.params)}</p>
    }
    return (
      <>
        {warning[f] && (
          <p className="mt-1 flex items-start gap-1 text-xs text-amber-700" data-testid={`warn-${f}`}>
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />{warning[f]}
          </p>
        )}
        {help[f] && !sens.isLocked(f) && <p className="mt-1 text-[11px] text-slate-400">{help[f]}</p>}
      </>
    )
  }

  function field(f: ComplianceField) {
    const isDate = f === 'reg_80g_valid_upto'
    if (sens.isLocked(f)) {
      return (
        <div key={f} data-field={f}>
          <LockedField
            label={label[f]}
            value={loaded[f]}
            display={isDate ? formatCalendarDate(loaded[f]) : undefined}
            field={f}
            pending={sens.pendingFor(f)}
            onRequest={sens.openRequest}
            hint={note(f)}
          />
        </div>
      )
    }
    return (
      <div key={f} data-field={f}>
        <label className="form-label" htmlFor={`compliance-${f}`}>{label[f]}</label>
        <input
          id={`compliance-${f}`}
          className={`form-input ${isDate ? '' : 'uppercase font-mono'} ${issues[f] ? 'border-red-400' : ''}`}
          type={isDate ? 'date' : 'text'}
          value={values[f]}
          placeholder={STATUTORY_EXAMPLE[f] || undefined}
          maxLength={isDate ? undefined : STATUTORY_MAX_LENGTH[f] + 4}
          aria-invalid={!!issues[f]}
          onChange={e => onChange(f, e.target.value)}
        />
        {note(f)}
      </div>
    )
  }

  // The pre-2021 12A number only appears if the trust has one on file: every
  // 12A trust had to re-register under 12AB by 2022, and an empty box for a
  // registration that no longer exists invites someone to fill it.
  const verified: ComplianceField[] = ['pan', 'reg_12ab_number', 'reg_80g_number', 'reg_80g_valid_upto',
    ...(loaded.reg_12a_number ? ['reg_12a_number' as const] : [])]
  const optional: ComplianceField[] = ['gstin', 'tan', 'fssai_license']

  const identityLabel: Record<IdentityField, string> = {
    registration_number: t('settings.profile.registrationNumber'),
    darpan_number: t('settings.profile.darpanNumber'),
  }
  // Real spellings rather than invented ones, so a trustee recognises the
  // shape of their own certificate.
  const identityPlaceholder: Record<IdentityField, string> = {
    registration_number: 'COOP/2021/UDAIPUR/201746',
    darpan_number: 'RJ/2024/2187120',
  }
  const identityHint: Record<IdentityField, string> = {
    registration_number: t('settings.profile.registrationNumberHint'),
    darpan_number: t('settings.profile.darpanNumberHint'),
  }

  return (
    <div className="border-t border-slate-100 pt-4 space-y-5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('settings.profile.registrationCompliance')}</p>
      {sens.locked && <VerifiedBanner verifiedAt={sens.state?.verified_at ?? null} message={t('sensitive.bannerVerifiedCompliance')} />}

      <section aria-labelledby="compliance-verified">
        <h4 id="compliance-verified" className="text-sm font-semibold text-slate-700">{t('settings.profile.verifiedHeading')}</h4>
        <p className="text-xs text-slate-500 mb-3">
          {sens.locked ? t('settings.profile.verifiedHelpLocked') : t('settings.profile.verifiedHelp')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{verified.map(field)}</div>
      </section>

      <section aria-labelledby="compliance-optional">
        <h4 id="compliance-optional" className="text-sm font-semibold text-slate-700">{t('settings.profile.optionalHeading')}</h4>
        <p className="text-xs text-slate-500 mb-3">{t('settings.profile.optionalHelp')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{optional.map(field)}</div>
      </section>

      <section aria-labelledby="compliance-identity">
        <h4 id="compliance-identity" className="text-sm font-semibold text-slate-700">{t('settings.profile.identityHeading')}</h4>
        <p className="text-xs text-slate-500 mb-3">{t('settings.profile.identityHelp')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {IDENTITY_FIELDS.map((f) => (
            <div key={f} data-field={f}>
              <label className="form-label" htmlFor={`identity-${f}`}>{identityLabel[f]}</label>
              <input
                id={`identity-${f}`}
                className="form-input"
                value={identity[f] ?? ''}
                placeholder={identityPlaceholder[f]}
                maxLength={IDENTITY_MAX_LENGTH[f]}
                onChange={e => onIdentityChange(f, e.target.value)}
              />
              <p className="mt-1 text-[11px] text-slate-400">{identityHint[f]}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
