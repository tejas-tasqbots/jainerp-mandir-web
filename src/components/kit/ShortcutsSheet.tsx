import { useTranslation } from 'react-i18next'
import { X, Keyboard } from 'lucide-react'
import { SHORTCUTS } from '../../lib/shortcuts'

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 no-print"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="font-bold text-navy-900 flex items-center gap-2">
            <Keyboard size={16} /> {t('shortcuts.title')}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-2.5">
          {SHORTCUTS.map(s => (
            <div key={s.keys} className="flex items-center justify-between text-sm">
              <span className="text-slate-600">{t(s.labelKey)}</span>
              <kbd className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-xs text-slate-600">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
