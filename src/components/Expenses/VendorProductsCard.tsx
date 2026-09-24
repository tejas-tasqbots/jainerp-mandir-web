import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { api, apiErrorMessage, parsePaise } from '../../lib/api'
import { useToast } from '../kit/Toast'
import type { VendorItem } from './expenseItems'

interface Category { id: string; name: string }
interface EditRow { id: string | null; name: string; unit: string; rate: string; gst_rate: string; category_id: string; other_category: string; is_active: boolean; dirty?: boolean }

/** "Other…" in the category dropdown: a new expense head, typed by name. */
const OTHER = '__other__'

const toRow = (i: VendorItem): EditRow => ({
  id: i.id, name: i.name, unit: i.unit ?? '', rate: String(Number(i.default_rate_paise) / 100),
  gst_rate: String(i.gst_rate ?? 0), category_id: i.category_id ?? '', other_category: '', is_active: i.is_active,
})
const blank = (): EditRow => ({ id: null, name: '', unit: '', rate: '', gst_rate: '0', category_id: '', other_category: '', is_active: true })

/**
 * What a vendor sells (tenant migration 057): "One Vendor Can give multiple
 * thing or multiple type of products that vendor can sell". Kept on the
 * vendor, so an expense bill from them is picked item by item - name, unit,
 * usual rate, GST and the expense head it books to come with the pick.
 */
export function VendorProductsCard({ vendorId, canEdit }: { vendorId: string; canEdit: boolean }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [rows, setRows] = useState<EditRow[]>([])
  const [draft, setDraft] = useState<EditRow>(blank)
  const [categories, setCategories] = useState<Category[]>([])
  const [busy, setBusy] = useState(false)

  const load = () => api.get(`/vendors/${vendorId}/items`, { params: { all: 'true' } })
    .then(r => setRows((r.data.data ?? []).map(toRow))).catch(() => setRows([]))
  useEffect(() => {
    load()
    api.get('/expense-categories', { params: { limit: '200' } }).then(r => setCategories(r.data.data ?? [])).catch(() => {})
  }, [vendorId]) // eslint-disable-line react-hooks/exhaustive-deps

  const body = (r: EditRow) => ({
    name: r.name.trim(), unit: r.unit.trim() || null, default_rate_paise: parsePaise(r.rate || '0'),
    gst_rate: Number(r.gst_rate || 0), is_active: r.is_active,
    ...(r.category_id === OTHER
      ? { category: r.other_category.trim() || null }
      : { category_id: r.category_id || null }),
  })

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true)
    try {
      await fn()
      if (ok) toast.success(ok)
      await load()
    } catch (e) {
      toast.error(apiErrorMessage(e, t('vendorProducts.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  // On a phone each product is a small card and every box carries its own
  // label (the column heads are desktop-only); a bare "120" and "5" meant
  // nothing.
  const field = (label: string, input: React.ReactNode, wide = false) => (
    <div className={wide ? 'col-span-2 md:col-span-1' : ''}>
      <span className="md:hidden form-label text-xs">{label}</span>
      {input}
    </div>
  )
  const cells = (r: EditRow, set: (p: Partial<EditRow>) => void) => (
    <>
      {field(t('vendorProducts.name'), (
        <input className="form-input" value={r.name} maxLength={200} disabled={!canEdit}
          placeholder={t('vendorProducts.namePlaceholder')} aria-label={t('vendorProducts.name')}
          onChange={e => set({ name: e.target.value })} />
      ), true)}
      {field(t('expenseItems.unit'), (
        <input className="form-input" value={r.unit} maxLength={30} placeholder="kg" disabled={!canEdit}
          aria-label={t('expenseItems.unit')} onChange={e => set({ unit: e.target.value })} />
      ))}
      {field(t('expenseItems.rate'), (
        <input type="number" min="0" step="0.01" className="form-input" value={r.rate} placeholder="0.00" disabled={!canEdit}
          aria-label={t('expenseItems.rate')} onChange={e => set({ rate: e.target.value })} />
      ))}
      {field(t('expenseItems.gstPct'), (
        <input type="number" min="0" max="40" step="0.01" className="form-input" value={r.gst_rate} disabled={!canEdit}
          aria-label={t('expenseItems.gstPct')} onChange={e => set({ gst_rate: e.target.value })} />
      ))}
      {field(t('expenses.category'), (
        <div className="space-y-1">
          <select className="form-select" value={r.category_id} disabled={!canEdit} aria-label={t('expenses.category')}
            onChange={e => set({ category_id: e.target.value })}>
            <option value="">{t('vendorProducts.noCategory')}</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={OTHER}>{t('expenseItems.otherCategory')}</option>
          </select>
          {r.category_id === OTHER && (
            <input className="form-input" maxLength={100} value={r.other_category} autoFocus
              placeholder={t('expenseItems.newCategoryName')} aria-label={t('expenseItems.newCategoryName')}
              onChange={e => set({ other_category: e.target.value })} />
          )}
        </div>
      ))}
    </>
  )

  return (
    <div data-testid="vendor-products">
      <h3 className="text-sm font-semibold text-slate-700 mb-2">{t('vendorProducts.title')}</h3>
      <div className="card p-3 space-y-2">
        <div className="hidden md:grid grid-cols-[1fr_5rem_6rem_4.5rem_10rem_auto_auto] gap-2 text-xs text-slate-500 px-0.5">
          <span>{t('vendorProducts.name')}</span><span>{t('expenseItems.unit')}</span><span>{t('expenseItems.rate')}</span>
          <span>{t('expenseItems.gstPct')}</span><span>{t('expenses.category')}</span><span /><span />
        </div>
        {rows.length === 0 && <p className="text-sm text-slate-500">{t('vendorProducts.none')}</p>}
        {rows.map(r => (
          <div key={r.id} className="grid grid-cols-2 md:grid-cols-[1fr_5rem_6rem_4.5rem_10rem_auto_auto] gap-2 items-start md:items-center rounded-lg border border-slate-200 p-2 md:border-0 md:p-0" data-testid="vendor-product">
            {cells(r, p => setRows(list => list.map(x => (x.id === r.id ? { ...x, ...p, dirty: true } : x))))}
            {canEdit && (
              <div className="col-span-2 flex items-center justify-end gap-2 md:contents">
                <button type="button" className="btn-secondary btn-sm" disabled={busy || !r.dirty}
                  onClick={() => run(() => api.patch(`/vendors/items/${r.id}`, body(r)), t('vendorProducts.saved'))}>
                  {t('common.save')}
                </button>
                <button type="button" className="p-1 text-slate-400 hover:text-brand-red rounded" disabled={busy}
                  title={t('vendorProducts.remove')} aria-label={`${t('vendorProducts.remove')} ${r.name}`}
                  onClick={() => run(() => api.delete(`/vendors/items/${r.id}`))}>
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
        {canEdit && (
          <div className="grid grid-cols-2 md:grid-cols-[1fr_5rem_6rem_4.5rem_10rem_auto] gap-2 items-start md:items-center pt-2 border-t border-slate-100">
            {cells(draft, p => setDraft(d => ({ ...d, ...p })))}
            <button type="button" className="btn-primary btn-sm col-span-2 md:col-span-1 justify-center" disabled={busy || !draft.name.trim()}
              onClick={() => run(async () => { await api.post(`/vendors/${vendorId}/items`, body(draft)); setDraft(blank()) }, t('vendorProducts.saved'))}>
              <Plus size={14} /> {t('vendorProducts.add')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
