import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, X, Users, LogOut, UserCheck, Undo2, Contact } from 'lucide-react'
import { printCurrentView } from '../../lib/downloadReport'
import { api, apiErrorMessage, dayOf, fmtPaise, parsePaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { DataTable, type ColumnDef, type ColumnFilterState, type RowAction } from '../../components/kit/DataTable'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { PhoneInput, isValidPhone } from '../../components/PhoneInput'
import {
  cancelExit, ExitDialog, fmtDay, RejoinDialog, statusOf, StaffStatusBadge, type StaffType,
} from '../Staff/StaffLifecycle'

/**
 * Employees & Volunteers: the staff register.
 *
 * Reported 2026-10-19: "if a staff member resigns there is no way to show it".
 * The list carried an Active badge nothing could change, and a person who left
 * stayed on it - and on the attendance register and in the salary run - for
 * ever. Payroll software keeps the person and records the separation: a last
 * working day and a reason. That is what "Mark as left" does (tenant migration
 * 066); the register then shows Active, Leaving (notice being served) or Left,
 * and opens on the people who are still working.
 *
 * The form is the staff register a trust keeps on paper: staff ID, contact,
 * the person's details, the job, the pay and an emergency contact. Mobile is
 * optional - "00000000" was being typed for helpers with no phone.
 */

interface Person {
  id: string
  name: string
  mobile?: string | null
  email?: string | null
  designation?: string | null
  department?: string | null
  monthly_salary_paise?: number
  salary_type?: 'monthly' | 'daily' | null
  joining_date?: string | null
  registration_date?: string | null
  is_active: boolean
  leaving_date?: string | null
  exit_reason?: string | null
  employee_code?: string | null
  employment_type?: string | null
  gender?: string | null
  date_of_birth?: string | null
  guardian_name?: string | null
  address?: string | null
  aadhaar_last4?: string | null
  bank_account_no?: string | null
  bank_ifsc?: string | null
  emergency_contact_name?: string | null
  emergency_contact_mobile?: string | null
  notes?: string | null
  created_at: string
}

type Tab = 'employees' | 'volunteers'
type View = 'working' | 'left' | 'all'

const EMPLOYMENT_TYPES = ['permanent', 'contract', 'daily_wage', 'part_time', 'temporary'] as const
const GENDERS = ['male', 'female', 'other'] as const

const emptyForm = {
  name: '', mobile: '', email: '', designation: '', department: '', salary: '', salary_type: 'monthly',
  joining_date: '', employee_code: '', employment_type: 'permanent', gender: '', date_of_birth: '',
  guardian_name: '', address: '', aadhaar_last4: '', bank_account_no: '', bank_ifsc: '',
  emergency_contact_name: '', emergency_contact_mobile: '', notes: '',
}
type Form = typeof emptyForm

/** The distinct values already typed, for the field's suggestions - so
 * "Nakoda Dham", "NAKODA DHAM" and "nakodadham" stop being three departments. */
function distinct(values: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>()
  for (const v of values) {
    const s = (v ?? '').trim()
    if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

export function EmployeesPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('employees')
  const [view, setView] = useState<View>('working')
  const [items, setItems] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [loadedMobile, setLoadedMobile] = useState('')
  const [form, setForm] = useState<Form>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [exitFor, setExitFor] = useState<Person | null>(null)
  const [rejoinFor, setRejoinFor] = useState<Person | null>(null)

  const staffType: StaffType = tab === 'employees' ? 'employee' : 'volunteer'
  const isEmp = tab === 'employees'
  const joinedOf = (p: Person) => dayOf(isEmp ? p.joining_date : p.registration_date)
  const leftOf = (p: Person) => dayOf(p.leaving_date) || null
  const statusFor = (p: Person) => statusOf(p.is_active, leftOf(p))

  useEffect(() => { load() }, [search, tab])

  async function load() {
    setLoading(true)
    try {
      // Everyone, active or not: the view below splits them, and its counts
      // must not depend on which view is open.
      const params = new URLSearchParams({ limit: '200' })
      if (search) params.set('q', search)
      const { data } = await api.get(`/${tab}?${params}`)
      setItems(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  // Still working = active, or serving notice (the last day is still ahead).
  const working = items.filter(p => statusFor(p) !== 'left')
  const left = items.filter(p => statusFor(p) === 'left')
  const shown = view === 'working' ? working : view === 'left' ? left : items

  const departments = useMemo(() => distinct(items.map(p => p.department)), [items])
  const designations = useMemo(() => distinct(items.map(p => p.designation)), [items])

  const salaryText = (p: Person) => {
    if (!p.monthly_salary_paise) return '—'
    return `₹${fmtPaise(p.monthly_salary_paise)}${p.salary_type === 'daily' ? t('staff.perDay') : t('employees.perMonth')}`
  }

  const columns: ColumnDef<Person>[] = useMemo(() => [
    {
      key: 'name', label: t('employees.name'),
      render: p => (
        <div>
          <span className="font-medium">{p.name}</span>
          {(p.employee_code || (isEmp && p.employment_type && p.employment_type !== 'permanent')) && (
            <span className="block text-xs text-slate-500">
              {[p.employee_code, isEmp && p.employment_type && p.employment_type !== 'permanent' ? t(`employees.type_${p.employment_type}`) : null]
                .filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      ),
    },
    { key: 'mobile', label: t('employees.mobile'), render: p => <span className="tabular-nums">{p.mobile || '—'}</span> },
    {
      key: 'designation', label: isEmp ? t('employees.designation') : t('employees.role'),
      render: p => <span className="text-slate-600">{p.designation || '—'}</span>,
    },
    { key: 'department', label: t('employees.department'), render: p => <span className="text-slate-600">{p.department || '—'}</span> },
    { key: 'joined', label: t('employees.joiningDate'), render: p => <span className="text-xs text-slate-500">{fmtDay(joinedOf(p)) || '—'}</span> },
    ...(isEmp ? [{ key: 'salary', label: t('employees.salary'), align: 'right' as const, render: (p: Person) => <>{salaryText(p)}</> }] : []),
    {
      key: 'status', label: t('employees.status'),
      render: p => <StaffStatusBadge isActive={p.is_active} leavingDate={leftOf(p)} reason={p.exit_reason} />,
    },
  ], [t, tab])

  async function exportExcel() {
    if (!shown.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: `${t('employees.title')} — ${isEmp ? t('employees.tabEmployees') : t('employees.tabVolunteers')}`,
        filename: tab,
        columns: [
          { header: t('employees.staffId'), width: 12 },
          { header: t('employees.name'), width: 26 },
          { header: t('employees.mobile'), width: 16 },
          { header: isEmp ? t('employees.designation') : t('employees.role'), width: 18 },
          { header: t('employees.department'), width: 16 },
          { header: t('employees.employmentType'), width: 14 },
          { header: t('employees.salary'), type: 'money' },
          { header: t('employees.salaryType'), width: 10 },
          { header: t('employees.joiningDate'), width: 12 },
          { header: t('employees.status'), width: 10 },
          { header: t('staffExit.lastWorkingDay'), width: 12 },
          { header: t('staffExit.reason'), width: 14 },
        ],
        rows: shown.map(p => [
          p.employee_code ?? '', p.name, p.mobile ?? '', p.designation ?? '', p.department ?? '',
          isEmp && p.employment_type ? t(`employees.type_${p.employment_type}`) : '',
          isEmp ? (p.monthly_salary_paise ?? 0) : 0,
          isEmp ? (p.salary_type === 'daily' ? t('employees.daily') : t('employees.monthly')) : '',
          fmtDay(joinedOf(p)),
          t(`staffExit.status_${statusFor(p)}`),
          fmtDay(leftOf(p)),
          p.exit_reason ? t(`staffExit.reason_${p.exit_reason}`) : '',
        ]),
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function openAdd() { setEditId(null); setForm(emptyForm); setLoadedMobile(''); setError(''); setShowForm(true) }
  function openEdit(p: Person) {
    setEditId(p.id)
    setError('')
    setLoadedMobile(p.mobile ?? '')
    setForm({
      name: p.name, mobile: p.mobile || '', email: p.email || '',
      designation: p.designation || '', department: p.department || '',
      salary: p.monthly_salary_paise ? String(p.monthly_salary_paise / 100) : '',
      salary_type: p.salary_type === 'daily' ? 'daily' : 'monthly',
      joining_date: joinedOf(p),
      employee_code: p.employee_code || '', employment_type: p.employment_type || 'permanent',
      gender: p.gender || '', date_of_birth: dayOf(p.date_of_birth), guardian_name: p.guardian_name || '',
      address: p.address || '', aadhaar_last4: p.aadhaar_last4 || '',
      bank_account_no: p.bank_account_no || '', bank_ifsc: p.bank_ifsc || '',
      emergency_contact_name: p.emergency_contact_name || '', emergency_contact_mobile: p.emergency_contact_mobile || '',
      notes: p.notes || '',
    })
    setShowForm(true)
  }

  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    // A number kept from before this check (e.g. "00000000") is left alone
    // until someone changes it; a new or changed one must be real.
    if (form.mobile && form.mobile !== loadedMobile && !isValidPhone(form.mobile)) {
      setError(t('employees.mobileInvalid')); return
    }
    if (form.aadhaar_last4 && !/^\d{4}$/.test(form.aadhaar_last4)) { setError(t('employees.aadhaarLast4Invalid')); return }
    if (form.bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.bank_ifsc)) { setError(t('employees.ifscInvalid')); return }
    setSaving(true)
    try {
      const txt = (v: string) => v.trim() || null
      const body: Record<string, unknown> = isEmp
        ? {
            name: form.name.trim(), mobile: txt(form.mobile), email: txt(form.email),
            designation: form.designation.trim(), department: form.department.trim() || 'general',
            monthly_salary_paise: form.salary ? parsePaise(form.salary) : 0,
            salary_type: form.salary_type,
            joining_date: form.joining_date || null,
            employee_code: txt(form.employee_code), employment_type: form.employment_type,
            gender: form.gender || null, date_of_birth: form.date_of_birth || null,
            guardian_name: txt(form.guardian_name), address: txt(form.address),
            aadhaar_last4: txt(form.aadhaar_last4),
            bank_account_no: txt(form.bank_account_no), bank_ifsc: txt(form.bank_ifsc),
            emergency_contact_name: txt(form.emergency_contact_name),
            emergency_contact_mobile: txt(form.emergency_contact_mobile),
            notes: txt(form.notes),
          }
        : {
            // A volunteer's role and department were sent before and silently
            // dropped: the table had no columns for them (now it does, 066).
            name: form.name.trim(), mobile: txt(form.mobile), designation: txt(form.designation),
            department: txt(form.department), notes: txt(form.notes),
            ...(form.joining_date ? { registration_date: form.joining_date } : {}),
          }
      if (editId) await api.patch(`/${tab}/${editId}`, body)
      else await api.post(`/${tab}`, body)
      setShowForm(false); setForm(emptyForm); setEditId(null)
      toast.success(t('common.saved'))
      load()
    } catch (err) {
      setError(apiErrorMessage(err, isEmp ? t('employees.couldNotSaveEmployee') : t('employees.couldNotSaveVolunteer')))
    } finally {
      setSaving(false)
    }
  }

  async function withdrawExit(p: Person) {
    if (!(await confirm({ message: t('staffExit.cancelConfirm', { name: p.name }), confirmLabel: t('staffExit.cancelExit') }))) return
    try {
      await cancelExit(staffType, p.id)
      toast.success(t('staffExit.cancelled', { name: p.name }))
      load()
    } catch (err) {
      toast.error(apiErrorMessage(err, t('staffExit.failed')))
    }
  }

  const monthlyBill = working
    .filter(p => isEmp && p.salary_type !== 'daily')
    .reduce((s, p) => s + (p.monthly_salary_paise ?? 0), 0)

  const stats: SummaryStat[] = [
    { label: t('employees.working'), value: String(working.length) },
    { label: t('employees.leftCount'), value: String(left.length) },
    ...(isEmp ? [{ label: t('employees.monthlyBill'), value: `₹${fmtPaise(monthlyBill)}`, sub: t('employees.monthlyBillSub') }] : []),
  ]

  function rowActions(p: Person): RowAction[] {
    const status = statusFor(p)
    const actions: RowAction[] = [
      { label: t('common.edit'), icon: <Pencil size={14} />, primary: true, onClick: () => openEdit(p) },
      { label: t('employees.viewProfile'), icon: <Contact size={14} />, onClick: () => navigate(`/staff/${p.id}`) },
    ]
    if (status === 'active') {
      actions.push({ label: t('staffExit.markLeft'), icon: <LogOut size={14} />, danger: true, onClick: () => setExitFor(p) })
    } else if (status === 'leaving') {
      actions.push({ label: t('staffExit.editExit'), icon: <LogOut size={14} />, onClick: () => setExitFor(p) })
      actions.push({ label: t('staffExit.cancelExit'), icon: <Undo2 size={14} />, onClick: () => withdrawExit(p) })
    } else {
      actions.push({ label: t('staffExit.rejoin'), icon: <UserCheck size={14} />, onClick: () => setRejoinFor(p) })
      if (leftOf(p)) actions.push({ label: t('staffExit.editExit'), icon: <LogOut size={14} />, onClick: () => setExitFor(p) })
    }
    return actions
  }

  const viewLabel: Record<View, string> = {
    working: t('employees.viewWorking', { count: working.length }),
    left: t('employees.viewLeft', { count: left.length }),
    all: t('employees.viewAll', { count: items.length }),
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('employees.title')} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Users size={18} /> {t('employees.title')}</h1>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> {isEmp ? t('employees.addEmployee') : t('employees.addVolunteer')}</button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex gap-2">
          {(['employees', 'volunteers'] as const).map(tabKey => (
            <button key={tabKey} onClick={() => { setTab(tabKey); setSearch('') }}
              className={`px-4 py-1.5 text-sm rounded-md font-medium ${tab === tabKey ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
              {tabKey === 'employees' ? t('employees.tabEmployees') : t('employees.tabVolunteers')}
            </button>
          ))}
        </div>
        {/* Opens on the people still working: a register that leads with
            everyone who ever worked here is not the one anybody needs daily. */}
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5" role="tablist" aria-label={t('employees.status')}>
          {(['working', 'left', 'all'] as const).map(v => (
            <button key={v} type="button" role="tab" aria-selected={view === v} data-testid={`staff-view-${v}`}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-sm rounded ${view === v ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {viewLabel[v]}
            </button>
          ))}
        </div>
      </div>

      <SummaryStrip stats={stats} />

      <DataTable
        viewKey="employees-list"
        columns={columns}
        rows={shown}
        rowKey={p => p.id}
        rowActions={rowActions}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('employees.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onPrint={() => printCurrentView()}
        filterState={filterState}
        onFilterChange={(key, st) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (st) next[key] = st
            else delete next[key]
            return next
          })
        }}
        page={1}
        limit={200}
        total={shown.length}
        onPageChange={() => {}}
        emptyMessage={view === 'left' ? t('employees.noneLeft') : isEmp ? t('employees.noEmployeesFound') : t('employees.noVolunteersFound')}
        emptyAction={view === 'left' ? undefined : { label: isEmp ? t('employees.addEmployee') : t('employees.addVolunteer'), onClick: openAdd }}
      />

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-900">{editId ? (isEmp ? t('employees.editEmployee') : t('employees.editVolunteer')) : (isEmp ? t('employees.addEmployee') : t('employees.addVolunteer'))}</h3>
              <button onClick={() => setShowForm(false)} aria-label={t('common.cancel')}><X size={18} className="text-slate-400" /></button>
            </div>
            <form onSubmit={submit} className="space-y-5" data-testid="staff-form">
              <datalist id="staff-departments">{departments.map(d => <option key={d} value={d} />)}</datalist>
              <datalist id="staff-designations">{designations.map(d => <option key={d} value={d} />)}</datalist>

              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('employees.sectionPerson')}</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="form-label" htmlFor="staff-name">{t('employees.nameRequired')}</label>
                    <input id="staff-name" className="form-input" value={form.name} onChange={e => set('name')(e.target.value)} required maxLength={255} />
                  </div>
                  {isEmp && (
                    <div>
                      <label className="form-label" htmlFor="staff-code">{t('employees.staffId')}</label>
                      <input id="staff-code" className="form-input" value={form.employee_code} maxLength={30}
                        placeholder={t('employees.staffIdPlaceholder')} onChange={e => set('employee_code')(e.target.value)} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="form-label">{t('employees.mobileOptional')}</span>
                    <PhoneInput value={form.mobile} onChange={set('mobile')} />
                  </div>
                  {isEmp && (
                    <div>
                      <label className="form-label" htmlFor="staff-email">{t('employees.email')}</label>
                      <input id="staff-email" type="email" className="form-input" value={form.email} onChange={e => set('email')(e.target.value)} />
                    </div>
                  )}
                </div>
                {isEmp && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="form-label" htmlFor="staff-gender">{t('employees.gender')}</label>
                        <select id="staff-gender" className="form-select" value={form.gender} onChange={e => set('gender')(e.target.value)}>
                          <option value="">—</option>
                          {GENDERS.map(g => <option key={g} value={g}>{t(`employees.gender_${g}`)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="form-label" htmlFor="staff-dob">{t('employees.dateOfBirth')}</label>
                        <input id="staff-dob" type="date" className="form-input" value={form.date_of_birth} onChange={e => set('date_of_birth')(e.target.value)} />
                      </div>
                      <div>
                        <label className="form-label" htmlFor="staff-aadhaar">{t('employees.aadhaarLast4')}</label>
                        <input id="staff-aadhaar" className="form-input font-mono" inputMode="numeric" maxLength={4} placeholder="1234"
                          value={form.aadhaar_last4} onChange={e => set('aadhaar_last4')(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="form-label" htmlFor="staff-guardian">{t('employees.guardianName')}</label>
                        <input id="staff-guardian" className="form-input" value={form.guardian_name} maxLength={255} onChange={e => set('guardian_name')(e.target.value)} />
                      </div>
                      <div>
                        <label className="form-label" htmlFor="staff-address">{t('employees.address')}</label>
                        <input id="staff-address" className="form-input" value={form.address} onChange={e => set('address')(e.target.value)} />
                      </div>
                    </div>
                  </>
                )}
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('employees.sectionWork')}</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="form-label" htmlFor="staff-designation">{isEmp ? t('employees.designationRequired') : t('employees.role')}</label>
                    <input id="staff-designation" className="form-input" list="staff-designations" value={form.designation} maxLength={100}
                      onChange={e => set('designation')(e.target.value)} required={isEmp} />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="staff-department">{t('employees.department')}</label>
                    <input id="staff-department" className="form-input" list="staff-departments" value={form.department} maxLength={50}
                      placeholder={t('employees.departmentPlaceholder')} onChange={e => set('department')(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {isEmp && (
                    <div>
                      <label className="form-label" htmlFor="staff-employment">{t('employees.employmentType')}</label>
                      <select id="staff-employment" className="form-select" value={form.employment_type} onChange={e => set('employment_type')(e.target.value)}>
                        {EMPLOYMENT_TYPES.map(et => <option key={et} value={et}>{t(`employees.type_${et}`)}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="form-label" htmlFor="staff-joining">{t('employees.joiningDate')}</label>
                    <input id="staff-joining" type="date" className="form-input" value={form.joining_date} onChange={e => set('joining_date')(e.target.value)} />
                  </div>
                </div>
              </fieldset>

              {isEmp && (
                <fieldset className="space-y-3">
                  <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('employees.sectionPay')}</legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="form-label" htmlFor="staff-salary-type">{t('employees.salaryType')}</label>
                      <select id="staff-salary-type" className="form-select" value={form.salary_type} onChange={e => set('salary_type')(e.target.value)}>
                        <option value="monthly">{t('employees.monthly')}</option>
                        <option value="daily">{t('employees.daily')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label" htmlFor="staff-salary">{form.salary_type === 'daily' ? t('employees.dailyWage') : t('employees.monthlySalary')}</label>
                      <input id="staff-salary" type="number" min="0" step="0.01" className="form-input" value={form.salary} onChange={e => set('salary')(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="form-label" htmlFor="staff-bank-ac">{t('employees.bankAccountNo')}</label>
                      <input id="staff-bank-ac" className="form-input font-mono" inputMode="numeric" maxLength={20}
                        value={form.bank_account_no} onChange={e => set('bank_account_no')(e.target.value.replace(/\s/g, ''))} />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="staff-ifsc">{t('employees.ifsc')}</label>
                      <input id="staff-ifsc" className="form-input font-mono uppercase" maxLength={11} placeholder="SBIN0001234"
                        value={form.bank_ifsc} onChange={e => set('bank_ifsc')(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
                    </div>
                  </div>
                </fieldset>
              )}

              {isEmp && (
                <fieldset className="space-y-3">
                  <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{t('employees.sectionEmergency')}</legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="form-label" htmlFor="staff-ec-name">{t('employees.emergencyName')}</label>
                      <input id="staff-ec-name" className="form-input" value={form.emergency_contact_name} maxLength={255}
                        onChange={e => set('emergency_contact_name')(e.target.value)} />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="staff-ec-mobile">{t('employees.emergencyMobile')}</label>
                      <input id="staff-ec-mobile" type="tel" className="form-input" maxLength={20} value={form.emergency_contact_mobile}
                        onChange={e => set('emergency_contact_mobile')(e.target.value)} />
                    </div>
                  </div>
                </fieldset>
              )}

              <div>
                <label className="form-label" htmlFor="staff-notes">{t('employees.notes')}</label>
                <textarea id="staff-notes" className="form-textarea" rows={2} value={form.notes} onChange={e => set('notes')(e.target.value)} />
              </div>

              {error && <p className="text-sm text-brand-red">{error}</p>}
              <div className="flex gap-3 justify-end pt-1">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {exitFor && (
        <ExitDialog type={staffType} id={exitFor.id} name={exitFor.name}
          onClose={() => setExitFor(null)}
          onDone={() => { toast.success(t('staffExit.recorded', { name: exitFor.name })); setExitFor(null); load() }} />
      )}
      {rejoinFor && (
        <RejoinDialog type={staffType} id={rejoinFor.id} name={rejoinFor.name} leavingDate={leftOf(rejoinFor)}
          onClose={() => setRejoinFor(null)}
          onDone={() => { toast.success(t('staffExit.rejoined', { name: rejoinFor.name })); setRejoinFor(null); load() }} />
      )}
    </div>
  )
}
