/**
 * Receipt label translations (plan §16).
 *
 * Deliberately separate from the app's i18n bundle: the receipt language is a
 * trust-level print setting, not the operator's UI language. A Marathi trust
 * may hand out English receipts to donors who file them with a CA, and a
 * counter volunteer using the Hindi UI must still print whatever the trust
 * configured. Receipts are also rendered into a detached iframe with no React
 * context, so they cannot use `useTranslation()`.
 */
export type ReceiptLang = 'en' | 'hi' | 'mr' | 'gu' | 'kn' | 'ta' | 'te'

/** The same list as a value, for validating untrusted input against. */
export const RECEIPT_LANGS: readonly ReceiptLang[] =
  ['en', 'hi', 'mr', 'gu', 'kn', 'ta', 'te']

export interface ReceiptLabels {
  donationReceipt: string
  receivedFrom: string
  receivedWithThanks: string
  donationAmount: string
  amount: string
  amountInr: string
  amountInWords: string
  category: string
  paymentMode: string
  modeOfPayment: string
  mode: string
  date: string
  receiptNo: string
  /** The registrar's own registration number, and the NGO-Darpan ID. */
  registrationNo: string
  darpanNo: string
  pan: string
  donorPan: string
  panOfTrust: string
  donorName: string
  donorNamePrefix: string
  donorsDetail: string
  purposeOfDonation: string
  description: string
  instrumentNo: string
  instrumentDate: string
  realizedAmount: string
  authorisedSignatory: string
  signature: string
  anonymous: string
  anonymousDonor: string
  generalDonation: string
  mobile: string
  yes: string
  no: string
  notProvided: string
  valid80g: string
  thankYou: string
  donorCopy: string
  officeCopy: string
  scanToPay: string
  // Counter slips: the title per module, and the per-plate Bhojanshala token.
  bhojanshalaToken: string
  prasadSlip: string
  sevaReceipt: string
  token: string
  onePlate: string
  breakfast: string
  lunch: string
  dinner: string
  // The itemised table every receipt with lines now prints.
  subtotal: string
  total: string
  // The signature block at the foot of every A4 design.
  forTrust: string
  computerGenerated: string
  // -- Remittance: how a devotee can pay the trust ---------------------------
  // One block on every design replaces five hand-written copies. IFSC, UPI,
  // PAN and the GST acronyms stay Latin in every language: they are printed on
  // a passbook and a cheque that way, and a translated IFSC is unusable.
  /** The "80G Eligible" row on a donation receipt. Six designs printed these
   * two English words regardless of the trust's receipt language. */
  eligible80g: string
  transactionId: string
  status: string
  received: string
  paymentDetails: string
  bankLabel: string
  accountName: string
  accountNo: string
  ifsc: string
  upiId: string
  scanToDonate: string
  receivedOn: string
  reference: string
  // -- A stay: the accommodation designs and the room bill -------------------
  stayDetails: string
  checkIn: string
  checkOut: string
  nights: string
  persons: string
  room: string
  guest: string
  guestIdLabel: string
  advance: string
  securityDeposit: string
  amountPaid: string
  balanceDue: string
  houseRules: string
  taxInvoice: string
  guestFolio: string
  placeOfSupply: string
  taxableValue: string
  // ── GST TAX INVOICE (CGST Rule 46) ────────────────────────────────────────
  // CGST/SGST/IGST are absent on purpose: statutory acronyms stay Latin in
  // every language, and a tax head is not a trust's word to change.
  hsnSac: string
  // s.31(3)(c) CGST: a REGISTERED person supplying exempt or nil-rated
  // services issues a bill of supply instead of a tax invoice. A temple with a
  // GSTIN letting a room below the taxable tariff is exactly that case.
  //
  // An UNREGISTERED trust issues neither - it has no standing to - so it never
  // reaches this label; buildReceiptHtml falls its template back instead.
  billOfSupply: string
  hsnSummary: string
  termsConditions: string
  duplicateForOffice: string
  srNo: string
  taxRate: string
  reverseCharge: string
  guestGstin: string
  originalForRecipient: string
  gstDeclaration: string
  // ── One bill, several lines (tenant migration 057) ───────────────────────
  // What was given back to a guest whose advance was larger than the stay
  // came to, what is still owed back, and the counter's remarks.
  refunded: string
  refundDue: string
  remarks: string
  qty: string
  supplier: string
  recipient: string
  // -- The three documents that are not one of the receipt designs -----------
  // A room bill, an 80G certificate and a boli intimation are all handed to the
  // person who paid, so they read the trust's vocabulary like everything else.
  // They used to take their labels from the admin app's UI i18n, which is the
  // OPERATOR'S language - so a renamed word changed the receipt and not the bill.
  roomBill: string
  hallBill: string
  paymentsReceived: string
  noPaymentsRecorded: string
  /** The 80G certificate's footer total. */
  total80gEligible: string
  /** The Act's own section reference. Locked: it is the law's words, not ours. */
  section80g5: string
  boliIntimation: string
  pledgedAmount: string
  pledgeDate: string
  paidSoFar: string
  outstandingAmount: string
  /** What the hall was booked FOR, on the hall bill. */
  eventName: string
  // -- The Anumodana sheet's own words ---------------------------------------
  // That design is rendered by receiptDocument.ts, which carries its own label
  // table because it is vendored into devotee-api and has no imports by design.
  // These nine exist only there, and the wording editor never listed them - so a
  // trust could not change the blessing line on the one design its donors
  // receive by WhatsApp. The override mechanism already reached them; the editor
  // did not. Declared here so it does.
  soldTo: string
  purpose: string
  /** The blessing under the amount, and the line the client pointed at. */
  anumodana: string
  thanks: string
  /** The 80G certification in the sheet's words. Locked, like `valid80g`. */
  certified80g: string
  validUpto: string
  bank: string
  authorised: string
  voided: string
}

const en: ReceiptLabels = {
  donationReceipt: 'Donation Receipt',
  receivedFrom: 'Received From',
  receivedWithThanks: 'Received with thanks from',
  donationAmount: 'Donation Amount',
  amount: 'Amount',
  amountInr: 'Amount (INR)',
  amountInWords: 'Amount in Words',
  category: 'Category',
  paymentMode: 'Payment Mode',
  modeOfPayment: 'Mode of Payment',
  mode: 'Mode',
  date: 'Date',
  receiptNo: 'Receipt No',
  registrationNo: 'Reg. No.',
  darpanNo: 'Darpan',
  pan: 'PAN',
  donorPan: 'Donor PAN',
  panOfTrust: 'PAN of Trust',
  donorName: 'Donor Name',
  donorNamePrefix: 'Donor Name Shri / Smt.',
  donorsDetail: 'Donors Detail',
  purposeOfDonation: 'Purpose of Donation',
  description: 'Description',
  instrumentNo: 'Instrument No.',
  instrumentDate: 'Instrument Date',
  realizedAmount: 'Realized Amount',
  authorisedSignatory: 'Authorised Signatory',
  signature: 'Signature',
  anonymous: 'Anonymous',
  anonymousDonor: 'Anonymous Donor',
  generalDonation: 'General Donation',
  mobile: 'Mobile',
  yes: 'Yes',
  no: 'No',
  notProvided: 'Not provided',
  valid80g: 'This receipt is valid for 80G tax exemption purposes.',
  thankYou: 'Thank you for your generous donation.',
  donorCopy: 'Donor Copy',
  officeCopy: 'Office Copy',
  scanToPay: 'Scan to pay',
  bhojanshalaToken: 'Bhojanshala Token',
  prasadSlip: 'Prasad Slip',
  sevaReceipt: 'Seva Receipt',
  token: 'Token',
  onePlate: '1 plate',
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  subtotal: 'Subtotal',
  total: 'Total',
  forTrust: 'For {name}',
  computerGenerated: 'This is a computer-generated receipt and does not need a physical signature.',
  eligible80g: '80G Eligible',
  transactionId: 'Transaction ID',
  status: 'Status',
  received: 'Received',
  paymentDetails: 'Payment Details',
  bankLabel: 'Bank',
  accountName: 'A/C Name',
  accountNo: 'A/C No.',
  ifsc: 'IFSC',
  upiId: 'UPI ID',
  scanToDonate: 'Scan to donate',
  receivedOn: 'Received on',
  reference: 'Ref.',
  stayDetails: 'Stay Details',
  checkIn: 'Check-in',
  checkOut: 'Check-out',
  nights: 'Nights',
  persons: 'Persons',
  room: 'Room',
  guest: 'Guest',
  guestIdLabel: 'ID',
  advance: 'Advance',
  securityDeposit: 'Security Deposit',
  amountPaid: 'Amount Paid',
  balanceDue: 'Balance Due',
  houseRules: 'House Rules',
  taxInvoice: 'Tax Invoice',
  guestFolio: 'Guest Folio',
  placeOfSupply: 'Place of Supply',
  taxableValue: 'Taxable Value',
  hsnSac: 'HSN/SAC',
  billOfSupply: 'Bill of Supply',
  hsnSummary: 'Tax Summary (HSN/SAC-wise)',
  termsConditions: 'Terms & Conditions',
  duplicateForOffice: 'Duplicate for Office',
  srNo: 'Sr.',
  taxRate: 'Rate',
  reverseCharge: 'Reverse Charge',
  guestGstin: 'Guest GSTIN',
  originalForRecipient: 'Original for Recipient',
  gstDeclaration: 'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.',
  refunded: 'Refunded',
  refundDue: 'Refund Due',
  remarks: 'Remarks',
  qty: 'Qty',
  supplier: 'Supplier',
  recipient: 'Recipient',
  roomBill: 'Room Bill',
  hallBill: 'Hall Bill',
  paymentsReceived: 'Payments Received',
  noPaymentsRecorded: 'No payments recorded',
  total80gEligible: 'Total 80G-Eligible Donation',
  section80g5: 'Section 80G(5)',
  boliIntimation: 'Boli Pledge Intimation',
  pledgedAmount: 'Pledged Amount',
  pledgeDate: 'Pledge Date',
  paidSoFar: 'Paid So Far',
  outstandingAmount: 'Outstanding Amount',
  eventName: 'Event',
  soldTo: 'Received from',
  purpose: 'Purpose',
  anumodana: 'Heartfelt anumodana for your generous daan. May this punya karya bring sukh and shanti to you and your family.',
  thanks: 'Thank you. Jai Jinendra.',
  certified80g: 'Certified that this donation is eligible for deduction under Section 80G(5)(vi) of the Income-tax Act, 1961.',
  validUpto: 'Valid up to',
  bank: 'Bank',
  authorised: 'Authorised signatory',
  voided: 'This receipt has been cancelled',
}

const hi: ReceiptLabels = {
  donationReceipt: 'दान रसीद',
  receivedFrom: 'प्राप्तकर्ता से',
  receivedWithThanks: 'सधन्यवाद प्राप्त हुआ',
  donationAmount: 'दान राशि',
  amount: 'राशि',
  amountInr: 'राशि (INR)',
  amountInWords: 'राशि शब्दों में',
  category: 'श्रेणी',
  paymentMode: 'भुगतान माध्यम',
  modeOfPayment: 'भुगतान का माध्यम',
  mode: 'माध्यम',
  date: 'दिनांक',
  receiptNo: 'रसीद क्रमांक',
  registrationNo: 'पंजीकरण सं.',
  darpanNo: 'दर्पण',
  pan: 'पैन',
  donorPan: 'दाता का पैन',
  panOfTrust: 'ट्रस्ट का पैन',
  donorName: 'दाता का नाम',
  donorNamePrefix: 'दाता का नाम श्री / श्रीमती',
  donorsDetail: 'दाता का विवरण',
  purposeOfDonation: 'दान का उद्देश्य',
  description: 'विवरण',
  instrumentNo: 'साधन क्रमांक',
  instrumentDate: 'साधन दिनांक',
  realizedAmount: 'प्राप्त राशि',
  authorisedSignatory: 'अधिकृत हस्ताक्षरकर्ता',
  signature: 'हस्ताक्षर',
  anonymous: 'गुप्त',
  anonymousDonor: 'गुप्त दाता',
  generalDonation: 'सामान्य दान',
  mobile: 'मोबाइल',
  yes: 'हाँ',
  no: 'नहीं',
  notProvided: 'नहीं दिया गया',
  valid80g: 'यह रसीद 80G कर छूट हेतु मान्य है।',
  thankYou: 'आपके उदार दान के लिए धन्यवाद।',
  donorCopy: 'दाता प्रति',
  officeCopy: 'कार्यालय प्रति',
  scanToPay: 'भुगतान हेतु स्कैन करें',
  bhojanshalaToken: 'भोजनशाला टोकन',
  prasadSlip: 'प्रसाद पर्ची',
  sevaReceipt: 'सेवा रसीद',
  token: 'टोकन',
  onePlate: '1 थाली',
  breakfast: 'नाश्ता',
  lunch: 'दोपहर का भोजन',
  dinner: 'रात्रि भोजन',
  subtotal: 'उप-योग',
  total: 'कुल',
  forTrust: '{name} हेतु',
  computerGenerated: 'यह कंप्यूटर द्वारा बनाई गई रसीद है; भौतिक हस्ताक्षर आवश्यक नहीं।',
  eligible80g: '80G पात्र',
  transactionId: 'लेनदेन आईडी',
  status: 'स्थिति',
  received: 'प्राप्त',
  paymentDetails: 'भुगतान विवरण',
  bankLabel: 'बैंक',
  accountName: 'खाताधारक का नाम',
  accountNo: 'खाता सं.',
  ifsc: 'IFSC',
  upiId: 'UPI आईडी',
  scanToDonate: 'दान हेतु स्कैन करें',
  receivedOn: 'प्राप्ति दिनांक',
  reference: 'संदर्भ',
  stayDetails: 'निवास विवरण',
  checkIn: 'आगमन',
  checkOut: 'प्रस्थान',
  nights: 'रातें',
  persons: 'व्यक्ति',
  room: 'कक्ष',
  guest: 'अतिथि',
  guestIdLabel: 'पहचान पत्र',
  advance: 'अग्रिम',
  securityDeposit: 'सुरक्षा निधि',
  amountPaid: 'प्राप्त राशि',
  balanceDue: 'शेष राशि',
  houseRules: 'नियम एवं शर्तें',
  taxInvoice: 'कर बीजक',
  guestFolio: 'अतिथि विवरण-पत्र',
  placeOfSupply: 'आपूर्ति स्थान',
  taxableValue: 'कर योग्य मूल्य',
  hsnSac: 'HSN/SAC',
  billOfSupply: 'आपूर्ति बिल',
  hsnSummary: 'कर सारांश (HSN/SAC अनुसार)',
  termsConditions: 'नियम एवं शर्तें',
  duplicateForOffice: 'कार्यालय हेतु द्वितीय प्रति',
  srNo: 'क्र.',
  taxRate: 'दर',
  reverseCharge: 'रिवर्स चार्ज',
  guestGstin: 'अतिथि GSTIN',
  originalForRecipient: 'प्राप्तकर्ता हेतु मूल प्रति',
  gstDeclaration: 'हम घोषित करते हैं कि इस बीजक में वर्णित सेवाओं का वास्तविक मूल्य दर्शाया गया है तथा सभी विवरण सत्य एवं सही हैं।',
  refunded: 'वापस की गई राशि',
  refundDue: 'वापसी योग्य राशि',
  remarks: 'टिप्पणी',
  qty: 'मात्रा',
  supplier: 'प्रदाता',
  recipient: 'प्राप्तकर्ता',
  roomBill: 'कक्ष बिल',
  hallBill: 'हॉल बिल',
  paymentsReceived: 'प्राप्त भुगतान',
  noPaymentsRecorded: 'कोई भुगतान दर्ज नहीं',
  total80gEligible: 'कुल 80G पात्र दान',
  section80g5: 'धारा 80G(5)',
  boliIntimation: 'बोली संकल्प सूचना',
  pledgedAmount: 'संकल्प राशि',
  pledgeDate: 'संकल्प दिनांक',
  paidSoFar: 'अब तक भुगतान',
  outstandingAmount: 'शेष राशि',
  eventName: 'कार्यक्रम',
  soldTo: 'प्राप्त',
  purpose: 'उद्देश्य',
  anumodana: 'आपके उदार दान की हार्दिक अनुमोदना। यह पुण्य कार्य आपके और आपके परिवार के जीवन में सुख-शांति लाए।',
  thanks: 'धन्यवाद। जय जिनेन्द्र।',
  certified80g: 'प्रमाणित किया जाता है कि यह दान आयकर अधिनियम, 1961 की धारा 80G(5)(vi) के अंतर्गत कटौती हेतु पात्र है।',
  validUpto: 'वैधता',
  bank: 'बैंक',
  authorised: 'अधिकृत हस्ताक्षरकर्ता',
  voided: 'यह रसीद निरस्त कर दी गई है',
}

const mr: ReceiptLabels = {
  donationReceipt: 'देणगी पावती',
  receivedFrom: 'यांच्याकडून प्राप्त',
  receivedWithThanks: 'सधन्यवाद प्राप्त झाले',
  donationAmount: 'देणगी रक्कम',
  amount: 'रक्कम',
  amountInr: 'रक्कम (INR)',
  amountInWords: 'रक्कम अक्षरी',
  category: 'श्रेणी',
  paymentMode: 'भरणा पद्धत',
  modeOfPayment: 'भरण्याची पद्धत',
  mode: 'पद्धत',
  date: 'दिनांक',
  receiptNo: 'पावती क्रमांक',
  registrationNo: 'नोंदणी क्र.',
  darpanNo: 'दर्पण',
  pan: 'पॅन',
  donorPan: 'देणगीदाराचा पॅन',
  panOfTrust: 'ट्रस्टचा पॅन',
  donorName: 'देणगीदाराचे नाव',
  donorNamePrefix: 'देणगीदाराचे नाव श्री / श्रीमती',
  donorsDetail: 'देणगीदाराचा तपशील',
  purposeOfDonation: 'देणगीचा उद्देश',
  description: 'तपशील',
  instrumentNo: 'साधन क्रमांक',
  instrumentDate: 'साधन दिनांक',
  realizedAmount: 'प्राप्त रक्कम',
  authorisedSignatory: 'अधिकृत स्वाक्षरीकर्ता',
  signature: 'स्वाक्षरी',
  anonymous: 'निनावी',
  anonymousDonor: 'निनावी देणगीदार',
  generalDonation: 'सर्वसाधारण देणगी',
  mobile: 'मोबाइल',
  yes: 'होय',
  no: 'नाही',
  notProvided: 'दिलेले नाही',
  valid80g: 'ही पावती 80G कर सवलतीसाठी वैध आहे.',
  thankYou: 'आपल्या उदार देणगीबद्दल धन्यवाद.',
  donorCopy: 'देणगीदार प्रत',
  officeCopy: 'कार्यालय प्रत',
  scanToPay: 'भरण्यासाठी स्कॅन करा',
  bhojanshalaToken: 'भोजनशाळा टोकन',
  prasadSlip: 'प्रसाद पावती',
  sevaReceipt: 'सेवा पावती',
  token: 'टोकन',
  onePlate: '1 थाळी',
  breakfast: 'न्याहारी',
  lunch: 'दुपारचे जेवण',
  dinner: 'रात्रीचे जेवण',
  subtotal: 'उप-बेरीज',
  total: 'एकूण',
  forTrust: '{name} करिता',
  computerGenerated: 'ही संगणकाद्वारे तयार केलेली पावती आहे; प्रत्यक्ष स्वाक्षरीची आवश्यकता नाही.',
  eligible80g: '80G पात्र',
  transactionId: 'व्यवहार आयडी',
  status: 'स्थिती',
  received: 'प्राप्त',
  paymentDetails: 'देयक तपशील',
  bankLabel: 'बँक',
  accountName: 'खातेदाराचे नाव',
  accountNo: 'खाते क्र.',
  ifsc: 'IFSC',
  upiId: 'UPI आयडी',
  scanToDonate: 'देणगीसाठी स्कॅन करा',
  receivedOn: 'प्राप्ती दिनांक',
  reference: 'संदर्भ',
  stayDetails: 'निवास तपशील',
  checkIn: 'आगमन',
  checkOut: 'प्रस्थान',
  nights: 'रात्री',
  persons: 'व्यक्ती',
  room: 'खोली',
  guest: 'अतिथी',
  guestIdLabel: 'ओळखपत्र',
  advance: 'आगाऊ रक्कम',
  securityDeposit: 'अनामत रक्कम',
  amountPaid: 'भरलेली रक्कम',
  balanceDue: 'शिल्लक रक्कम',
  houseRules: 'नियम व अटी',
  taxInvoice: 'कर देयक',
  guestFolio: 'अतिथी तपशील-पत्र',
  placeOfSupply: 'पुरवठा ठिकाण',
  taxableValue: 'करपात्र मूल्य',
  hsnSac: 'HSN/SAC',
  billOfSupply: 'पुरवठा देयक',
  hsnSummary: 'कर सारांश (HSN/SAC नुसार)',
  termsConditions: 'नियम व अटी',
  duplicateForOffice: 'कार्यालयासाठी दुसरी प्रत',
  srNo: 'क्र.',
  taxRate: 'दर',
  reverseCharge: 'रिव्हर्स चार्ज',
  guestGstin: 'पाहुणे GSTIN',
  originalForRecipient: 'प्राप्तकर्त्यासाठी मूळ प्रत',
  gstDeclaration: 'आम्ही घोषित करतो की या देयकात वर्णन केलेल्या सेवांची प्रत्यक्ष किंमत दर्शविली आहे आणि सर्व तपशील खरे व अचूक आहेत.',
  refunded: 'परत केलेली रक्कम',
  refundDue: 'परत देय रक्कम',
  remarks: 'शेरा',
  qty: 'संख्या',
  supplier: 'पुरवठादार',
  recipient: 'प्राप्तकर्ता',
  roomBill: 'खोली बिल',
  hallBill: 'सभागृह बिल',
  paymentsReceived: 'प्राप्त देयके',
  noPaymentsRecorded: 'कोणतेही देयक नोंदवलेले नाही',
  total80gEligible: 'एकूण 80G पात्र दान',
  section80g5: 'कलम 80G(5)',
  boliIntimation: 'बोली संकल्प सूचना',
  pledgedAmount: 'संकल्प रक्कम',
  pledgeDate: 'संकल्प दिनांक',
  paidSoFar: 'आतापर्यंत भरलेले',
  outstandingAmount: 'शिल्लक रक्कम',
  eventName: 'कार्यक्रम',
  soldTo: 'प्राप्त',
  purpose: 'उद्देश',
  anumodana: 'आपल्या उदार दानाची हार्दिक अनुमोदना. हे पुण्यकार्य आपल्या व आपल्या कुटुंबाच्या जीवनात सुख-शांती आणो.',
  thanks: 'धन्यवाद. जय जिनेंद्र.',
  certified80g: 'प्रमाणित करण्यात येते की हे दान आयकर अधिनियम, 1961 च्या कलम 80G(5)(vi) अंतर्गत वजावटीस पात्र आहे.',
  validUpto: 'वैधता',
  bank: 'बँक',
  authorised: 'अधिकृत स्वाक्षरीकर्ता',
  voided: 'ही पावती रद्द करण्यात आली आहे',
}

const gu: ReceiptLabels = {
  donationReceipt: 'દાન પાવતી',
  receivedFrom: 'તરફથી પ્રાપ્ત',
  receivedWithThanks: 'સાભાર પ્રાપ્ત થયું',
  donationAmount: 'દાન રકમ',
  amount: 'રકમ',
  amountInr: 'રકમ (INR)',
  amountInWords: 'રકમ શબ્દોમાં',
  category: 'શ્રેણી',
  paymentMode: 'ચુકવણી પદ્ધતિ',
  modeOfPayment: 'ચુકવણીની પદ્ધતિ',
  mode: 'પદ્ધતિ',
  date: 'તારીખ',
  receiptNo: 'પાવતી નંબર',
  registrationNo: 'નોંધણી નં.',
  darpanNo: 'દર્પણ',
  pan: 'પાન',
  donorPan: 'દાતાનો પાન',
  panOfTrust: 'ટ્રસ્ટનો પાન',
  donorName: 'દાતાનું નામ',
  donorNamePrefix: 'દાતાનું નામ શ્રી / શ્રીમતી',
  donorsDetail: 'દાતાની વિગત',
  purposeOfDonation: 'દાનનો હેતુ',
  description: 'વિગત',
  instrumentNo: 'ચેક/ડ્રાફ્ટ નંબર',
  instrumentDate: 'ચેક/ડ્રાફ્ટ તારીખ',
  realizedAmount: 'પ્રાપ્ત રકમ',
  authorisedSignatory: 'અધિકૃત સહીકર્તા',
  signature: 'સહી',
  anonymous: 'ગુપ્ત',
  anonymousDonor: 'ગુપ્ત દાતા',
  generalDonation: 'સામાન્ય દાન',
  mobile: 'મોબાઇલ',
  yes: 'હા',
  no: 'ના',
  notProvided: 'આપેલ નથી',
  valid80g: 'આ પાવતી 80G કર મુક્તિ માટે માન્ય છે.',
  thankYou: 'આપના ઉદાર દાન બદલ આભાર.',
  donorCopy: 'દાતા નકલ',
  officeCopy: 'કાર્યાલય નકલ',
  scanToPay: 'ચુકવણી માટે સ્કેન કરો',
  bhojanshalaToken: 'ભોજનશાળા ટોકન',
  prasadSlip: 'પ્રસાદ સ્લિપ',
  sevaReceipt: 'સેવા રસીદ',
  token: 'ટોકન',
  onePlate: '1 થાળી',
  breakfast: 'નાસ્તો',
  lunch: 'બપોરનું ભોજન',
  dinner: 'રાત્રિ ભોજન',
  subtotal: 'પેટા સરવાળો',
  total: 'કુલ',
  forTrust: '{name} વતી',
  computerGenerated: 'આ કમ્પ્યુટર દ્વારા બનાવેલી પાવતી છે; ભૌતિક સહીની જરૂર નથી.',
  eligible80g: '80G પાત્ર',
  transactionId: 'વ્યવહાર આઈડી',
  status: 'સ્થિતિ',
  received: 'મળ્યું',
  paymentDetails: 'ચુકવણી વિગત',
  bankLabel: 'બેંક',
  accountName: 'ખાતાધારકનું નામ',
  accountNo: 'ખાતા નં.',
  ifsc: 'IFSC',
  upiId: 'UPI આઈડી',
  scanToDonate: 'દાન માટે સ્કેન કરો',
  receivedOn: 'પ્રાપ્તિ તારીખ',
  reference: 'સંદર્ભ',
  stayDetails: 'નિવાસ વિગત',
  checkIn: 'આગમન',
  checkOut: 'પ્રસ્થાન',
  nights: 'રાત્રિ',
  persons: 'વ્યક્તિ',
  room: 'ખંડ',
  guest: 'અતિથિ',
  guestIdLabel: 'ઓળખપત્ર',
  advance: 'અગાઉથી રકમ',
  securityDeposit: 'જમાનત રકમ',
  amountPaid: 'ચૂકવેલ રકમ',
  balanceDue: 'બાકી રકમ',
  houseRules: 'નિયમો અને શરતો',
  taxInvoice: 'કર બિલ',
  guestFolio: 'અતિથિ વિગત-પત્ર',
  placeOfSupply: 'પુરવઠા સ્થળ',
  taxableValue: 'કરપાત્ર મૂલ્ય',
  hsnSac: 'HSN/SAC',
  billOfSupply: 'પુરવઠા બિલ',
  hsnSummary: 'કર સારાંશ (HSN/SAC પ્રમાણે)',
  termsConditions: 'નિયમો અને શરતો',
  duplicateForOffice: 'કાર્યાલય માટે બીજી નકલ',
  srNo: 'ક્રમ',
  taxRate: 'દર',
  reverseCharge: 'રિવર્સ ચાર્જ',
  guestGstin: 'મહેમાન GSTIN',
  originalForRecipient: 'પ્રાપ્તકર્તા માટે મૂળ નકલ',
  gstDeclaration: 'અમે ઘોષણા કરીએ છીએ કે આ બિલમાં વર્ણવેલ સેવાઓની વાસ્તવિક કિંમત દર્શાવેલ છે અને તમામ વિગતો સાચી અને યોગ્ય છે.',
  refunded: 'પરત કરેલ રકમ',
  refundDue: 'પરત આપવાની રકમ',
  remarks: 'નોંધ',
  qty: 'જથ્થો',
  supplier: 'સપ્લાયર',
  recipient: 'પ્રાપ્તકર્તા',
  roomBill: 'રૂમ બિલ',
  hallBill: 'હોલ બિલ',
  paymentsReceived: 'પ્રાપ્ત ચુકવણી',
  noPaymentsRecorded: 'કોઈ ચુકવણી નોંધાયેલ નથી',
  total80gEligible: 'કુલ 80G પાત્ર દાન',
  section80g5: 'કલમ 80G(5)',
  boliIntimation: 'બોલી સંકલ્પ સૂચના',
  pledgedAmount: 'સંકલ્પ રકમ',
  pledgeDate: 'સંકલ્પ તારીખ',
  paidSoFar: 'અત્યાર સુધી ચૂકવેલ',
  outstandingAmount: 'બાકી રકમ',
  eventName: 'નિમિત્ત',
  soldTo: 'પ્રાપ્ત',
  purpose: 'હેતુ',
  anumodana: 'આપના ઉદાર દાનની હાર્દિક અનુમોદના. આ પુણ્ય કાર્ય આપના અને આપના પરિવારના જીવનમાં સુખ-શાંતિ લાવે.',
  thanks: 'આભાર. જય જિનેન્દ્ર.',
  certified80g: 'પ્રમાણિત કરવામાં આવે છે કે આ દાન આવકવેરા અધિનિયમ, 1961 ની કલમ 80G(5)(vi) હેઠળ કપાત માટે પાત્ર છે.',
  validUpto: 'માન્યતા',
  bank: 'બેંક',
  authorised: 'અધિકૃત સહીકર્તા',
  voided: 'આ પાવતી રદ કરવામાં આવી છે',
}

const kn: ReceiptLabels = {
  donationReceipt: 'ದಾನ ರಶೀದಿ',
  receivedFrom: 'ಇವರಿಂದ ಸ್ವೀಕರಿಸಲಾಗಿದೆ',
  receivedWithThanks: 'ಕೃತಜ್ಞತೆಯೊಂದಿಗೆ ಸ್ವೀಕರಿಸಲಾಗಿದೆ',
  donationAmount: 'ದಾನದ ಮೊತ್ತ',
  amount: 'ಮೊತ್ತ',
  amountInr: 'ಮೊತ್ತ (INR)',
  amountInWords: 'ಮೊತ್ತ ಅಕ್ಷರಗಳಲ್ಲಿ',
  category: 'ವರ್ಗ',
  paymentMode: 'ಪಾವತಿ ವಿಧಾನ',
  modeOfPayment: 'ಪಾವತಿಯ ವಿಧಾನ',
  mode: 'ವಿಧಾನ',
  date: 'ದಿನಾಂಕ',
  receiptNo: 'ರಶೀದಿ ಸಂಖ್ಯೆ',
  registrationNo: 'ನೋಂದಣಿ ಸಂ.',
  darpanNo: 'ದರ್ಪಣ',
  pan: 'ಪ್ಯಾನ್',
  donorPan: 'ದಾನಿಯ ಪ್ಯಾನ್',
  panOfTrust: 'ಟ್ರಸ್ಟ್‌ನ ಪ್ಯಾನ್',
  donorName: 'ದಾನಿಯ ಹೆಸರು',
  donorNamePrefix: 'ದಾನಿಯ ಹೆಸರು ಶ್ರೀ / ಶ್ರೀಮತಿ',
  donorsDetail: 'ದಾನಿಯ ವಿವರ',
  purposeOfDonation: 'ದಾನದ ಉದ್ದೇಶ',
  description: 'ವಿವರ',
  instrumentNo: 'ಚೆಕ್/ಡಿಡಿ ಸಂಖ್ಯೆ',
  instrumentDate: 'ಚೆಕ್/ಡಿಡಿ ದಿನಾಂಕ',
  realizedAmount: 'ಸ್ವೀಕೃತ ಮೊತ್ತ',
  authorisedSignatory: 'ಅಧಿಕೃತ ಸಹಿದಾರರು',
  signature: 'ಸಹಿ',
  anonymous: 'ಗುಪ್ತ',
  anonymousDonor: 'ಗುಪ್ತ ದಾನಿ',
  generalDonation: 'ಸಾಮಾನ್ಯ ದಾನ',
  mobile: 'ಮೊಬೈಲ್',
  yes: 'ಹೌದು',
  no: 'ಇಲ್ಲ',
  notProvided: 'ನೀಡಿಲ್ಲ',
  valid80g: 'ಈ ರಶೀದಿ 80G ತೆರಿಗೆ ವಿನಾಯಿತಿಗೆ ಮಾನ್ಯವಾಗಿದೆ.',
  thankYou: 'ನಿಮ್ಮ ಉದಾರ ದಾನಕ್ಕೆ ಧನ್ಯವಾದಗಳು.',
  donorCopy: 'ದಾನಿಯ ಪ್ರತಿ',
  officeCopy: 'ಕಚೇರಿ ಪ್ರತಿ',
  scanToPay: 'ಪಾವತಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ',
  bhojanshalaToken: 'ಭೋಜನಶಾಲೆ ಟೋಕನ್',
  prasadSlip: 'ಪ್ರಸಾದ ಚೀಟಿ',
  sevaReceipt: 'ಸೇವಾ ರಸೀದಿ',
  token: 'ಟೋಕನ್',
  onePlate: '1 ತಟ್ಟೆ',
  breakfast: 'ಉಪಾಹಾರ',
  lunch: 'ಮಧ್ಯಾಹ್ನದ ಊಟ',
  dinner: 'ರಾತ್ರಿ ಊಟ',
  subtotal: 'ಉಪಮೊತ್ತ',
  total: 'ಒಟ್ಟು',
  forTrust: '{name} ಪರವಾಗಿ',
  computerGenerated: 'ಇದು ಗಣಕದಿಂದ ರಚಿತವಾದ ರಸೀದಿ; ಸಹಿ ಅಗತ್ಯವಿಲ್ಲ.',
  eligible80g: '80G ಅರ್ಹ',
  transactionId: 'ವಹಿವಾಟು ಐಡಿ',
  status: 'ಸ್ಥಿತಿ',
  received: 'ಸ್ವೀಕರಿಸಲಾಗಿದೆ',
  paymentDetails: 'ಪಾವತಿ ವಿವರ',
  bankLabel: 'ಬ್ಯಾಂಕ್',
  accountName: 'ಖಾತೆದಾರರ ಹೆಸರು',
  accountNo: 'ಖಾತೆ ಸಂ.',
  ifsc: 'IFSC',
  upiId: 'UPI ಐಡಿ',
  scanToDonate: 'ದೇಣಿಗೆಗೆ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ',
  receivedOn: 'ಸ್ವೀಕೃತಿ ದಿನಾಂಕ',
  reference: 'ಉಲ್ಲೇಖ',
  stayDetails: 'ವಸತಿ ವಿವರ',
  checkIn: 'ಆಗಮನ',
  checkOut: 'ನಿರ್ಗಮನ',
  nights: 'ರಾತ್ರಿಗಳು',
  persons: 'ವ್ಯಕ್ತಿಗಳು',
  room: 'ಕೊಠಡಿ',
  guest: 'ಅತಿಥಿ',
  guestIdLabel: 'ಗುರುತಿನ ಚೀಟಿ',
  advance: 'ಮುಂಗಡ',
  securityDeposit: 'ಭದ್ರತಾ ಮೊತ್ತ',
  amountPaid: 'ಪಾವತಿಸಿದ ಮೊತ್ತ',
  balanceDue: 'ಬಾಕಿ ಮೊತ್ತ',
  houseRules: 'ನಿಯಮ ಮತ್ತು ಷರತ್ತುಗಳು',
  taxInvoice: 'ತೆರಿಗೆ ಬಿಲ್',
  guestFolio: 'ಅತಿಥಿ ವಿವರ ಪತ್ರ',
  placeOfSupply: 'ಪೂರೈಕೆ ಸ್ಥಳ',
  taxableValue: 'ತೆರಿಗೆಗೊಳಪಡುವ ಮೌಲ್ಯ',
  hsnSac: 'HSN/SAC',
  billOfSupply: 'ಪೂರೈಕೆ ಬಿಲ್',
  hsnSummary: 'ತೆರಿಗೆ ಸಾರಾಂಶ (HSN/SAC ಪ್ರಕಾರ)',
  termsConditions: 'ನಿಯಮಗಳು ಮತ್ತು ಷರತ್ತುಗಳು',
  duplicateForOffice: 'ಕಚೇರಿಗಾಗಿ ಎರಡನೇ ಪ್ರತಿ',
  srNo: 'ಕ್ರ.',
  taxRate: 'ದರ',
  reverseCharge: 'ರಿವರ್ಸ್ ಚಾರ್ಜ್',
  guestGstin: 'ಅತಿಥಿ GSTIN',
  originalForRecipient: 'ಸ್ವೀಕರಿಸುವವರಿಗೆ ಮೂಲ ಪ್ರತಿ',
  gstDeclaration: 'ಈ ಬಿಲ್‌ನಲ್ಲಿ ವಿವರಿಸಿದ ಸೇವೆಗಳ ವಾಸ್ತವಿಕ ಬೆಲೆಯನ್ನು ತೋರಿಸಲಾಗಿದೆ ಮತ್ತು ಎಲ್ಲಾ ವಿವರಗಳು ಸತ್ಯ ಮತ್ತು ಸರಿಯಾಗಿವೆ ಎಂದು ನಾವು ಘೋಷಿಸುತ್ತೇವೆ.',
  refunded: 'ಮರುಪಾವತಿ ಮೊತ್ತ',
  refundDue: 'ಮರುಪಾವತಿಸಬೇಕಾದ ಮೊತ್ತ',
  remarks: 'ಟಿಪ್ಪಣಿ',
  qty: 'ಪ್ರಮಾಣ',
  supplier: 'ಸರಬರಾಜುದಾರ',
  recipient: 'ಸ್ವೀಕರಿಸುವವರು',
  roomBill: 'ಕೊಠಡಿ ಬಿಲ್',
  hallBill: 'ಸಭಾಂಗಣ ಬಿಲ್',
  paymentsReceived: 'ಸ್ವೀಕರಿಸಿದ ಪಾವತಿಗಳು',
  noPaymentsRecorded: 'ಯಾವುದೇ ಪಾವತಿ ದಾಖಲಾಗಿಲ್ಲ',
  total80gEligible: 'ಒಟ್ಟು 80G ಅರ್ಹ ದೇಣಿಗೆ',
  section80g5: 'ಸೆಕ್ಷನ್ 80G(5)',
  boliIntimation: 'ಬೋಲಿ ಸಂಕಲ್ಪ ಸೂಚನೆ',
  pledgedAmount: 'ಸಂಕಲ್ಪ ಮೊತ್ತ',
  pledgeDate: 'ಸಂಕಲ್ಪ ದಿನಾಂಕ',
  paidSoFar: 'ಇದುವರೆಗೆ ಪಾವತಿಸಿದ',
  outstandingAmount: 'ಬಾಕಿ ಮೊತ್ತ',
  eventName: 'ಕಾರ್ಯಕ್ರಮ',
  soldTo: 'ಇವರಿಂದ ಸ್ವೀಕರಿಸಲಾಗಿದೆ',
  purpose: 'ಉದ್ದೇಶ',
  anumodana: 'ನಿಮ್ಮ ಉದಾರ ದಾನಕ್ಕೆ ಹೃತ್ಪೂರ್ವಕ ಅನುಮೋದನೆ. ಈ ಪುಣ್ಯ ಕಾರ್ಯ ನಿಮ್ಮ ಮತ್ತು ನಿಮ್ಮ ಕುಟುಂಬದ ಜೀವನದಲ್ಲಿ ಸುಖ-ಶಾಂತಿ ತರಲಿ.',
  thanks: 'ಧನ್ಯವಾದಗಳು. ಜೈ ಜಿನೇಂದ್ರ.',
  certified80g: 'ಈ ದಾನವು ಆದಾಯ ತೆರಿಗೆ ಕಾಯ್ದೆ, 1961 ರ ಸೆಕ್ಷನ್ 80G(5)(vi) ಅಡಿಯಲ್ಲಿ ಕಡಿತಕ್ಕೆ ಅರ್ಹವಾಗಿದೆ ಎಂದು ಪ್ರಮಾಣೀಕರಿಸಲಾಗಿದೆ.',
  validUpto: 'ಮಾನ್ಯತೆ',
  bank: 'ಬ್ಯಾಂಕ್',
  authorised: 'ಅಧಿಕೃತ ಸಹಿದಾರರು',
  voided: 'ಈ ರಶೀದಿಯನ್ನು ರದ್ದುಪಡಿಸಲಾಗಿದೆ',
}

const ta: ReceiptLabels = {
  donationReceipt: 'நன்கொடை ரசீது',
  receivedFrom: 'இவரிடமிருந்து பெறப்பட்டது',
  receivedWithThanks: 'நன்றியுடன் பெறப்பட்டது',
  donationAmount: 'நன்கொடைத் தொகை',
  amount: 'தொகை',
  amountInr: 'தொகை (INR)',
  amountInWords: 'தொகை எழுத்தில்',
  category: 'வகை',
  paymentMode: 'செலுத்தும் முறை',
  modeOfPayment: 'பணம் செலுத்தும் முறை',
  mode: 'முறை',
  date: 'தேதி',
  receiptNo: 'ரசீது எண்',
  registrationNo: 'பதிவு எண்',
  darpanNo: 'தர்பண்',
  pan: 'பான்',
  donorPan: 'நன்கொடையாளரின் பான்',
  panOfTrust: 'அறக்கட்டளையின் பான்',
  donorName: 'நன்கொடையாளர் பெயர்',
  donorNamePrefix: 'நன்கொடையாளர் பெயர் திரு / திருமதி',
  donorsDetail: 'நன்கொடையாளர் விவரம்',
  purposeOfDonation: 'நன்கொடையின் நோக்கம்',
  description: 'விவரம்',
  instrumentNo: 'காசோலை/வரைவு எண்',
  instrumentDate: 'காசோலை/வரைவு தேதி',
  realizedAmount: 'பெறப்பட்ட தொகை',
  authorisedSignatory: 'அங்கீகரிக்கப்பட்ட கையொப்பமிடுபவர்',
  signature: 'கையொப்பம்',
  anonymous: 'பெயர் குறிப்பிடாதவர்',
  anonymousDonor: 'பெயர் குறிப்பிடாத நன்கொடையாளர்',
  generalDonation: 'பொது நன்கொடை',
  mobile: 'மொபைல்',
  yes: 'ஆம்',
  no: 'இல்லை',
  notProvided: 'வழங்கப்படவில்லை',
  valid80g: 'இந்த ரசீது 80G வரி விலக்குக்குச் செல்லுபடியாகும்.',
  thankYou: 'உங்கள் தாராள நன்கொடைக்கு நன்றி.',
  donorCopy: 'நன்கொடையாளர் நகல்',
  officeCopy: 'அலுவலக நகல்',
  scanToPay: 'செலுத்த ஸ்கேன் செய்யவும்',
  bhojanshalaToken: 'போஜனசாலை டோக்கன்',
  prasadSlip: 'பிரசாத சீட்டு',
  sevaReceipt: 'சேவை ரசீது',
  token: 'டோக்கன்',
  onePlate: '1 தட்டு',
  breakfast: 'காலை உணவு',
  lunch: 'மதிய உணவு',
  dinner: 'இரவு உணவு',
  subtotal: 'துணைத் தொகை',
  total: 'மொத்தம்',
  forTrust: '{name} சார்பாக',
  computerGenerated: 'இது கணினியில் உருவாக்கப்பட்ட ரசீது; கையொப்பம் தேவையில்லை.',
  eligible80g: '80G தகுதி',
  transactionId: 'பப்புவர் ஐடி',
  status: 'நிலை',
  received: 'பெறப்பட்டது',
  paymentDetails: 'கட்டண விவரம்',
  bankLabel: 'வங்கி',
  accountName: 'கணக்கு பெயர்',
  accountNo: 'கணக்கு எண்',
  ifsc: 'IFSC',
  upiId: 'UPI ஐடி',
  scanToDonate: 'நன்கொடைக்கு ஸ்கேன் செய்யவும்',
  receivedOn: 'பெறப்பட்ட நாள்',
  reference: 'குறிப்பு',
  stayDetails: 'தங்கும் விவரம்',
  checkIn: 'வருகை',
  checkOut: 'புறப்பாடு',
  nights: 'இரவுகள்',
  persons: 'நபர்கள்',
  room: 'அறை',
  guest: 'விருந்தினர்',
  guestIdLabel: 'அடையாள அட்டை',
  advance: 'முன்பணம்',
  securityDeposit: 'வைப்புத்தொகை',
  amountPaid: 'செலுத்திய தொகை',
  balanceDue: 'நிலுவைத் தொகை',
  houseRules: 'விதிமுறைகள்',
  taxInvoice: 'வரி விலைப்பட்டியல்',
  guestFolio: 'விருந்தினர் விவரப் பட்டியல்',
  placeOfSupply: 'வழங்கல் இடம்',
  taxableValue: 'வரிவிதிக்கத்தக்க மதிப்பு',
  hsnSac: 'HSN/SAC',
  billOfSupply: 'வழங்கல் பட்டியல்',
  hsnSummary: 'வரி சுருக்கம் (HSN/SAC வாரியாக)',
  termsConditions: 'விதிமுறைகள் மற்றும் நிபந்தனைகள்',
  duplicateForOffice: 'அலுவலகத்திற்கான இரண்டாம் பிரதி',
  srNo: 'வ.எண்',
  taxRate: 'விகிதம்',
  reverseCharge: 'ரிவர்ஸ் சார்ஜ்',
  guestGstin: 'விருந்தினர் GSTIN',
  originalForRecipient: 'பெறுநருக்கான மூலப் பிரதி',
  gstDeclaration: 'இந்த விலைப்பட்டியலில் குறிப்பிடப்பட்ட சேவைகளின் உண்மையான விலை காட்டப்பட்டுள்ளது என்றும், அனைத்து விவரங்களும் உண்மையானவை மற்றும் சரியானவை என்றும் நாங்கள் அறிவிக்கிறோம்.',
  refunded: 'திருப்பி அளித்த தொகை',
  refundDue: 'திருப்பித் தர வேண்டிய தொகை',
  remarks: 'குறிப்பு',
  qty: 'அளவு',
  supplier: 'வழங்குநர்',
  recipient: 'பெறுநர்',
  roomBill: 'அறை கட்டணச் சீட்டு',
  hallBill: 'மண்டப கட்டணச் சீட்டு',
  paymentsReceived: 'பெறப்பட்ட கட்டணங்கள்',
  noPaymentsRecorded: 'எந்த கட்டணமும் பதிவாகவில்லை',
  total80gEligible: 'மொத்த 80G தகுதியான நன்கொடை',
  section80g5: 'பிரிவு 80G(5)',
  boliIntimation: 'போலி சங்கல்ப அறிவிப்பு',
  pledgedAmount: 'சங்கல்ப தொகை',
  pledgeDate: 'சங்கல்ப தேதி',
  paidSoFar: 'இதுவரை செலுத்தியது',
  outstandingAmount: 'நிலுவைத் தொகை',
  eventName: 'நிகழ்வு',
  soldTo: 'பெறப்பட்டது',
  purpose: 'நோக்கம்',
  anumodana: 'உங்கள் தாராள நன்கொடைக்கு மனமார்ந்த அனுமோதனை. இந்தப் புண்ணிய காரியம் உங்களுக்கும் உங்கள் குடும்பத்திற்கும் சுகமும் சாந்தியும் அளிக்கட்டும்.',
  thanks: 'நன்றி. ஜெய் ஜினேந்திரா.',
  certified80g: 'இந்த நன்கொடை வருமான வரிச் சட்டம், 1961 பிரிவு 80G(5)(vi) இன் கீழ் கழிவுக்குத் தகுதியானது எனச் சான்றளிக்கப்படுகிறது.',
  validUpto: 'செல்லுபடி',
  bank: 'வங்கி',
  authorised: 'அங்கீகரிக்கப்பட்ட கையொப்பமிடுபவர்',
  voided: 'இந்த ரசீது ரத்து செய்யப்பட்டது',
}

const te: ReceiptLabels = {
  donationReceipt: 'విరాళ రసీదు',
  receivedFrom: 'వీరి నుండి అందింది',
  receivedWithThanks: 'కృతజ్ఞతతో స్వీకరించబడింది',
  donationAmount: 'విరాళం మొత్తం',
  amount: 'మొత్తం',
  amountInr: 'మొత్తం (INR)',
  amountInWords: 'మొత్తం అక్షరాలలో',
  category: 'వర్గం',
  paymentMode: 'చెల్లింపు విధానం',
  modeOfPayment: 'చెల్లింపు విధానం',
  mode: 'విధానం',
  date: 'తేదీ',
  receiptNo: 'రసీదు సంఖ్య',
  registrationNo: 'నమోదు సం.',
  darpanNo: 'దర్పణ్',
  pan: 'పాన్',
  donorPan: 'దాత పాన్',
  panOfTrust: 'ట్రస్ట్ పాన్',
  donorName: 'దాత పేరు',
  donorNamePrefix: 'దాత పేరు శ్రీ / శ్రీమతి',
  donorsDetail: 'దాత వివరాలు',
  purposeOfDonation: 'విరాళం ఉద్దేశ్యం',
  description: 'వివరణ',
  instrumentNo: 'చెక్/డీడీ సంఖ్య',
  instrumentDate: 'చెక్/డీడీ తేదీ',
  realizedAmount: 'అందిన మొత్తం',
  authorisedSignatory: 'అధీకృత సంతకందారు',
  signature: 'సంతకం',
  anonymous: 'గుప్త',
  anonymousDonor: 'గుప్త దాత',
  generalDonation: 'సాధారణ విరాళం',
  mobile: 'మొబైల్',
  yes: 'అవును',
  no: 'కాదు',
  notProvided: 'ఇవ్వలేదు',
  valid80g: 'ఈ రసీదు 80G పన్ను మినహాయింపుకు చెల్లుతుంది.',
  thankYou: 'మీ ఉదార విరాళానికి ధన్యవాదాలు.',
  donorCopy: 'దాత ప్రతి',
  officeCopy: 'కార్యాలయ ప్రతి',
  scanToPay: 'చెల్లించడానికి స్కాన్ చేయండి',
  bhojanshalaToken: 'భోజనశాల టోకెన్',
  prasadSlip: 'ప్రసాద చీటీ',
  sevaReceipt: 'సేవా రసీదు',
  token: 'టోకెన్',
  onePlate: '1 ప్లేట్',
  breakfast: 'అల్పాహారం',
  lunch: 'మధ్యాహ్న భోజనం',
  dinner: 'రాత్రి భోజనం',
  subtotal: 'ఉప మొత్తం',
  total: 'మొత్తం',
  forTrust: '{name} తరఫున',
  computerGenerated: 'ఇది కంప్యూటర్ రూపొందించిన రసీదు; సంతకం అవసరం లేదు.',
  eligible80g: '80G అర్హత',
  transactionId: 'లావాదేవీ ఐడి',
  status: 'స్థితి',
  received: 'అందింది',
  paymentDetails: 'చెల్లింపు వివరాలు',
  bankLabel: 'బ్యాంకు',
  accountName: 'ఖాతాదారు పేరు',
  accountNo: 'ఖాతా సం.',
  ifsc: 'IFSC',
  upiId: 'UPI ఐడీ',
  scanToDonate: 'విరాళం కోసం స్కాన్ చేయండి',
  receivedOn: 'అందిన తేదీ',
  reference: 'సూచిక',
  stayDetails: 'బస వివరాలు',
  checkIn: 'రాక',
  checkOut: 'నిష్క్రమణ',
  nights: 'రాత్రులు',
  persons: 'వ్యక్తులు',
  room: 'గది',
  guest: 'అతిథి',
  guestIdLabel: 'గుర్తింపు కార్డు',
  advance: 'అడ్వాన్స్',
  securityDeposit: 'జమా మొత్తం',
  amountPaid: 'చెల్లించిన మొత్తం',
  balanceDue: 'బాకీ మొత్తం',
  houseRules: 'నియమ నిబంధనలు',
  taxInvoice: 'పన్ను ఇన్‌వాయిస్',
  guestFolio: 'అతిథి వివరాల పత్రం',
  placeOfSupply: 'సరఫరా స్థలం',
  taxableValue: 'పన్ను విధించదగిన విలువ',
  hsnSac: 'HSN/SAC',
  billOfSupply: 'సరఫరా బిల్లు',
  hsnSummary: 'పన్ను సారాంశం (HSN/SAC వారీగా)',
  termsConditions: 'నిబంధనలు మరియు షరతులు',
  duplicateForOffice: 'కార్యాలయం కోసం రెండవ ప్రతి',
  srNo: 'క్ర.',
  taxRate: 'రేటు',
  reverseCharge: 'రివర్స్ ఛార్జ్',
  guestGstin: 'అతిథి GSTIN',
  originalForRecipient: 'స్వీకర్తకు అసలు ప్రతి',
  gstDeclaration: 'ఈ ఇన్‌వాయిస్‌లో వివరించిన సేవల వాస్తవ ధర చూపబడింది మరియు అన్ని వివరాలు నిజమైనవి మరియు సరైనవి అని మేము ప్రకటిస్తున్నాము.',
  refunded: 'వాపసు చేసిన మొత్తం',
  refundDue: 'వాపసు ఇవ్వాల్సిన మొత్తం',
  remarks: 'గమనిక',
  qty: 'పరిమాణం',
  supplier: 'సరఫరాదారు',
  recipient: 'స్వీకర్త',
  roomBill: 'గది బిల్లు',
  hallBill: 'హాల్ బిల్లు',
  paymentsReceived: 'స్వీకరించిన చెల్లింపులు',
  noPaymentsRecorded: 'ఏ చెల్లింపూ నమోదు కాలేదు',
  total80gEligible: 'మొత్తం 80G అర్హత దానం',
  section80g5: 'సెక్షన్ 80G(5)',
  boliIntimation: 'బోలి సంకల్ప సూచన',
  pledgedAmount: 'సంకల్ప మొత్తం',
  pledgeDate: 'సంకల్ప తేదీ',
  paidSoFar: 'ఇప్పటివరకు చెల్లించిన',
  outstandingAmount: 'బకాయి మొత్తం',
  eventName: 'కార్యక్రమం',
  soldTo: 'స్వీకరించబడింది',
  purpose: 'ఉద్దేశ్యం',
  anumodana: 'మీ ఉదార విరాళానికి హృదయపూర్వక అనుమోదన. ఈ పుణ్య కార్యం మీకు, మీ కుటుంబానికి సుఖశాంతులు ప్రసాదించాలి.',
  thanks: 'ధన్యవాదాలు. జై జినేంద్ర.',
  certified80g: 'ఈ విరాళం ఆదాయపు పన్ను చట్టం, 1961 లోని సెక్షన్ 80G(5)(vi) కింద మినహాయింపుకు అర్హమైనదని ధృవీకరించబడింది.',
  validUpto: 'చెల్లుబాటు',
  bank: 'బ్యాంక్',
  authorised: 'అధీకృత సంతకందారు',
  voided: 'ఈ రసీదు రద్దు చేయబడింది',
}

export const RECEIPT_LABELS: Record<ReceiptLang, ReceiptLabels> = { en, hi, mr, gu, kn, ta, te }

export function receiptLabels(lang?: string | null): ReceiptLabels {
  // hasOwnProperty: a stray value like 'constructor' must not index the prototype.
  return lang && Object.prototype.hasOwnProperty.call(RECEIPT_LABELS, lang) ? RECEIPT_LABELS[lang as ReceiptLang] : en
}

// ---------------------------------------------------------------------------
// A trust's own wording
// ---------------------------------------------------------------------------

/**
 * Per-trust label overrides: `{ <label key>: { <language>: text } }`.
 *
 * A trust asked to print "Bhet" (gift) where we print "Dan" (donation). Rather
 * than fork a design per trust, the override lands here - on the layer every
 * design already reads every printed word through - so one edit changes the word
 * on all seventeen designs, on both copies, and on the WhatsApp PDF.
 *
 * Only stored per language, never per design: a trust that changes a word means
 * it on its receipts, not on one of them.
 */
export type LabelOverrides = Partial<Record<keyof ReceiptLabels, Record<string, string>>>

/** Long enough for a sentence label like `valid80g`, short enough to stay on the page. */
export const MAX_LABEL_LEN = 160

/**
 * The `{tokens}` a label substitutes at render time.
 *
 * `forTrust` is `For {name}` and prints the trust's name where the token is. A
 * trust that types its own wording over it and leaves the token out gets a
 * signature line with no trust on it - which is what happened: a screenshot of
 * the wording editor showed a person's name typed into that field, and nothing
 * on the screen suggested the braces meant anything.
 *
 * Returned rather than checked, so the editor can SAY which token is required
 * instead of only refusing the save.
 */
export function labelPlaceholders(key: keyof ReceiptLabels): string[] {
  const shipped = String(en[key] ?? '')
  return [...shipped.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[0])
}

/**
 * Words a trust may NOT rewrite.
 *
 * `valid80g` and `computerGenerated` are the two statements on a receipt that
 * are about the law rather than about the trust: one asserts a tax exemption to
 * the donor's assessing officer, the other tells them why there is no wet
 * signature. Both are printed by us on the trust's behalf and a trust editing
 * them is a compliance problem, not a preference. Everything else - every
 * heading, every field name, every blessing - is theirs.
 */
export const LOCKED_LABELS: readonly string[] = [
  // A declaration made TO the tax authority. A trust may rename "Dan" to
  // "Bhet"; it may not restate what it is certifying under Rule 46.
  'gstDeclaration',
  'valid80g', 'computerGenerated',
  // The Act's own section reference. A trust rewriting "Section 80G(5)" on a
  // certificate a donor files with an assessing officer is the same class of
  // problem as rewriting the certification sentence itself.
  'section80g5',
  // The Anumodana sheet's own 80G certification. The same statement `valid80g`
  // makes on the printed designs, in the sheet's words, and locked for the same
  // reason: a trust rewriting the exemption it claims to an assessing officer is
  // a compliance problem rather than a preference.
  'certified80g',
]

/** The keys a trust may override, in the order the editor should show them. */
export const OVERRIDABLE_LABELS: readonly (keyof ReceiptLabels)[] =
  (Object.keys(en) as (keyof ReceiptLabels)[]).filter((k) => !LOCKED_LABELS.includes(k))

/**
 * Rebuild the override map from untrusted input.
 *
 * Rebuilt rather than filtered, for the same reason `parseDefinition` rebuilds:
 * a filter leaves whatever it did not think to look for. Anything unrecognised,
 * over-long, non-string or containing markup is DROPPED rather than throwing -
 * a receipt must still print, and one bad word is not a reason to refuse the
 * whole document. The API validates on save and reports; this is the renderer's
 * own last line, because a stored row outlives the code that wrote it.
 */
export function parseLabelOverrides(raw: unknown): LabelOverrides {
  const out: LabelOverrides = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const allowed = new Set<string>(OVERRIDABLE_LABELS as readonly string[])
  for (const [key, byLang] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) continue
    if (!byLang || typeof byLang !== 'object' || Array.isArray(byLang)) continue
    const langs: Record<string, string> = {}
    for (const [lang, text] of Object.entries(byLang as Record<string, unknown>)) {
      if (!RECEIPT_LANGS.includes(lang as ReceiptLang)) continue
      if (typeof text !== 'string') continue
      const v = text.trim()
      if (!v || v.length > MAX_LABEL_LEN) continue
      // No markup, ever. The renderer escapes receipt DATA, not the label
      // table - labels are template, and a label carrying a tag would be
      // written into the document as one.
      if (v.includes('<') || v.includes('>')) continue
      // Same rule as `labelOverrideIssue`. A stored override that lost its
      // placeholder prints a signature line with no trust name on it, so the
      // shipped label is used instead - a receipt that says the right thing in
      // our words beats one that says the wrong thing in theirs.
      if (labelPlaceholders(key as keyof ReceiptLabels).some((tk) => !v.includes(tk))) continue
      langs[lang] = v
    }
    if (Object.keys(langs).length) out[key as keyof ReceiptLabels] = langs
  }
  return out
}

/**
 * What a trust did wrong, for the save screen. Null when the map is clean.
 *
 * Separate from `parseLabelOverrides`, which silently drops: on save a trust
 * must be TOLD that its 200-character heading will not print, rather than
 * saving it and wondering later why the receipt still says "Donation Amount".
 */
export function labelOverrideIssue(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'Wording must be a set of label values.'
  const allowed = new Set<string>(OVERRIDABLE_LABELS as readonly string[])
  for (const [key, byLang] of Object.entries(raw as Record<string, unknown>)) {
    if (LOCKED_LABELS.includes(key)) return `"${key}" is fixed by law and cannot be changed.`
    if (!allowed.has(key)) return `"${key}" is not a label on a receipt.`
    if (!byLang || typeof byLang !== 'object' || Array.isArray(byLang)) return `"${key}" must hold one wording per language.`
    for (const [lang, text] of Object.entries(byLang as Record<string, unknown>)) {
      if (!RECEIPT_LANGS.includes(lang as ReceiptLang)) return `"${lang}" is not a receipt language.`
      if (typeof text !== 'string') return `The wording for "${key}" must be text.`
      if (text.length > MAX_LABEL_LEN) return `The wording for "${key}" is longer than ${MAX_LABEL_LEN} characters.`
      if (text.includes('<') || text.includes('>')) return 'Wording cannot contain < or >.'
      // A placeholder the shipped label has must survive. Where it goes is the
      // trust's choice - "For X", "X हेतु" and "X करिता" are three different
      // word orders - so it is refused rather than re-appended.
      for (const token of labelPlaceholders(key as keyof ReceiptLabels)) {
        if (!text.includes(token)) {
          return `The wording for "${key}" must still contain ${token}, which is replaced with the trust's name when the receipt prints.`
        }
      }
    }
  }
  return null
}

/**
 * The label table a receipt actually prints from: ours, with the trust's words
 * on top.
 *
 * Falls back per KEY and not per language: a trust that renamed one heading in
 * Hindi keeps our Hindi for everything else, and a trust that renamed it only
 * in English keeps our Hindi untouched. The alternative - an all-or-nothing
 * language override - would make one edit blank out a hundred labels.
 */
export function receiptLabelsFor(lang?: string | null, overrides?: unknown): ReceiptLabels {
  const base = receiptLabels(lang)
  const map = parseLabelOverrides(overrides)
  const keys = Object.keys(map) as (keyof ReceiptLabels)[]
  if (!keys.length) return base
  const l = lang && RECEIPT_LANGS.includes(lang as ReceiptLang) ? lang : 'en'
  const out: ReceiptLabels = { ...base }
  for (const k of keys) {
    const text = map[k]?.[l]
    if (text) out[k] = escapeLabel(text)
  }
  return out
}

/**
 * Escape a trust's wording, HERE and nowhere else.
 *
 * Every label in this table is interpolated into a receipt as template - our own
 * words are, which is why nothing escaped them before - and several designs
 * interpolate one into an ATTRIBUTE, where a bare quote is enough on its own.
 * So a trust's word is escaped, and escaped by the layer that owns it.
 *
 * Deliberately NOT done by `escapeDeep` in receiptTemplates.ts, which escapes
 * receipt DATA on the way in. Having both do it produced `&amp;amp;lt;` on the
 * Anumodana design - three escapes, because that design passes the already
 * escaped block down into a renderer that escapes again. One owner, one escape.
 *
 * Escaping rather than refusing keeps "Donor's Copy" spellable: the entity
 * prints as the apostrophe the trust typed.
 */
export function escapeLabel(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
