import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, UserPlus, X } from 'lucide-react'
import { api } from '../lib/api'
import type { DevoteeSelection } from '../types'

/**
 * "Names on the receipt" (tenant migration 066).
 *
 * A family pays once and asks for every name on the receipt. Counters typed all
 * of them into the donor's name, so the donor list filled with people called
 * "achalji ankitji ayushji dharmavat". Now the donor stays the one person who
 * pays (80G and Form 10BD are in their name), and the other names are added
 * here: ticked from the family saved on the donor, or typed and remembered for
 * next time. The receipt prints "Ashok Jain, Sunita Jain & Ankit Jain".
 */

export const FAMILY_RELATIONS = [
  'spouse', 'son', 'daughter', 'father', 'mother', 'brother', 'sister',
  'son_in_law', 'daughter_in_law', 'grandson', 'granddaughter', 'grandfather', 'grandmother', 'other',
] as const

export interface NameRow { name: string; relation: string | null }

const keyOf = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN')

/** The receipt's name line, exactly as the API composes it (common/domain/receipt-names.ts). */
export function receiptNameLine(payer: string | undefined, names: NameRow[]): string {
  const p = (payer ?? '').trim()
  const rest = names.map(n => n.name.trim()).filter(n => n && keyOf(n) !== keyOf(p))
  if (!p || !rest.length) return p
  const all = [p, ...rest]
  return `${all.slice(0, -1).join(', ')} & ${all[all.length - 1]}`
}

export function ReceiptNames({ donor, value, onChange, saveFamily, onSaveFamilyChange }: {
  donor: DevoteeSelection | null
  value: NameRow[]
  onChange: (rows: NameRow[]) => void
  saveFamily: boolean
  onSaveFamilyChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const [family, setFamily] = useState<NameRow[]>([])
  const [name, setName] = useState('')
  const [relation, setRelation] = useState('')

  // The family saved on this donor, to tick instead of retyping.
  useEffect(() => {
    setFamily([])
    if (!donor || donor.is_anonymous || (!donor.global_user_id && !donor.mobile)) return
    let live = true
    api.get('/donors/lookup', { params: { global_user_id: donor.global_user_id, mobile: donor.mobile } })
      .then(r => {
        const d = r.data?.data ?? r.data
        if (live) setFamily(Array.isArray(d?.family_members) ? d.family_members : [])
      })
      .catch(() => { if (live) setFamily([]) })
    return () => { live = false }
  }, [donor?.global_user_id, donor?.mobile, donor?.is_anonymous])

  if (!donor || donor.is_anonymous) return null

  const has = (n: string) => value.some(v => keyOf(v.name) === keyOf(n))
  const toggle = (m: NameRow) => onChange(has(m.name) ? value.filter(v => keyOf(v.name) !== keyOf(m.name)) : [...value, m])
  const isSaved = (n: string) => family.some(f => keyOf(f.name) === keyOf(n))
  const newOnes = value.filter(v => !isSaved(v.name))

  function add() {
    const n = name.trim().replace(/\s+/g, ' ')
    if (!n || has(n) || keyOf(n) === keyOf(donor?.name ?? '') || value.length >= 10) { setName(''); return }
    onChange([...value, { name: n, relation: relation || null }])
    setName('')
    setRelation('')
  }

  const relationLabel = (r: string | null) => (r ? t(`receiptNames.relation_${r}`) : '')

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2.5" data-testid="receipt-names">
      <div>
        <span className="form-label mb-0 flex items-center gap-1.5"><UserPlus size={14} /> {t('receiptNames.title')}</span>
        <p className="text-xs text-slate-500">{t('receiptNames.hint')}</p>
      </div>

      {family.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={t('receiptNames.savedFamily')}>
          {family.map(m => {
            const on = has(m.name)
            return (
              <button key={m.name} type="button" onClick={() => toggle(m)} aria-pressed={on}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${on
                  ? 'border-green-600 bg-green-50 text-green-800' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                {on ? <Check size={12} /> : <Plus size={12} />}
                {m.name}{m.relation && <span className="text-slate-400">· {relationLabel(m.relation)}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Typed names not yet saved on the donor. */}
      {newOnes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {newOnes.map(m => (
            <span key={m.name} className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs text-blue-800">
              {m.name}{m.relation && <span className="text-blue-500">· {relationLabel(m.relation)}</span>}
              <button type="button" aria-label={t('receiptNames.remove', { name: m.name })} onClick={() => toggle(m)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="form-input flex-1 min-w-[160px]" value={name} maxLength={100}
          placeholder={t('receiptNames.namePlaceholder')} aria-label={t('receiptNames.namePlaceholder')}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <select className="form-select w-40" value={relation} aria-label={t('receiptNames.relation')}
          onChange={e => setRelation(e.target.value)}>
          <option value="">{t('receiptNames.relation')}</option>
          {FAMILY_RELATIONS.map(r => <option key={r} value={r}>{relationLabel(r)}</option>)}
        </select>
        <button type="button" className="btn-secondary btn-sm" onClick={add} disabled={!name.trim() || value.length >= 10}>
          <Plus size={14} /> {t('receiptNames.add')}
        </button>
      </div>

      {newOnes.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={saveFamily} onChange={e => onSaveFamilyChange(e.target.checked)} className="w-3.5 h-3.5" />
          {t('receiptNames.remember', { name: donor.name || t('donations.theDonor') })}
        </label>
      )}

      {value.length > 0 && (
        <p className="text-xs text-slate-600" data-testid="receipt-name-line">
          {t('receiptNames.preview')} <b>{receiptNameLine(donor.name, value)}</b>
          <span className="block text-slate-400">{t('receiptNames.eightyGNote', { name: donor.name || t('donations.theDonor') })}</span>
        </p>
      )}
    </div>
  )
}
