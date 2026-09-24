import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { fmtPaise, parsePaise } from '../../lib/api'
import { newChargeRow, useChargeItems, type ChargeRow } from './chargeRows'

/**
 * Extra charges on a stay (tenant migration 057): an extra bed for the third
 * person, food, laundry, damage, "other charges".
 *
 * Asked for 2026-09-24: "1 bed is there double sharing but with them they have
 * one person extra so they can add bed ... there should be option for input
 * Other Charges ... at booking, check-in or checkout".
 *
 * Picking an item from the trust's price list (Settings → Stay → Extra
 * charges) fills its rate and, for a per-night item, the nights; the clerk can
 * still change either. Used by the booking form and by the check-in, stay and
 * checkout dialogs, so all four take extras the same way.
 */
export function ExtraChargesEditor({
  rows, onChange, nights, rooms,
}: {
  rows: ChargeRow[]
  onChange: (rows: ChargeRow[]) => void
  /** The stay's nights, the default for a per-night item. */
  nights: number
  /** When several rooms are booked together, which one each charge is on. */
  rooms?: Array<{ id: string; label: string }>
}) {
  const { t } = useTranslation()
  const items = useChargeItems()
  const set = (key: string, patch: Partial<ChargeRow>) =>
    onChange(rows.map(r => (r.key === key ? { ...r, ...patch } : r)))
  const multiRoom = (rooms?.length ?? 0) > 1

  return (
    <div className="space-y-2" data-testid="extra-charges">
      {rows.map(row => {
        const amount = Math.round(parsePaise(row.rate || '0') * Number(row.qty || 0) * Number(row.nights || 0))
        return (
          <div key={row.key} className="rounded-lg border border-slate-200 p-2.5" data-testid="charge-row">
            <div className={`grid gap-2 items-end ${multiRoom ? 'md:grid-cols-[8rem_1fr_4rem_4rem_6rem_auto]' : 'md:grid-cols-[1fr_4rem_4rem_6rem_auto]'} grid-cols-2`}>
              {multiRoom && (
                <div>
                  <label className="form-label text-xs">{t('roomCharges.room')}</label>
                  <select className="form-select" value={row.room_id} aria-label={t('roomCharges.room')}
                    onChange={e => set(row.key, { room_id: e.target.value })}>
                    {rooms!.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
              )}
              <div className="col-span-2 md:col-span-1">
                <label className="form-label text-xs">{t('roomCharges.what')}</label>
                <input
                  className="form-input" list={`charge-items-${row.key}`} value={row.description}
                  aria-label={t('roomCharges.what')} placeholder={t('roomCharges.whatPlaceholder')} maxLength={200}
                  onChange={e => {
                    const v = e.target.value
                    const item = items.find(i => i.name === v)
                    set(row.key, item
                      ? {
                        description: item.name, charge_item_id: item.id,
                        rate: item.default_rate_paise ? String(item.default_rate_paise / 100) : row.rate,
                        nights: item.per_night ? String(Math.max(1, nights)) : '1',
                      }
                      : { description: v, charge_item_id: '' })
                  }}
                />
                <datalist id={`charge-items-${row.key}`}>
                  {items.map(i => <option key={i.id} value={i.name} />)}
                </datalist>
              </div>
              <div>
                <label className="form-label text-xs">{t('roomCharges.qty')}</label>
                <input type="number" min="0.01" step="0.01" className="form-input" value={row.qty}
                  aria-label={t('roomCharges.qty')} onChange={e => set(row.key, { qty: e.target.value })} />
              </div>
              <div>
                <label className="form-label text-xs">{t('roomCharges.nights')}</label>
                <input type="number" min="1" step="1" className="form-input" value={row.nights}
                  aria-label={t('roomCharges.nights')} onChange={e => set(row.key, { nights: e.target.value })} />
              </div>
              <div>
                <label className="form-label text-xs">{t('roomCharges.rate')}</label>
                <input type="number" min="0" step="0.01" className="form-input" value={row.rate} placeholder="0.00"
                  aria-label={t('roomCharges.rate')} onChange={e => set(row.key, { rate: e.target.value })} />
              </div>
              <button type="button" className="p-2 text-slate-400 hover:text-brand-red rounded mb-0.5"
                title={t('roomCharges.remove')} aria-label={t('roomCharges.remove')}
                onClick={() => onChange(rows.filter(r => r.key !== row.key))}>
                <Trash2 size={14} />
              </button>
            </div>
            {amount > 0 && (
              <p className="text-xs text-slate-500 mt-1 text-right" data-testid="charge-amount">= ₹{fmtPaise(amount)}</p>
            )}
          </div>
        )
      })}
      <button type="button" className="btn-secondary btn-sm"
        onClick={() => onChange([...rows, newChargeRow(rooms?.[0]?.id ?? '', nights)])}>
        <Plus size={14} /> {t('roomCharges.add')}
      </button>
    </div>
  )
}
