import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2 } from 'lucide-react'
import { api, parsePaise, currentFY } from '../../lib/api'

/**
 * The "Still to do" items, completable without leaving the wizard.
 *
 * They used to `navigate(item.route)`, which dropped you onto a full page and
 * left you to find your way back — so clearing five items meant five round
 * trips through the app.
 *
 * These are deliberately MINIMAL. Each creates the single record that clears
 * the checklist item; the real screens keep every other field. The point is to
 * get past "the register is empty", not to reimplement Dharamshala inside a
 * wizard.
 *
 * Payloads verified against the API rather than guessed:
 *  - rooms and cattle go through the generic resource controller
 *    (resources.controller.ts, `@Post(':resource')`), so the body is the
 *    table's own columns — tenant-template.sql and tenant-migrations/016.
 *  - prasad has its own controller and wants paise plus gst_rate.
 *  - opening balances are keyed on account AND financial year, which is why
 *    currentFY() is not optional here.
 *
 * `comms_templates` is absent on purpose: it is a review action, not a record,
 * and it clears when a preference row exists. Pretending a form completes it
 * would tick a box nobody had read.
 */

type Props = { itemKey: string; onDone: () => void }

export function QuickAdd({ itemKey, onDone }: Props) {
  switch (itemKey) {
    case 'opening_balances': return <OpeningBalance onDone={onDone} />
    case 'rooms': return <AddRoom onDone={onDone} />
    case 'prasad_items': return <AddPrasad onDone={onDone} />
    case 'cattle': return <AddCattle onDone={onDone} />
    default: return null
  }
}

/** True when this item can be finished inline rather than navigated to. */
export function isQuickAddable(itemKey: string): boolean {
  return ['opening_balances', 'rooms', 'prasad_items', 'cattle'].includes(itemKey)
}

function useSave(onDone: () => void) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await fn(); onDone() }
    catch (e: any) { setErr(e?.response?.data?.error?.message ?? t('setupWizard.saveFailed')) }
    finally { setBusy(false) }
  }
  return { busy, err, run }
}

function Wrap({ children, busy, err, onSave, disabled }: {
  children: React.ReactNode; busy: boolean; err: string; onSave: () => void; disabled: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 space-y-2">
      {children}
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button type="button" onClick={onSave} disabled={disabled || busy}
        className="btn-primary btn-sm disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        {t('common.save')}
      </button>
    </div>
  )
}

const inp = 'form-input text-sm w-full'

function OpeningBalance({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const { busy, err, run } = useSave(onDone)
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const fy = currentFY()

  useEffect(() => {
    api.get('/accounts', { params: { limit: 100 } })
      .then(r => {
        const rows = r.data.data || []
        setAccounts(rows)
        if (rows[0]) setAccountId(rows[0].id)
      })
      .catch(() => { /* the select just stays empty */ })
  }, [])

  return (
    <Wrap busy={busy} err={err} disabled={!accountId}
      onSave={() => run(() => api.post('/account-opening-balances', {
        account_id: accountId, fy, opening_balance_paise: parsePaise(amount || '0'),
      }))}>
      <p className="text-xs text-slate-500">{t('setupWizard.quick.openingHint', { fy })}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select className="form-select text-sm w-full" value={accountId} onChange={e => setAccountId(e.target.value)}>
          {accounts.length === 0 && <option value="">{t('setupWizard.quick.noAccounts')}</option>}
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input className={inp} inputMode="decimal" placeholder="0.00" value={amount}
          onChange={e => setAmount(e.target.value)} />
      </div>
    </Wrap>
  )
}

function AddRoom({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const { busy, err, run } = useSave(onDone)
  const [roomNumber, setRoomNumber] = useState('')
  const [tariff, setTariff] = useState('')

  return (
    <Wrap busy={busy} err={err} disabled={!roomNumber.trim()}
      onSave={() => run(() => api.post('/rooms', {
        room_number: roomNumber.trim(),
        tariff_paise: parsePaise(tariff || '0'),
      }))}>
      <p className="text-xs text-slate-500">{t('setupWizard.quick.roomHint')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={inp} placeholder={t('setupWizard.quick.roomNumber') as string}
          value={roomNumber} onChange={e => setRoomNumber(e.target.value)} />
        <input className={inp} inputMode="decimal" placeholder={t('setupWizard.quick.tariff') as string}
          value={tariff} onChange={e => setTariff(e.target.value)} />
      </div>
    </Wrap>
  )
}

function AddPrasad({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const { busy, err, run } = useSave(onDone)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')

  return (
    <Wrap busy={busy} err={err} disabled={!name.trim()}
      onSave={() => run(() => api.post('/prasad/items', {
        name: name.trim(),
        unit: 'piece',
        price_paise: parsePaise(price || '0'),
        gst_rate: 0,
        stock_qty: 0,
        low_stock_threshold: 0,
      }))}>
      <p className="text-xs text-slate-500">{t('setupWizard.quick.prasadHint')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={inp} placeholder={t('setupWizard.quick.prasadName') as string}
          value={name} onChange={e => setName(e.target.value)} />
        <input className={inp} inputMode="decimal" placeholder={t('setupWizard.quick.price') as string}
          value={price} onChange={e => setPrice(e.target.value)} />
      </div>
    </Wrap>
  )
}

function AddCattle({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const { busy, err, run } = useSave(onDone)
  const [tag, setTag] = useState('')
  const [name, setName] = useState('')

  return (
    <Wrap busy={busy} err={err} disabled={!tag.trim()}
      onSave={() => run(() => api.post('/cattle', {
        tag_number: tag.trim(),
        name: name.trim() || null,
        category: 'cow',
      }))}>
      <p className="text-xs text-slate-500">{t('setupWizard.quick.cattleHint')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={inp} placeholder={t('setupWizard.quick.tagNumber') as string}
          value={tag} onChange={e => setTag(e.target.value)} />
        <input className={inp} placeholder={t('setupWizard.quick.cattleName') as string}
          value={name} onChange={e => setName(e.target.value)} />
      </div>
    </Wrap>
  )
}
