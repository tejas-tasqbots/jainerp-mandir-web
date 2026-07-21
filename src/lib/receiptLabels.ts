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
export type ReceiptLang = 'en' | 'hi' | 'mr'

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
  printHint: string
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
  printHint: 'Ctrl+P to print or save as PDF',
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
  printHint: 'प्रिंट या PDF के लिए Ctrl+P दबाएँ',
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
  printHint: 'प्रिंट किंवा PDF साठी Ctrl+P दाबा',
}

export const RECEIPT_LABELS: Record<ReceiptLang, ReceiptLabels> = { en, hi, mr }

export function receiptLabels(lang?: string | null): ReceiptLabels {
  return RECEIPT_LABELS[(lang as ReceiptLang)] ?? en
}
