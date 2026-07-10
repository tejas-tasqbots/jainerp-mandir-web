import { useEffect, useState } from 'react'
import { Plus, Save, X, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { useConfirm } from '../../components/ConfirmDialog'

export interface MasterField {
  /** Column name sent to / read from the API. */
  key: string
  label: string
  type?: 'text' | 'number' | 'money' | 'checkbox'
  /** Optional placeholder for inputs. */
  placeholder?: string
  /** Field is required when creating. */
  required?: boolean
  /** Default value for new rows. */
  default?: string | number | boolean
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
}

type Row = Record<string, unknown> & { id: string }

function emptyForm(fields: MasterField[]): Record<string, string | number | boolean> {
  const f: Record<string, string | number | boolean> = {}
  for (const field of fields) {
    f[field.key] = field.default ?? (field.type === 'checkbox' ? false : '')
  }
  return f
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
export function MasterEditor({ resource, title, description, fields, listParams, statusField = 'is_active' }: MasterEditorProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm(fields))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get(`/${resource}`, { params: listParams })
      setRows(data.data || data || [])
    } catch {
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [resource])

  function buildPayload(values: Record<string, string | number | boolean>): Record<string, unknown> {
    const payload: Record<string, unknown> = {}
    for (const field of fields) {
      const v = values[field.key]
      if (field.type === 'checkbox') {
        payload[field.key] = Boolean(v)
      } else if (field.type === 'money') {
        if (v !== '' && v != null) payload[field.key] = toPaise(v as string)
      } else if (field.type === 'number') {
        if (v !== '' && v != null) payload[field.key] = Number(v)
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
      else values[field.key] = (row[field.key] as string | number) ?? ''
    }
    setForm(values)
    setEditingId(row.id)
    setShowAdd(false)
    setError('')
  }

  function startAdd() {
    setForm(emptyForm(fields))
    setShowAdd(true)
    setEditingId(null)
    setError('')
  }

  function cancel() {
    setShowAdd(false)
    setEditingId(null)
    setError('')
  }

  async function save() {
    for (const field of fields) {
      if (field.required && !form[field.key] && form[field.key] !== 0) {
        setError(`${field.label} is required`)
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
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to save')
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
      setError('Failed to update status')
    }
  }

  async function remove(row: Row) {
    const name = (row.name ?? row.label ?? 'this entry') as string
    if (!(await confirm({ title: 'Delete entry', message: `Delete "${name}"?\nPast records that reference it are kept.`, confirmLabel: 'Delete', danger: true }))) return
    try {
      await api.delete(`/${resource}/${row.id}`)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string }; message?: string } } }
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to delete')
    }
  }

  function renderField(field: MasterField) {
    const v = form[field.key]
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
    return (
      <div>
        <label className="form-label">{field.label}{field.required && ' *'}</label>
        <input
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
          <div key={field.key} className={field.type === 'checkbox' ? 'flex items-end pb-2' : ''}>
            {renderField(field)}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-brand-red">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn-primary btn-sm">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          {editingId ? 'Update' : 'Add'}
        </button>
        <button onClick={cancel} className="btn-secondary btn-sm"><X size={14} /> Cancel</button>
      </div>
    </div>
  )

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
        </div>
        {!showAdd && !editingId && (
          <button onClick={startAdd} className="btn-primary btn-sm"><Plus size={14} /> Add</button>
        )}
      </div>
      <div className="card-body space-y-3">
        {showAdd && editorRow}
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 && !showAdd ? (
          <p className="text-sm text-slate-400">No entries yet. Click “Add” to create one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  {fields.filter(f => f.type !== 'checkbox').map(f => <th key={f.key}>{f.label}</th>)}
                  {fields.some(f => f.type === 'checkbox') && <th>Flags</th>}
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
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
                          {f.type === 'money'
                            ? `₹${Number(fromPaise(row[f.key])).toLocaleString('en-IN')}`
                            : String(row[f.key] ?? '—')}
                        </td>
                      ))}
                      {fields.some(f => f.type === 'checkbox') && (
                        <td>
                          {fields.filter(f => f.type === 'checkbox').map(f =>
                            row[f.key] ? <span key={f.key} className="badge-blue mr-1">{f.label}</span> : null,
                          )}
                        </td>
                      )}
                      <td>
                        <button onClick={() => toggleActive(row)}
                          className={active ? 'badge-green cursor-pointer' : 'badge-gray cursor-pointer'}>
                          {active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="text-right">
                        <button onClick={() => startEdit(row)} className="btn-icon" title="Edit">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => remove(row)} className="btn-icon text-slate-500 hover:text-brand-red" title="Delete">
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
