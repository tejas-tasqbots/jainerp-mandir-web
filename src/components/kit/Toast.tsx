import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />,
  error: <AlertCircle size={16} className="text-red-600 flex-shrink-0" />,
  info: <Info size={16} className="text-blue-600 flex-shrink-0" />,
}

const BORDERS: Record<ToastKind, string> = {
  success: 'border-l-green-600',
  error: 'border-l-red-600',
  info: 'border-l-blue-600',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts(ts => ts.filter(t => t.id !== id))
  }, [])

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++
    setToasts(ts => [...ts.slice(-3), { id, kind, message }])
    // Errors stay longer — the user may need to read and act on them.
    window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000)
  }, [dismiss])

  const api = useRef<ToastApi>({
    success: m => push('success', m),
    error: m => push('error', m),
    info: m => push('info', m),
  })
  // Keep the stable ref pointing at the latest push.
  api.current.success = m => push('success', m)
  api.current.error = m => push('error', m)
  api.current.info = m => push('info', m)

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 no-print" aria-live="polite">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 bg-white border border-slate-200 border-l-4 ${BORDERS[toast.kind]} rounded-md shadow-lg px-3.5 py-2.5 max-w-sm text-sm text-slate-700 animate-[toast-in_.18s_ease-out]`}
            role={toast.kind === 'error' ? 'alert' : 'status'}
          >
            {ICONS[toast.kind]}
            <span className="flex-1 leading-snug">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="text-slate-300 hover:text-slate-500 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
