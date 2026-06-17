// ─── Auth ────────────────────────────────────────────────────────────────────
export type Role = 'temple_admin' | 'cashier' | 'accountant' | 'priest' | 'volunteer' | 'viewer'

export interface TenantMembership {
  tenant_id: string
  tenant_name: string
  tenant_slug: string
  roles: Role[]
}

// ─── Common ──────────────────────────────────────────────────────────────────
export type PaymentMode = 'cash' | 'upi' | 'cheque' | 'netbanking' | 'online'

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  total_pages: number
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  meta?: PaginationMeta
  error?: { code: string; message: string }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
export interface DashboardOverview {
  period: string
  donations: { total_paise: number; count: number }
  expenses: { total_paise: number; count: number }
  visitors: number
  donors: number
  employees: number
  rooms_available: number
  bolis: { open: number; outstanding_paise: number }
  events: { upcoming: Event[]; past: Event[] }
}

// ─── Donations ───────────────────────────────────────────────────────────────
export interface DonationCategory {
  id: string
  name: string
  is_80g_eligible: boolean
  is_active: boolean
}

export interface Donation {
  id: string
  donor_id?: string
  donor_name?: string
  donor_mobile?: string
  category_id: string
  category_name?: string
  amount_paise: number
  payment_mode: PaymentMode
  utr_number?: string
  is_80g_eligible: boolean
  invoice_no: string
  receipt_cdn_url?: string
  source: string
  is_voided: boolean
  void_reason?: string
  created_at: string
}

// ─── Donors ──────────────────────────────────────────────────────────────────
export interface Donor {
  id: string
  name: string
  mobile: string
  email?: string
  pan_masked?: string
  gotra?: string
  city?: string
  state?: string
  pincode?: string
  cumulative_amount_current_fy_paise?: number
  is_active: boolean
  created_at: string
}

// ─── Boli ────────────────────────────────────────────────────────────────────
export type BoliStatus = 'pledged' | 'partially_paid' | 'paid' | 'waived'
export type BoliType = 'aarti' | 'pratistha' | 'seva' | 'chadhava' | 'other'

export interface Boli {
  id: string
  devotee_id?: string
  devotee_name: string
  devotee_mobile?: string
  event_id?: string
  boli_type: BoliType
  description?: string
  pledged_amount_paise: number
  paid_amount_paise: number
  outstanding_paise: number
  pledge_date: string
  due_date?: string
  status: BoliStatus
  created_at: string
}

// ─── Expenses ────────────────────────────────────────────────────────────────
export interface Expense {
  id: string
  vendor_name?: string
  category_name?: string
  description: string
  amount_paise: number
  payment_mode: PaymentMode
  bill_number?: string
  bill_date?: string
  is_on_credit: boolean
  gst_amount_paise?: number
  receipt_cdn_url?: string
  created_at: string
}

// ─── Rooms ───────────────────────────────────────────────────────────────────
export type BookingStatus = 'booked' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled'

export interface Room {
  id: string
  room_number: string
  room_type: string
  capacity: number
  tariff_per_night_paise: number
  floor?: string
  is_available: boolean
}

export interface RoomBooking {
  id: string
  room_id: string
  room_number?: string
  guest_name: string
  guest_mobile: string
  guest_id_type?: string
  check_in_date: string
  check_out_date: string
  persons_count: number
  advance_paise: number
  tariff_per_night_paise: number
  total_paise: number
  balance_paise: number
  status: BookingStatus
  created_at: string
}

// ─── Hall ────────────────────────────────────────────────────────────────────
export type SessionType = 'hourly' | 'morning' | 'evening' | 'full_day'
export type HallBookingStatus = 'confirmed' | 'completed' | 'cancelled'

export interface Hall {
  id: string
  name: string
  capacity: number
  hourly_rate_paise?: number
  full_day_rate_paise?: number
}

export interface HallBooking {
  id: string
  hall_id: string
  hall_name?: string
  event_name: string
  booking_date: string
  session_type: SessionType
  subtotal_paise: number
  cgst_paise: number
  sgst_paise: number
  total_paise: number
  advance_paise: number
  status: HallBookingStatus
  created_at: string
}

// ─── Prasad ──────────────────────────────────────────────────────────────────
export interface PrasadItem {
  id: string
  name: string
  name_hindi?: string
  unit?: string
  price_paise: number
  gst_rate: number
  stock_qty: number
  low_stock_threshold?: number
  is_available: boolean
  sort_order?: number
}

export interface PrasadSaleItem {
  item_id: string
  item_name: string
  qty: number
  price_paise: number
}

export interface PrasadSale {
  id: string
  items: PrasadSaleItem[]
  subtotal_paise: number
  gst_paise: number
  total_paise: number
  payment_mode: PaymentMode
  buyer_name?: string
  buyer_mobile?: string
  created_at: string
}

// ─── Seva ────────────────────────────────────────────────────────────────────
export type SevaStatus = 'confirmed' | 'completed' | 'cancelled'

export interface Seva {
  id: string
  name: string
  description?: string
  amount_paise: number
  duration_minutes?: number
  is_active: boolean
}

export interface SevaBooking {
  id: string
  seva_id: string
  seva_name?: string
  devotee_name: string
  devotee_mobile: string
  gotra?: string
  sankalp_names?: string
  booking_date: string
  slot_time?: string
  amount_paise: number
  payment_mode: PaymentMode
  status: SevaStatus
  receipt_cdn_url?: string
  created_at: string
}

// ─── Bhojanshala ─────────────────────────────────────────────────────────────
export type MealType = 'breakfast' | 'lunch' | 'dinner'

export interface BhojanshalaSale {
  id: string
  meal_type: MealType
  tokens: number
  rate_paise: number
  total_paise: number
  payment_mode: PaymentMode
  devotee_mobile?: string
  created_at: string
}

// ─── Events ──────────────────────────────────────────────────────────────────
export type EventType = 'festival' | 'pravachan' | 'utsav' | 'camp' | 'yatra' | 'bhajan' | 'annadan' | 'other'
export type EventStatus = 'planned' | 'executing' | 'completed' | 'cancelled'

export interface Event {
  id: string
  name: string
  event_type: EventType
  start_date: string
  end_date: string
  estimated_budget_paise?: number
  allow_registration: boolean
  registration_fee_paise?: number
  status: EventStatus
  description?: string
  created_at: string
}

export interface EventRegistration {
  id: string
  event_id: string
  registrant_name: string
  mobile: string
  attendee_count: number
  payment_mode?: PaymentMode
  amount_paise?: number
  status: 'registered' | 'attended' | 'cancelled'
  created_at: string
}

// ─── Accounts ────────────────────────────────────────────────────────────────
export interface Account {
  id: string
  name: string
  type: 'cash' | 'bank'
  account_number?: string
  bank_name?: string
  ifsc?: string
  is_default_cash: boolean
  is_active: boolean
}

export interface FixedAsset {
  id: string
  name: string
  purchase_date: string
  purchase_cost_paise: number
  useful_life_years: number
  depreciation_method: 'SLM' | 'WDV'
  depreciation_rate: number
  accumulated_depreciation_paise: number
  active: boolean
}

export interface Loan {
  id: string
  type: 'taken' | 'given'
  party_name: string
  principal_paise: number
  interest_rate: number
  start_date: string
  end_date?: string
  repaid_paise: number
  status: 'active' | 'closed'
}

export interface Creditor {
  id: string
  vendor_name?: string
  description: string
  original_amount_paise: number
  due_date?: string
  paid_amount_paise: number
  status: 'pending' | 'partially_paid' | 'paid'
  created_at: string
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export interface LedgerEntry {
  date: string
  description: string
  debit_paise: number
  credit_paise: number
  balance_paise: number
  reference?: string
}

export interface DayBookEntry {
  date: string
  type: string
  description: string
  debit_paise: number
  credit_paise: number
  reference?: string
}

// ─── Lost & Found ────────────────────────────────────────────────────────────
export type LostFoundStatus = 'unclaimed' | 'claimed' | 'donated' | 'disposed'

export interface LostFoundItem {
  id: string
  description: string
  found_date: string
  found_location?: string
  photo_cdn_url?: string
  status: LostFoundStatus
  claimant_name?: string
  claimant_mobile?: string
  claimed_at?: string
  notes?: string
}

// ─── Visitor Count ────────────────────────────────────────────────────────────
export interface VisitorCount {
  id: string
  count_date: string
  morning_count?: number
  evening_count?: number
  peak_count?: number
  total_count: number
  notes?: string
}

// ─── Users ───────────────────────────────────────────────────────────────────
export interface TenantUser {
  id: string
  mobile: string
  name: string | null
  roles: Role[]
  is_active: boolean
  last_seen_at?: string
}
