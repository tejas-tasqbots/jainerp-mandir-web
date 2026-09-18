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
  printHint: string
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
  registrationNo: 'Registration No.',
  darpanNo: 'Darpan Registration No.',
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
  registrationNo: 'पंजीकरण क्रमांक',
  darpanNo: 'दर्पण पंजीकरण क्रमांक',
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
  registrationNo: 'नोंदणी क्रमांक',
  darpanNo: 'दर्पण नोंदणी क्रमांक',
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
  registrationNo: 'નોંધણી નંબર',
  darpanNo: 'દર્પણ નોંધણી નંબર',
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
  printHint: 'પ્રિન્ટ અથવા PDF માટે Ctrl+P દબાવો',
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
  registrationNo: 'ನೋಂದಣಿ ಸಂಖ್ಯೆ',
  darpanNo: 'ದರ್ಪಣ ನೋಂದಣಿ ಸಂಖ್ಯೆ',
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
  printHint: 'ಮುದ್ರಿಸಲು ಅಥವಾ PDF ಗಾಗಿ Ctrl+P ಒತ್ತಿರಿ',
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
  darpanNo: 'தர்பண் பதிவு எண்',
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
  printHint: 'அச்சிட அல்லது PDF க்கு Ctrl+P அழுத்தவும்',
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
  registrationNo: 'నమోదు సంఖ్య',
  darpanNo: 'దర్పణ్ నమోదు సంఖ్య',
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
  printHint: 'ముద్రించడానికి లేదా PDF కోసం Ctrl+P నొక్కండి',
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
}

export const RECEIPT_LABELS: Record<ReceiptLang, ReceiptLabels> = { en, hi, mr, gu, kn, ta, te }

export function receiptLabels(lang?: string | null): ReceiptLabels {
  // hasOwnProperty: a stray value like 'constructor' must not index the prototype.
  return lang && Object.prototype.hasOwnProperty.call(RECEIPT_LABELS, lang) ? RECEIPT_LABELS[lang as ReceiptLang] : en
}
