import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import {
  BedDouble, Building2, CreditCard, Gavel, Gift, HandCoins, PackagePlus, Percent, PiggyBank, Sparkles, Tags,
  UtensilsCrossed, Wallet, type LucideIcon,
} from 'lucide-react'
import { api } from '../../lib/api'
import { MasterEditor } from './MasterEditor'
import { useTrustHas80g } from '../../store/profileStore'
import { BhojanshalaRates } from './BhojanshalaRates'
import { HallPackagesEditor } from './HallPackagesEditor'

/**
 * Settings → Categories & Dropdowns, one list at a time.
 *
 * It used to be ten editors stacked on one page - donation categories, funds,
 * expense heads, payment modes, sevas, GST, room extras, halls, rooms,
 * bhojanshala rates, prasad - so finding the one you wanted meant scrolling
 * past the other nine (founder, 2026-09-24: "this page scrolling is too long").
 * Now a rail groups them by the counter they feed, shows how many entries each
 * has, and the page shows only the list picked. The pick is `?sub=` in the
 * URL, so a link (the bhojanshala counter's "no rate set") lands on it.
 */

type Group = 'donations' | 'payments' | 'expenses' | 'seva' | 'stay' | 'food'
interface ListDef {
  id: string
  group: Group
  icon: LucideIcon
  title: string
  /** The master resource, for the entry count; none for a form like the plate rates. */
  resource?: string
  listParams?: Record<string, string>
  render: () => React.ReactNode
}

const GROUPS: Group[] = ['donations', 'payments', 'expenses', 'seva', 'stay', 'food']
export const DEFAULT_MASTER = 'donation-categories'

export function MastersTab() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const has80g = useTrustHas80g()

  const lists: ListDef[] = useMemo(() => [
    {
      id: 'donation-categories', group: 'donations', icon: HandCoins, resource: 'donation-categories',
      title: t('settings.masters.donationCategories'),
      render: () => (
        <MasterEditor
          resource="donation-categories"
          title={t('settings.masters.donationCategories')}
          description={t('settings.masters.donationCategoriesDesc')}
          onCount={n => setCounts(c => ({ ...c, 'donation-categories': n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderGeneral') as string },
            // Which fund this head's gifts belong to (tenant-migration 038).
            // Set once here, so the donation counter never asks; the fund
            // carries the statutory bucket (corpus / specific / general).
            {
              key: 'fund_id', label: t('settings.masters.fields.fund'), type: 'select',
              optionsFrom: { resource: 'funds' }, emptyLabel: t('settings.masters.fields.fundNone') as string,
            },
            ...(has80g ? [{ key: 'is_80g_eligible', label: t('settings.masters.fields.is80gEligible'), type: 'checkbox' as const, default: true }] : []),
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
          ]}
        />
      ),
    },
    {
      // Named funds (tenant-migration 036). Separate from the donation
      // CATEGORY, which says what a gift was for; a fund says whose money it
      // is and what it may be spent on. Dev Dravya, Jivdaya and Sadharan are
      // added here - they are not seeded, because they would be wrong for a
      // trust outside the Jain tradition.
      id: 'funds', group: 'donations', icon: PiggyBank, resource: 'funds',
      title: t('settings.masters.funds'),
      render: () => (
        <MasterEditor
          resource="funds"
          title={t('settings.masters.funds')}
          description={t('settings.masters.fundsDesc')}
          onCount={n => setCounts(c => ({ ...c, funds: n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: 'Dev Dravya' },
            {
              key: 'fund_type', label: t('settings.masters.fields.fundType'), type: 'select', default: 'general',
              options: [
                { value: 'general', label: t('donations.fundGeneral') },
                { value: 'specific', label: t('donations.fundSpecific') },
                { value: 'corpus', label: t('donations.fundCorpus') },
              ],
            },
            { key: 'is_restricted', label: t('settings.masters.fields.isRestricted'), type: 'checkbox', default: true },
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
          ]}
        />
      ),
    },
    {
      // The trust's own boli types (tenant migration 061) — they were five
      // words hardcoded in the New boli form. A type can name the fund its
      // collections belong to: Dev Dravya for an aarti boli, in the Jain way.
      id: 'boli-categories', group: 'donations', icon: Gavel, resource: 'boli-categories',
      title: t('settings.masters.boliCategories'),
      render: () => (
        <MasterEditor
          resource="boli-categories"
          title={t('settings.masters.boliCategories')}
          description={t('settings.masters.boliCategoriesDesc')}
          onCount={n => setCounts(c => ({ ...c, 'boli-categories': n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: 'Shantidhara' },
            { key: 'name_hindi', label: t('settings.masters.fields.nameHindi'), placeholder: 'शांतिधारा' },
            {
              key: 'fund_id', label: t('settings.masters.fields.fund'), type: 'select',
              optionsFrom: { resource: 'funds' }, emptyLabel: t('settings.masters.fields.fundNone') as string,
            },
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
          ]}
        />
      ),
    },
    {
      id: 'payment-modes', group: 'payments', icon: CreditCard, resource: 'payment-modes',
      title: t('settings.masters.paymentModes'),
      render: () => (
        <MasterEditor
          resource="payment-modes"
          title={t('settings.masters.paymentModes')}
          description={t('settings.masters.paymentModesDesc')}
          onCount={n => setCounts(c => ({ ...c, 'payment-modes': n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.displayName'), required: true, placeholder: t('settings.masters.fields.namePlaceholderUpi') as string },
            { key: 'code', label: t('settings.masters.fields.code'), required: true, placeholder: t('settings.masters.fields.codePlaceholder') as string },
            { key: 'requires_reference', label: t('settings.masters.fields.requiresRef'), type: 'checkbox' },
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
          ]}
        />
      ),
    },
    {
      id: 'gst-rates', group: 'payments', icon: Percent, resource: 'gst-rates',
      title: t('settings.masters.gstRates'),
      render: () => (
        <MasterEditor
          resource="gst-rates"
          title={t('settings.masters.gstRates')}
          description={t('settings.masters.gstRatesDesc')}
          onCount={n => setCounts(c => ({ ...c, 'gst-rates': n }))}
          fields={[
            { key: 'service', label: t('settings.masters.fields.service'), required: true, placeholder: t('settings.masters.fields.servicePlaceholder') as string },
            { key: 'cgst', label: t('settings.masters.fields.cgst'), type: 'number', placeholder: '9' },
            { key: 'sgst', label: t('settings.masters.fields.sgst'), type: 'number', placeholder: '9' },
            { key: 'igst', label: t('settings.masters.fields.igst'), type: 'number', placeholder: '18' },
          ]}
        />
      ),
    },
    {
      id: 'expense-categories', group: 'expenses', icon: Wallet, resource: 'expense-categories',
      title: t('settings.masters.expenseCategories'),
      render: () => (
        <MasterEditor
          resource="expense-categories"
          title={t('settings.masters.expenseCategories')}
          description={t('settings.masters.expenseCategoriesDesc')}
          onCount={n => setCounts(c => ({ ...c, 'expense-categories': n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderElectricity') as string },
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
          ]}
        />
      ),
    },
    {
      id: 'sevas', group: 'seva', icon: Sparkles, resource: 'services',
      title: t('settings.masters.sevas'),
      render: () => (
        <MasterEditor
          resource="services"
          title={t('settings.masters.sevas')}
          description={t('settings.masters.sevasDesc')}
          onCount={n => setCounts(c => ({ ...c, sevas: n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderAbhishek') as string },
            { key: 'name_hindi', label: t('settings.masters.fields.nameHindi'), placeholder: 'अभिषेक' },
            { key: 'price_paise', label: t('settings.masters.fields.amountRupees'), type: 'money', placeholder: '0.00', required: true },
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
          ]}
        />
      ),
    },
    {
      id: 'prasad', group: 'seva', icon: Gift, resource: 'prasad/items',
      title: t('settings.masters.prasadItems'),
      render: () => (
        <MasterEditor
          resource="prasad/items"
          title={t('settings.masters.prasadItems')}
          description={t('settings.masters.prasadItemsDesc')}
          statusField="is_available"
          onCount={n => setCounts(c => ({ ...c, prasad: n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderLadoo') as string },
            { key: 'name_hindi', label: t('settings.masters.fields.nameHindi'), placeholder: 'लड्डू' },
            { key: 'unit', label: t('settings.masters.fields.unit'), placeholder: t('settings.masters.fields.unitPlaceholder') as string, default: 'piece' },
            { key: 'price_paise', label: t('settings.masters.fields.priceRupees'), type: 'money', required: true, placeholder: '0.00' },
            { key: 'gst_rate', label: t('settings.masters.fields.gstPercentField'), type: 'number', placeholder: '0', default: 0 },
            { key: 'low_stock_threshold', label: t('settings.masters.fields.lowStockAlert'), type: 'number', placeholder: '10', default: 10 },
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0', default: 0 },
          ]}
        />
      ),
    },
    {
      id: 'rooms', group: 'stay', icon: BedDouble, resource: 'rooms',
      title: t('settings.masters.rooms'),
      render: () => (
        <MasterEditor
          resource="rooms"
          title={t('settings.masters.rooms')}
          description={t('settings.masters.roomsDesc')}
          statusField="is_available"
          onCount={n => setCounts(c => ({ ...c, rooms: n }))}
          fields={[
            { key: 'room_number', label: t('settings.masters.fields.roomNo'), required: true, placeholder: t('settings.masters.fields.roomNoPlaceholder') as string },
            { key: 'name', label: t('settings.masters.fields.nameType'), placeholder: t('settings.masters.fields.nameTypePlaceholder') as string },
            // Where the room is, so the room board can show it building by
            // building and floor by floor (tenant migration 053). Both are
            // optional: a one-building trust leaves Building empty.
            { key: 'building', label: t('settings.masters.fields.building'), placeholder: t('settings.masters.fields.buildingPlaceholder') as string, clearable: true },
            { key: 'floor', label: t('settings.masters.fields.floor'), type: 'number', placeholder: t('settings.masters.fields.floorPlaceholder') as string },
            { key: 'capacity_persons', label: t('settings.masters.fields.capacity'), type: 'number', placeholder: '0' },
            { key: 'tariff_paise', label: t('settings.masters.fields.tariffPerNight'), type: 'money', placeholder: '0' },
            { key: 'gst_rate', label: t('settings.masters.fields.gstPercent'), type: 'number', placeholder: '0' },
            // Shown to a devotee choosing a room in the Bhakt app and portal
            // (tenant-migration 040). The first photo is the one a search card uses.
            { key: 'images', label: t('settings.masters.fields.roomPhotos'), type: 'images' },
          ]}
        />
      ),
    },
    {
      // The stay extras' price list (tenant migration 057): what the desk
      // picks from in the Extra charges dropdown.
      id: 'room-charges', group: 'stay', icon: PackagePlus, resource: 'room-charge-items', listParams: { all: 'true' },
      title: t('roomCharges.priceList'),
      render: () => (
        <MasterEditor
          resource="room-charge-items"
          title={t('roomCharges.priceList')}
          description={t('roomCharges.priceListHint')}
          listParams={{ all: 'true' }}
          onCount={n => setCounts(c => ({ ...c, 'room-charges': n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('roomCharges.newItemPlaceholder') as string },
            { key: 'default_rate_paise', label: t('roomCharges.rate'), type: 'money', placeholder: '0.00' },
            { key: 'per_night', label: t('roomCharges.perNight'), type: 'checkbox' },
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
          ]}
        />
      ),
    },
    {
      id: 'halls', group: 'stay', icon: Building2, resource: 'halls',
      title: t('settings.masters.halls'),
      render: () => (
        <MasterEditor
          resource="halls"
          title={t('settings.masters.halls')}
          description={t('settings.masters.hallsDesc')}
          statusField="is_available"
          onCount={n => setCounts(c => ({ ...c, halls: n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('settings.masters.fields.namePlaceholderMainHall') as string },
            // A lawn, a dining hall or a terrace is let the same way as a hall
            // and can go into a package with it (tenant migration 061).
            {
              key: 'venue_type', label: t('settings.masters.fields.venueType'), type: 'select', default: 'hall',
              options: [
                { value: 'hall', label: t('hallPackages.venue.hall') },
                { value: 'lawn', label: t('hallPackages.venue.lawn') },
                { value: 'dining', label: t('hallPackages.venue.dining') },
                { value: 'terrace', label: t('hallPackages.venue.terrace') },
                { value: 'other', label: t('hallPackages.venue.other') },
              ],
            },
            { key: 'capacity_persons', label: t('settings.masters.fields.capacity'), type: 'number', placeholder: '0' },
            { key: 'fullday_tariff_paise', label: t('settings.masters.fields.fullDayTariff'), type: 'money', placeholder: '0' },
            { key: 'session_tariff_paise', label: t('settings.masters.fields.sessionTariff'), type: 'money', placeholder: '0' },
            { key: 'hourly_tariff_paise', label: t('settings.masters.fields.hourlyTariff'), type: 'money', placeholder: '0' },
            { key: 'gst_rate', label: t('settings.masters.fields.gstPercent'), type: 'number', placeholder: '0' },
            // Shown to devotees deciding where to hold a function
            // (tenant-migration 040). The first is the one a listing uses.
            { key: 'images', label: t('settings.masters.fields.hallPhotos'), type: 'images' },
          ]}
        />
      ),
    },
    {
      // Packages — several halls, lawns and rooms at one price — and what each
      // venue costs per rate category (tenant migration 061).
      id: 'hall-packages', group: 'stay', icon: Building2,
      title: t('hallPackages.title'),
      render: () => <HallPackagesEditor />,
    },
    {
      // What a hall booking can add on top (tenant migration 061): decoration,
      // electricity, generator, sound ... at the trust's own rates.
      id: 'hall-charges', group: 'stay', icon: PackagePlus, resource: 'hall-charge-items',
      title: t('hallPackages.extrasList'),
      render: () => (
        <MasterEditor
          resource="hall-charge-items"
          title={t('hallPackages.extrasList')}
          description={t('hallPackages.extrasListHint')}
          onCount={n => setCounts(c => ({ ...c, 'hall-charges': n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('hallPackages.extraPlaceholder') as string },
            { key: 'default_rate_paise', label: t('roomCharges.rate'), type: 'money', placeholder: '0.00' },
            { key: 'per_day', label: t('hallPackages.perDay'), type: 'checkbox' },
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
          ]}
        />
      ),
    },
    {
      // Who pays which price (tenant migration 061): Sangh member, Jain
      // non-member, outsider, a religious function ... Each venue and package
      // can carry its own price for each.
      id: 'rate-categories', group: 'stay', icon: Tags, resource: 'rate-categories',
      title: t('hallPackages.rateCategories'),
      render: () => (
        <MasterEditor
          resource="rate-categories"
          title={t('hallPackages.rateCategories')}
          description={t('hallPackages.rateCategoriesHint')}
          onCount={n => setCounts(c => ({ ...c, 'rate-categories': n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('hallPackages.rateCategoryPlaceholder') as string },
            { key: 'description', label: t('hallPackages.whoPays'), placeholder: '' },
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
          ]}
        />
      ),
    },
    {
      // What a plate costs at each sitting (tenant migration 042): a property
      // of the trust, not of a sale, so it is set here and the counter shows
      // it as fixed. Vendors live on their own master page (Masters →
      // Vendors / Suppliers), not here, so one record has one editor.
      id: 'bhojanshala', group: 'food', icon: UtensilsCrossed,
      title: t('settings.bhojanshalaRates.heading'),
      render: () => <BhojanshalaRates />,
    },
    {
      // What a meal can add (tenant migration 061): packaging for a parcel,
      // an extra item, delivery — "if someone wants lunch with packaging we
      // take packaging charges".
      id: 'bhojanshala-charges', group: 'food', icon: PackagePlus, resource: 'bhojanshala-charge-items',
      title: t('bhojanshalaExtras.priceList'),
      render: () => (
        <MasterEditor
          resource="bhojanshala-charge-items"
          title={t('bhojanshalaExtras.priceList')}
          description={t('bhojanshalaExtras.priceListHint')}
          onCount={n => setCounts(c => ({ ...c, 'bhojanshala-charges': n }))}
          fields={[
            { key: 'name', label: t('settings.masters.fields.name'), required: true, placeholder: t('bhojanshalaExtras.placeholder') as string },
            { key: 'default_rate_paise', label: t('roomCharges.rate'), type: 'money', placeholder: '0.00' },
            { key: 'per_plate', label: t('bhojanshalaExtras.perPlate'), type: 'checkbox' },
            { key: 'sort_order', label: t('settings.masters.fields.sortOrder'), type: 'number', placeholder: '0' },
          ]}
        />
      ),
    },
  ], [t, has80g])

  const requested = params.get('sub') ?? ''
  const current = lists.find(l => l.id === requested) ?? lists.find(l => l.id === DEFAULT_MASTER)!

  const pick = (id: string) => setParams(prev => {
    const p = new URLSearchParams(prev)
    p.set('sub', id)
    return p
  }, { replace: true })

  // How many entries each list has, for the rail. One small request each; the
  // open list keeps its own figure current through onCount as rows change.
  useEffect(() => {
    let live = true
    for (const l of lists) {
      if (!l.resource) continue
      api.get(`/${l.resource}`, { params: { ...l.listParams, limit: 1 } })
        .then(r => {
          const total = Number(r.data?.meta?.total ?? (r.data?.data ?? []).length)
          if (live && Number.isFinite(total)) setCounts(c => (l.id in c ? c : { ...c, [l.id]: total }))
        })
        .catch(() => {})
    }
    return () => { live = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const item = (l: ListDef, compact = false) => {
    const Icon = l.icon
    const on = l.id === current.id
    return (
      <button key={l.id} type="button" onClick={() => pick(l.id)} aria-current={on ? 'page' : undefined}
        data-testid={`master-tab-${l.id}`}
        className={`flex items-center gap-2 rounded-lg text-left text-sm transition-colors ${compact ? 'shrink-0 px-3 py-1.5 border' : 'w-full px-2.5 py-2'} ${
          on
            ? 'bg-navy-900 text-white border-navy-900'
            : compact ? 'bg-white text-slate-600 border-slate-200 hover:border-slate-300' : 'text-slate-600 hover:bg-slate-100'
        }`}>
        <Icon size={15} className={`shrink-0 ${on ? 'text-white' : 'text-slate-400'}`} />
        {/* Wraps rather than truncates: "Extra charges price list" read
            "Extra charges price l..." and the Hindi and Marathi names are longer. */}
        <span className={`flex-1 ${compact ? 'whitespace-nowrap' : 'min-w-0 leading-snug'}`}>{l.title}</span>
        {counts[l.id] !== undefined && (
          <span className={`rounded-full px-1.5 text-[11px] font-semibold ${on ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {counts[l.id]}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-4" data-testid="masters-tab">
      <p className="text-sm text-slate-500">{t('settings.masters.helpText')}</p>

      {/* A phone: one scrolling row of chips instead of the rail. */}
      <div className="lg:hidden -mx-1 px-1 flex gap-2 overflow-x-auto pb-1" data-testid="masters-chips">
        {lists.map(l => item(l, true))}
      </div>

      <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-5 lg:items-start">
        <nav className="hidden lg:block card p-2 sticky top-4" aria-label={t('settings.masters.listsNav')} data-testid="masters-rail">
          {GROUPS.map(g => (
            <div key={g} className="mb-1.5 last:mb-0">
              <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {t(`settings.masters.groups.${g}`)}
              </p>
              {lists.filter(l => l.group === g).map(l => item(l))}
            </div>
          ))}
        </nav>
        <div key={current.id} data-testid={`master-panel-${current.id}`}>{current.render()}</div>
      </div>
    </div>
  )
}
