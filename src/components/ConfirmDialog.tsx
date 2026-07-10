import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react'
import { AlertTriangle, X } from 'lucide-react'

/**
 * In-app confirmation dialog replacing the browser's native window.confirm()
 * (which renders the ugly "app.jainerp.in says…" popup). Usage:
 *
 *   const confirm = useConfirm()
 *   if (!(await confirm({ message: 'Delete this entry?', confirmLabel: 'Delete', danger: true }))) return
 *
 * A single provider (mounted once in App) owns the modal; useConfirm() returns a
 * promise that resolves true/false when the user chooses.
 */
export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((o) => {
    const normalized: ConfirmOptions = typeof o === 'string' ? { message: o } : o
    setOpts(normalized)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const close = useCallback((result: boolean) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setOpts(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close(false)
            if (e.key === 'Enter') close(true)
          }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-start justify-between p-5 pb-3">
              <div className="flex items-center gap-3">
                {opts.danger && (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
                    <AlertTriangle size={18} className="text-red-600" />
                  </span>
                )}
                <h3 className="font-bold text-navy-900 text-base pt-1">{opts.title ?? 'Please confirm'}</h3>
              </div>
              <button type="button" onClick={() => close(false)} title="Close" aria-label="Close">
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <p className="px-5 text-sm text-slate-600 whitespace-pre-line">{opts.message}</p>
            <div className="flex justify-end gap-2 p-5 pt-4">
              <button type="button" className="btn-secondary" onClick={() => close(false)} autoFocus>
                {opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                className={opts.danger ? 'btn-danger' : 'btn-primary'}
                onClick={() => close(true)}
              >
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx
}
