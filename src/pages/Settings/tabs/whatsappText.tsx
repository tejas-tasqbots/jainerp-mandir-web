import { Fragment, type ReactNode } from 'react'

/** WhatsApp's own formatting: *bold* and _italic_, newlines kept. */
function waText(text: string): ReactNode[] {
  return text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, i) => {
    if (/^\*[^*\n]+\*$/.test(part)) return <strong key={i}>{part.slice(1, -1)}</strong>
    if (/^_[^_\n]+_$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** A message as the recipient sees it: a WhatsApp bubble with header, body and footer. */
export function WhatsAppBubble({ header, body, footer, children }: { header?: string | null; body: string; footer?: string | null; children?: ReactNode }) {
  return (
    <div className="rounded-lg p-3" style={{ background: '#EFEAE2' }}>
      <div className="max-w-md bg-white rounded-lg shadow-sm overflow-hidden text-[13px] leading-relaxed text-slate-800">
        <div className="px-3 pt-2.5 pb-2">
          {header && <div className="font-semibold mb-1">{header}</div>}
          <div className="whitespace-pre-wrap">{waText(body)}</div>
          {footer && <div className="text-[11px] text-slate-400 mt-1.5">{footer}</div>}
        </div>
        {children}
      </div>
    </div>
  )
}
