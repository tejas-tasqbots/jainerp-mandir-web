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
type Result = {
  success: boolean; direct?: boolean; reason?: string; error?: string; filePath?: string; printer?: string
  /** 2.7.7+: why direct printing did not run, when it was on and the driver printed instead. */
  directError?: string
}
type ImageMode = 'gsv0' | 'escstar'
type CutMode = 'gsv66' | 'gsv1' | 'escm' | 'none'
type Bridge = {
  getPrinters?: () => Promise<{ printers: PrinterInfo[]; receiptPrinter: string | null; documentPrinter: string | null; rawThermal?: boolean; rawImage?: ImageMode; rawCut?: CutMode }>
  setPrinter?: (kind: 'receipt' | 'document', name: string | null) => Promise<{ success: boolean }>
  /** Desktop 2.7.6+: direct thermal printing, and the sale print path that honours it. */
  setRawThermal?: (on: boolean) => Promise<{ success: boolean }>
  printRoll?: (docs: string[], combined: string) => Promise<Result>
  /** Desktop 2.7.7+: the printer check strip, and the two answers it gives. */
  rawCheck?: (widthMm?: number) => Promise<{ success: boolean; printer?: string; error?: string }>
  setRawOptions?: (image: ImageMode, cut: CutMode) => Promise<{ success: boolean }>
  /** Desktop 2.7.8+: the last prints on this computer, direct or driver and why. */
  getPrintLog?: () => Promise<string[]>
  printHtml?: (html: string) => Promise<Result>
  printHtmlBatch?: (htmls: string[]) => Promise<Result[]>
  openPath?: (p: string) => Promise<string>
}

export function DesktopPrintersCard({ testDocs, rollWidthMm }: {
  /** The trust's slip roll width (58 / 80 / 112), for the printer check strip. */
  rollWidthMm?: number
  /**
   * The documents a test print sends: for the receipt printer a three-token
   * sale, as one document per token when per-plate tokens are on (each is its
   * own print job, so the cutter cuts between them) or one slip when off; for
   * the document printer, one A4/A5 receipt.
   */
  testDocs: (kind: 'receipt' | 'document') => { docs: string[]; combined: string }
}) {
  const { t } = useTranslation()
  const bridge = (typeof window !== 'undefined' ? window.electronAPI : undefined) as Bridge | undefined
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null)
  const [chosen, setChosen] = useState<{ receipt: string; document: string }>({ receipt: '', document: '' })
  const [result, setResult] = useState<{ kind: 'receipt' | 'document'; text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState<'receipt' | 'document' | null>(null)
  const [rawThermal, setRawThermal] = useState(false)
  const [rawImage, setRawImage] = useState<ImageMode>('gsv0')
  const [rawCut, setRawCut] = useState<CutMode>('gsv66')
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null)
  const [log, setLog] = useState<string[] | null>(null)

  useEffect(() => {
    if (!bridge?.getPrinters) return
    let live = true
    bridge.getPrinters().then((r) => {
      if (!live) return
      setPrinters(r.printers)
      setChosen({ receipt: r.receiptPrinter ?? '', document: r.documentPrinter ?? '' })
      setRawThermal(!!r.rawThermal)
      if (r.rawImage) setRawImage(r.rawImage)
      if (r.rawCut) setRawCut(r.rawCut)
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
      // One job per document, exactly as printReceiptDocuments does at the
      // counter — through the same batch call when the desktop has it, so the
      // test shows the counter's real speed as well as its real output.
      const { docs, combined } = testDocs(kind)
      const results: Result[] = []
      // The receipt test goes the way a sale goes (printReceiptDocuments):
      // printRoll on a desktop that has it, so direct thermal printing is what
      // gets tested when it is on.
      if (kind === 'receipt' && bridge.printRoll) results.push(await bridge.printRoll(docs, combined))
      else if (docs.length > 1 && bridge.printHtmlBatch) results.push(...await bridge.printHtmlBatch(docs))
      else for (const doc of docs) results.push(await bridge.printHtml(doc))
      const failed = results.find((r) => !r.success)
      const printer = results.find((r) => r.printer)?.printer ?? ''
      if (!failed) {
        // Direct printing was on but did not run: say so, and why - the
        // silent fallback is what made "it doesn't cut" impossible to read.
        const skipped = results.find((r) => r.directError)?.directError
        const text = kind === 'receipt' && skipped
          ? t('settings.printers.directSkipped', { reason: skipped, printer: printer || '—' })
          : kind === 'receipt' && results.some((r) => r.direct)
          ? t('settings.printers.testSentDirect', { count: docs.length, printer: printer || chosen.receipt || systemDefault || '—' })
          : kind === 'receipt' && docs.length > 1
          ? t('settings.printers.testSentTokens', { count: docs.length, printer })
          : kind === 'receipt'
            ? `${t('settings.printers.testSent', { printer })} ${t('settings.printers.onePerSale')}`
            : t('settings.printers.testSent', { printer })
        setResult({ kind, ok: !skipped, text })
      } else {
        setResult({ kind, ok: false, text: t('settings.printers.testFailed', { printer: failed.printer ?? '—', reason: failed.reason ?? failed.error ?? '' }) })
        // Only the first fallback PDF: three tokens failing should not open three windows.
        if (failed.filePath) void bridge.openPath?.(failed.filePath)
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
        {row('receipt', t('settings.printers.receipt'), `${t('settings.printers.receiptHint')} ${t('settings.printers.receiptTestHint')}`)}
        {bridge.setRawThermal && (
          <label className="flex items-start gap-2 cursor-pointer" data-testid="printer-raw-thermal">
            <input type="checkbox" className="mt-0.5" checked={rawThermal}
              onChange={(e) => { const on = e.target.checked; setRawThermal(on); setResult(null); void bridge.setRawThermal!(on) }} />
            <span>
              <span className="text-sm font-medium">{t('settings.printers.rawThermal')}</span>
              <span className="block text-xs text-slate-500">{t('settings.printers.rawThermalHint')}</span>
            </span>
          </label>
        )}
        {/* Which picture and which cut THIS printer understands. Reported
            2026-09-28 from a counter (PSF-307, 58 mm): direct printing fed a
            BLANK token and did not cut - its printer did not know the default
            picture command. The check strip answers both questions on paper. */}
        {rawThermal && bridge.rawCheck && bridge.setRawOptions && (
          <div className="ml-6 space-y-2 rounded-lg border border-slate-200 p-3" data-testid="printer-raw-options">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary btn-sm" data-testid="printer-raw-check"
                disabled={busy !== null} onClick={async () => {
                  setCheck(null)
                  const r = await bridge.rawCheck!(rollWidthMm).catch((e) => ({ success: false, error: String(e) }))
                  setCheck(r.success
                    ? { ok: true, text: t('settings.printers.checkSent', { printer: (r as { printer?: string }).printer ?? '—' }) }
                    : { ok: false, text: t('settings.printers.checkFailed', { reason: (r as { error?: string }).error ?? '' }) })
                }}>
                <Printer size={13} /> {t('settings.printers.checkPrint')}
              </button>
              <span className="text-xs text-slate-500">{t('settings.printers.checkHint')}</span>
            </div>
            {check && <p className={`text-xs ${check.ok ? 'text-emerald-700' : 'text-amber-800'}`} data-testid="printer-raw-check-result">{check.text}</p>}
            <div className="flex flex-wrap gap-3">
              <label className="text-xs">
                <span className="block text-slate-600 mb-1">{t('settings.printers.imageMode')}</span>
                <select className="form-select" value={rawImage} data-testid="printer-raw-image"
                  onChange={(e) => { const v = e.target.value as ImageMode; setRawImage(v); void bridge.setRawOptions!(v, rawCut) }}>
                  <option value="gsv0">{t('settings.printers.imageB')}</option>
                  <option value="escstar">{t('settings.printers.imageC')}</option>
                </select>
              </label>
              <label className="text-xs">
                <span className="block text-slate-600 mb-1">{t('settings.printers.cutMode')}</span>
                <select className="form-select" value={rawCut} data-testid="printer-raw-cut"
                  onChange={(e) => { const v = e.target.value as CutMode; setRawCut(v); void bridge.setRawOptions!(rawImage, v) }}>
                  <option value="gsv66">{t('settings.printers.cutD')}</option>
                  <option value="gsv1">{t('settings.printers.cutE')}</option>
                  <option value="escm">{t('settings.printers.cutF')}</option>
                  <option value="none">{t('settings.printers.cutNone')}</option>
                </select>
              </label>
            </div>
          </div>
        )}
        {row('document', t('settings.printers.document'), t('settings.printers.documentHint'))}
        {/* What the last prints on this computer actually did - direct or
            through the driver, and why. Asked for after "test print cuts, the
            counter's 6 tokens do not" could not be told apart remotely. */}
        {bridge.getPrintLog && (
          <div className="space-y-1.5" data-testid="printer-log">
            <button type="button" className="btn-secondary btn-sm"
              onClick={async () => setLog(await bridge.getPrintLog!().catch(() => []))}>
              {t('settings.printers.recentPrints')}
            </button>
            {log && (
              <pre className="text-[11px] leading-snug bg-slate-50 border border-slate-200 rounded p-2 whitespace-pre-wrap max-h-60 overflow-auto">
                {log.length ? log.slice().reverse().join('\n') : t('settings.printers.noPrintsYet')}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
