/**
 * VENDORED: byte-identical in devotee-api (src/receipts/receipt-document.ts)
 * and mandiradmin-web (src/lib/receiptDocument.ts), so the receipt a counter
 * prints on the "Anumodana" template is the receipt the donor's WhatsApp
 * button opens. `node qa/qa-comms-catalog.mjs` fails if the copies drift.
 *
 * The receipt a donor or devotee receives — as the PDF behind the WhatsApp
 * "Download receipt" button and as the page the devotee portal shows.
 *
 * ── WHY IT LOOKS THE WAY IT DOES ────────────────────────────────────────────
 * A temple receipt is kept, shown to family, filed with a CA. The old one was
 * an invoice with a coloured bar. This reads as a document from a Jain trust:
 * the "॥ जय जिनेन्द्र ॥" invocation traditional receipt books open with, the
 * trust's own colour as a double frame with a gold rule, the donor's name set
 * large, the amount in figures and words, and an anumodana line for a gift.
 *
 * A5 portrait: a phone shows the whole page without zooming (the WhatsApp
 * case), and it prints two-up or centred on A4 without rescaling.
 *
 * ── WHAT IT MUST NEVER DO ───────────────────────────────────────────────────
 * - Print an 80G certification for a gift that is not 80G-eligible, or for a
 *   trust with no 80G registration (`show_80g` is already gated by
 *   statutory-visibility; the eligibility check is here).
 * - Print a sale (prasad, bhojanshala) as a donation: `kind: 'sale'` drops the
 *   80G row and the anumodana line, and titles it as the sale it was.
 * - Trust its inputs: donor names, addresses and category names are typed by
 *   people, so everything is escaped.
 */

export type ReceiptLanguage = 'en' | 'hi' | 'mr' | 'gu' | 'kn' | 'ta' | 'te';

export interface ReceiptDocument {
  kind: 'donation' | 'sale';
  /** Overrides the localized "Donation Receipt" title (e.g. "Prasad Receipt"). */
  title?: string | null;
  receipt_number: string;
  date: string | Date;
  is_voided: boolean;
  donor: { name?: string | null; mobile?: string | null; pan?: string | null; address?: string | null };
  amount_paise: number;
  /** "Items" / "Meal" for a sale; the donation purpose otherwise. */
  detail_label?: string | null;
  category: string;
  payment_mode: string | null;
  is_80g_eligible: boolean;
  mandir: {
    name?: string | null;
    address?: string | null;
    mobile?: string | null;
    email?: string | null;
    pan?: string | null;
    gstin?: string | null;
    show_gstin?: boolean;
    reg_80g_number?: string | null;
    reg_80g_urn?: string | null;
    reg_80g_valid_upto?: string | Date | null;
    reg_12a_number?: string | null;
    reg_12ab_number?: string | null;
    show_80g?: boolean;
    upi_id?: string | null;
    bank_account_name?: string | null;
    bank_account_no?: string | null;
    bank_ifsc?: string | null;
    bank_name?: string | null;
    logo_cdn_url?: string | null;
    logo_base64?: string | null;
    show_logo?: boolean;
    footer?: string | null;
    primary_color?: string | null;
    receipt_language?: string | null;
  } | null;
}

interface Labels {
  donationReceipt: string;
  receiptNo: string;
  date: string;
  receivedFrom: string;
  soldTo: string;
  amount: string;
  amountInWords: string;
  purpose: string;
  paymentMode: string;
  eligible80g: string;
  yes: string;
  no: string;
  mobile: string;
  pan: string;
  anonymous: string;
  anumodana: string;
  thanks: string;
  certified80g: string;
  validUpto: string;
  bank: string;
  authorised: string;
  /** The line above the signature; {name} is the trust. Word order differs: "For X", "कृते X", "X करिता". */
  forTrust: string;
  computerGenerated: string;
  voided: string;
}

const LABELS: Record<ReceiptLanguage, Labels> = {
  en: {
    donationReceipt: 'Donation Receipt', receiptNo: 'Receipt No.', date: 'Date',
    receivedFrom: 'Received with gratitude from', soldTo: 'Received from', amount: 'Amount',
    amountInWords: 'In words', purpose: 'Purpose', paymentMode: 'Payment mode',
    eligible80g: '80G eligible', yes: 'Yes', no: 'No', mobile: 'Mobile', pan: 'PAN',
    anonymous: 'Anonymous devotee',
    anumodana: 'Heartfelt anumodana for your generous daan. May this punya karya bring sukh and shanti to you and your family.',
    thanks: 'Thank you. Jai Jinendra.',
    certified80g: 'Certified that this donation is eligible for deduction under Section 80G(5)(vi) of the Income-tax Act, 1961.',
    validUpto: 'Valid up to', bank: 'Bank', authorised: 'Authorised signatory', forTrust: 'For {name}',
    computerGenerated: 'This is a computer-generated receipt and does not need a physical signature.',
    voided: 'This receipt has been cancelled',
  },
  hi: {
    donationReceipt: 'दान रसीद', receiptNo: 'रसीद क्रमांक', date: 'दिनांक',
    receivedFrom: 'सादर प्राप्त', soldTo: 'प्राप्त', amount: 'राशि',
    amountInWords: 'शब्दों में', purpose: 'उद्देश्य', paymentMode: 'भुगतान माध्यम',
    eligible80g: '80G पात्र', yes: 'हाँ', no: 'नहीं', mobile: 'मोबाइल', pan: 'PAN',
    anonymous: 'गुप्त दानदाता',
    anumodana: 'आपके उदार दान की हार्दिक अनुमोदना। यह पुण्य कार्य आपके और आपके परिवार के जीवन में सुख-शांति लाए।',
    thanks: 'धन्यवाद। जय जिनेन्द्र।',
    certified80g: 'प्रमाणित किया जाता है कि यह दान आयकर अधिनियम, 1961 की धारा 80G(5)(vi) के अंतर्गत कटौती हेतु पात्र है।',
    validUpto: 'वैधता', bank: 'बैंक', authorised: 'अधिकृत हस्ताक्षरकर्ता', forTrust: 'कृते {name}',
    computerGenerated: 'यह कंप्यूटर द्वारा तैयार की गई रसीद है, इस पर हस्ताक्षर आवश्यक नहीं है।',
    voided: 'यह रसीद निरस्त कर दी गई है',
  },
  mr: {
    donationReceipt: 'दान पावती', receiptNo: 'पावती क्रमांक', date: 'दिनांक',
    receivedFrom: 'सादर प्राप्त', soldTo: 'प्राप्त', amount: 'रक्कम',
    amountInWords: 'अक्षरी', purpose: 'उद्देश', paymentMode: 'भरणा प्रकार',
    eligible80g: '80G पात्र', yes: 'होय', no: 'नाही', mobile: 'मोबाइल', pan: 'PAN',
    anonymous: 'गुप्त दाता',
    anumodana: 'आपल्या उदार दानाची हार्दिक अनुमोदना. हे पुण्यकार्य आपल्या व आपल्या कुटुंबाच्या जीवनात सुख-शांती आणो.',
    thanks: 'धन्यवाद. जय जिनेंद्र.',
    certified80g: 'प्रमाणित करण्यात येते की हे दान आयकर अधिनियम, 1961 च्या कलम 80G(5)(vi) अंतर्गत वजावटीस पात्र आहे.',
    validUpto: 'वैधता', bank: 'बँक', authorised: 'अधिकृत स्वाक्षरीकर्ता', forTrust: '{name} करिता',
    computerGenerated: 'ही संगणकाद्वारे तयार केलेली पावती आहे, यावर स्वाक्षरीची आवश्यकता नाही.',
    voided: 'ही पावती रद्द करण्यात आली आहे',
  },
  gu: {
    donationReceipt: 'દાન પાવતી', receiptNo: 'પાવતી નંબર', date: 'તારીખ',
    receivedFrom: 'સાદર પ્રાપ્ત', soldTo: 'પ્રાપ્ત', amount: 'રકમ',
    amountInWords: 'શબ્દોમાં', purpose: 'હેતુ', paymentMode: 'ચુકવણી પદ્ધતિ',
    eligible80g: '80G પાત્ર', yes: 'હા', no: 'ના', mobile: 'મોબાઇલ', pan: 'PAN',
    anonymous: 'ગુપ્ત દાતા',
    anumodana: 'આપના ઉદાર દાનની હાર્દિક અનુમોદના. આ પુણ્ય કાર્ય આપના અને આપના પરિવારના જીવનમાં સુખ-શાંતિ લાવે.',
    thanks: 'આભાર. જય જિનેન્દ્ર.',
    certified80g: 'પ્રમાણિત કરવામાં આવે છે કે આ દાન આવકવેરા અધિનિયમ, 1961 ની કલમ 80G(5)(vi) હેઠળ કપાત માટે પાત્ર છે.',
    validUpto: 'માન્યતા', bank: 'બેંક', authorised: 'અધિકૃત સહીકર્તા', forTrust: '{name} વતી',
    computerGenerated: 'આ કમ્પ્યુટર દ્વારા તૈયાર કરેલી પાવતી છે, તેના પર સહીની જરૂર નથી.',
    voided: 'આ પાવતી રદ કરવામાં આવી છે',
  },
  kn: {
    donationReceipt: 'ದಾನ ರಶೀದಿ', receiptNo: 'ರಶೀದಿ ಸಂಖ್ಯೆ', date: 'ದಿನಾಂಕ',
    receivedFrom: 'ಕೃತಜ್ಞತೆಯಿಂದ ಸ್ವೀಕರಿಸಲಾಗಿದೆ', soldTo: 'ಇವರಿಂದ ಸ್ವೀಕರಿಸಲಾಗಿದೆ', amount: 'ಮೊತ್ತ',
    amountInWords: 'ಅಕ್ಷರಗಳಲ್ಲಿ', purpose: 'ಉದ್ದೇಶ', paymentMode: 'ಪಾವತಿ ವಿಧಾನ',
    eligible80g: '80G ಅರ್ಹ', yes: 'ಹೌದು', no: 'ಇಲ್ಲ', mobile: 'ಮೊಬೈಲ್', pan: 'PAN',
    anonymous: 'ಗುಪ್ತ ದಾನಿ',
    anumodana: 'ನಿಮ್ಮ ಉದಾರ ದಾನಕ್ಕೆ ಹೃತ್ಪೂರ್ವಕ ಅನುಮೋದನೆ. ಈ ಪುಣ್ಯ ಕಾರ್ಯ ನಿಮ್ಮ ಮತ್ತು ನಿಮ್ಮ ಕುಟುಂಬದ ಜೀವನದಲ್ಲಿ ಸುಖ-ಶಾಂತಿ ತರಲಿ.',
    thanks: 'ಧನ್ಯವಾದಗಳು. ಜೈ ಜಿನೇಂದ್ರ.',
    certified80g: 'ಈ ದಾನವು ಆದಾಯ ತೆರಿಗೆ ಕಾಯ್ದೆ, 1961 ರ ಸೆಕ್ಷನ್ 80G(5)(vi) ಅಡಿಯಲ್ಲಿ ಕಡಿತಕ್ಕೆ ಅರ್ಹವಾಗಿದೆ ಎಂದು ಪ್ರಮಾಣೀಕರಿಸಲಾಗಿದೆ.',
    validUpto: 'ಮಾನ್ಯತೆ', bank: 'ಬ್ಯಾಂಕ್', authorised: 'ಅಧಿಕೃತ ಸಹಿದಾರರು', forTrust: '{name} ಪರವಾಗಿ',
    computerGenerated: 'ಇದು ಕಂಪ್ಯೂಟರ್‌ನಿಂದ ರಚಿಸಲಾದ ರಶೀದಿ, ಇದಕ್ಕೆ ಸಹಿಯ ಅಗತ್ಯವಿಲ್ಲ.',
    voided: 'ಈ ರಶೀದಿಯನ್ನು ರದ್ದುಪಡಿಸಲಾಗಿದೆ',
  },
  ta: {
    donationReceipt: 'நன்கொடை ரசீது', receiptNo: 'ரசீது எண்', date: 'தேதி',
    receivedFrom: 'நன்றியுடன் பெறப்பட்டது', soldTo: 'பெறப்பட்டது', amount: 'தொகை',
    amountInWords: 'எழுத்தில்', purpose: 'நோக்கம்', paymentMode: 'செலுத்தும் முறை',
    eligible80g: '80G தகுதி', yes: 'ஆம்', no: 'இல்லை', mobile: 'மொபைல்', pan: 'PAN',
    anonymous: 'பெயர் குறிப்பிடாத நன்கொடையாளர்',
    anumodana: 'உங்கள் தாராள நன்கொடைக்கு மனமார்ந்த அனுமோதனை. இந்தப் புண்ணிய காரியம் உங்களுக்கும் உங்கள் குடும்பத்திற்கும் சுகமும் சாந்தியும் அளிக்கட்டும்.',
    thanks: 'நன்றி. ஜெய் ஜினேந்திரா.',
    certified80g: 'இந்த நன்கொடை வருமான வரிச் சட்டம், 1961 பிரிவு 80G(5)(vi) இன் கீழ் கழிவுக்குத் தகுதியானது எனச் சான்றளிக்கப்படுகிறது.',
    validUpto: 'செல்லுபடி', bank: 'வங்கி', authorised: 'அங்கீகரிக்கப்பட்ட கையொப்பமிடுபவர்', forTrust: '{name} சார்பாக',
    computerGenerated: 'இது கணினியால் உருவாக்கப்பட்ட ரசீது; கையொப்பம் தேவையில்லை.',
    voided: 'இந்த ரசீது ரத்து செய்யப்பட்டது',
  },
  te: {
    donationReceipt: 'విరాళ రసీదు', receiptNo: 'రసీదు సంఖ్య', date: 'తేదీ',
    receivedFrom: 'కృతజ్ఞతతో స్వీకరించబడింది', soldTo: 'స్వీకరించబడింది', amount: 'మొత్తం',
    amountInWords: 'అక్షరాలలో', purpose: 'ఉద్దేశ్యం', paymentMode: 'చెల్లింపు విధానం',
    eligible80g: '80G అర్హత', yes: 'అవును', no: 'కాదు', mobile: 'మొబైల్', pan: 'PAN',
    anonymous: 'గుప్త దాత',
    anumodana: 'మీ ఉదార విరాళానికి హృదయపూర్వక అనుమోదన. ఈ పుణ్య కార్యం మీకు, మీ కుటుంబానికి సుఖశాంతులు ప్రసాదించాలి.',
    thanks: 'ధన్యవాదాలు. జై జినేంద్ర.',
    certified80g: 'ఈ విరాళం ఆదాయపు పన్ను చట్టం, 1961 లోని సెక్షన్ 80G(5)(vi) కింద మినహాయింపుకు అర్హమైనదని ధృవీకరించబడింది.',
    validUpto: 'చెల్లుబాటు', bank: 'బ్యాంక్', authorised: 'అధీకృత సంతకందారు', forTrust: '{name} తరఫున',
    computerGenerated: 'ఇది కంప్యూటర్ ద్వారా రూపొందించిన రసీదు; దీనిపై సంతకం అవసరం లేదు.',
    voided: 'ఈ రసీదు రద్దు చేయబడింది',
  },
};

const MODES: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', cheque: 'Cheque', netbanking: 'Net Banking', neft: 'NEFT', rtgs: 'RTGS',
  dd: 'Demand Draft', online: 'Online', razorpay: 'Online (Razorpay)', card: 'Card',
};

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A colour the trust typed is interpolated into CSS, so only a hex colour gets through. */
function safeColor(v: string | null | undefined): string {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v ?? '') ? String(v) : '#7A1F1F';
}

function rupees(paise: number): string {
  const n = Number(paise) / 100;
  const whole = Number.isFinite(n) && Math.round(n * 100) % 100 === 0;
  return (Number.isFinite(n) ? n : 0).toLocaleString('en-IN', {
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
  });
}

export function amountInWords(paise: number): string {
  if (!Number.isFinite(paise)) return 'Zero Rupees Only';
  const r = Math.floor(paise / 100);
  const p = Math.round(paise % 100);
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
    'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const words = (n: number): string => {
    if (n === 0) return '';
    if (n < 20) return `${ones[n]} `;
    if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''} `;
    if (n < 1000) return `${ones[Math.floor(n / 100)]} Hundred ${words(n % 100)}`;
    if (n < 100000) return `${words(Math.floor(n / 1000))}Thousand ${words(n % 1000)}`;
    if (n < 10000000) return `${words(Math.floor(n / 100000))}Lakh ${words(n % 100000)}`;
    return `${words(Math.floor(n / 10000000))}Crore ${words(n % 10000000)}`;
  };
  const main = words(r).trim() || 'Zero';
  const paisa = p ? ` and ${words(p).trim()} Paise` : '';
  return `${main} Rupees${paisa} Only`;
}

/** A small lotus — the one ornament, drawn inline so the PDF needs nothing fetched. */
function lotus(color: string, size = 26): string {
  return `<svg width="${size}" height="${Math.round(size * 0.62)}" viewBox="0 0 64 40" aria-hidden="true">
    <g fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round">
      <path d="M32 4c6 8 7 18 0 30c-7-12-6-22 0-30z"/>
      <path d="M32 34c-4-9-12-16-24-17c2 11 11 17 24 17z"/>
      <path d="M32 34c4-9 12-16 24-17c-2 11-11 17-24 17z"/>
      <path d="M6 36h52" stroke-linecap="round"/>
    </g></svg>`;
}

export function receiptLanguage(value: unknown): ReceiptLanguage {
  // hasOwnProperty, not `in`: 'constructor' in LABELS is true.
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LABELS, value) ? (value as ReceiptLanguage) : 'en';
}

/**
 * The receipt as its two halves — styles and markup — for a caller that wraps
 * them in a page of its own (mandiradmin-web's print/download pipeline).
 */
export function receiptParts(r: ReceiptDocument): { lang: ReceiptLanguage; title: string; css: string; body: string } {
  const m = r.mandir ?? {};
  const L = LABELS[receiptLanguage(m.receipt_language)];
  const color = safeColor(m.primary_color);
  const gold = '#B8862B';
  const donation = r.kind === 'donation';
  const title = r.title || L.donationReceipt;
  const date = new Date(r.date);
  const dateStr = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const logo = m.show_logo ? (m.logo_base64 || m.logo_cdn_url) : null;
  const logoTag = logo && /^(data:image\/|https:\/\/)/.test(logo) ? `<img class="logo" src="${esc(logo)}" alt="" />` : '';

  const regs: string[] = [];
  if (m.pan) regs.push(`PAN ${esc(m.pan)}`);
  if (m.show_80g && m.reg_80g_number) regs.push(`80G ${esc(m.reg_80g_number)}`);
  if (m.show_80g && (m.reg_12ab_number || m.reg_12a_number)) regs.push(`12A ${esc(m.reg_12ab_number || m.reg_12a_number)}`);
  if (m.show_gstin && m.gstin) regs.push(`GSTIN ${esc(m.gstin)}`);

  const contact = [m.mobile, m.email].filter(Boolean).map(esc).join(' · ');
  const donorBits = [
    r.donor?.mobile ? `${L.mobile} ${esc(r.donor.mobile)}` : '',
    r.donor?.pan ? `${L.pan} ${esc(r.donor.pan)}` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const mode = r.payment_mode ? (MODES[r.payment_mode] ?? esc(r.payment_mode)) : '—';

  const show80gCert = donation && r.is_80g_eligible && m.show_80g && m.reg_80g_number;
  const validUpto = m.reg_80g_valid_upto ? new Date(m.reg_80g_valid_upto) : null;
  const pay: string[] = [];
  if (m.upi_id) pay.push(`UPI <b>${esc(m.upi_id)}</b>`);
  if (m.bank_account_no) {
    pay.push(`${L.bank} <b>${esc([m.bank_name, m.bank_account_no, m.bank_ifsc].filter(Boolean).join(' · '))}</b>`);
  }

  const css = `
  @page { size: A5 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Gujarati', 'Noto Sans Kannada',
      'Noto Sans Tamil', 'Noto Sans Telugu', 'Nirmala UI', 'Segoe UI', Arial, sans-serif;
    color: #2B2118; background: #EDE7DC;
  }
  .serif { font-family: 'Noto Serif', 'Noto Serif Devanagari', 'Nirmala UI', Georgia, serif; }
  .sheet {
    position: relative; width: 148mm; min-height: 210mm; margin: 16px auto; background: #FFFDF8;
    padding: 5mm; box-shadow: 0 6px 28px rgba(60, 40, 20, .18);
  }
  .frame { position: relative; min-height: 200mm; border: 1.6mm double ${color}; padding: 1.2mm; }
  .inner { position: relative; min-height: 196.3mm; border: .35mm solid ${gold}; padding: 4.5mm 6mm 3.5mm; display: flex; flex-direction: column; }
  .corner { position: absolute; width: 7mm; height: 7mm; border-color: ${gold}; border-style: solid; }
  .corner.tl { top: 1.5mm; left: 1.5mm; border-width: .5mm 0 0 .5mm; }
  .corner.tr { top: 1.5mm; right: 1.5mm; border-width: .5mm .5mm 0 0; }
  .corner.bl { bottom: 1.5mm; left: 1.5mm; border-width: 0 0 .5mm .5mm; }
  .corner.br { bottom: 1.5mm; right: 1.5mm; border-width: 0 .5mm .5mm 0; }
  .invocation { text-align: center; color: ${gold}; font-size: 9.5pt; letter-spacing: .5px; display: flex; align-items: center; gap: 3mm; }
  .invocation::before, .invocation::after { content: ''; flex: 1; height: .3mm; background: linear-gradient(90deg, transparent, ${gold}); }
  .invocation::after { background: linear-gradient(90deg, ${gold}, transparent); }
  .head { text-align: center; margin-top: 2mm; }
  .logo { max-height: 13mm; max-width: 30mm; object-fit: contain; margin-bottom: 1.5mm; }
  .trust { font-size: 15pt; font-weight: 700; color: ${color}; line-height: 1.2; }
  .addr { font-size: 7.2pt; color: #6B5B4B; margin-top: 1mm; line-height: 1.4; }
  .regs { margin-top: 1.4mm; display: flex; flex-wrap: wrap; justify-content: center; gap: 1.2mm; }
  .regs span { font-size: 6.8pt; color: #5A4A3A; border: .25mm solid #E3D5BE; border-radius: 3mm; padding: .4mm 2mm; background: #FBF5EA; }
  .ribbon { margin: 3.2mm auto 0; text-align: center; }
  .ribbon span { display: inline-block; background: ${color}; color: #FFF; font-size: 8.6pt; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; padding: 1.1mm 6mm; border-radius: 4mm; }
  .meta { display: flex; justify-content: space-between; margin-top: 3mm; font-size: 7.8pt; border-top: .25mm dashed #D9C8AC; border-bottom: .25mm dashed #D9C8AC; padding: 1.6mm 1mm; }
  .meta b { font-size: 9pt; color: #2B2118; }
  .meta .k { color: #8A7560; margin-right: 1.5mm; }
  .from { margin-top: 3.2mm; }
  .from .k { font-size: 7.6pt; color: #8A7560; text-transform: uppercase; letter-spacing: .8px; }
  .from .name { font-size: 13.5pt; font-weight: 700; margin-top: .8mm; line-height: 1.25; }
  .from .sub { font-size: 7.4pt; color: #6B5B4B; margin-top: .6mm; line-height: 1.45; }
  .amount { margin-top: 3mm; display: flex; align-items: center; justify-content: space-between; gap: 4mm;
    background: linear-gradient(90deg, ${color}14, ${color}06); border-left: 1.2mm solid ${gold}; border-radius: 1.5mm; padding: 2.4mm 4mm; }
  .amount .k { font-size: 7.6pt; color: #8A7560; text-transform: uppercase; letter-spacing: .8px; }
  .amount .words { font-size: 8pt; font-style: italic; color: #4A3B2E; margin-top: .8mm; line-height: 1.4; }
  .amount .fig { font-size: 19pt; font-weight: 800; color: ${color}; white-space: nowrap; }
  .details { margin-top: 2.4mm; width: 100%; border-collapse: collapse; font-size: 8pt; }
  .details td { padding: 1.15mm 1mm; border-bottom: .25mm solid #F0E6D6; vertical-align: top; }
  .details td:first-child { color: #8A7560; width: 36%; }
  .details td:last-child { font-weight: 600; }
  .badge { display: inline-block; font-size: 7.2pt; font-weight: 700; padding: .3mm 2.4mm; border-radius: 3mm; }
  .badge.yes { background: #E3F4E6; color: #1E6B33; }
  .badge.no { background: #F3EEE6; color: #7A6A58; }
  .blessing { margin-top: 3mm; text-align: center; color: ${color}; }
  .blessing p { font-size: 8.2pt; font-style: italic; line-height: 1.5; margin-top: .6mm; padding: 0 4mm; }
  .cert { margin-top: 2.6mm; background: #F1F8F2; border: .25mm solid #A9D5B2; border-radius: 1.5mm; padding: 1.8mm 3mm; font-size: 7pt; color: #1E5B2E; line-height: 1.45; }
  .pay { margin-top: 2mm; font-size: 7.2pt; color: #6B5B4B; text-align: center; line-height: 1.5; }
  .spacer { flex: 1; min-height: 2mm; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm; margin-top: 2mm; }
  .foot .note { font-size: 6.6pt; color: #8A7560; line-height: 1.5; max-width: 58%; }
  .sign { text-align: center; font-size: 7.4pt; color: #4A3B2E; min-width: 38mm; }
  .sign .line { border-top: .3mm solid #9C8A74; margin-top: 7mm; padding-top: 1mm; color: #8A7560; }
  .custom { margin-top: 1.6mm; text-align: center; font-size: 7.6pt; color: #4A3B2E; font-style: italic; }
  .brand { margin-top: 1.4mm; text-align: center; font-size: 6pt; color: #B3A38E; letter-spacing: .4px; }
  .void-banner { margin-top: 3mm; text-align: center; background: #FDECEC; border: .35mm solid #E08A8A; color: #9B1C1C; font-weight: 700; font-size: 8.4pt; padding: 1.6mm; border-radius: 1.5mm; text-transform: uppercase; letter-spacing: 1px; }
  .void-mark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
  .void-mark span { transform: rotate(-32deg); font-size: 64pt; font-weight: 800; color: rgba(190, 30, 30, .12); letter-spacing: 8px; }
  @media print { body { background: #FFF; } .sheet { margin: 0; box-shadow: none; } }
  /* The PDF renderer measures this against one A5 page and zooms long receipts to fit. */
  /* Phones: the A5 sheet is 148 mm (~560 px) wide, so on screen it steps down
     to fit instead of running off the right edge. Print and the PDF never
     match these (print media, and the renderer's page is wider). */
  @media screen and (max-width: 580px) { .sheet { margin: 0 auto; zoom: .74; } }
  @media screen and (max-width: 430px) { .sheet { zoom: .72; } }
  @media screen and (max-width: 400px) { .sheet { zoom: .68; } }
  @media screen and (max-width: 375px) { .sheet { zoom: .64; } }
  @media screen and (max-width: 350px) { .sheet { zoom: .6; } }
`;
  const body = `<div class="sheet">
  <div class="frame"><div class="inner">
    <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
    ${r.is_voided ? '<div class="void-mark"><span>VOID</span></div>' : ''}
    <div class="invocation serif">॥ जय जिनेन्द्र ॥</div>
    <div class="head">
      ${logoTag}
      <div class="trust serif">${esc(m.name || 'Jain Mandir')}</div>
      ${m.address ? `<div class="addr">${esc(m.address)}${contact ? `<br/>${contact}` : ''}</div>` : contact ? `<div class="addr">${contact}</div>` : ''}
      ${regs.length ? `<div class="regs">${regs.map((x) => `<span>${x}</span>`).join('')}</div>` : ''}
    </div>
    <div class="ribbon"><span>${esc(title)}</span></div>
    ${r.is_voided ? `<div class="void-banner">⚠ ${esc(L.voided)}</div>` : ''}
    <div class="meta">
      <div><span class="k">${esc(L.receiptNo)}</span><b>${esc(r.receipt_number)}</b></div>
      <div><span class="k">${esc(L.date)}</span><b>${esc(dateStr)}</b></div>
    </div>
    <div class="from">
      <div class="k">${esc(donation ? L.receivedFrom : L.soldTo)}</div>
      <div class="name serif">${esc(r.donor?.name || L.anonymous)}</div>
      ${donorBits || r.donor?.address ? `<div class="sub">${donorBits}${donorBits && r.donor?.address ? '<br/>' : ''}${esc(r.donor?.address ?? '')}</div>` : ''}
    </div>
    <div class="amount">
      <div>
        <div class="k">${esc(L.amount)}</div>
        <div class="words">${esc(amountInWords(r.amount_paise))}</div>
      </div>
      <div class="fig">₹ ${rupees(r.amount_paise)}</div>
    </div>
    <table class="details">
      <tr><td>${esc(r.detail_label || L.purpose)}</td><td>${esc(r.category || '—')}</td></tr>
      <tr><td>${esc(L.paymentMode)}</td><td>${mode}</td></tr>
      ${donation ? `<tr><td>${esc(L.eligible80g)}</td><td><span class="badge ${r.is_80g_eligible ? 'yes' : 'no'}">${esc(r.is_80g_eligible ? L.yes : L.no)}</span></td></tr>` : ''}
    </table>
    ${show80gCert ? `<div class="cert">${esc(L.certified80g)}<br/>80G: <b>${esc(m.reg_80g_number)}</b>${m.reg_80g_urn ? ` &nbsp;·&nbsp; URN: <b>${esc(m.reg_80g_urn)}</b>` : ''}${validUpto && !Number.isNaN(validUpto.getTime()) ? ` &nbsp;·&nbsp; ${esc(L.validUpto)}: <b>${esc(validUpto.toLocaleDateString('en-IN'))}</b>` : ''}</div>` : ''}
    ${r.is_voided ? "" : `<div class="blessing">
      ${lotus(gold)}
      <p class="serif">${esc(donation ? L.anumodana : L.thanks)}</p>
    </div>`}
    ${pay.length ? `<div class="pay">${pay.join(' &nbsp;|&nbsp; ')}</div>` : ''}
    <div class="spacer"></div>
    ${m.footer ? `<div class="custom">${esc(m.footer)}</div>` : ''}
    <div class="foot">
      <div class="note">${esc(L.computerGenerated)}</div>
      <div class="sign">${esc(L.forTrust.replace('{name}', m.name || ''))}<div class="line">${esc(L.authorised)}</div></div>
    </div>
    <div class="brand">Generated with JainERP</div>
  </div></div>
</div>`;
  return { lang: receiptLanguage(m.receipt_language), title: `${title} ${r.receipt_number}`, css, body };
}

export function buildReceiptDocument(r: ReceiptDocument): string {
  const { lang, title, css, body } = receiptParts(r);
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}
