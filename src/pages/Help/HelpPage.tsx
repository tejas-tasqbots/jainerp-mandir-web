import { HelpCircle, Phone, Mail, BookOpen, ExternalLink, Keyboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SHORTCUTS } from '../../lib/shortcuts'

/**
 * Step-by-step guides. The words live in the locale files (help.<id>.title,
 * help.<id>.s1..sN) so every language reads its own guide; only the ids and how
 * many steps each has are kept here.
 */
const topics: { id: string; steps: number; hiddenForNow?: boolean }[] = [
  { id: 'devotees', steps: 7 },
  { id: 'donation', steps: 7 },
  { id: 'boli', steps: 6 },
  { id: 'certificates', steps: 6 },
  { id: 'rooms', steps: 6 },
  { id: 'prasad', steps: 5 },
  { id: 'bhojanshala', steps: 4 },
  { id: 'seva', steps: 5 },
  // The screen is switched off for now (lib/rbac HIDDEN_FOR_NOW).
  { id: 'connectedDevotees', steps: 5, hiddenForNow: true },
  { id: 'staff', steps: 5 },
]


/* Platform support contacts.
   Kept beside each other and used for both the link and the visible text, so a
   card can never show one address while dialling or mailing another — which is
   what happened here: the page still offered a placeholder 1234567890 and the
   old tasqbots address long after the API had moved to PLATFORM_SUPPORT_PHONE /
   PLATFORM_SUPPORT_EMAIL. */
const SUPPORT_PHONE = '+91 91565 25532'
const SUPPORT_PHONE_E164 = '+919156525532'
const SUPPORT_EMAIL = 'support@jainerp.org'

export function HelpPage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-xl font-bold text-navy-900">{t('ui.userGuideHelp')}</h1>

      {/* Keyboard shortcuts */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
            <Keyboard size={15} /> {t('shortcuts.title')}
          </h3>
        </div>
        <div className="card-body">
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
            {SHORTCUTS.map(s => (
              <div key={s.keys} className="flex items-center justify-between text-sm py-1">
                <span className="text-slate-600">{t(s.labelKey)}</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-xs text-slate-600">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick guides */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
            <HelpCircle size={15} />{t('ui.stepByStep')}</h3>
        </div>
        <div className="card-body">
          <div className="grid sm:grid-cols-2 gap-5">
            {topics.filter(topic => !topic.hiddenForNow).map(topic => (
              <div key={topic.id} className="border border-slate-100 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-navy-900 mb-3 flex items-center gap-2">
                  <BookOpen size={13} className="text-brand-red flex-shrink-0" /> {t(`help.${topic.id}.title`)}
                </h4>
                <ol className="space-y-1.5">
                  {Array.from({ length: topic.steps }, (_, i) => (
                    <li key={i} className="flex gap-2 text-xs text-slate-600">
                      <span className="w-4 h-4 bg-brand-red text-white rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold">{i+1}</span>
                      {t(`help.${topic.id}.s${i + 1}`)}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Support */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">{t('ui.supportFeedback')}</h3></div>
        <div className="card-body">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <a href={`tel:${SUPPORT_PHONE_E164}`} className="flex items-center gap-3 p-4 border border-slate-200 rounded-lg hover:border-brand-blue hover:bg-blue-50 transition-colors group">
              <div className="p-2 bg-green-100 rounded-lg"><Phone size={16} className="text-green-600" /></div>
              <div>
                <p className="font-medium text-sm">{t('ui.callSupport')}</p>
                {/* The number itself, not only the tel: link — a trustee on a
                    desktop has nothing to dial from and needs to read it. */}
                <p className="text-xs text-slate-600">{SUPPORT_PHONE}</p>
                <p className="text-xs text-slate-400">{t('ui.supportHours')}</p>
              </div>
            </a>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-3 p-4 border border-slate-200 rounded-lg hover:border-brand-blue hover:bg-blue-50 transition-colors group">
              <div className="p-2 bg-blue-100 rounded-lg"><Mail size={16} className="text-blue-600" /></div>
              <div>
                <p className="font-medium text-sm">{t('ui.emailSupport')}</p>
                <p className="text-xs text-slate-400">{SUPPORT_EMAIL}</p>
              </div>
            </a>
            <a href="/settings" className="flex items-center gap-3 p-4 border border-slate-200 rounded-lg hover:border-brand-blue hover:bg-blue-50 transition-colors">
              <div className="p-2 bg-orange-100 rounded-lg"><ExternalLink size={16} className="text-orange-600" /></div>
              <div>
                <p className="font-medium text-sm">{t('ui.raiseRequirement')}</p>
                <p className="text-xs text-slate-400">{t('nav.settings')} → {t('settings.tabs.privacy')}</p>
              </div>
            </a>
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-slate-400 py-4">
        <p>JainERP™ v2.0 — {t('help.poweredBy')}</p>
        <p className="mt-1">© {new Date().getFullYear()} {t('help.rights')}</p>
      </div>
    </div>
  )
}
