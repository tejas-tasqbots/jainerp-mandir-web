/**
 * Where a rendered receipt GOES: the print dialog, a PDF download, a share
 * sheet, the Electron shell — plus the UPI QR encoder, which is async and
 * browser-only.
 *
 * The designs themselves are in `receiptTemplates.ts` so that devotee-api can
 * render the trust's chosen one for the donor's PDF. Everything that file
 * exports is re-exported here, so the sixteen callers of this module are
 * unchanged.
 */

import { api } from './api'
import { buildReceiptHtml, type ReceiptData } from './receiptTemplates'

// The designs, re-exported: `printReceipt` stays the one import path.
export * from './receiptTemplates'

/**
 * UPI deep-link QR for the trust's UPI ID.
 *
 * Generated in the browser — nothing is fetched, so it works on the offline
 * desktop counter. Returns null only when the trust has no UPI ID, or has
 * deliberately turned the QR off.
 *
 * ── WHY IT IS OPT-OUT ───────────────────────────────────────────────────────
 * `receipt_show_upi_qr` used to be opt-IN and defaults to false, so a trust had
 * to find a checkbox in Settings before a single donor ever saw a QR: reported
 * as "on all receipts I need a QR of given UPI where payment details are
 * there". A trust that has typed a UPI id has already said it wants to be paid
 * that way.
 *
 * ── WHY THE AMOUNT IS USUALLY ABSENT ────────────────────────────────────────
 * `am` used to be the receipt total, unconditionally. On a SETTLED receipt —
 * which is most of them, since a receipt is what you get after paying — that is
 * a QR asking for money the donor has just handed over, and scanning it pays
 * twice. It now prefills ONLY what is still due. With nothing due the QR is
 * open-amount, which is what "scan to donate" means and what `qrCaption()` has
 * been saying in words all along.
 */
export async function buildUpiQr(r: ReceiptData): Promise<string | null> {
  const m = r.mandir
  if (!m?.upi_id || m.receipt_show_upi_qr === false) return null
  // What is still owed, if the document says. A room bill carries it in meta;
  // everything else is settled at the counter by definition.
  const meta = (r.meta ?? {}) as Record<string, unknown>
  const due = Math.max(0, Math.round(Number(meta.due_paise ?? 0)))
  const params = new URLSearchParams({
    pa: m.upi_id,
    pn: m.name,
    cu: 'INR',
    // The document, not "Donation" — a guest settling a dharamshala bill saw
    // "Donation ROOM/2026-27/000042" in their UPI app. Derived here rather than
    // from the renderer's `docTitle`/label table, which are module-private to it
    // on purpose: this note is one line of UPI metadata, not a printed label,
    // and reaching across for it would tie the print pipeline to the designs.
    tn: [r.doc_title || (r.kind === 'donation' ? 'Donation' : 'Payment'), r.receipt_number]
      .filter(Boolean).join(' ').trim(),
  })
  if (due > 0) params.set('am', (due / 100).toFixed(2))
  try {
    const QR = await import('qrcode')
    return await QR.toDataURL(`upi://pay?${params.toString()}`, { margin: 1, width: 220 })
  } catch {
    // A missing QR must never block the receipt itself.
    return null
  }
}
/** The desktop shell's bridge, when this is running inside Electron. */
interface DesktopPrintBridge {
  printHtml?: (html: string, opts?: { silent?: boolean }) => Promise<{
    success: boolean
    reason?: string
    error?: string
    filePath?: string
  }>
  openPath?: (filePath: string) => Promise<string>
}

function desktopBridge(): DesktopPrintBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { electronAPI?: DesktopPrintBridge }).electronAPI
}

/**
 * Render the receipt HTML and trigger print. Uses a hidden iframe (no popup,
 * so it is not blocked by popup blockers); falls back to a new tab if the
 * iframe approach is unavailable.
 *
 * ── ON THE DESKTOP BUILD THIS GOES THROUGH ELECTRON ─────────────────────────
 * `window.print()` never returns inside the Electron shell. The call blocks,
 * no print dialog ever appears, the cleanup below never runs and the iframe is
 * left in the DOM — so somebody at the counter saves a donation, sees nothing
 * happen, and the donor leaves without a receipt. There is no error to notice.
 * Confirmed against the unmodified shell: the donation was written to the
 * database correctly and the print simply went nowhere.
 *
 * The shell renders the document in its own window and prints it there, and
 * writes a PDF and opens it when there is no printer — a counter machine
 * frequently has none configured. The browser build is untouched.
 */
export function printReceiptHtml(html: string): void {
  const bridge = desktopBridge()
  if (bridge?.printHtml) {
    void bridge.printHtml(html).then((res) => {
      // Not an error worth interrupting anyone over: a cancelled print and an
      // absent printer look the same from here, and in both cases the PDF is
      // the useful outcome rather than a dialog saying something went wrong.
      if (!res?.success && res?.filePath) void bridge.openPath?.(res.filePath)
    }).catch(() => { /* the shell reports its own failures */ })
    return
  }

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) {
    // Fallback to popup
    const win = window.open('', '_blank', 'width=800,height=960')
    if (!win) { alert('Popup blocked. Please allow popups for this site and try again.'); return }
    win.document.write(html)
    win.document.close()
    document.body.removeChild(iframe)
    return
  }

  // Strip the auto-print script from the HTML; we drive print() from the iframe load.
  doc.open()
  doc.write(html.replace('<script>window.onload=()=>{window.print()}</script>', ''))
  doc.close()

  const cleanup = () => { setTimeout(() => { try { document.body.removeChild(iframe) } catch { /* noop */ } }, 1000) }
  iframe.contentWindow!.onafterprint = cleanup
  // Give the browser a tick to lay out before printing
  setTimeout(() => {
    iframe.contentWindow!.focus()
    iframe.contentWindow!.print()
    cleanup()
  }, 250)
}

/**
 * Fetch and print a receipt. Defaults to the donations endpoint; pass a
 * different `basePath` (e.g. '/seva-bookings') for other receipt-bearing
 * resources whose `/:id/receipt` returns a shape-compatible payload.
 */
export async function printDonationReceipt(id: string, basePath = '/donations'): Promise<void> {
  const receipt = await fetchReceipt(id, basePath)
  printReceiptHtml(buildReceiptHtml(receipt))
}

/** The fetch every print/download/share path shares, QR included. */
async function fetchReceipt(id: string, basePath: string): Promise<ReceiptData> {
  const { data } = await api.get(`${basePath}/${id}/receipt`)
  const receipt: ReceiptData = data.data
  receipt.upi_qr_data_uri = await buildUpiQr(receipt)
  return receipt
}

/**
 * Print a counter slip immediately, but only if the trust asked for that.
 *
 * ── WHY THE DECISION IS MADE HERE AND NOT AT THE COUNTER ────────────────────
 * `slip_auto_print` is a trust-level setting (Settings → Receipts → Counter
 * slips, tenant migration 032). The prasad, seva and bhojanshala screens should
 * not each fetch the profile to find out whether to print — that is three
 * copies of one rule, and the receipt payload already carries the answer.
 *
 * So this fetches the slip once, prints it if the flag is set, and otherwise
 * does nothing at all. The manual Print button stays on every screen: a
 * counter whose printer is out of paper still needs to be able to reprint.
 *
 * ── AND WHY IT SWALLOWS ITS ERRORS ──────────────────────────────────────────
 * The SALE is already recorded by the time this runs. A print failure must not
 * surface as a failed sale — the operator would void a good transaction and
 * take the money again. Returns false so the caller can mention it quietly if
 * it wants to.
 */
export async function autoPrintSlip(id: string, basePath: string): Promise<boolean> {
  try {
    const receipt = await fetchReceipt(id, basePath)
    if (!receipt.mandir?.slip_auto_print) return false
    printReceiptHtml(buildReceiptHtml(receipt))
    return true
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One-click PDF download / share (Vyapar / Khatabook style).
//
// Reuses the exact same receipt HTML + 9 templates as printing — the only
// difference is the output sink: instead of the browser print dialog we
// rasterize the rendered receipt and assemble an A4 PDF in the browser. This
// keeps everything 100% client-side (works offline on the desktop counter),
// with no server PDF worker. Heavy libs (html2canvas, jsPDF) are dynamically
// imported so they don't bloat the initial bundle.
// ─────────────────────────────────────────────────────────────────────────────

/** Paper sizes in mm. Mirrors PAPER_MM in receiptTemplates.ts. */
const PAPER = {
  a4: { width: 210, height: 297 },
  a5: { width: 148, height: 210 },
} as const

/**
 * Which paper a rendered document is for, and how much of it is printable.
 *
 * Read out of the document's own `@page` rule rather than passed in: the HTML
 * is the only thing these sinks receive, and `buildReceiptHtml` is the single
 * place that decides paper. A second copy of that decision here is a second
 * thing to get wrong — which is exactly how the download button came to
 * produce A4 for a trust set to A5.
 *
 * A thermal roll has no page box; it falls back to A4, because the download
 * button on a till-roll receipt is someone wanting a filable copy.
 */
function paperOf(html: string): { width: number; height: number; margin: number } {
  const rule = /@page\s*\{[^}]*?size:\s*(A4|A5)[^}]*?\}/i.exec(html)
  const size = PAPER[rule?.[1]?.toUpperCase() === 'A5' ? 'a5' : 'a4']
  const margin = Number(/@page\s*\{[^}]*?margin:\s*([\d.]+)mm/i.exec(html)?.[1] ?? 0)
  return { width: size.width, height: size.height, margin }
}

/** Render receipt HTML in a detached iframe and rasterize it to a canvas. */
async function renderHtmlToCanvas(html: string): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas')
  const paper = paperOf(html)

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  // As wide as the paper is printable, at 96dpi. Hardcoded to 794px (A4) it
  // laid every design out at A4 width and then squeezed the raster onto
  // whatever page jsPDF was making.
  iframe.style.width = `${Math.round(((paper.width - paper.margin * 2) / 25.4) * 96)}px`
  iframe.style.height = '10px'
  iframe.style.border = '0'
  iframe.style.background = '#fff'
  document.body.appendChild(iframe)

  try {
    const doc = iframe.contentWindow?.document
    if (!doc) throw new Error('Could not create render frame')
    // Drop the auto-print script — we only want layout, not a print dialog.
    // The "${L.printHint}" hint is only meant for someone
    // looking at the receipt on screen before printing; @media print already
    // hides it for real printing, but html2canvas rasterizes the live DOM and
    // ignores print-media rules, so without stripping it here it would end up
    // baked into every downloaded/shared PDF.
    doc.open()
    doc.write(
      html
        .replace('<script>window.onload=()=>{window.print()}</script>', '')
        .replace(/<div class="print-hint">.*?<\/div>/, ''),
    )
    doc.close()

    // Wait for fonts + images (logo) to settle before snapshotting.
    await (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready?.catch(() => {})
    await new Promise((r) => setTimeout(r, 350))

    // .sheet is the Anumodana template's page; every other template uses .page.
    const target = (doc.querySelector('.page, .sheet') as HTMLElement) || doc.body
    return await html2canvas(target, {
      scale: 2, // crisp text at print resolution
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: target.scrollWidth,
      windowHeight: target.scrollHeight,
    })
  } finally {
    setTimeout(() => { try { document.body.removeChild(iframe) } catch { /* noop */ } }, 100)
  }
}

/** Turn receipt HTML into a jsPDF document, paginating tall receipts across A4 pages. */
async function htmlToPdf(html: string): Promise<import('jspdf').jsPDF> {
  const { jsPDF } = await import('jspdf')
  const paper = paperOf(html)
  const canvas = await renderHtmlToCanvas(html)
  const pdf = new jsPDF({
    unit: 'mm',
    // The trust's paper, not always A4. A trust set to A5 downloaded an A4
    // file — the same receipt as the print, on the wrong sheet.
    format: paper.width === PAPER.a5.width ? 'a5' : 'a4',
    orientation: 'portrait',
  })

  // The page's own margin is honoured, so the download matches the print
  // rather than bleeding to the paper edge.
  const boxWidthMm = paper.width - paper.margin * 2;
  const boxHeightMm = paper.height - paper.margin * 2;
  const imgHeightMm = (canvas.height * boxWidthMm) / canvas.width;

  // ── ONE RECEIPT, ONE PAGE ─────────────────────────────────────────────────
  // The whole print rework rests on that guarantee, and this sink was the one
  // place it did not hold: anything taller than the page was SLICED, so a
  // receipt could arrive as two images cut through the middle of a line.
  // Scaling to fit is what the print path does geometrically and what
  // devotee-api's PDF service does by measurement — it just has to happen
  // here too.
  if (imgHeightMm > boxHeightMm) {
    const k = boxHeightMm / imgHeightMm;
    const w = boxWidthMm * k;
    pdf.addImage(
      canvas.toDataURL('image/png'), 'PNG',
      // Centred, since it no longer fills the width.
      paper.margin + (boxWidthMm - w) / 2, paper.margin, w, boxHeightMm,
    );
    return pdf;
  }
  pdf.addImage(
    canvas.toDataURL('image/png'), 'PNG',
    paper.margin, paper.margin, boxWidthMm, imgHeightMm,
  );
  return pdf
}

function safeFileName(receipt: ReceiptData): string {
  const num = (receipt.receipt_number || 'receipt').replace(/[\\/:*?"<>|]+/g, '-')
  return `Receipt-${num}.pdf`
}

/**
 * Build the receipt PDF and download it (one click, no print dialog).
 * Same templates/branding as printing — Vyapar-style "Download PDF".
 */
export async function downloadReceiptPdf(id: string, basePath = '/donations'): Promise<void> {
  const { data } = await api.get(`${basePath}/${id}/receipt`)
  const receipt: ReceiptData = data.data
  receipt.upi_qr_data_uri = await buildUpiQr(receipt)
  const pdf = await htmlToPdf(buildReceiptHtml(receipt))
  pdf.save(safeFileName(receipt))
}

/**
 * Share the receipt PDF via the native share sheet (WhatsApp / email / etc.)
 * where supported (mobile + some desktops). Falls back to a normal download
 * when the Web Share API can't share files.
 */
export async function shareReceiptPdf(id: string, basePath = '/donations'): Promise<void> {
  const { data } = await api.get(`${basePath}/${id}/receipt`)
  const receipt: ReceiptData = data.data
  receipt.upi_qr_data_uri = await buildUpiQr(receipt)
  const pdf = await htmlToPdf(buildReceiptHtml(receipt))
  const fileName = safeFileName(receipt)
  const blob = pdf.output('blob') as Blob

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean
    share?: (data: ShareData) => Promise<void>
  }
  const file = new File([blob], fileName, { type: 'application/pdf' })
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: `Receipt ${receipt.receipt_number}` })
      return
    } catch (e) {
      // user cancelled or share failed → fall through to download
      if ((e as DOMException)?.name === 'AbortError') return
    }
  }
  // Fallback: trigger a download of the same PDF.
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
