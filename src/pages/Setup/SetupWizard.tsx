import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Image as ImageIcon, Loader2, Sparkles, Upload } from 'lucide-react'
import { api } from '../../lib/api'
import { compressImage } from '../../lib/imageCompress'
import {
  issueKey, normaliseStatutory, sameStatutoryValue, STATUTORY_EXAMPLE, statutoryIssue, type StatutoryIssue,
} from '../../lib/statutoryIds'
import { QuickAdd, isQuickAddable } from './QuickAdd'
import { useAuthStore } from '../../store/authStore'
import { fetchSetup, type SetupProgress } from '../../components/SetupChecklist'
import { DarshanTimings } from '../../components/DarshanTimings'
import { MulnayakPicker } from '../../components/MulnayakPicker'
import { COMMON_DONATION_CATEGORIES, COMMON_EXPENSE_HEADS, SuggestedListPicker } from '../../components/SuggestedListPicker'

/**
 * First-login setup — the same step-by-step shape as the registration wizard,
 * pointed at the settings a trust needs before its first receipt goes out.
 *
 * WHY A WIZARD AND NOT JUST THE CHECKLIST
 * The dashboard checklist answers "what is missing"; it does not collect
 * anything. A new trust admin who taps it lands in Settings on a tab of twenty
 * fields with no order and no sense of when they are finished. Registration
 * already proved the shape that works here — a handful of short steps, one
 * subject each, always skippable, with the end in sight — so first-run setup
 * uses it too rather than inventing a second idiom.
 *
 * RULES IT KEEPS
 *  - EVERY step is skippable, including the first. Nothing here blocks the app;
 *    a trust that wants to record a donation right now must be able to.
 *  - Each step saves on its way out, so a wizard abandoned halfway keeps what
 *    was typed. Losing four screens of typing because somebody closed a tab is
 *    how a setup flow gets abandoned the second time too.
 *  - It reads the same `GET /tenants/me/setup` the checklist does, so the
 *    percentage here and the percentage on the dashboard cannot disagree, and
 *    steps already satisfied open pre-filled rather than blank.
 *  - It writes through the ordinary Settings endpoints. No wizard-only write
 *    path means no second set of validation rules to drift.
 */

type StepKey = 'identity' | 'tax' | 'money' | 'categories' | 'receipts' | 'public' | 'team' | 'done'

const STEPS: Array<{ key: StepKey; labelKey: string }> = [
  { key: 'identity', labelKey: 'setupWizard.steps.identity' },
  { key: 'tax', labelKey: 'setupWizard.steps.tax' },
  { key: 'money', labelKey: 'setupWizard.steps.money' },
  { key: 'categories', labelKey: 'setupWizard.steps.categories' },
  { key: 'receipts', labelKey: 'setupWizard.steps.receipts' },
  { key: 'public', labelKey: 'setupWizard.steps.public' },
  { key: 'team', labelKey: 'setupWizard.steps.team' },
  { key: 'done', labelKey: 'setupWizard.steps.done' },
]

const TEMPLATES = ['classic', 'minimal', 'modern', 'traditional', 'elegant']

/** The registration numbers the tax step checks as they are typed. */
const TAX_FIELDS = ['pan', 'reg_80g_number', 'reg_12ab_number', 'gstin'] as const
type TaxField = (typeof TAX_FIELDS)[number]

/** Only ever true once — the wizard offers itself, it does not chase. */
const SEEN_KEY = 'jainerp_setup_wizard_offered'

/**
 * Where the user got to, per tenant.
 *
 * "Finish setup" used to drop you back on step 1 every time, because `step`
 * was seeded with a constant. On an eight-step wizard that meant clicking Next
 * past everything you had already answered to reach the one you had not - so
 * the button that exists to resume was the one thing that would not resume.
 */
const STEP_KEY = 'jainerp_setup_wizard_step'

function readStep(tenantId: string): StepKey | null {
  try {
    const v = localStorage.getItem(`${STEP_KEY}:${tenantId}`)
    return v && STEPS.some(s => s.key === v) ? (v as StepKey) : null
  } catch { return null }
}
function writeStep(tenantId: string, step: StepKey) {
  try { localStorage.setItem(`${STEP_KEY}:${tenantId}`, step) } catch { /* private mode */ }
}

export function hasBeenOfferedWizard(tenantId: string): boolean {
  try { return localStorage.getItem(`${SEEN_KEY}:${tenantId}`) === '1' } catch { return true }
}
export function markWizardOffered(tenantId: string) {
  try { localStorage.setItem(`${SEEN_KEY}:${tenantId}`, '1') } catch { /* private mode */ }
}

interface Form {
  name: string; address_line1: string; city: string; state: string; pincode: string
  area: string; mobile: string; email: string; website: string
  pan: string; reg_80g_number: string; reg_12ab_number: string
  is_gst_registered: boolean; gstin: string
  upi_id: string; bank_name: string
  donation_receipt_template: string; custom_receipt_footer: string
  // Brought over from Receipt Settings. The wizard offered only a template and
  // a footer line, so the receipt a donor actually receives could not be
  // finished here - no logo, no 80G line, no paper size - and the step said as
  // much ("upload your logo in Settings"). These are the same field names the
  // settings tab patches, through the same PATCH /tenants/me.
  logo_base64: string; show_logo_on_receipts: boolean
  show_80g_on_receipt: boolean; show_gstin_on_header: boolean
  receipt_copies: string; receipt_paper: string
  about: string; main_deity: string; darshan_timings: string
}

const BLANK: Form = {
  name: '', address_line1: '', city: '', state: '', pincode: '',
  area: '', mobile: '', email: '', website: '',
  pan: '', reg_80g_number: '', reg_12ab_number: '',
  is_gst_registered: false, gstin: '',
  upi_id: '', bank_name: '',
  donation_receipt_template: '', custom_receipt_footer: '',
  logo_base64: '', show_logo_on_receipts: true,
  show_80g_on_receipt: false, show_gstin_on_header: true,
  receipt_copies: 'single', receipt_paper: 'a4',
  about: '', main_deity: '', darshan_timings: '',
}

export function SetupWizard() {
  const { t } = useTranslation()
  const tenantId = useAuthStore(st => st.tenant?.id ?? 'anon')
  const navigate = useNavigate()
  // Resume where they left off. See STEP_KEY above - "Finish setup" used to
  // restart at step 1 every time.
  const [step, setStep] = useState<StepKey>(() => readStep(tenantId) ?? 'identity')
  const [form, setForm] = useState<Form>(BLANK)

  // Persist the position so a reload, or a trip out to Settings and back via
  // "Finish setup", returns here rather than to the beginning.
  useEffect(() => { writeStep(tenantId, step) }, [tenantId, step])
  const [setup, setSetup] = useState<SetupProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // A cash/bank account is a row, not a field, so it is only offered when the
  // trust has none — re-asking somebody who already has accounts would create
  // a duplicate.
  const [needsAccount, setNeedsAccount] = useState(false)
  const [account, setAccount] = useState({ name: '', bank_name: '', account_no: '', ifsc: '' })
  const [trustee, setTrustee] = useState({ name: '', designation: '', mobile: '' })
  // The team step showed input fields and nothing else, so a trust that had
  // already added its board had no way to know. The obvious response is to type
  // it again - which is exactly what happened, producing a duplicate row.
  const [trustees, setTrustees] = useState<Array<{ id: string; name: string; designation?: string | null; mobile?: string | null }>>([])
  const [addingTrustee, setAddingTrustee] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  // Which Still-to-do row is expanded on the summary. One at a time.
  const [openItem, setOpenItem] = useState<string | null>(null)
  // Comma-separated on purpose: a trust listing its heads types them faster
  // than it adds them one row at a time, and this is the one chance to catch
  // them while they are thinking about it.
  const [newCategories, setNewCategories] = useState('')
  const [newHeads, setNewHeads] = useState('')
  const [existing, setExisting] = useState<{ categories: number; heads: number }>({ categories: 0, heads: 0 })
  const [existingNames, setExistingNames] = useState<{ categories: string[]; heads: string[] }>({ categories: [], heads: [] })
  const [templeType, setTempleType] = useState<string | null>(null)
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; name: string; bank_name: string; account_no: string; ifsc: string }>>([])
  const [pickedAccount, setPickedAccount] = useState('')
  const [accountLocked, setAccountLocked] = useState(false)

  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }))
  const stepIndex = STEPS.findIndex(s => s.key === step)

  // What was saved when the wizard opened. The tax numbers are judged only
  // where they CHANGE — the API's rule — so a verified value the trust cannot
  // edit never blocks Next.
  const [saved, setSaved] = useState<Form>(BLANK)
  const taxIssues = useMemo(() => {
    const out: Partial<Record<TaxField, StatutoryIssue>> = {}
    const pans = [normaliseStatutory('pan', form.pan) ?? saved.pan]
    for (const f of TAX_FIELDS) {
      if (f === 'gstin' && !form.is_gst_registered) continue
      const next = normaliseStatutory(f, form[f])
      if (!next || sameStatutoryValue(f, next, saved[f])) continue
      const found = statutoryIssue(f, next, f === 'pan' ? [] : pans)
      if (found) out[f] = found
    }
    return out
  }, [form, saved])
  const taxError = (f: TaxField) => {
    const issue = taxIssues[f]
    return issue ? t(issueKey(issue), issue.params) : undefined
  }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [profileRes, publicRes, progress] = await Promise.all([
        api.get('/tenants/me'),
        api.get('/tenants/me/public-profile').catch(() => ({ data: { data: {} } })),
        fetchSetup(),
      ])
      const p = (profileRes.data.data ?? {}) as Record<string, any>
      const pub = (publicRes.data?.data ?? {}) as Record<string, any>
      setSetup(progress)
      // Pre-fill from what is already saved. A step that opens blank when the
      // answer is already on file invites somebody to retype it differently.
      const onFile = {
        ...BLANK,
        ...Object.fromEntries(
          Object.keys(BLANK)
            .filter(k => k in p && p[k] != null)
            .map(k => [k, typeof BLANK[k as keyof Form] === 'boolean' ? !!p[k] : String(p[k] ?? '')]),
        ),
        about: String(pub.about ?? ''),
        main_deity: String(pub.main_deity ?? ''),
        darshan_timings: String(pub.darshan_timings ?? ''),
      } as Form
      setSaved(onFile)
      setForm(onFile)
      setTempleType((pub.temple_type as string) ?? null)
      // Which bank accounts could receive a devotee transfer, and which one is
      // already nominated. `needsAccount` is about whether we have to CREATE
      // one — not whether to ask at all. An earlier version conflated the two,
      // so a trust that already had accounts was never offered the choice and
      // finished setup with no donation account nominated.
      const [acctRes, nominated] = await Promise.all([
        api.get('/accounts', { params: { limit: 100 } }).catch(() => null),
        api.get('/tenants/me/donation-account').then(r => r.data?.data ?? null).catch(() => null),
      ])
      const all = (acctRes?.data?.data ?? []) as Array<Record<string, any>>
      const banks = all.filter(a => a.type === 'bank' && a.is_active
        && String(a.account_no ?? '').trim() && String(a.ifsc ?? '').trim())
      setBankAccounts(banks.map(a => ({
        id: a.id, name: a.name, bank_name: a.bank_name ?? '', account_no: a.account_no ?? '', ifsc: a.ifsc ?? '',
      })))
      setPickedAccount(nominated?.id ?? '')
      setAccountLocked(!!nominated?.is_verified)
      setNeedsAccount(banks.length === 0)
      // Names as well as counts: the step offers the common ones as chips, and
      // it can only grey out the ones already present if it knows them.
      const [cats, heads] = await Promise.all([
        api.get('/donation-categories', { params: { limit: 200 } }).catch(() => null),
        api.get('/expense-categories', { params: { limit: 200 } }).catch(() => null),
      ])
      const names = (r: any): string[] =>
        (r?.data?.data ?? []).map((c: any) => String(c?.name ?? '')).filter(Boolean)
      setExisting({
        categories: cats?.data?.meta?.total ?? (cats?.data?.data?.length ?? 0),
        heads: heads?.data?.meta?.total ?? (heads?.data?.data?.length ?? 0),
      })
      setExistingNames({ categories: names(cats), heads: names(heads) })
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? t('setupWizard.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  /**
   * Trims, drops blanks, and PATCHes only what this step owns. `extra` is for
   * the rare value that must be sent even when blank — a deliberate clear.
   */
  async function patchProfile(keys: (keyof Form)[], extra: Record<string, unknown> = {}) {
    const body: Record<string, unknown> = { ...extra }
    for (const k of keys) {
      const v = form[k]
      if (typeof v === 'boolean') body[k] = v
      else if (String(v).trim() !== '') body[k] = String(v).trim()
    }
    if (Object.keys(body).length) await api.patch('/tenants/me', body)
  }

  async function saveStep(): Promise<boolean> {
    setSaving(true); setError('')
    try {
      switch (step) {
        case 'identity':
          await patchProfile(['name', 'address_line1', 'city', 'state', 'pincode', 'area', 'mobile', 'email', 'website'])
          break
        case 'tax':
          if (Object.keys(taxIssues).length) {
            setError(t('settings.profile.fixHighlighted'))
            return false
          }
          // Unticking "registered for GST" hid the GSTIN box but kept what was
          // in it, and this step posted it anyway — so a trust that said "not
          // registered" still held a GSTIN, and the GSTIN is what switches GST
          // on. Not registered now clears it.
          await patchProfile(
            form.is_gst_registered
              ? ['pan', 'reg_80g_number', 'reg_12ab_number', 'is_gst_registered', 'gstin']
              : ['pan', 'reg_80g_number', 'reg_12ab_number', 'is_gst_registered'],
            form.is_gst_registered ? {} : { gstin: null },
          )
          break
        case 'money': {
          // Create the account AND nominate it as the one devotees pay into.
          //
          // This step used to type bank details into kshetra_profile. Those
          // columns are dead now — the devotee app reads the nominated
          // `accounts` row that the platform verified — so collecting them here
          // would have quietly produced a trust that looks set up and shows
          // donors nothing.
          let accountId = pickedAccount
          if (needsAccount && account.name.trim() && account.account_no.trim() && account.ifsc.trim()) {
            const { data } = await api.post('/accounts', {
              name: account.name.trim(),
              type: 'bank',
              bank_name: account.bank_name.trim() || null,
              account_no: account.account_no.trim(),
              ifsc: account.ifsc.trim().toUpperCase(),
              is_default_bank: true,
            })
            accountId = data?.data?.id ?? ''
            setNeedsAccount(false)
          }
          // Never re-nominate a verified account: the server refuses it, and
          // sending it anyway would surface an error the user cannot act on.
          if (accountId && !accountLocked) {
            // Best-effort: a trust that already has a verified account gets a
            // documented refusal, and failing the whole step for that would be
            // wrong — nothing else on this screen is at fault.
            await api.patch('/tenants/me/donation-account', { account_id: accountId }).catch(() => {})
          }
          await patchProfile(['upi_id'])
          break
        }
        case 'categories': {
          // A donation cannot be recorded without a category, nor an expense
          // without a head — so these are collected before the trust is sent
          // off to record anything, not left to be discovered at the counter.
          const add = async (path: string, names: string[]) => {
            for (const name of names.map(n => n.trim()).filter(Boolean)) {
              await api.post(path, { name, is_active: true }).catch(() => {})
            }
          }
          await add('/donation-categories', newCategories.split(',').filter(Boolean))
          await add('/expense-categories', newHeads.split(',').filter(Boolean))
          break
        }
        case 'receipts':
          await patchProfile([
            'donation_receipt_template', 'custom_receipt_footer',
            'logo_base64', 'show_logo_on_receipts',
            'show_80g_on_receipt', 'show_gstin_on_header',
            'receipt_copies', 'receipt_paper',
          ])
          break
        case 'public': {
          const body: Record<string, unknown> = {}
          for (const k of ['about', 'main_deity', 'darshan_timings'] as const) {
            if (form[k].trim()) body[k] = form[k].trim()
          }
          if (Object.keys(body).length) await api.patch('/tenants/me/public-profile', body)
          break
        }
        case 'team':
          if (trustee.name.trim()) {
            await api.post('/tenants/me/trustees', {
              name: trustee.name.trim(),
              designation: trustee.designation.trim() || null,
              mobile: trustee.mobile.trim() || null,
            })
            setTrustee({ name: '', designation: '', mobile: '' })
          }
          break
      }
      return true
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? t('setupWizard.saveFailed'))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function next() {
    if (!(await saveStep())) return
    const i = STEPS.findIndex(s => s.key === step)
    setStep(STEPS[Math.min(i + 1, STEPS.length - 1)].key)
    window.scrollTo({ top: 0 })
  }

  const loadTrustees = async () => {
    try { const { data } = await api.get('/tenants/me/trustees'); setTrustees(data.data ?? []) } catch { /* non-fatal */ }
  }
  useEffect(() => { if (step === 'team') void loadTrustees() }, [step])

  /** Add one and stay put, so a board of five is five clicks, not five passes
      through the wizard. Clearing the form afterwards is also what stops Next
      from posting the same person a second time. */
  async function addTrustee() {
    if (!trustee.name.trim() || addingTrustee) return
    setAddingTrustee(true)
    setError('')
    try {
      await api.post('/tenants/me/trustees', {
        name: trustee.name.trim(),
        designation: trustee.designation.trim() || null,
        mobile: trustee.mobile.trim() || null,
      })
      setTrustee({ name: '', designation: '', mobile: '' })
      await loadTrustees()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? t('setupWizard.saveFailed'))
    } finally {
      setAddingTrustee(false)
    }
  }

  async function removeTrustee(id: string) {
    try { await api.delete(`/tenants/me/trustees/${id}`); await loadTrustees() } catch { /* non-fatal */ }
  }

  // Refresh on ARRIVAL at the summary, not on the transition into it.
  //
  // Refreshing inside next() looked equivalent and was not: the summary is also
  // reachable by skipping, and skip() does not save, so a user who filled two
  // steps and skipped the rest was shown the percentage from page load. The one
  // screen whose entire job is to say where you stand was the one that could be
  // stale.
  useEffect(() => {
    if (step !== 'done') return
    let cancelled = false
    fetchSetup().then(s => { if (!cancelled) setSetup(s) })
    return () => { cancelled = true }
  }, [step])

  /** Skip does NOT save — a half-typed field the user walked away from is not
      an answer, and writing it would be putting words in their mouth. */
  function skip() {
    const i = STEPS.findIndex(s => s.key === step)
    setStep(STEPS[Math.min(i + 1, STEPS.length - 1)].key)
    setError('')
    window.scrollTo({ top: 0 })
  }

  function finish() {
    navigate('/', { replace: true })
  }

  const percent = setup?.percent ?? 0
  const remaining = useMemo(
    () => (setup?.groups ?? []).flatMap(g => g.items.filter(i => !i.done)).slice(0, 6),
    [setup],
  )

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-red" size={22} />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-red/10 flex items-center justify-center shrink-0">
              <Sparkles size={19} className="text-brand-red" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-navy-900">{t('setupWizard.title')}</h1>
              <p className="text-sm text-slate-500">{t('setupWizard.subtitle')}</p>
            </div>
          </div>
          {/* Leaving is available from the first screen, not just the last. */}
          <button onClick={finish} className="text-sm text-slate-400 hover:text-slate-600 shrink-0">
            {t('setupWizard.doThisLater')}
          </button>
        </div>

        {/* Stepper — the same one registration uses, so the flow feels like a
            continuation of onboarding rather than a new thing. */}
        <ol className="flex flex-wrap items-center gap-y-2 mb-5">
          {STEPS.map((s, i) => {
            const done = i < stepIndex
            const current = i === stepIndex
            return (
              <li key={s.key} className="flex items-center">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${
                  current ? 'bg-brand-red text-white'
                    : done ? 'bg-green-100 text-green-800' : 'bg-white text-slate-400 border border-slate-200'
                }`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                    current ? 'bg-white/25' : done ? 'bg-green-600 text-white' : 'bg-slate-100'
                  }`}>
                    {done ? <Check size={11} /> : i + 1}
                  </span>
                  <span className="hidden sm:inline">{t(s.labelKey)}</span>
                </div>
                {i < STEPS.length - 1 && <ChevronRight size={14} className="text-slate-300 mx-0.5" />}
              </li>
            )
          })}
        </ol>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-600 mt-0.5 shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
          {step === 'identity' && (
            <Section title={t('setupWizard.identity.title')} hint={t('setupWizard.identity.hint')}>
              <Field label={t('setup.items.name.label')} value={form.name} onChange={v => set({ name: v })} />
              <Field label={t('setupWizard.f.address')} value={form.address_line1} onChange={v => set({ address_line1: v })} />
              <Row>
                <Field label={t('setupWizard.f.city')} value={form.city} onChange={v => set({ city: v })} />
                <Field label={t('setupWizard.f.state')} value={form.state} onChange={v => set({ state: v })} />
              </Row>
              <Row>
                <Field label={t('setup.items.pincode.label')} value={form.pincode} inputMode="numeric" maxLength={6}
                  onChange={v => set({ pincode: v.replace(/\D/g, '') })} />
                <Field label={t('setup.items.area.label')} value={form.area} onChange={v => set({ area: v })}
                  hint={t('setup.items.area.why')} />
              </Row>
              <Row>
                <Field label={t('setupWizard.f.mobile')} value={form.mobile} inputMode="tel"
                  onChange={v => set({ mobile: v })} />
                <Field label={t('setupWizard.f.email')} value={form.email} type="email"
                  onChange={v => set({ email: v })} />
              </Row>
              <Field label={t('setupWizard.f.website')} value={form.website} onChange={v => set({ website: v })} />
            </Section>
          )}

          {step === 'tax' && (
            <Section title={t('setupWizard.tax.title')} hint={t('setupWizard.tax.hint')}>
              <Field label={t('setup.items.pan.label')} value={form.pan} maxLength={10} uppercase
                placeholder={STATUTORY_EXAMPLE.pan} error={taxError('pan')}
                onChange={v => set({ pan: v.toUpperCase() })} hint={t('setup.items.pan.why')} />
              <Field label={t('setup.items.reg_80g.label')} value={form.reg_80g_number} maxLength={20} uppercase
                placeholder={STATUTORY_EXAMPLE.reg_80g_number} error={taxError('reg_80g_number')}
                onChange={v => set({ reg_80g_number: v.toUpperCase() })} hint={t('setup.items.reg_80g.why')} />
              <Field label={t('setup.items.reg_12a.label')} value={form.reg_12ab_number} maxLength={20} uppercase
                placeholder={STATUTORY_EXAMPLE.reg_12ab_number} error={taxError('reg_12ab_number')}
                onChange={v => set({ reg_12ab_number: v.toUpperCase() })} hint={t('setup.items.reg_12a.why')} />
              <label className="flex items-center gap-2 text-sm text-slate-700 pt-1">
                <input type="checkbox" checked={form.is_gst_registered}
                  onChange={e => set({ is_gst_registered: e.target.checked })} />
                {t('setupWizard.tax.gstRegistered')}
              </label>
              {form.is_gst_registered && (
                <Field label={t('setup.items.gstin.label')} value={form.gstin} maxLength={15} uppercase
                  placeholder={STATUTORY_EXAMPLE.gstin} error={taxError('gstin')}
                  onChange={v => set({ gstin: v.toUpperCase() })} />
              )}
            </Section>
          )}

          {step === 'money' && (
            <Section title={t('setupWizard.money.title')} hint={t('setupWizard.money.hint')}>
              {/* ONE bank account, asked for once.
                  This step used to ask twice — an account for the books, then
                  the same digits again as "payment details" on the profile.
                  The devotee app now reads the nominated account, so the second
                  copy was collected and discarded: worse than never asking,
                  because the trust believed it had told us. */}
              {needsAccount ? (
                <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <p className="text-sm font-semibold text-slate-700">
                    {t('setupWizard.money.bankTitle')}
                  </p>
                  <p className="text-xs text-slate-500 -mt-2">{t('setupWizard.money.bankHint')}</p>
                  <Row>
                    <Field label={t('setupWizard.f.accountName')} value={account.name}
                      onChange={v => setAccount(a => ({ ...a, name: v }))}
                      hint={t('setupWizard.money.holderHint')} />
                    <Field label={t('setupWizard.f.bankName')} value={account.bank_name}
                      onChange={v => setAccount(a => ({ ...a, bank_name: v }))} />
                  </Row>
                  <Row>
                    <Field label={t('setupWizard.f.accountNo')} value={account.account_no}
                      onChange={v => setAccount(a => ({ ...a, account_no: v }))} />
                    <Field label="IFSC" value={account.ifsc} maxLength={11} uppercase
                      onChange={v => setAccount(a => ({ ...a, ifsc: v.toUpperCase() }))} />
                  </Row>
                  <p className="text-xs text-slate-400">{t('setupWizard.money.verifyNote')}</p>
                </div>
              ) : (
                /* Accounts already exist, so the job here is CHOOSING which one
                   faces donors — not typing another. */
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">{t('setupWizard.money.bankTitle')}</p>
                  <p className="text-xs text-slate-500">{t('setupWizard.money.bankHint')}</p>
                  {bankAccounts.map(a => (
                    <label key={a.id}
                      className={`flex items-center gap-3 rounded-xl border p-3 ${
                        pickedAccount === a.id ? 'border-brand-red bg-red-50/40' : 'border-slate-200'
                      } ${accountLocked ? 'opacity-70' : 'cursor-pointer hover:bg-slate-50'}`}>
                      <input type="radio" name="wizard-donation-account" disabled={accountLocked}
                        checked={pickedAccount === a.id} onChange={() => setPickedAccount(a.id)} />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-800">{a.name}</span>
                        <span className="block text-xs text-slate-500">
                          {[a.bank_name, a.account_no, a.ifsc].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </label>
                  ))}
                  <p className="text-xs text-slate-400">
                    {accountLocked
                      ? t('setupWizard.money.lockedNote')
                      : t('setupWizard.money.verifyNote')}
                  </p>
                </div>
              )}

              <div className="pt-2">
                <Field label={t('setupWizard.f.upiId')} value={form.upi_id}
                  onChange={v => set({ upi_id: v })} hint={t('setupWizard.money.upiHint')} />
              </div>
            </Section>
          )}

          {step === 'categories' && (
            <Section title={t('setupWizard.categories.title')} hint={t('setupWizard.categories.hint')}>
              <SuggestedListPicker
                label={t('setup.items.categories.label')}
                suggestions={COMMON_DONATION_CATEGORIES}
                existing={existingNames.categories}
                value={newCategories}
                onChange={setNewCategories}
                hint={existing.categories > 0
                  ? t('setupWizard.categories.alreadyHave', { count: existing.categories })
                  : t('setup.items.categories.why')}
              />
              <SuggestedListPicker
                label={t('setup.items.expense_heads.label')}
                suggestions={COMMON_EXPENSE_HEADS}
                existing={existingNames.heads}
                value={newHeads}
                onChange={setNewHeads}
                hint={existing.heads > 0
                  ? t('setupWizard.categories.alreadyHave', { count: existing.heads })
                  : t('setup.items.expense_heads.why')}
              />
            </Section>
          )}

          {step === 'receipts' && (
            <Section title={t('setupWizard.receipts.title')} hint={t('setupWizard.receipts.hint')}>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('setup.items.template.label')}</label>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATES.map(id => (
                    <button key={id} type="button"
                      onClick={() => set({ donation_receipt_template: id })}
                      className={`px-3 py-1.5 rounded-lg text-sm border capitalize ${
                        form.donation_receipt_template === id
                          ? 'border-brand-red bg-red-50 text-brand-red font-semibold'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}>
                      {id}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">{t('setupWizard.receipts.templateHint')}</p>
              </div>
              <Field label={t('setup.items.receipt_footer.label')} value={form.custom_receipt_footer}
                onChange={v => set({ custom_receipt_footer: v })} hint={t('setup.items.receipt_footer.why')} multiline />

              {/* LOGO. The step used to say "upload your logo in Settings - it
                  needs a file, so it is not part of this flow". It can be:
                  compressImage() turns the file into a base64 data URI, which
                  is what Receipt Settings already stores in logo_base64. */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('settings.receipts.logo')}</label>
                <div className="flex items-center gap-3">
                  {form.logo_base64
                    ? <img src={form.logo_base64} alt="" className="h-12 w-12 rounded-lg object-contain border border-slate-200 bg-white" />
                    : <div className="h-12 w-12 rounded-lg border border-dashed border-slate-300 grid place-items-center text-slate-300"><ImageIcon size={16} /></div>}
                  <button type="button" onClick={() => logoInputRef.current?.click()} className="btn-secondary text-sm">
                    <Upload size={13} /> {t('setupWizard.receipts.chooseLogo')}
                  </button>
                  {form.logo_base64 && (
                    <button type="button" onClick={() => set({ logo_base64: '' })} className="text-xs text-slate-400 hover:text-brand-red">
                      {t('common.delete')}
                    </button>
                  )}
                </div>
                <input ref={logoInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden"
                  onChange={async e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    // Smaller budget than a gallery photo: a logo is reprinted
                    // on every receipt, so it should not carry a page of bytes.
                    try { set({ logo_base64: await compressImage(f, { maxDim: 600, maxBytes: 120_000 }) }) }
                    catch { setError(t('setupWizard.receipts.logoFailed')) }
                    if (logoInputRef.current) logoInputRef.current.value = ''
                  }} />
              </div>

              <Row>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('settings.receipts.copies')}</label>
                  <select className="form-select w-full" value={form.receipt_copies}
                    onChange={e => set({ receipt_copies: e.target.value })}>
                    <option value="single">{t('settings.receipts.copySingle')}</option>
                    <option value="duplicate">{t('settings.receipts.copyDuplicate')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('settings.receipts.paper')}</label>
                  <select className="form-select w-full" value={form.receipt_paper}
                    onChange={e => set({ receipt_paper: e.target.value })}>
                    <option value="a4">A4</option>
                    <option value="a5">A5</option>
                    <option value="thermal">{t('settings.receipts.paperThermal')}</option>
                  </select>
                </div>
              </Row>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_logo_on_receipts}
                    onChange={e => set({ show_logo_on_receipts: e.target.checked })} />
                  {t('settings.receipts.showLogo')}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_80g_on_receipt}
                    onChange={e => set({ show_80g_on_receipt: e.target.checked })} />
                  {t('settings.receipts.show80g')}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="w-4 h-4 accent-navy-900" checked={form.show_gstin_on_header}
                    onChange={e => set({ show_gstin_on_header: e.target.checked })} />
                  {t('settings.receipts.showGstin')}
                </label>
              </div>

              {/* Colour and the live preview stay in Receipt Settings - a
                  preview iframe does not belong in a "few short steps" flow. */}
              <p className="text-xs text-slate-400">{t('setupWizard.receipts.moreHint')}</p>
            </Section>
          )}

          {step === 'public' && (
            <Section title={t('setupWizard.public.title')} hint={t('setupWizard.public.hint')}>
              <Field label={t('setup.items.about.label')} value={form.about} onChange={v => set({ about: v })}
                hint={t('setup.items.about.why')} multiline />
              <Row>
                <MulnayakPicker
                  label={t('setup.items.main_deity.label')}
                  value={form.main_deity}
                  templeType={templeType}
                  onChange={v => set({ main_deity: v })}
                />
                <DarshanTimings
                  label={t('setup.items.darshan_timings.label')}
                  value={form.darshan_timings}
                  onChange={v => set({ darshan_timings: v })}
                  hint={t('setup.items.darshan_timings.why')}
                />
              </Row>
            </Section>
          )}

          {step === 'team' && (
            <Section title={t('setupWizard.team.title')} hint={t('setupWizard.team.hint')}>
              <Row>
                <Field label={t('setupWizard.f.trusteeName')} value={trustee.name}
                  onChange={v => setTrustee(x => ({ ...x, name: v }))} />
                <Field label={t('setupWizard.f.designation')} value={trustee.designation}
                  onChange={v => setTrustee(x => ({ ...x, designation: v }))} />
              </Row>
              <Field label={t('setupWizard.f.mobile')} value={trustee.mobile} inputMode="tel"
                onChange={v => setTrustee(x => ({ ...x, mobile: v }))} />

              <button type="button" onClick={addTrustee}
                disabled={!trustee.name.trim() || addingTrustee}
                className="btn-secondary w-full sm:w-auto disabled:opacity-50">
                {addingTrustee ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t('setupWizard.team.add')}
              </button>

              {/* The board as it actually stands. Without this the step looked
                  empty however many trustees were already saved. */}
              {trustees.length > 0 && (
                <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
                  {trustees.map(tr => (
                    <div key={tr.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-100 last:border-0">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-navy-900 truncate">{tr.name}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {[tr.designation, tr.mobile].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                      <button type="button" onClick={() => removeTrustee(tr.id)}
                        className="text-xs text-slate-400 hover:text-brand-red shrink-0">
                        {t('common.delete')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-slate-400">{t('setupWizard.team.moreHint')}</p>
            </Section>
          )}

          {step === 'done' && (
            <div>
              <h2 className="text-base font-bold text-navy-900">{t('setupWizard.done.title')}</h2>
              <p className="text-sm text-slate-500 mt-1">{t('setupWizard.done.hint')}</p>

              <div className="mt-5">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-3xl font-extrabold text-navy-900">{percent}%</span>
                  <span className="text-xs text-slate-400">{t('setup.complete')}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-brand-red transition-[width] duration-700"
                    style={{ width: `${percent}%` }} />
                </div>
              </div>

              {remaining.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-slate-500 mt-5 mb-2">{t('setupWizard.done.stillToDo')}</p>
                  <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                    {remaining.map(item => {
                      const inline = isQuickAddable(item.key)
                      const open = openItem === item.key
                      return (
                        <li key={item.key}>
                          {/* Items that CAN be finished here expand in place.
                              The rest still navigate - `comms_templates` is a
                              review, not a record, and a form would tick a box
                              nobody had read. */}
                          <button
                            onClick={() => inline ? setOpenItem(open ? null : item.key) : navigate(item.route)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left">
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm text-slate-700">
                                {t(`setup.items.${item.key}.label`, { defaultValue: item.label })}
                              </span>
                            </span>
                            <ChevronRight size={15}
                              className={`text-slate-300 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                          </button>
                          {open && (
                            <QuickAdd itemKey={item.key} onDone={async () => {
                              // Re-read progress so the item disappears and the
                              // percentage moves without a reload.
                              setOpenItem(null)
                              setSetup(await fetchSetup())
                            }} />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}

              <p className="text-xs text-slate-400 mt-4">{t('setupWizard.done.anytime')}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-5">
          {stepIndex > 0 && step !== 'done' ? (
            <button onClick={() => setStep(STEPS[stepIndex - 1].key)} className="btn-secondary">
              <ArrowLeft size={15} /> {t('common.back')}
            </button>
          ) : <span />}

          <div className="flex items-center gap-3">
            {step !== 'done' && (
              <button onClick={skip} className="text-sm text-slate-400 hover:text-slate-600">
                {t('setupWizard.skipStep')}
              </button>
            )}
            <button onClick={step === 'done' ? finish : next} disabled={saving} className="btn-primary">
              {saving && <Loader2 size={15} className="animate-spin" />}
              {step === 'done' ? t('setupWizard.goToDashboard') : t('common.next')}
              {step !== 'done' && <ChevronRight size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-bold text-navy-900">{title}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}

function Field({
  label, value, onChange, hint, type = 'text', maxLength, inputMode, uppercase, multiline, placeholder, error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
  type?: string
  maxLength?: number
  inputMode?: 'text' | 'numeric' | 'tel'
  uppercase?: boolean
  multiline?: boolean
  placeholder?: string
  /** Shown instead of the hint, in red, while the value is wrong. */
  error?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      {multiline ? (
        <textarea className="form-input w-full min-h-[80px]" value={value} maxLength={maxLength}
          onChange={e => onChange(e.target.value)} />
      ) : (
        <input className={`form-input w-full ${uppercase ? 'uppercase' : ''} ${error ? 'border-red-400' : ''}`} type={type} value={value}
          maxLength={maxLength} inputMode={inputMode} placeholder={placeholder} aria-invalid={!!error}
          onChange={e => onChange(e.target.value)} />
      )}
      {error
        ? <p className="mt-1 text-xs text-red-600" role="alert">{error}</p>
        : hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}
