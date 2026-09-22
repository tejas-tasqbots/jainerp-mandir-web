import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'

/**
 * Which printer this computer sends receipts to. Desktop app only.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Reported from a client's counter: "in desktop when I print using the print
 * token button it is giving the blank pages". The desktop printed silently to
 * Windows' DEFAULT printer — on one counter PC we looked at that was
 * "Microsoft Print to PDF", and the office A4 printer beside it was set to US
 * Letter — with no page size, which is how a receipt printer ends up feeding
 * blank paper. The desktop now names the printer and sends the exact page
 * (see mandiradmin-desktop/electron/print-geometry.ts); this is where a trust
 * says which printer that is, and checks it with one test print.
 *
 * The choice is stored on THIS computer (the desktop's own config), not on the
 * trust: two counters of one temple have different printers.
 *
 * Renders nothing in a browser, or under a desktop older than the printer
 * bridge.
 */

type PrinterInfo = { name: string; displayName: string; isDefault: boolean }
type Result = { success: boolean; reason?: string; error?: string; filePath?: string; printer?: string }
type Bridge = {
  getPrinters?: () => Promise<{ printers: PrinterInfo[]; receiptPrinter: string | null; documentPrinter: string | null }>
  setPrinter?: (kind: 'receipt' | 'document', name: string | null) => Promise<{ success: boolean }>
  printHtml?: (html: string) => Promise<Result>
  openPath?: (p: string) => Promise<string>
}

export function DesktopPrintersCard({ testHtml }: {
  /** A sample document for a test print: a roll slip, or an A4/A5 receipt. */
  testHtml: (kind: 'receipt' | 'document') => string
}) {
  const { t } = useTranslation()
  const bridge = (typeof window !== 'undefined' ? window.electronAPI : undefined) as Bridge | undefined
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null)
  const [chosen, setChosen] = useState<{ receipt: string; document: string }>({ receipt: '', document: '' })
  const [result, setResult] = useState<{ kind: 'receipt' | 'document'; text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState<'receipt' | 'document' | null>(null)

  useEffect(() => {
    if (!bridge?.getPrinters) return
    let live = true
    bridge.getPrinters().then((r) => {
      if (!live) return
      setPrinters(r.printers)
      setChosen({ receipt: r.receiptPrinter ?? '', document: r.documentPrinter ?? '' })
    }).catch(() => setPrinters([]))
    return () => { live = false }
  }, [bridge])

  if (!bridge?.getPrinters || !bridge.setPrinter) return null
  const systemDefault = printers?.find((p) => p.isDefault)?.displayName

  async function choose(kind: 'receipt' | 'document', name: string) {
    setChosen((c) => ({ ...c, [kind]: name }))
    setResult(null)
    await bridge!.setPrinter!(kind, name || null)
  }

  async function test(kind: 'receipt' | 'document') {
    if (!bridge?.printHtml) return
    setBusy(kind)
    setResult(null)
    try {
      const r = await bridge.printHtml(testHtml(kind))
      if (r.success) {
        setResult({ kind, ok: true, text: t('settings.printers.testSent', { printer: r.printer ?? '' }) })
      } else {
        setResult({ kind, ok: false, text: t('settings.printers.testFailed', { printer: r.printer ?? '—', reason: r.reason ?? r.error ?? '' }) })
        if (r.filePath) void bridge.openPath?.(r.filePath)
      }
    } catch (e) {
      setResult({ kind, ok: false, text: String(e) })
    } finally {
      setBusy(null)
    }
  }

  const row = (kind: 'receipt' | 'document', label: string, hint: string) => (
    <div className="space-y-1.5">
      <label className="form-label" htmlFor={`printer-${kind}`}>{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <select id={`printer-${kind}`} className="form-select flex-1 min-w-[220px]" value={chosen[kind]}
          data-testid={`printer-${kind}`} disabled={!printers}
          onChange={(e) => void choose(kind, e.target.value)}>
          <option value="">{t('settings.printers.systemDefault', { name: systemDefault ?? '—' })}</option>
          {(printers ?? []).map((p) => <option key={p.name} value={p.name}>{p.displayName}</option>)}
        </select>
        <button type="button" className="btn-secondary btn-sm" data-testid={`printer-test-${kind}`}
          disabled={busy !== null} onClick={() => void test(kind)}>
          <Printer size={13} /> {busy === kind ? t('settings.printers.testing') : t('settings.printers.testPrint')}
        </button>
      </div>
      <p className="text-xs text-slate-500">{hint}</p>
      {result?.kind === kind && (
        <p className={`text-xs ${result.ok ? 'text-emerald-700' : 'text-amber-800'}`} data-testid={`printer-result-${kind}`}>
          {result.text}
        </p>
      )}
    </div>
  )

  return (
    <div className="card" data-testid="desktop-printers">
      <div className="card-header">
        <h3 className="font-semibold text-sm">{t('settings.printers.title')}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{t('settings.printers.subtitle')}</p>
      </div>
      <div className="card-body space-y-4">
        {row('receipt', t('settings.printers.receipt'), t('settings.printers.receiptHint'))}
        {row('document', t('settings.printers.document'), t('settings.printers.documentHint'))}
      </div>
    </div>
  )
}
