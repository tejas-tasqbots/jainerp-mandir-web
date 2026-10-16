import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CloudUpload, Download, FileSpreadsheet, FolderOpen, FolderPlus, HardDrive, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-react'
import { offlineBridge, errText, fmtBytes, type BackupSettings, type BackupSettingsView, type AskOnExit } from '../../../lib/offlineDesktop'
import { useAuthStore } from '../../../store/authStore'
import { useToast } from '../../../components/kit/Toast'

/**
 * JainERP Offline: backups are files the mandir keeps.
 *
 * Everything lives on this one computer, so a backup that stays here does not
 * survive the computer. The way out that needs no internet from the app: write
 * backups into a OneDrive / Google Drive / Dropbox folder (their own sync
 * client uploads it whenever this computer is online), a pen drive, or a second
 * disk. Up to three folders; each backup goes to all of them.
 */
export function OfflineBackupTab() {
  const { t } = useTranslation()
  const toast = useToast()
  const bridge = offlineBridge()
  const isAdmin = useAuthStore(s => s.user?.roles?.includes('temple_admin') ?? false)
  const [view, setView] = useState<BackupSettingsView | null>(null)
  const [draft, setDraft] = useState<BackupSettings | null>(null)
  const [busy, setBusy] = useState<'backup' | 'save' | 'restore' | 'excel' | null>(null)
  const [lastRun, setLastRun] = useState<{ written: string[]; failed: Array<{ folder: string; error: string }> } | null>(null)
  const [error, setError] = useState('')

  async function load() {
    if (!bridge) return
    const v = await bridge.backupSettings()
    setView(v)
    setDraft(v.settings)
  }
  useEffect(() => {
    void load()
    // The daily automatic backup, or one taken on the native Backup window.
    return bridge?.onBackupTaken(() => { void load() })
  }, [])

  if (!bridge || !view || !draft) return null
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.settings)
  const set = (patch: Partial<BackupSettings>) => setDraft(d => (d ? { ...d, ...patch } : d))

  async function backupNow() {
    setBusy('backup'); setError(''); setLastRun(null)
    const r = await bridge!.backupNow()
    setBusy(null)
    if (!r.success) { setError(errText(r, t('offline.backup.failed', 'The backup failed.'))); return }
    setLastRun({ written: r.written, failed: r.failed })
    toast.success(t('offline.backup.done', 'Backup saved — {{rows}} records.', { rows: r.totalRows.toLocaleString('en-IN') }))
    void load()
  }

  async function addFolder(path?: string) {
    const chosen = path ?? (await bridge!.chooseFolder())
    if (!chosen || !draft) return
    if (draft.folders.some(f => f.toLowerCase() === chosen.toLowerCase())) return
    set({ folders: [...draft.folders, chosen].slice(0, view!.maxFolders) })
  }

  async function save() {
    setBusy('save'); setError('')
    const r = await bridge!.saveBackupSettings(draft!)
    setBusy(null)
    if (!r.success) { setError(errText(r, t('offline.backup.saveFailed', 'Could not save.'))); return }
    toast.success(t('settings.saved'))
    void load()
  }

  async function restore(path?: string) {
    const file = path ?? (await bridge!.chooseBackupFile())
    if (!file) return
    setBusy('restore'); setError('')
    // The desktop asks for confirmation itself, in a native dialog.
    const r = await bridge!.restore(file)
    setBusy(null)
    if (!r.success) { if (!('cancelled' in r && r.cancelled)) setError(errText(r, t('offline.backup.restoreFailed', 'The restore failed.'))); return }
    toast.success(t('offline.backup.restored', 'Restored {{rows}} records. Everyone signs in again.', { rows: r.totalRows.toLocaleString('en-IN') }))
  }

  async function excel() {
    setBusy('excel'); setError('')
    const r = await bridge!.exportExcel()
    setBusy(null)
    if (!r.success) { setError(errText(r, t('offline.backup.excelFailed', 'The Excel export failed.'))); return }
    void bridge!.openFolder(r.filePath.replace(/[\\/][^\\/]+$/, ''))
  }

  const newest = view.newest
  const onlyThisComputer = draft.folders.length === 0
  const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const ASK: Array<{ id: AskOnExit; label: string }> = [
    { id: 'always', label: t('offline.backup.askAlways', 'Every time the app is closed') },
    { id: 'if-not-today', label: t('offline.backup.askIfNotToday', 'Only if no backup was taken today') },
    { id: 'never', label: t('offline.backup.askNever', 'Never ask (rely on the daily automatic backup)') },
  ]

  return (
    <div className="space-y-4 max-w-3xl">
      {/* ── Now ── */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><HardDrive size={15} /> {t('offline.backup.title', 'Backup')}</h3></div>
        <div className="card-body space-y-3">
          <p className="text-sm text-slate-600">
            {newest
              ? t('offline.backup.last', 'Last backup: {{when}} ({{size}})', { when: when(newest.createdAt), size: fmtBytes(newest.bytes) })
              : t('offline.backup.never', 'No backup has been taken yet.')}
          </p>
          {onlyThisComputer && (
            <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-sm text-amber-800 flex gap-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{t('offline.backup.onlyHere', 'Backups are only on this computer ({{dir}}). If this computer fails they are lost with it — add a OneDrive, Google Drive or pen-drive folder below.', { dir: view.defaultFolder })}</span>
            </div>
          )}
          {error && <p className="text-sm text-brand-red">{error}</p>}
          {lastRun && lastRun.failed.length > 0 && (
            <div className="text-sm text-amber-800">{t('offline.backup.partial', 'Saved, but not to every folder:')} {lastRun.failed.map(f => f.folder).join(', ')}</div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={backupNow} disabled={!!busy} className="btn-primary">
              {busy === 'backup' ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
              {busy === 'backup' ? t('offline.backup.running', 'Backing up…') : t('offline.backup.now', 'Back up now')}
            </button>
            <button onClick={excel} disabled={!!busy} className="btn-secondary"><FileSpreadsheet size={16} /> {t('offline.backup.excel', 'Excel copy of the registers')}</button>
            <button onClick={() => bridge.openFolder(view.folders[0])} className="btn-secondary"><FolderOpen size={16} /> {t('offline.backup.openFolder', 'Open backup folder')}</button>
          </div>
        </div>
      </div>

      {/* ── Where ── */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><CloudUpload size={15} /> {t('offline.backup.whereTitle', 'Where backups are saved')}</h3></div>
        <div className="card-body space-y-3">
          <p className="text-xs text-slate-500">{t('offline.backup.whereHelp', 'Each backup is saved to every folder below (up to {{max}}). A OneDrive or Google Drive folder is uploaded by its own app whenever this computer is online — JainERP itself never uses the internet.', { max: view.maxFolders })}</p>
          {draft.folders.length === 0 ? (
            <p className="text-sm text-slate-500">{t('offline.backup.defaultOnly', 'Default (this computer): {{dir}}', { dir: view.defaultFolder })}</p>
          ) : (
            <ul className="space-y-2">
              {draft.folders.map((f, i) => (
                <li key={f} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm">
                  <span className="font-mono text-xs break-all">{i + 1}. {f}</span>
                  {isAdmin && <button onClick={() => set({ folders: draft.folders.filter(x => x !== f) })} className="text-slate-400 hover:text-brand-red" aria-label={t('common.delete') as string}><Trash2 size={15} /></button>}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && draft.folders.length < view.maxFolders && (
            <div className="flex flex-wrap gap-2">
              {view.suggestions.filter(s => !draft.folders.some(f => f.toLowerCase() === s.path.toLowerCase())).map(s => (
                <button key={s.path} onClick={() => addFolder(s.path)} className="btn-secondary btn-sm" title={s.path}>
                  <CloudUpload size={14} /> {t('offline.backup.useSuggestion', 'Use {{label}}', { label: s.label })}
                </button>
              ))}
              <button onClick={() => addFolder()} className="btn-secondary btn-sm"><FolderPlus size={14} /> {t('offline.backup.addFolder', 'Choose a folder or pen drive…')}</button>
            </div>
          )}
        </div>
      </div>

      {/* ── When ── */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">{t('offline.backup.whenTitle', 'When')}</h3></div>
        <div className="card-body space-y-4 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={draft.autoDaily} disabled={!isAdmin} onChange={e => set({ autoDaily: e.target.checked })} />
            <span>{t('offline.backup.autoDaily', 'Take a backup automatically once a day while the app is open')}</span>
          </label>
          <div>
            <p className="font-medium mb-2">{t('offline.backup.onExit', 'When the app is closed, ask to back up:')}</p>
            <div className="space-y-1.5">
              {ASK.map(o => (
                <label key={o.id} className="flex items-center gap-2">
                  <input type="radio" name="ask-on-exit" checked={draft.askOnExit === o.id} disabled={!isAdmin} onChange={() => set({ askOnExit: o.id })} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="keep-days">{t('offline.backup.keep', 'Keep backups for')}</label>
            <input id="keep-days" type="number" min={1} max={3650} className="form-input w-24" value={draft.keepDays} disabled={!isAdmin}
              onChange={e => set({ keepDays: Number(e.target.value) || 1 })} />
            <span>{t('offline.backup.days', 'days (the newest 5 are always kept)')}</span>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={draft.excelCopy} disabled={!isAdmin} onChange={e => set({ excelCopy: e.target.checked })} />
            <span>{t('offline.backup.excelWith', 'Also save a readable Excel copy of the main registers with each backup')}</span>
          </label>
          {isAdmin ? (
            <button onClick={save} disabled={!dirty || !!busy} className="btn-primary btn-sm"><Save size={14} /> {t('settings.save')}</button>
          ) : (
            <p className="text-xs text-slate-400">{t('offline.backup.adminOnly', 'Only the Temple Admin can change these.')}</p>
          )}
        </div>
      </div>

      {/* ── Restore ── */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><RotateCcw size={15} /> {t('offline.backup.restoreTitle', 'Backups and restore')}</h3></div>
        <div className="card-body space-y-3">
          <p className="text-xs text-slate-500">{t('offline.backup.restoreHelp', 'Restoring REPLACES everything on this computer with the backup — users and their PINs included — and everyone signs in again. Moving to a new computer: install JainERP Offline there, activate the same licence, then restore the latest backup.')}</p>
          {view.backups.length === 0 ? (
            <p className="text-sm text-slate-400">{t('offline.backup.none', 'No backups yet.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>{t('offline.backup.when', 'Taken')}</th><th>{t('offline.backup.size', 'Size')}</th><th>{t('offline.backup.folder', 'Folder')}</th><th /></tr></thead>
                <tbody>
                  {view.backups.slice(0, 15).map(b => (
                    <tr key={b.path}>
                      <td className="text-sm">{when(b.createdAt)}</td>
                      <td className="text-sm text-slate-500">{fmtBytes(b.bytes)}</td>
                      <td className="text-xs font-mono text-slate-500 break-all">{b.folder}</td>
                      <td className="text-right">
                        {isAdmin && <button onClick={() => restore(b.path)} disabled={!!busy} className="text-xs font-medium text-brand-red underline">{t('offline.backup.restore', 'Restore')}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isAdmin && (
            <button onClick={() => restore()} disabled={!!busy} className="btn-secondary btn-sm"><RotateCcw size={14} /> {t('offline.backup.restoreFile', 'Restore from a file…')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
