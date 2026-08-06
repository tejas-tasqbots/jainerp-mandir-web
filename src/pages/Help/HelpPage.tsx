import { HelpCircle, Phone, Mail, BookOpen, ExternalLink, CheckCircle, Keyboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SHORTCUTS } from '../../lib/shortcuts'

const topics = [
  {
    title: 'Finding & Registering Devotees (Global Devotee Search)',
    steps: [
      'On every form (Donation, Pledge, Seva Booking, Room, Hall, Prasad) the devotee field is a global search box',
      'Type a mobile number or name — matches across ALL temples appear with Verified ✓ and Connected 🔗 badges',
      'Select a match to attach the devotee; their PAN (if verified) flows onto the 80G receipt automatically',
      'Not found? Click "Register on-site": enter name + optional PAN, then "Send OTP"',
      'The devotee shares the 6-digit OTP from their phone; verifying links them to your temple and confirms identity',
      'PAN tip: tick "Don\'t share PAN" to skip it — the receipt then prints with name + mobile only',
      'Offline (desktop): the box becomes plain name + mobile inputs; the record auto-links by mobile when you reconnect',
    ],
  },
  {
    title: 'Recording a Donation',
    steps: [
      'Go to Donations → New Donation',
      'Use the Donor search to find/register a devotee (see "Global Devotee Search" above)',
      'For unnamed gifts choose "Anonymous / Gupt Dan", or "Dan Peti (Donation Box)" for collection-box cash',
      'Select donation category and enter amount + payment mode',
      '80G eligibility is auto-checked (disabled for cash > ₹2000, and for anonymous gifts)',
      'Save — receipt available via the Receipt icon (📄) in the list',
      'To void a donation: click the 🚫 icon and enter a reason (admin only)',
    ],
  },
  {
    title: 'Pledge (Boli) Management',
    steps: [
      'Go to Donations → Pledges tab → New Pledge — use the Devotee search to attach a global devotee (or mark anonymous)',
      'Enter the pledged amount; status will be "Pledged" until payment is recorded',
      'When devotee pays: click the "Pay" button on the pledge entry',
      'Enter amount and payment mode in the modal, then confirm',
      'To waive remaining balance: click ⚠️ icon and enter a reason (admin only)',
      'View intimation details via the 🔔 icon on any boli row',
    ],
  },
  {
    title: '80G Certificates & Form 10BD',
    steps: [
      'Go to Certificates & TDS page',
      'Select the Financial Year (e.g. 2025-26)',
      'Click "Load Eligible Donors" to see 80G-eligible donations',
      'Click "Generate Form 10BD" to create IT-format entries',
      'Download compliance reports from the Download Compliance Files section',
      'Switch to TDS tab to view/export TDS deducted at source',
    ],
  },
  {
    title: 'Room Booking',
    steps: [
      'Go to Dharamshala → Rooms → New Booking',
      'Select available room and enter guest details and dates',
      'Enter advance amount if applicable',
      'Booking appears in the list with "Booked" status',
      'On arrival: click "Check-In" button',
      'On departure: click "Check-Out"; to cancel: click ✕ icon',
    ],
  },
  {
    title: 'Prasad POS Counter',
    steps: [
      'Go to Prasad Counter — item grid shows all active items',
      'Click items to add to cart; use +/- to adjust quantity',
      'Cart shows subtotal, GST, and total automatically',
      'Select payment mode and click Checkout to record the sale',
      'Manage items via Prasad Counter → Manage Items (edit, adjust stock)',
    ],
  },
  {
    title: 'Bhojanshala Tokens',
    steps: [
      'Go to Bhojanshala page — select the date using the date picker',
      'Click "Record Sale" to add a token sale (meal type, quantity, rate)',
      'Summary cards show total tokens and collection for the day',
      'To redeem tokens later: click "Redeem" on any sale row and enter quantity',
    ],
  },
  {
    title: 'Seva (Pooja) Bookings',
    steps: [
      'Go to Seva Booking → New Booking',
      'Select seva type — amount fills automatically from the seva catalog',
      'Use the Devotee search to attach a global devotee (or mark anonymous)',
      'Enter gotra, sankalp names, and date (these stay separate from the devotee record)',
      'Booking list shows status; mark "Done" after the pooja is completed',
    ],
  },
  {
    title: 'Connected Devotees',
    steps: [
      'Go to People → Connected Devotees to manage every devotee linked to your temple',
      'Three tabs: Connected (approved), Pending Requests (devotees who asked to join), Pending Invites (you invited)',
      'Approve / Reject pending requests; cancel a pending invite or remove a connected devotee',
      'Click "Invite Devotee", enter a 10-digit mobile — the devotee gets a notification in the JainERP™ Devotee app to accept',
      'Connected devotees can receive temple notices and appear pre-verified in your forms',
    ],
  },
  {
    title: 'Staff & User Management',
    steps: [
      'Go to Settings → Users',
      'To invite a new staff member: enter mobile, name, and role, then click "Send Invite"',
      'Staff receives an OTP on their mobile to log in',
      'To update role or deactivate: click "Edit" on the staff row',
      'Roles: Admin > Accountant > Cashier > Priest > Volunteer > Viewer',
    ],
  },
]

const apiCoverage = [
  { endpoint: 'POST /auth/send-otp, /verify-otp, /select-tenant', ui: 'Login Page — OTP flow', status: 'connected' },
  { endpoint: 'GET/POST /donations, PATCH /:id/void, GET /:id/receipt', ui: 'Donations List + Add Donation', status: 'connected' },
  { endpoint: 'GET/POST/PATCH/DELETE /expenses', ui: 'Expenses List + Add + Edit + Delete', status: 'connected' },
  { endpoint: 'GET/POST /donors, PATCH /donors/:id, GET /donors/:id/ledger', ui: 'Donor List + Profile (with edit)', status: 'connected' },
  { endpoint: 'GET /devotees/search, POST /devotees/register, POST /devotees/verify-otp', ui: 'DevoteePicker (all transaction forms)', status: 'connected' },
  { endpoint: 'GET /devotee-links, POST /invite, PATCH /:id/approve, /:id/reject, DELETE /:id', ui: 'Connected Devotees page', status: 'connected' },
  { endpoint: 'GET/POST /room-bookings, PATCH /:id/checkin, /checkout, /cancel', ui: 'Rooms List + New Booking', status: 'connected' },
  { endpoint: 'GET/POST/PATCH /hall-bookings', ui: 'Hall Bookings List + Add', status: 'connected' },
  { endpoint: 'GET/POST/PATCH /prasad/items, POST /:id/adjust-stock, POST/GET /prasad/sales', ui: 'Prasad Counter POS + Manage Items', status: 'connected' },
  { endpoint: 'GET/POST/PATCH /seva-bookings', ui: 'Seva Bookings + Add', status: 'connected' },
  { endpoint: 'POST/GET /bhojanshala/sales, PATCH /:id/redeem, GET /daily-summary', ui: 'Bhojanshala with Redeem Tokens', status: 'connected' },
  { endpoint: 'GET/POST/PATCH /bolis, POST /:id/payments, POST /:id/waive, GET /:id/intimation', ui: 'Donations → Pledges tab + Pay + Waive + Intimation', status: 'connected' },
  { endpoint: 'GET/POST/PATCH/DELETE /events, GET /:id/registrations, POST /:id/announce', ui: 'Events List + Detail + Edit + Delete', status: 'connected' },
  { endpoint: 'GET /dashboard', ui: 'Dashboard with KPIs and Charts', status: 'connected' },
  { endpoint: 'GET /reports/daily-collection, /donation-register, /expense-register, /gst-summary', ui: 'Reports page with export', status: 'connected' },
  { endpoint: 'GET /compliance/80g-certificates, POST /form-10bd/generate, GET /tds-report', ui: 'Certificates & TDS page', status: 'connected' },
  { endpoint: 'GET/PATCH /tenants/me, PATCH /tenants/me/privacy, GET /subscription, /usage', ui: 'Settings — Profile + Subscription tabs', status: 'connected' },
  { endpoint: 'GET/POST/PATCH /users', ui: 'Settings → Users', status: 'connected' },
  { endpoint: 'GET/POST/PATCH /vendors, /priests, /employees, /volunteers', ui: 'Masters — Vendors, Priests, Employees', status: 'connected' },
  { endpoint: 'GET/POST/PATCH /inventory-items', ui: 'Masters — Inventory', status: 'connected' },
  { endpoint: 'GET /accounting/ledger, /day-book, /income-expenditure, /balance-sheet', ui: 'Accounts module', status: 'connected' },
  { endpoint: 'GET/POST /registers/lost-found, /visitor-counts', ui: 'Registers — Lost & Found, Visitor Count', status: 'connected' },
]

export function HelpPage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-xl font-bold text-navy-900">{t('ui.userGuideHelp')}</h1>

      {/* Keyboard shortcuts */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
            <Keyboard size={15} /> {t('shortcuts.title')}
          </h3>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 gap-x-8 gap-y-2">
            {SHORTCUTS.map(s => (
              <div key={s.keys} className="flex items-center justify-between text-sm py-1">
                <span className="text-slate-600">{t(s.labelKey)}</span>
                <kbd className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-xs text-slate-600">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick guides */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
            <HelpCircle size={15} />{t('ui.stepByStep')}</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 gap-5">
            {topics.map(topic => (
              <div key={topic.title} className="border border-slate-100 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-navy-900 mb-3 flex items-center gap-2">
                  <BookOpen size={13} className="text-brand-red flex-shrink-0" /> {topic.title}
                </h4>
                <ol className="space-y-1.5">
                  {topic.steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs text-slate-600">
                      <span className="w-4 h-4 bg-brand-red text-white rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold">{i+1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* API Coverage Table */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-sm text-navy-900 flex items-center gap-2">
            <CheckCircle size={15} />{t('ui.apiConnStatus')}</h3>
          <span className="badge-green">{apiCoverage.filter(a => a.status === 'connected').length} / {apiCoverage.length} endpoints connected</span>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>{t('ui.apiEndpoint')}</th><th>{t('ui.connectedUi')}</th><th>{t('ui.status')}</th></tr></thead>
            <tbody>
              {apiCoverage.map((a, i) => (
                <tr key={i}>
                  <td className="font-mono text-xs text-slate-600">{a.endpoint}</td>
                  <td className="text-sm">{a.ui}</td>
                  <td><span className="badge-green flex items-center gap-1"><CheckCircle size={10} />{t('ui.connected')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Support */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-sm">{t('ui.supportFeedback')}</h3></div>
        <div className="card-body">
          <div className="grid grid-cols-3 gap-4">
            <a href="tel:+911234567890" className="flex items-center gap-3 p-4 border border-slate-200 rounded-lg hover:border-brand-blue hover:bg-blue-50 transition-colors group">
              <div className="p-2 bg-green-100 rounded-lg"><Phone size={16} className="text-green-600" /></div>
              <div>
                <p className="font-medium text-sm">{t('ui.callSupport')}</p>
                <p className="text-xs text-slate-400">{t('ui.supportHours')}</p>
              </div>
            </a>
            <a href="mailto:support@tasqbots.com" className="flex items-center gap-3 p-4 border border-slate-200 rounded-lg hover:border-brand-blue hover:bg-blue-50 transition-colors group">
              <div className="p-2 bg-blue-100 rounded-lg"><Mail size={16} className="text-blue-600" /></div>
              <div>
                <p className="font-medium text-sm">{t('ui.emailSupport')}</p>
                <p className="text-xs text-slate-400">support@tasqbots.com</p>
              </div>
            </a>
            <a href="/settings" className="flex items-center gap-3 p-4 border border-slate-200 rounded-lg hover:border-brand-blue hover:bg-blue-50 transition-colors">
              <div className="p-2 bg-orange-100 rounded-lg"><ExternalLink size={16} className="text-orange-600" /></div>
              <div>
                <p className="font-medium text-sm">{t('ui.raiseRequirement')}</p>
                <p className="text-xs text-slate-400">Settings → Privacy &amp; Sync</p>
              </div>
            </a>
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-slate-400 py-4">
        <p>JainERP™ v2.0 — Powered by Tasqbots Technologies Pvt. Ltd.</p>
        <p className="mt-1">© {new Date().getFullYear()} All rights reserved</p>
      </div>
    </div>
  )
}
