import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Save, X, Pencil, Trash2, RefreshCw, ImagePlus, Search } from 'lucide-react'
import { api } from '../../lib/api'
import { compressImage } from '../../lib/imageCompress'
import { useConfirm } from '../../components/ConfirmDialog'

/**
 * Photos per record. The API refuses a sixth (common/domain/images.ts), so this
 * is the same number said twice — deliberately, because the picker must stop
 * the trustee BEFORE the upload rather than reject five minutes of choosing.
 */
const MAX_IMAGES = 5

export interface MasterField {
  /** Column name sent to / read from the API. */
  key: string
  label: string
  /**
   * `list`: a TEXT[] column (a room's amenities), typed comma-separated and
   * saved as an array; an empty box saves an empty list.
   */
  type?: 'text' | 'number' | 'money' | 'checkbox' | 'select' | 'images' | 'list'
  /** Options for a `select` field. Ignored for every other type. */
  options?: { value: string; label: string }[]
  /**
   * Load a `select`'s options from another master instead — e.g. the funds a
   * donation category can point at. Re-read whenever the editor opens, so a
   * fund added in the card below is offered without a reload.
   */
  optionsFrom?: { resource: string; labelKey?: string }
  /**
   * A first, empty choice for a `select` ("No fund"). Choosing it saves NULL,
   * so a link can be removed again — an omitted key would leave it unchanged.
   */
  emptyLabel?: string
  /** Optional placeholder for inputs. */
  placeholder?: string
  /** A `checkbox`'s short tag in the list when ticked (the label is used otherwise). */
  badge?: string
  /** Field is required when creating. */
  required?: boolean
  /** Default value for new rows. */
  default?: string | number | boolean
  /**
   * Emptying the field saves NULL. Without it an empty value is simply not
   * sent, which is right for a required name and wrong for an optional one:
   * a Building typed by mistake could never be removed again.
   */
  clearable?: boolean
}

export interface MasterEditorProps {
  /** Resource slug as registered in the backend resource-registry (e.g. 'donation-categories'). */
  resource: string
  title: string
  description?: string
  fields: MasterField[]
  /** Extra query params for the list call, e.g. { is_active: 'true' } — omit to list all. */
  listParams?: Record<string, string>
  /** Boolean column that represents "enabled". Defaults to 'is_active'. */
  statusField?: string
  /** Told how many entries the list has, whenever it loads (the Settings rail shows it). */
  onCount?: (n: number) => void
}

/** A list longer than this gets a search box above it. */
const SEARCH_FROM = 8

type Row = Record<string, unknown> & { id: string }

type FormValue = string | number | boolean | string[]

function emptyForm(fields: MasterField[]): Record<string, FormValue> {
  const f: Record<string, FormValue> = {}
  for (const field of fields) {
    f[field.key] = field.type === 'images'
      ? []
      : field.default ?? (field.type === 'checkbox' ? false : '')
  }
  return f
}

/** Whatever the API gave back for an images column, as an array of strings. */
function toImageList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string' && v.trim()) return [v]
  return []
}

/** A TEXT[] value for the comma-separated box, and back. */
function listToText(v: unknown): string {
  return Array.isArray(v) ? v.filter(x => typeof x === 'string').join(', ') : (typeof v === 'string' ? v : '')
}
function textToList(v: unknown): string[] {
  return String(v ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 30)
}

/** Money fields are stored in paise on the backend but edited in rupees. */
function toPaise(rupees: string | number): number {
  return Math.round(Number(rupees) * 100)
}
function fromPaise(paise: unknown): string {
  const n = Number(paise || 0)
  return Number.isFinite(n) ? String(n / 100) : ''
}

/**
 * Generic create/list/edit/activate-deactivate editor over a backend master
 * resource. Soft-deletes via is_active so historical records keep their value.
 */
export function MasterEditor({ resource, title, description, fields, listParams, statusField = 'is_active', onCount }: MasterEditorProps) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Row[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm(fields))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Options for fields declared with `optionsFrom`, keyed by field.
  const [remoteOptions, setRemoteOptions] = useState<Record<string, { value: string; label: string }[]>>({})
  const confirm = useConfirm()

  async function loadRemoteOptions() {
    const remote = fields.filter(f => f.optionsFrom)
    if (!remote.length) return
    const entries = await Promise.all(remote.map(async f => {
      try {
        const { data } = await api.get(`/${f.optionsFrom!.resource}`, { params: { limit: 200 } })
        const rows: Row[] = data.data || data || []
        const labelKey = f.optionsFrom!.labelKey ?? 'name'
        return [f.key, rows.map(r => ({
          value: r.id,
          label: `${String(r[labelKey] ?? r.id)}${r.is_active === false ? ` (${t('common.inactive')})` : ''}`,
        }))] as const
      } catch {
        return [f.key, []] as const
      }
    }))
    setRemoteOptions(Object.fromEntries(entries))
  }

  const optionsOf = (field: MasterField) => field.optionsFrom ? (remoteOptions[field.key] ?? []) : (field.options ?? [])

  // What the search matches: every column as shown (a select by its label).
  const q = query.trim().toLowerCase()
  const shown = !q ? rows : rows.filter(row => fields.some(f => {
    const v = row[f.key]
    if (v === null || v === undefined || f.type === 'images' || f.type === 'checkbox') return false
    const label = f.type === 'select' ? optionsOf(f).find(o => o.value === v)?.label ?? ''
      : f.type === 'list' ? listToText(v) : String(v)
    return label.toLowerCase().includes(q)
  }))

  async function load() {
    setLoading(true)
    try {
      // These lists have no pagination UI, so every page has to be pulled in.
      // The resource API defaults to 50 rows and caps `limit` at 200 — without
      // this loop a master with more entries silently loses the tail, and a
      // newly added row past the cut-off is invisible (and so un-editable).
      const PAGE = 200
      const all: Row[] = []
      for (let page = 1; ; page++) {
        const { data } = await api.get(`/${resource}`, { params: { ...listParams, page, limit: PAGE } })
        const batch: Row[] = data.data || data || []
        all.push(...batch)
        const total = Number(data.meta?.total ?? all.length)
        if (batch.length < PAGE || all.length >= total) break
      }
      setRows(all)
      onCount?.(all.length)
    } catch {
      setError(t('settings.masters.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(); loadRemoteOptions() }, [resource])

  function buildPayload(values: Record<string, FormValue>): Record<string, unknown> {
    const payload: Record<string, unknown> = {}
    for (const field of fields) {
      const v = values[field.key]
      if (field.type === 'images') {
        // Always sent, including empty: removing the last photo has to reach
        // the database, and an omitted key would leave the old ones in place.
        payload[field.key] = toImageList(v)
      } else if (field.type === 'list') {
        payload[field.key] = textToList(v)
      } else if (field.type === 'checkbox') {
        payload[field.key] = Boolean(v)
      } else if (field.type === 'money') {
        if (v !== '' && v != null) payload[field.key] = toPaise(v as string)
      } else if (field.type === 'number') {
        if (v !== '' && v != null) payload[field.key] = Number(v)
      } else if (((field.type === 'select' && field.emptyLabel !== undefined) || field.clearable) && (v === '' || v == null)) {
        payload[field.key] = null
      } else {
        if (v !== '' && v != null) payload[field.key] = v
      }
    }
    return payload
  }

  function startEdit(row: Row) {
    const values = emptyForm(fields)
    for (const field of fields) {
      if (field.type === 'money') values[field.key] = fromPaise(row[field.key])
      else if (field.type === 'checkbox') values[field.key] = Boolean(row[field.key])
      else if (field.type === 'images') values[field.key] = toImageList(row[field.key])
      else if (field.type === 'list') values[field.key] = listToText(row[field.key])
      else values[field.key] = (row[field.key] as string | number) ?? ''
    }
    setForm(values)
    setEditingId(row.id)
    setShowAdd(false)
    setError('')
    loadRemoteOptions()
  }

  function startAdd() {
    setForm(emptyForm(fields))
    setShowAdd(true)
    setEditingId(null)
    setError('')
    loadRemoteOptions()
  }

  function cancel() {
    setShowAdd(false)
    setEditingId(null)
    setError('')
  }

  async function save() {
    for (const field of fields) {
      if (field.required && !form[field.key] && form[field.key] !== 0) {
        setError(t('settings.masters.fieldRequired', { field: field.label }))
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload(form)
      if (editingId) {
        await api.patch(`/${resource}/${editingId}`, payload)
      } else {
        await api.post(`/${resource}`, payload)
      }
      cancel()
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string }; message?: string } } }
      setError(err.response?.data?.error?.message || err.response?.data?.message || t('settings.masters.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row: Row) {
    const next = !(row[statusField] ?? true)
    try {
      await api.patch(`/${resource}/${row.id}`, { [statusField]: next })
      await load()
    } catch {
      setError(t('settings.masters.statusUpdateFailed'))
    }
  }

  async function remove(row: Row) {
    const name = (row.name ?? row.label ?? t('settings.masters.thisEntry')) as string
    if (!(await confirm({ title: t('settings.masters.deleteTitle'), message: t('settings.masters.deleteMessage', { name }), confirmLabel: t('common.delete'), danger: true }))) return
    try {
      await api.delete(`/${resource}/${row.id}`)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string }; message?: string } } }
      setError(err.response?.data?.error?.message || err.response?.data?.message || t('settings.masters.deleteFailed'))
    }
  }

  function renderField(field: MasterField) {
    const v = form[field.key]
    if (field.type === 'images') {
      return <ImagesField field={field} value={toImageList(v)}
        onChange={next => setForm(f => ({ ...f, [field.key]: next }))} />
    }
    if (field.type === 'checkbox') {
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={Boolean(v)}
            onChange={e => setForm(f => ({ ...f, [field.key]: e.target.checked }))}
          />
          {field.label}
        </label>
      )
    }
    if (field.type === 'select') {
      return (
        <div>
          <label className="form-label" htmlFor="master-editor-field-1">{field.label}{field.required && ' *'}</label>
          <select id="master-editor-field-1"
            className="form-select"
            value={(v as string) ?? ''}
            aria-label={field.label}
            onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
          >
            {field.emptyLabel !== undefined && <option value="">{field.emptyLabel}</option>}
            {optionsOf(field).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )
    }
    return (
      <div>
        <label className="form-label" htmlFor="master-editor-field-2">{field.label}{field.required && ' *'}</label>
        <input id="master-editor-field-2"
          className="form-input"
          type={field.type === 'number' || field.type === 'money' ? 'number' : 'text'}
          step={field.type === 'money' ? '0.01' : undefined}
          min={field.type === 'money' || field.type === 'number' ? '0' : undefined}
          placeholder={field.placeholder}
          value={v as string | number}
          onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
        />
      </div>
    )
  }

  const editorRow = (
    <div className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {fields.map(field => (
          <div key={field.key} className={
            field.type === 'checkbox' ? 'flex items-end pb-2'
              // A row of thumbnails needs the full width, not half of it.
              : field.type === 'images' ? 'col-span-2'
                : ''
          }>
            {renderField(field)}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-brand-red">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn-primary btn-sm">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          {editingId ? t('settings.accounts.update') : t('common.add')}
        </button>
        <button onClick={cancel} className="btn-secondary btn-sm"><X size={14} /> {t('common.cancel')}</button>
      </div>
    </div>
  )

  return (
    <div className="card" data-testid={`master-${resource}`}>
      <div className="card-header flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
        </div>
        {!showAdd && !editingId && (
          <button onClick={startAdd} className="btn-primary btn-sm"><Plus size={14} /> {t('common.add')}</button>
        )}
      </div>
      <div className="card-body space-y-3">
        {showAdd && editorRow}
        {/* A long list (donation heads run to dozens) gets a search box. */}
        {!loading && rows.length > SEARCH_FROM && (
          <div className="relative max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="form-input pl-8" value={query} onChange={e => setQuery(e.target.value)}
              placeholder={t('settings.masters.searchList', { count: rows.length })} aria-label={t('settings.masters.searchList', { count: rows.length })}
              data-testid="master-search" />
          </div>
        )}
        {loading ? (
          <p className="text-sm text-slate-400">{t('common.loading')}</p>
        ) : rows.length === 0 && !showAdd ? (
          <p className="text-sm text-slate-400">{t('settings.masters.noEntries')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  {fields.filter(f => f.type !== 'checkbox').map(f => <th key={f.key}>{f.label}</th>)}
                  {fields.some(f => f.type === 'checkbox') && <th>{t('settings.masters.flags')}</th>}
                  <th>{t('common.status')}</th>
                  <th className="text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={99} className="text-sm text-slate-400 text-center py-4">{t('settings.masters.noMatch')}</td></tr>
                )}
                {shown.map(row => {
                  const active = (row[statusField] ?? true) as boolean
                  if (editingId === row.id) {
                    return (
                      <tr key={row.id}>
                        <td colSpan={fields.filter(f => f.type !== 'checkbox').length + (fields.some(f => f.type === 'checkbox') ? 1 : 0) + 2}>
                          {editorRow}
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={row.id} className={active ? '' : 'opacity-50'}>
                      {fields.filter(f => f.type !== 'checkbox').map(f => (
                        <td key={f.key} className="text-sm">
                          {f.type === 'images'
                            ? <ImageCell images={toImageList(row[f.key])} />
                            : f.type === 'money'
                            ? `₹${Number(fromPaise(row[f.key])).toLocaleString('en-IN')}`
                            : f.type === 'select'
                              // The option's label, not its stored value: a fund
                              // link would otherwise print as a UUID, and a
                              // fund type as "specific" rather than "Specific grant".
                              ? (optionsOf(f).find(o => o.value === row[f.key])?.label
                                  ?? (row[f.key] ? String(row[f.key]) : (f.emptyLabel ?? '—')))
                              : f.type === 'list'
                                ? (listToText(row[f.key]) || '—')
                                : String(row[f.key] ?? '—')}
                        </td>
                      ))}
                      {fields.some(f => f.type === 'checkbox') && (
                        <td>
                          {fields.filter(f => f.type === 'checkbox').map(f =>
                            row[f.key] ? <span key={f.key} className="badge-blue mr-1" title={f.label}>{f.badge ?? f.label}</span> : null,
                          )}
                        </td>
                      )}
                      <td>
                        <button onClick={() => toggleActive(row)}
                          className={active ? 'badge-green cursor-pointer' : 'badge-gray cursor-pointer'}>
                          {active ? t('common.active') : t('common.inactive')}
                        </button>
                      </td>
                      <td className="text-right">
                        <button onClick={() => startEdit(row)} className="btn-icon" title={t('common.edit') as string}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => remove(row)} className="btn-icon text-slate-500 hover:text-brand-red" title={t('common.delete') as string}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The photos on one record, in the row of a list: a strip of thumbnails, so a
 * trustee can see at a glance which rooms still have none.
 */
function ImageCell({ images }: { images: string[] }) {
  const { t } = useTranslation()
  if (!images.length) return <span className="text-slate-300">—</span>
  return (
    <div className="flex items-center gap-1">
      {images.slice(0, 3).map((src, i) => (
        <img key={i} src={src} alt="" loading="lazy"
          className="w-8 h-8 rounded object-cover border border-slate-200" />
      ))}
      {images.length > 3 && (
        <span className="text-[11px] text-slate-400">
          {t('settings.masters.imagesMore', { count: images.length - 3 })}
        </span>
      )}
    </div>
  )
}

/**
 * Pick up to five photos off the device for one record.
 *
 * Every picked file is downscaled to 1600px / ~300KB before it ever leaves the
 * browser (lib/imageCompress.ts). A phone photo is 4-12MP; stored raw as base64
 * it would be several MB on the row and on every screen that reads the row, and
 * the API would refuse it anyway. Compressing here means the trustee picks the
 * photo they actually took and it just works.
 *
 * The count is enforced in three places on purpose: the input is hidden once
 * five are held, a sixth picked in the same multi-select is dropped with a
 * message, and the API refuses a sixth regardless of what any client does.
 */
function ImagesField({ field, value, onChange }: {
  field: MasterField
  value: string[]
  onChange: (next: string[]) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const room = MAX_IMAGES - value.length

  async function pick(files: FileList | null) {
    if (!files?.length) return
    setErr('')
    const picked = Array.from(files)
    const images = picked.filter(f => f.type.startsWith('image/'))
    if (images.length !== picked.length) setErr(t('settings.masters.imagesOnly'))

    const take = images.slice(0, room)
    if (images.length > room) {
      setErr(t('settings.masters.imagesMax', { max: MAX_IMAGES }))
    }
    if (!take.length) { if (inputRef.current) inputRef.current.value = ''; return }

    setBusy(true)
    try {
      const out: string[] = []
      for (const file of take) {
        try { out.push(await compressImage(file)) }
        catch { setErr(t('settings.masters.imageReadFailed', { name: file.name })) }
      }
      if (out.length) onChange([...value, ...out])
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <label className="form-label">
        {field.label}
        <span className="ml-1 font-normal text-slate-400">
          {t('settings.masters.imagesCount', { count: value.length, max: MAX_IMAGES })}
        </span>
      </label>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {value.map((src, i) => (
            <div key={i} className="relative group">
              <img src={src} alt="" className="w-20 h-20 rounded-md object-cover border border-slate-200" />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                title={t('common.delete') as string}
                aria-label={t('settings.masters.imageRemove', { n: i + 1 }) as string}
                className="absolute -top-1.5 -right-1.5 bg-white border border-slate-300 rounded-full p-0.5 text-slate-500 hover:text-brand-red shadow-sm"
              >
                <X size={12} />
              </button>
              {/* The first photo is the one a search result card shows. */}
              {i === 0 && (
                <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[9px] text-center rounded-b-md py-px">
                  {t('settings.masters.imageCover')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {room > 0 && (
        <>
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
            id={`images-${field.key}`} onChange={e => pick(e.target.files)} />
          <label htmlFor={`images-${field.key}`}
            className="btn-secondary btn-sm cursor-pointer inline-flex w-auto">
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            {busy ? t('settings.masters.imagesAdding') : t('settings.masters.imagesAdd')}
          </label>
        </>
      )}

      <p className="mt-1 text-[11px] text-slate-400">{t('settings.masters.imagesHelp', { max: MAX_IMAGES })}</p>
      {err && <p className="mt-1 text-xs text-brand-red">{err}</p>}
    </div>
  )
}
