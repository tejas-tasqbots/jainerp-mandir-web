import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { useConfirm } from '../../../components/ConfirmDialog'

interface Trustee {
  id: string
  name: string
  designation?: string | null
  mobile?: string | null
  email?: string | null
  since_year?: number | null
}

const EMPTY = { name: '', designation: '', mobile: '', email: '', since_year: '' }

/** Trustee board management (shown on receipts/80G docs and the public temple page). */
export function TrusteesTab() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [rows, setRows] = useState<Trustee[]>([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    try { const { data } = await api.get('/tenants/me/trustees'); setRows(data.data ?? []) } catch { /* */ }
  }

  function startEdit(t: Trustee) {
    setEditingId(t.id)
    setForm({
      name: t.name ?? '', designation: t.designation ?? '', mobile: t.mobile ?? '',
      email: t.email ?? '', since_year: t.since_year ? String(t.since_year) : '',
    })
  }

  async function save() {
    if (!form.name.trim()) { setErr(t('settings.trustees.nameRequired')); return }
    setSaving(true); setErr('')
    const payload = {
      name: form.name.trim(),
      designation: form.designation.trim() || null,
      mobile: form.mobile.trim() || null,
      email: form.email.trim() || null,
      since_year: form.since_year ? Number(form.since_year) : null,
    }
    try {
      if (editingId) await api.patch(`/tenants/me/trustees/${editingId}`, payload)
      else await api.post('/tenants/me/trustees', payload)
      setForm(EMPTY); setEditingId(null); await load()
    } catch (e: any) { setErr(e?.response?.data?.error?.message || t('settings.trustees.saveFailed')) }
    finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!(await confirm({ title: t('settings.trustees.removeTitle'), message: t('settings.trustees.removeMessage'), confirmLabel: t('settings.trustees.remove'), danger: true }))) return
    try { await api.delete(`/tenants/me/trustees/${id}`); await load() } catch { /* */ }
  }

  return (
    <div className="card">
      <div className="card-header"><h3 className="font-semibold text-sm flex items-center gap-2"><Users size={14} /> {t('settings.trustees.heading')}</h3></div>
      <div className="card-body space-y-4">
        <p className="text-xs text-slate-400">
          {t('settings.trustees.helpText')}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <input className="form-input" placeholder={t('settings.trustees.namePlaceholder') as string} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className="form-input" placeholder={t('settings.trustees.designationPlaceholder') as string} value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} />
          <input className="form-input" type="tel" placeholder={t('settings.trustees.mobilePlaceholder') as string} value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} />
          <input className="form-input" type="email" placeholder={t('settings.trustees.emailPlaceholder') as string} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <input className="form-input" type="number" placeholder={t('settings.trustees.sinceYearPlaceholder') as string} value={form.since_year} onChange={e => setForm(f => ({ ...f, since_year: e.target.value }))} />
        </div>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">
            <Plus size={13} /> {saving ? t('settings.saving') : editingId ? t('settings.trustees.updateTrustee') : t('settings.trustees.addTrustee')}
          </button>
          {editingId && (
            <button onClick={() => { setEditingId(null); setForm(EMPTY) }} className="btn-secondary btn-sm"><X size={13} /> {t('common.cancel')}</button>
          )}
        </div>

        {rows.length > 0 ? (
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2">{t('common.name')}</th><th>{t('settings.trustees.designation')}</th><th>{t('common.mobile')}</th><th>{t('common.email')}</th><th>{t('settings.trustees.since')}</th><th className="text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(trustee => (
                <tr key={trustee.id} className="border-b border-slate-100">
                  <td className="py-2 font-medium">{trustee.name}</td>
                  <td>{trustee.designation || '—'}</td>
                  <td>{trustee.mobile || '—'}</td>
                  <td>{trustee.email || '—'}</td>
                  <td>{trustee.since_year || '—'}</td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => startEdit(trustee)} className="text-slate-500 hover:text-navy-900 p-1"><Pencil size={14} /></button>
                    <button onClick={() => remove(trustee.id)} className="text-slate-500 hover:text-brand-red p-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-center text-slate-400 text-sm py-4">{t('settings.trustees.noTrustees')}</p>
        )}
      </div>
    </div>
  )
}
