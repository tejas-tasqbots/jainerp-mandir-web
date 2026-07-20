import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Trash2 } from 'lucide-react'
import { api, fmtPaise } from '../../lib/api'
import { DataTable, type ColumnDef } from '../../components/kit/DataTable'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface ResourceItem { kind: 'resource'; resource: string; id: string; label: string; deleted_at: string }
interface ExpenseItem { kind: 'expense'; id: string; description: string; vendor_name: string | null; amount_paise: number; deleted_at: string }
type BinItem = ResourceItem | ExpenseItem

const RESOURCE_LABEL_KEY: Record<string, string> = {
  vendors: 'nav.vendors', rooms: 'nav.rooms', halls: 'nav.hall', guests: 'dharamshala.guest',
  priests: 'nav.priests', employees: 'nav.employees', volunteers: 'employees.tabVolunteers',
  'inventory-items': 'nav.inventory', 'lost-found': 'nav.lostFound', creditors: 'nav.creditors',
  'fixed-assets': 'nav.fixedAssets', loans: 'nav.loans', announcements: 'events.announce', gallery: 'settings.tabs.gallery',
}

/**
 * Recycle Bin — every soft-deleted row from the last 90 days, across the
 * generic master/register resources plus expenses (its own service), with a
 * one-click restore. Donations/donors aren't included: a donation is voided
 * (not deleted) with its own undo-free audit trail already, and donor
 * deletion isn't exposed anywhere in the app yet.
 */
export function RecycleBinPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const [items, setItems] = useState<BinItem[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringKey, setRestoringKey] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [resResp, expResp] = await Promise.allSettled([
        api.get('/recycle-bin'),
        api.get('/expenses/deleted'),
      ])
      const resourceItems: ResourceItem[] = resResp.status === 'fulfilled'
        ? (resResp.value.data.data || []).map((r: any) => ({ kind: 'resource', ...r }))
        : []
      const expenseItems: ExpenseItem[] = expResp.status === 'fulfilled'
        ? (expResp.value.data.data || []).map((e: any) => ({ kind: 'expense', ...e }))
        : []
      const merged = [...resourceItems, ...expenseItems]
        .sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime())
      setItems(merged)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  function keyOf(item: BinItem) { return item.kind === 'expense' ? `expense:${item.id}` : `${item.resource}:${item.id}` }

  async function restore(item: BinItem) {
    setRestoringKey(keyOf(item))
    try {
      if (item.kind === 'expense') await api.post(`/expenses/${item.id}/restore`, {})
      else await api.post(`/${item.resource}/${item.id}/restore`, {})
      toast.success(t('recycleBin.restored'))
      load()
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(ex.response?.data?.error?.message || t('recycleBin.restoreFailed'))
    } finally {
      setRestoringKey(null)
    }
  }

  const columns: ColumnDef<BinItem>[] = useMemo(() => [
    {
      key: 'type', label: t('recycleBin.type'),
      render: item => item.kind === 'expense'
        ? <span className="badge-gray">{t('nav.expenses')}</span>
        : <span className="badge-gray">{t(RESOURCE_LABEL_KEY[item.resource] ?? item.resource)}</span>,
    },
    {
      key: 'label', label: t('recycleBin.item'),
      render: item => item.kind === 'expense'
        ? <div><p className="font-medium">{item.description}</p>{item.vendor_name && <p className="text-xs text-slate-400">{item.vendor_name}</p>}</div>
        : <span className="font-medium">{item.label}</span>,
    },
    {
      key: 'amount', label: t('common.amount'), align: 'right',
      render: item => item.kind === 'expense' ? <>₹{fmtPaise(item.amount_paise)}</> : <span className="text-slate-300">—</span>,
    },
    {
      key: 'deleted_at', label: t('recycleBin.deletedAt'),
      render: item => <span className="text-xs text-slate-400">{new Date(item.deleted_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>,
    },
    {
      key: 'actions', label: t('common.actions'),
      render: item => (
        <button
          type="button" onClick={() => restore(item)} disabled={restoringKey === keyOf(item)}
          className="btn-secondary btn-sm !text-xs"
        >
          <RotateCcw size={12} /> {t('recycleBin.restore')}
        </button>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, restoringKey])

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('recycleBin.title')} />

      <div className="no-print">
        <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Trash2 size={18} /> {t('recycleBin.title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('recycleBin.subtitle')}</p>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={item => keyOf(item)}
        loading={loading}
        filterState={{}}
        onFilterChange={() => {}}
        page={1}
        limit={items.length || 1}
        total={items.length}
        onPageChange={() => {}}
        emptyMessage={t('recycleBin.empty')}
      />
    </div>
  )
}
