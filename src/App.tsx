import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfirmProvider } from './components/ConfirmDialog'
import { DeleteEntryProvider } from './components/DeleteEntryDialog'
import { ToastProvider } from './components/kit/Toast'
import { Layout } from './components/Layout/Layout'
import { LoginPage } from './pages/Login/LoginPage'
import { OfflineSignedOut } from './components/OfflineSignedOut'
import { isOfflineDesktop } from './lib/offlineDesktop'
import { RegisterPage } from './pages/Register/RegisterPage'
import { Dashboard } from './pages/Dashboard/Dashboard'
import { DonationsHub } from './pages/Donations/DonationsHub'
import { AddDonation } from './pages/Donations/AddDonation'
import { ExpensesList } from './pages/Expenses/ExpensesList'
import { AddExpense } from './pages/Expenses/AddExpense'
import { RecurringExpenses } from './pages/Expenses/RecurringExpenses'
import { RoomsList } from './pages/Dharamshala/Rooms/RoomsList'
import { RoomAvailability } from './pages/Dharamshala/Rooms/RoomAvailability'
import { Housekeeping } from './pages/Dharamshala/Rooms/Housekeeping'
import { WebsiteRequests } from './pages/Dharamshala/Rooms/WebsiteRequests'
import { AddRoomCheckin } from './pages/Dharamshala/Rooms/AddRoomCheckin'
import { HallBookingsList } from './pages/Dharamshala/Hall/HallBookingsList'
import { AddHallBooking } from './pages/Dharamshala/Hall/AddHallBooking'
import { PrasadCounter } from './pages/Prasad/PrasadCounter'
import { PrasadItems } from './pages/Prasad/PrasadItems'
import { PrasadSales } from './pages/Prasad/PrasadSales'
import { DevicesPage } from './pages/Devices/DevicesPage'
import { MyAccountPage } from './pages/Settings/MyAccountPage'
import { SevaBookingsList } from './pages/Seva/SevaBookingsList'
import { AddSevaBooking } from './pages/Seva/AddSevaBooking'
import { AnnadaanList } from './pages/Annadaan/AnnadaanList'
import { CattleList } from './pages/Gaushala/CattleList'
import { AddBoli } from './pages/Boli/AddBoli'
import { EventsList } from './pages/Events/EventsList'
import { EventDetail } from './pages/Events/EventDetail'
import { DonorList } from './pages/Donors/DonorList'
import { DonorProfile } from './pages/Donors/DonorProfile'
import { CreditorList } from './pages/Creditors/CreditorList'
import { VendorsPage } from './pages/Masters/VendorsPage'
import { VendorProfile } from './pages/Masters/VendorProfile'
import { PriestsPage } from './pages/Masters/PriestsPage'
import { EmployeesPage } from './pages/Masters/EmployeesPage'
import { PayrollPage } from './pages/Payroll/PayrollPage'
import { StaffPage, StaffProfile } from './pages/Staff/StaffPage'
import { InventoryPage } from './pages/Masters/InventoryPage'
import { ConnectedDevoteesPage } from './pages/Devotees/ConnectedDevoteesPage'
import { ContraEntries } from './pages/Accounts/ContraEntries'
import { FixedAssets } from './pages/Accounts/FixedAssets'
import { Loans } from './pages/Accounts/Loans'
import { DayBook } from './pages/Accounts/DayBook'
import { Ledger } from './pages/Accounts/Ledger'
import { TrialBalance } from './pages/Accounts/TrialBalance'
import { GeneralLedger } from './pages/Accounts/GeneralLedger'
import { ReceiptsPayments } from './pages/Accounts/ReceiptsPayments'
import { IncomeExpenditure } from './pages/Accounts/IncomeExpenditure'
import { BalanceSheet } from './pages/Accounts/BalanceSheet'
import { Cheques } from './pages/Accounts/Cheques'
import { CashBank } from './pages/Accounts/CashBank'
import { BankReconciliation } from './pages/Accounts/BankReconciliation'
import { ReportsHome } from './pages/Reports/ReportsHome'
import { CertificatesPage } from './pages/Certificates/CertificatesPage'
import { LostFoundPage } from './pages/Registers/LostFoundPage'
import { RecycleBinPage } from './pages/Registers/RecycleBinPage'
import { ActivityLogPage } from './pages/Registers/ActivityLogPage'
import { VisitorCountPage } from './pages/Registers/VisitorCountPage'
import { SettingsPage } from './pages/Settings/SettingsPage'
import { SetupWizard } from './pages/Setup/SetupWizard'
import { SantPage } from './pages/Sant/SantPage'
import { HelpPage } from './pages/Help/HelpPage'
import { useAuthStore } from './store/authStore'
import { useProfileStore } from './store/profileStore'

// True when running inside the Electron desktop shell (loaded over file://).
const isDesktop =
  typeof window !== 'undefined' &&
  (Boolean((window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron) ||
    window.location.protocol === 'file:')

function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center h-screen bg-slate-50">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-cta border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600 text-sm">{t('ui.loadingApp')}</p>
      </div>
    </div>
  )
}

export default function App() {
  const { isLoggedIn, accessToken } = useAuthStore()
  const { fetchProfile } = useProfileStore()
  const [initialising, setInitialising] = useState(true)

  useEffect(() => {
    const init = async () => {
      if (isLoggedIn && accessToken) {
        // The profile is a nicety at boot (mandir name in the header) — the app
        // is perfectly usable without it and each screen loads its own data. So
        // cap the wait rather than letting a slow or unreachable API hold the
        // whole shell behind the splash screen; it resolves in the background.
        try {
          await Promise.race([
            fetchProfile(),
            new Promise(resolve => setTimeout(resolve, 6000)),
          ])
        } catch { /* ignore — screens fetch what they need */ }
      }
      setInitialising(false)
    }
    init()
  }, [])

  if (initialising) return <LoadingScreen />

  // Under file:// (Electron desktop) HTML5 history routing 404s on navigation —
  // assets resolve relative to the filesystem root. Use hash routing there.
  const Router = isDesktop ? HashRouter : BrowserRouter

  return (
    <Router>
      <ToastProvider>
      <ConfirmProvider>
      <DeleteEntryProvider>
      <Routes>
        {/* Self-serve Trust/Temple registration. Public, and declared outside
            the auth branch so it is reachable from the website and from the
            login page without a session — and still reachable if a signed-in
            user follows a registration link. */}
        <Route path="/register" element={<RegisterPage />} />
        {!isLoggedIn ? (
          // JainERP Offline signs in at its own PIN screen; the OTP screen
          // cannot work there and is never shown.
          <Route path="*" element={isOfflineDesktop() ? <OfflineSignedOut /> : <LoginPage />} />
        ) : (
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />

            {/* Donations hub — combines Donations, Requests, Pledges (was Boli) as tabs */}
            <Route path="/donations" element={<DonationsHub />} />
            <Route path="/donations/add" element={<AddDonation key="new" />} />
            <Route path="/donations/:id/edit" element={<AddDonation key="edit" />} />
            <Route path="/donation-requests" element={<Navigate to="/donations?tab=requests" replace />} />

            {/* Expenses */}
            <Route path="/expenses" element={<ExpensesList />} />
            <Route path="/expenses/add" element={<AddExpense />} />
            <Route path="/expenses/recurring" element={<RecurringExpenses />} />

            {/* Dharamshala */}
            <Route path="/rooms" element={<RoomsList />} />
            <Route path="/rooms/availability" element={<RoomAvailability />} />
            <Route path="/rooms/housekeeping" element={<Housekeeping />} />
            <Route path="/rooms/requests" element={<WebsiteRequests />} />
            <Route path="/rooms/checkin" element={<AddRoomCheckin />} />
            <Route path="/hall" element={<HallBookingsList />} />
            <Route path="/hall/add" element={<AddHallBooking key="new" />} />
            <Route path="/hall/:id/edit" element={<AddHallBooking key="edit" />} />

            {/* Prasad */}
            <Route path="/prasad" element={<PrasadCounter />} />
            <Route path="/prasad/items" element={<PrasadItems />} />
            <Route path="/prasad/sales" element={<PrasadSales />} />

            {/* Seva */}
            <Route path="/seva" element={<SevaBookingsList />} />
            <Route path="/seva/add" element={<AddSevaBooking />} />

            {/* Bhojanshala */}
            <Route path="/annadaan" element={<AnnadaanList />} />
            <Route path="/gaushala" element={<CattleList />} />

            {/* Boli (Pledges) — list now lives inside the Donations hub as a tab */}
            <Route path="/boli" element={<Navigate to="/donations?tab=pledges" replace />} />
            <Route path="/boli/add" element={<AddBoli />} />
            <Route path="/boli/:id/edit" element={<AddBoli />} />

            {/* Events */}
            <Route path="/events" element={<EventsList />} />
            <Route path="/events/:id" element={<EventDetail />} />

            {/* People */}
            <Route path="/donors" element={<DonorList />} />
            <Route path="/donors/:id" element={<DonorProfile />} />
            <Route path="/creditors" element={<CreditorList />} />
            <Route path="/devotees" element={<ConnectedDevoteesPage />} />

            {/* Masters */}
            <Route path="/masters/vendors" element={<VendorsPage />} />
            <Route path="/masters/vendors/:id" element={<VendorProfile />} />
            <Route path="/masters/priests" element={<PriestsPage />} />
            <Route path="/masters/employees" element={<EmployeesPage />} />
            <Route path="/staff" element={<StaffPage />} />
            {/* One page, three addresses: StaffPage reads its tab from the URL. */}
            <Route path="/staff/attendance" element={<StaffPage />} />
            <Route path="/staff/payroll" element={<StaffPage />} />
            <Route path="/staff/:id" element={<StaffProfile />} />
            <Route path="/payroll" element={<PayrollPage />} />
            <Route path="/masters/inventory" element={<InventoryPage />} />

            {/* Accounts */}
            <Route path="/accounts/cash-bank" element={<CashBank />} />
            <Route path="/accounts/reconciliation" element={<BankReconciliation />} />
            <Route path="/accounts/cheques" element={<Cheques />} />
            <Route path="/accounts/contra" element={<ContraEntries />} />
            <Route path="/accounts/fixed-assets" element={<FixedAssets />} />
            <Route path="/accounts/loans" element={<Loans />} />
            <Route path="/accounts/day-book" element={<DayBook />} />
            <Route path="/accounts/ledger" element={<Ledger />} />
            <Route path="/accounts/trial-balance" element={<TrialBalance />} />
            <Route path="/accounts/general-ledger" element={<GeneralLedger />} />
            <Route path="/accounts/receipts-payments" element={<ReceiptsPayments />} />
            <Route path="/accounts/income-expenditure" element={<IncomeExpenditure />} />
            <Route path="/accounts/balance-sheet" element={<BalanceSheet />} />

            {/* Reports */}
            <Route path="/reports" element={<ReportsHome />} />

            {/* Certificates & TDS */}
            <Route path="/certificates" element={<CertificatesPage />} />

            {/* Registers */}
            <Route path="/registers/lost-found" element={<LostFoundPage />} />
            <Route path="/registers/visitor-count" element={<VisitorCountPage />} />
            <Route path="/registers/recycle-bin" element={<RecycleBinPage />} />
            <Route path="/registers/activity-log" element={<ActivityLogPage />} />
            <Route path="/my-devices" element={<DevicesPage />} />
            <Route path="/my-account" element={<MyAccountPage />} />

            {/* Settings & Help */}
            <Route path="/sant" element={<SantPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* First-login setup. A route, not a modal, so "finish setup later"
                is a link somebody can come back to or be sent. */}
            <Route path="/setup" element={<SetupWizard />} />
            <Route path="/help" element={<HelpPage />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        )}
      </Routes>
      </DeleteEntryProvider>
      </ConfirmProvider>
      </ToastProvider>
    </Router>
  )
}
