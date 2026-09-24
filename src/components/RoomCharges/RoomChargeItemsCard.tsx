import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { api, apiErrorMessage, parsePaise } from '../../lib/api'
import { useToast } from '../kit/Toast'
import type { ChargeItem } from './chargeRows'

interface EditItem extends ChargeItem { is_active: boolean; rate: string; dirty?: boolean }

/**
 * The trust's price list of stay extras (tenant migration 057): "that bed
 * charges will be decided" by the trust, once, here - then picking "Extra bed"
 * at the desk fills its rate. A rate of zero leaves the clerk to type it.
 */
export function RoomChargeItemsCard() {
  const { t } = useTranslation()
  const toast = useToast()
  const [items, setItems] = useState<EditItem[]>([])
  const [newName, setNewName] = useState('')
  const [newRate, setNewRate] = useState('')
  const [newPerNight, setNewPerNight] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/room-charge-items', { params: { all: 'true' } })
    .then(r => setItems((r.data.data ?? []).map((i: ChargeItem & { is_active: boolean }) => ({
      ...i, default_rate_paise: Number(i.default_rate_paise), rate: String(Number(i.default_rate_paise) / 100),
    }))))
    .catch(() => setItems([]))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: string, p: Partial<EditItem>) =>
    setItems(list => list.map(i => (i.id === id ? { ...i, ...p, dirty: true } : i)))

  async function save(i: EditItem) {
    setBusy(true)
    try {
      await api.patch(`/room-charge-items/${i.id}`, {
        name: i.name, default_rate_paise: parsePaise(i.rate || '0'), per_night: i.per_night, is_active: i.is_active,
      })
      toast.success(t('roomCharges.itemSaved'))
      await load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('roomCharges.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (!newName.trim()) return
    setBusy(true)
    try {
      await api.post('/room-charge-items', { name: newName.trim(), default_rate_paise: parsePaise(newRate || '0'), per_night: newPerNight })
      setNewName(''); setNewRate(''); setNewPerNight(false)
      await load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('roomCharges.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  async function remove(i: EditItem) {
    setBusy(true)
    try {
      await api.delete(`/room-charge-items/${i.id}`)
      await load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('roomCharges.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" data-testid="room-charge-items">
      <div className="card-header">
        <h3 className="font-semibold text-sm">{t('roomCharges.priceList')}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{t('roomCharges.priceListHint')}</p>
      </div>
      <div className="card-body space-y-2">
        {items.map(i => (
          <div key={i.id} className="grid grid-cols-[1fr_7rem_auto_auto_auto_auto] gap-2 items-center" data-testid="charge-item">
            <input className="form-input" value={i.name} aria-label={t('roomCharges.what')} maxLength={120}
              onChange={e => patch(i.id, { name: e.target.value })} />
            <input type="number" min="0" step="0.01" className="form-input" value={i.rate} aria-label={t('roomCharges.rate')}
              onChange={e => patch(i.id, { rate: e.target.value })} />
            <label className="text-xs text-slate-600 inline-flex items-center gap-1 whitespace-nowrap">
              <input type="checkbox" checked={i.per_night} onChange={e => patch(i.id, { per_night: e.target.checked })} />
              {t('roomCharges.perNight')}
            </label>
            <label className="text-xs text-slate-600 inline-flex items-center gap-1 whitespace-nowrap">
              <input type="checkbox" checked={i.is_active} onChange={e => patch(i.id, { is_active: e.target.checked })} />
              {t('common.active')}
            </label>
            <button type="button" className="btn-secondary btn-sm" disabled={busy || !i.dirty} onClick={() => save(i)}>
              {t('common.save')}
            </button>
            <button type="button" className="p-1 text-slate-400 hover:text-brand-red rounded" disabled={busy}
              title={t('roomCharges.remove')} aria-label={`${t('roomCharges.remove')} ${i.name}`} onClick={() => remove(i)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_7rem_auto_auto] gap-2 items-center pt-2 border-t border-slate-100">
          <input className="form-input" value={newName} placeholder={t('roomCharges.newItemPlaceholder')} maxLength={120}
            aria-label={t('roomCharges.newItem')} onChange={e => setNewName(e.target.value)} />
          <input type="number" min="0" step="0.01" className="form-input" value={newRate} placeholder="0.00"
            aria-label={t('roomCharges.rate')} onChange={e => setNewRate(e.target.value)} />
          <label className="text-xs text-slate-600 inline-flex items-center gap-1 whitespace-nowrap">
            <input type="checkbox" checked={newPerNight} onChange={e => setNewPerNight(e.target.checked)} />
            {t('roomCharges.perNight')}
          </label>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !newName.trim()} onClick={add}>
            <Plus size={14} /> {t('roomCharges.addItem')}
          </button>
        </div>
      </div>
    </div>
  )
}
