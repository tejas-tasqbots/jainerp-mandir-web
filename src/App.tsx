import { useEffect, useState } from 'react'
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfirmProvider } from './components/ConfirmDialog'
import { Layout } from './components/Layout/Layout'
import { LoginPage } from './pages/Login/LoginPage'
import { Dashboard } from './pages/Dashboard/Dashboard'
import { DonationsHub } from './pages/Donations/DonationsHub'
import { AddDonation } from './pages/Donations/AddDonation'
import { ExpensesList } from './pages/Expenses/ExpensesList'
import { AddExpense } from './pages/Expenses/AddExpense'
import { RoomsList } from './pages/Dharamshala/Rooms/RoomsList'
import { AddRoomCheckin } from './pages/Dharamshala/Rooms/AddRoomCheckin'
import { HallBookingsList } from './pages/Dharamshala/Hall/HallBookingsList'
import { AddHallBooking } from './pages/Dharamshala/Hall/AddHallBooking'
import { PrasadCounter } from './pages/Prasad/PrasadCounter'
import { PrasadItems } from './pages/Prasad/PrasadItems'
import { SevaBookingsList } from './pages/Seva/SevaBookingsList'
import { AddSevaBooking } from './pages/Seva/AddSevaBooking'
import { AnnadaanList } from './pages/Annadaan/AnnadaanList'
import { BoliList } from './pages/Boli/BoliList'
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
import { InventoryPage } from './pages/Masters/InventoryPage'
import { ConnectedDevoteesPage } from './pages/Devotees/ConnectedDevoteesPage'
import { ContraEntries } from './pages/Accounts/ContraEntries'
import { FixedAssets } from './pages/Accounts/FixedAssets'
import { Loans } from './pages/Accounts/Loans'
import { CashBook } from './pages/Accounts/CashBook'
import { DayBook } from './pages/Accounts/DayBook'
import { Ledger } from './pages/Accounts/Ledger'
import { TrialBalance } from './pages/Accounts/TrialBalance'
import { ReceiptsPayments } from './pages/Accounts/ReceiptsPayments'
import { IncomeExpenditure } from './pages/Accounts/IncomeExpenditure'
import { BalanceSheet } from './pages/Accounts/BalanceSheet'
import { ReportsHome } from './pages/Reports/ReportsHome'
import { CertificatesPage } from './pages/Certificates/CertificatesPage'
import { LostFoundPage } from './pages/Registers/LostFoundPage'
import { VisitorCountPage } from './pages/Registers/VisitorCountPage'
import { SettingsPage } from './pages/Settings/SettingsPage'
import { MaharajPage } from './pages/Maharaj/MaharajPage'
import { HelpPage } from './pages/Help/HelpPage'
import { useAuthStore } from './store/authStore'
import { useProfileStore } from './store/profileStore'

// True when running inside the Electron desktop shell (loaded over file://).
const isDesktop =
  typeof window !== 'undefined' &&
  (Boolean((window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron) ||
    window.location.protocol === 'file:')

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen bg-slate-50">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-cta border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600 text-sm">Loading JainERP™...</p>
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
        try { await fetchProfile() } catch { /* ignore */ }
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
      <ConfirmProvider>
      <Routes>
        {!isLoggedIn ? (
          <Route path="*" element={<LoginPage />} />
        ) : (
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />

            {/* Donations hub — combines Donations, Requests, Pledges (was Boli) as tabs */}
            <Route path="/donations" element={<DonationsHub />} />
            <Route path="/donations/add" element={<AddDonation />} />
            <Route path="/donations/:id/edit" element={<AddDonation />} />
            <Route path="/donation-requests" element={<Navigate to="/donations?tab=requests" replace />} />

            {/* Expenses */}
            <Route path="/expenses" element={<ExpensesList />} />
            <Route path="/expenses/add" element={<AddExpense />} />

            {/* Dharamshala */}
            <Route path="/rooms" element={<RoomsList />} />
            <Route path="/rooms/checkin" element={<AddRoomCheckin />} />
            <Route path="/hall" element={<HallBookingsList />} />
            <Route path="/hall/add" element={<AddHallBooking />} />

            {/* Prasad */}
            <Route path="/prasad" element={<PrasadCounter />} />
            <Route path="/prasad/items" element={<PrasadItems />} />

            {/* Seva */}
            <Route path="/seva" element={<SevaBookingsList />} />
            <Route path="/seva/add" element={<AddSevaBooking />} />

            {/* Bhojanshala */}
            <Route path="/annadaan" element={<AnnadaanList />} />

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
            <Route path="/masters/inventory" element={<InventoryPage />} />

            {/* Accounts */}
            <Route path="/accounts/contra" element={<ContraEntries />} />
            <Route path="/accounts/fixed-assets" element={<FixedAssets />} />
            <Route path="/accounts/loans" element={<Loans />} />
            <Route path="/accounts/cash-book" element={<CashBook />} />
            <Route path="/accounts/bank-book" element={<CashBook bankMode />} />
            <Route path="/accounts/day-book" element={<DayBook />} />
            <Route path="/accounts/ledger" element={<Ledger />} />
            <Route path="/accounts/trial-balance" element={<TrialBalance />} />
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

            {/* Settings & Help */}
            <Route path="/maharaj" element={<MaharajPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        )}
      </Routes>
      </ConfirmProvider>
    </Router>
  )
}
