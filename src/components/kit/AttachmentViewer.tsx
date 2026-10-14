import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Download, ExternalLink, FileText, Maximize2, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react'

/**
 * A payment screenshot, a bill photo or a PDF attached to an entry, as a data
 * URL. The thumbnail opens a full-screen viewer:
 *   - image: zoom (buttons, mouse wheel at the pointer, +/- keys, double-click,
 *     two-finger pinch), drag to pan, rotate, fit, download
 *   - PDF: the browser's own PDF viewer (it has its own zoom), open in a new
 *     tab, download
 * Opening a `data:` URL in a new tab is blocked by Chrome, so the viewer works
 * from a blob: URL made from the data.
 *
 * Not for guest ID documents: those are view-only on purpose (GuestIdDocuments
 * IdViewer draws them on a watermarked canvas with no download).
 */

const MIN = 0.2
const MAX = 8

function isPdf(src: string) {
  return src.startsWith('data:application/pdf')
}

function dataUrlToBlobUrl(src: string): string | null {
  const comma = src.indexOf(',')
  if (!src.startsWith('data:') || comma < 0) return null
  const mime = src.slice(5, src.indexOf(';'))
  try {
    const bin = atob(src.slice(comma + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: mime }))
  } catch {
    return null
  }
}

function extFor(src: string) {
  if (isPdf(src)) return 'pdf'
  const m = /^data:image\/(\w+)/.exec(src)
  return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'bin'
}

/** Clickable preview; opens the viewer. */
export function AttachmentThumb({ src, alt, fileName, className = '' }: { src: string; alt: string; fileName?: string; className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      {isPdf(src) ? (
        <button type="button" onClick={() => setOpen(true)}
          className={`w-full flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100 ${className}`}>
          <FileText size={28} className="text-red-600 flex-shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-slate-800">{t('attachment.pdf')}</span>
            <span className="block text-xs text-slate-500">{t('attachment.clickToOpen')}</span>
          </span>
          <Maximize2 size={16} className="text-slate-400" />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} title={t('attachment.clickToZoom')}
          className={`group relative block w-full cursor-zoom-in ${className}`}>
          <img src={src} alt={alt} className="w-full rounded-lg border border-slate-200" />
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2.5 py-1 text-xs text-white opacity-90 group-hover:opacity-100">
            <ZoomIn size={13} /> {t('attachment.clickToZoom')}
          </span>
        </button>
      )}
      {open && <AttachmentViewer src={src} alt={alt} fileName={fileName} onClose={() => setOpen(false)} />}
    </>
  )
}

export function AttachmentViewer({ src, alt, fileName, onClose }: { src: string; alt: string; fileName?: string; onClose: () => void }) {
  const { t } = useTranslation()
  const pdf = isPdf(src)
  const blobUrl = useMemo(() => dataUrlToBlobUrl(src), [src])
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])

  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [rot, setRot] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const pinch = useRef<{ dist: number; scale: number } | null>(null)

  // The live values, so the zoom maths never reads a stale render.
  const scaleRef = useRef(1)
  const posRef = useRef({ x: 0, y: 0 })
  const apply = useCallback((s: number, p: { x: number; y: number }) => {
    scaleRef.current = s; posRef.current = p
    setScale(s); setPos(p)
  }, [])
  const fit = useCallback(() => apply(1, { x: 0, y: 0 }), [apply])
  // Zoom keeping the point under (cx, cy) - relative to the stage centre - still.
  const zoomAt = useCallback((next: number, cx = 0, cy = 0) => {
    const s = Math.min(MAX, Math.max(MIN, next))
    const k = s / scaleRef.current
    const p = posRef.current
    apply(s, { x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k })
  }, [apply])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (pdf) return
      else if (e.key === '+' || e.key === '=') zoomAt(scaleRef.current * 1.25)
      else if (e.key === '-') zoomAt(scaleRef.current / 1.25)
      else if (e.key === '0') fit()
      else if (e.key.toLowerCase() === 'r') setRot(r => (r + 90) % 360)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, zoomAt, fit, pdf])

  const centre = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { cx: clientX - (r.left + r.width / 2), cy: clientY - (r.top + r.height / 2) }
  }
  const onWheel = (e: ReactWheelEvent) => {
    const { cx, cy } = centre(e.clientX, e.clientY)
    zoomAt(scaleRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), cx, cy)
  }
  const onPointerDown = (e: ReactPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: scaleRef.current }
      drag.current = null
    } else {
      drag.current = { x: e.clientX, y: e.clientY, px: posRef.current.x, py: posRef.current.y }
    }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const { cx, cy } = centre((a.x + b.x) / 2, (a.y + b.y) / 2)
      zoomAt(pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist), cx, cy)
    } else if (drag.current) {
      apply(scaleRef.current, { x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y })
    }
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) drag.current = null
  }

  const name = `${fileName || 'attachment'}.${extFor(src)}`
  const btn = 'inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20 disabled:opacity-40'

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950" role="dialog" aria-modal="true" aria-label={alt} data-attachment-viewer="">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-white/10">
        <span className="mr-auto truncate text-sm text-white/80">{alt}</span>
        {!pdf && (
          <>
            <button type="button" className={btn} onClick={() => zoomAt(scale / 1.25)} disabled={scale <= MIN} aria-label={t('attachment.zoomOut')} title={t('attachment.zoomOut')}><ZoomOut size={16} /></button>
            <span className="w-14 text-center text-sm tabular-nums text-white">{Math.round(scale * 100)}%</span>
            <button type="button" className={btn} onClick={() => zoomAt(scale * 1.25)} disabled={scale >= MAX} aria-label={t('attachment.zoomIn')} title={t('attachment.zoomIn')}><ZoomIn size={16} /></button>
            <button type="button" className={btn} onClick={fit} title={t('attachment.fit')}><Maximize2 size={16} /> <span className="hidden sm:inline">{t('attachment.fit')}</span></button>
            <button type="button" className={btn} onClick={() => setRot(r => (r + 90) % 360)} title={t('attachment.rotate')}><RotateCw size={16} /> <span className="hidden sm:inline">{t('attachment.rotate')}</span></button>
          </>
        )}
        {pdf && blobUrl && (
          <a className={btn} href={blobUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> {t('attachment.openNewTab')}</a>
        )}
        {blobUrl && <a className={btn} href={blobUrl} download={name}><Download size={16} /> {t('attachment.download')}</a>}
        <button type="button" className={btn} onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
      </div>
      {pdf ? (
        blobUrl
          ? <iframe src={blobUrl} title={alt} className="flex-1 w-full bg-white" />
          : <p className="m-auto text-white/80">{t('attachment.cannotOpen')}</p>
      ) : (
        <div ref={stageRef} className="relative flex-1 overflow-hidden touch-none select-none cursor-grab active:cursor-grabbing"
                    onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onDoubleClick={(e) => { const { cx, cy } = centre(e.clientX, e.clientY); if (scaleRef.current > 1.01) fit(); else zoomAt(2.5, cx, cy) }}>
          <img src={src} alt={alt} draggable={false}
            className="absolute left-1/2 top-1/2 max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)]"
            style={{ transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${scale}) rotate(${rot}deg)`, transformOrigin: 'center' }} />
          <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white/80">
            {t('attachment.hint')}
          </p>
        </div>
      )}
    </div>,
    document.body,
  )
}
