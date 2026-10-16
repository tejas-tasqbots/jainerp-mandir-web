/**
 * JainERP Offline — the desktop edition that runs entirely on one computer.
 *
 * The SAME bundle runs in the browser, in the online desktop and in the
 * offline desktop. Only the offline one sets `window.__JAINERP_OFFLINE__` (its
 * preload, before any script runs) and exposes `electronAPI.offline`. Every
 * offline-only screen and control checks `offlineBridge()` first, so the
 * online app and the browser never see any of it.
 *
 * Offline there is no OTP: each user signs in on this computer with their own
 * PIN, set by the Temple Admin. There is no subscription: a licence. And
 * backups are files the mandir keeps, in folders it chooses.
 */

export interface OfflineUser {
  id: string
  name: string
  mobileTail: string
  roles: string[]
  isAdmin: boolean
  hasPin: boolean
}

export interface OfflineLicence {
  valid: boolean
  grace: boolean
  expiry: string | null
  temple: string
  daysRemaining?: number | null
  licenseId?: string
  termDays?: number | null
}

export type AskOnExit = 'always' | 'if-not-today' | 'never'

export interface BackupSettings {
  folders: string[]
  autoDaily: boolean
  askOnExit: AskOnExit
  keepDays: number
  excelCopy: boolean
}

export interface BackupFile { name: string; path: string; bytes: number; createdAt: string; folder?: string }

export interface BackupSettingsView {
  success: boolean
  settings: BackupSettings
  folders: string[]
  defaultFolder: string
  suggestions: Array<{ label: string; path: string; kind: 'onedrive' | 'google-drive' | 'dropbox' | 'documents' }>
  maxFolders: number
  newest: BackupFile | null
  backups: BackupFile[]
}

type Result<T = object> = Promise<({ success: true } & T) | { success: false; error?: string; cancelled?: boolean }>

export interface OfflineBridge {
  me(): Result<{ user: OfflineUser }>
  users(): Result<{ users: OfflineUser[] }>
  setUserPin(userId: string, pin: string): Result
  changeMyPin(currentPin: string, nextPin: string): Result
  checkPinFormat(pin: string): Promise<{ error: string | null }>
  licence(): Promise<{ success: true; info: OfflineLicence; graceDays: number; version: string }>
  renewLicence(block: string): Result<{ info: OfflineLicence }>
  backupSettings(): Promise<BackupSettingsView>
  saveBackupSettings(next: Partial<BackupSettings>): Result<{ settings: BackupSettings }>
  chooseFolder(): Promise<string | null>
  chooseBackupFile(): Promise<string | null>
  backupNow(): Result<{ filePath: string; totalRows: number; written: string[]; failed: Array<{ folder: string; error: string }> }>
  restore(filePath: string): Result<{ totalRows: number }>
  exportExcel(all?: boolean): Result<{ filePath: string; totalRows: number }>
  openFolder(dir: string): Promise<string>
  /** Back to the desktop's PIN screen (the web has signed out). */
  returnToPin(): Promise<void>
  onBackupTaken(cb: (e: { at: string; written: string[]; failed: Array<{ folder: string; error: string }> }) => void): () => void
}

/** The offline edition's bridge, or null everywhere else. */
export function offlineBridge(): OfflineBridge | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { __JAINERP_OFFLINE__?: boolean; electronAPI?: { offline?: OfflineBridge } }
  return w.__JAINERP_OFFLINE__ && w.electronAPI?.offline ? w.electronAPI.offline : null
}

export const isOfflineDesktop = (): boolean => offlineBridge() !== null

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

export function errText(r: { success: boolean; error?: string }, fallback: string): string {
  return ('error' in r && r.error) || fallback
}
