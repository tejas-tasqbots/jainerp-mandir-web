import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, X, Package, AlertTriangle } from 'lucide-react'
import { api, fmtPaise, parsePaise } from '../../lib/api'
import { exportXlsx } from '../../lib/exportXlsx'
import { DataTable, filterStateToParams, type ColumnDef, type ColumnFilterState, type RowAction } from '../../components/kit/DataTable'
import { SummaryStrip, type SummaryStat } from '../../components/kit/SummaryStrip'
import { PrintLetterhead } from '../../components/kit/PrintLetterhead'
import { useToast } from '../../components/kit/Toast'

interface InventoryItem {
  id: string
  name: string
  category?: string
  unit?: string
  current_stock?: number
  reorder_level?: number
  unit_price_paise?: number
  is_active: boolean
  created_at: string
}

const emptyForm = { name: '', category: '', unit: 'piece', current_stock: '0', reorder_level: '0', unit_price: '' }

// Bhandar item masters are small — load the full set so the low-stock filter
// and stock-value summary see every item, and let the table paginate visually.
const FETCH_LIMIT = 200

const isLowStock = (i: InventoryItem) =>
  i.current_stock !== undefined && i.reorder_level !== undefined && i.current_stock <= i.reorder_level

export function InventoryPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})
  const [lowOnly, setLowOnly] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const categoryOptions = useMemo(
    () => Array.from(new Set(items.map(i => i.category).filter((c): c is string => !!c))).sort(),
    [items],
  )

  const columns: ColumnDef<InventoryItem>[] = useMemo(() => [
    {
      key: 'name', label: t('inventory.item'),
      render: i => (
        <span className="font-medium inline-flex items-center gap-1.5">
          {i.name}
          {isLowStock(i) && (
            <span className="badge-red inline-flex items-center gap-1" title={t('inventory.lowStock')}>
              <AlertTriangle size={10} /> {t('inventory.lowStock')}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'category', label: t('inventory.category'),
      filter: { kind: 'enum', param: 'category', options: categoryOptions.map(c => ({ value: c, label: c })) },
      render: i => <span className="text-slate-600">{i.category || '—'}</span>,
    },
    { key: 'unit', label: t('inventory.unit'), render: i => <span className="text-slate-600">{i.unit || '—'}</span> },
    {
      key: 'stock', label: t('inventory.stock'), align: 'right',
      render: i => (
        <span className={`font-semibold ${isLowStock(i) ? 'text-red-600' : 'text-slate-700'}`}>
          {i.current_stock ?? 0}
        </span>
      ),
    },
    {
      key: 'reorder', label: t('inventory.reorderLevel'), align: 'right',
      render: i => <span className="text-slate-500">{i.reorder_level ?? 0}</span>,
    },
    {
      key: 'unitPrice', label: t('inventory.unitPrice'), align: 'right',
      render: i => <>{i.unit_price_paise ? `₹${fmtPaise(i.unit_price_paise)}` : '—'}</>,
    },
    {
      key: 'value', label: t('inventory.stockValue'), align: 'right',
      render: i => {
        const value = (i.unit_price_paise ?? 0) * (i.current_stock ?? 0)
        return <span className="text-slate-600">{value ? `₹${fmtPaise(value)}` : '—'}</span>
      },
    },
    {
      key: 'status', label: t('inventory.status'),
      filter: { kind: 'enum', param: 'is_active', options: [
        { value: 'true', label: t('inventory.active') },
        { value: 'false', label: t('inventory.inactive') },
      ] },
      render: i => i.is_active
        ? <span className="badge-green">{t('inventory.active')}</span>
        : <span className="badge-gray">{t('inventory.inactive')}</span>,
    },
     
  ], [t, categoryOptions])

  useEffect(() => { load() }, [search, filterState])

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(FETCH_LIMIT) })
      if (search) params.set('q', search)
      for (const [k, v] of Object.entries(filterStateToParams(columns, filterState))) params.set(k, v)
      const { data } = await api.get(`/inventory-items?${params}`)
      setItems(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  // Low-stock is a computed condition (stock ≤ reorder level), so it filters
  // over the fully-loaded item set on the client.
  const visible = lowOnly ? items.filter(isLowStock) : items
  const lowCount = items.filter(isLowStock).length
  const stockValue = items.reduce((s, i) => s + (i.unit_price_paise ?? 0) * (i.current_stock ?? 0), 0)

  const stats: SummaryStat[] = [
    { label: t('inventory.title'), value: String(items.length) },
    { label: t('inventory.stockValue'), value: `₹${fmtPaise(stockValue)}` },
    { label: t('inventory.lowStock'), value: String(lowCount), tone: lowCount ? 'expense' : 'default' },
  ]

  async function exportExcel() {
    if (!visible.length) { toast.info(t('kit.nothingToExport')); return }
    try {
      await exportXlsx({
        title: t('inventory.title'),
        filename: 'inventory',
        columns: [
          { header: t('inventory.item'), width: 26 },
          { header: t('inventory.category'), width: 16 },
          { header: t('inventory.unit'), width: 10 },
          { header: t('inventory.stock'), type: 'number' },
          { header: t('inventory.reorderLevel'), type: 'number' },
          { header: t('inventory.unitPrice'), type: 'money' },
          { header: t('inventory.stockValue'), type: 'money' },
          { header: t('inventory.status'), width: 10 },
        ],
        rows: visible.map(i => [
          i.name, i.category ?? '', i.unit ?? '', i.current_stock ?? 0, i.reorder_level ?? 0,
          i.unit_price_paise ?? 0, (i.unit_price_paise ?? 0) * (i.current_stock ?? 0),
          i.is_active ? t('inventory.active') : t('inventory.inactive'),
        ]),
        totals: [t('kit.total'), '', '', '', '', '', stockValue, ''],
      })
      toast.success(t('kit.exportReady'))
    } catch {
      toast.error(t('kit.exportFailed'))
    }
  }

  function openAdd() { setEditId(null); setForm(emptyForm); setShowForm(true) }
  function openEdit(item: InventoryItem) {
    setEditId(item.id)
    setForm({
      name: item.name, category: item.category || '', unit: item.unit || 'piece',
      current_stock: String(item.current_stock ?? 0),
      reorder_level: String(item.reorder_level ?? 0),
      unit_price: item.unit_price_paise ? String(item.unit_price_paise / 100) : '',
    })
    setShowForm(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        name: form.name, category: form.category || undefined, unit: form.unit,
        current_stock: parseInt(form.current_stock) || 0,
        reorder_level: parseInt(form.reorder_level) || 0,
        unit_price_paise: form.unit_price ? parsePaise(form.unit_price) : undefined,
      }
      if (editId) await api.patch(`/inventory-items/${editId}`, body)
      else await api.post('/inventory-items', body)
      setShowForm(false); setForm(emptyForm); setEditId(null)
      toast.success(editId ? t('inventory.itemUpdated') : t('inventory.itemAdded'))
      load()
    } finally {
      setSaving(false)
    }
  }

  function rowActions(i: InventoryItem): RowAction[] {
    return [{ label: t('inventory.editItem'), icon: <Pencil size={14} />, primary: true, onClick: () => openEdit(i) }]
  }

  return (
    <div className="space-y-4">
      <PrintLetterhead title={t('inventory.title')} />

      <div className="flex items-center justify-between no-print">
        <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Package size={18} /> {t('inventory.title')}</h1>
        <button onClick={openAdd} className="btn-primary btn-sm"><Plus size={14} /> {t('inventory.addItem')}</button>
      </div>

      <SummaryStrip stats={stats} />

      <div className="no-print">
        <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={e => setLowOnly(e.target.checked)}
            className="accent-[var(--color-cta)]"
          />
          {t('inventory.showLowStockOnly')}
          {lowCount > 0 && <span className="badge-red">{lowCount}</span>}
        </label>
      </div>

      <DataTable
        viewKey="inventory-list"
        columns={columns}
        rows={visible}
        rowKey={i => i.id}
        rowActions={rowActions}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('inventory.searchPlaceholder')}
        onExportXlsx={exportExcel}
        onPrint={() => window.print()}
        filterState={filterState}
        onFilterChange={(key, s) => {
          setFilterState(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
          })
        }}
        page={1}
        limit={FETCH_LIMIT}
        total={visible.length}
        onPageChange={() => {}}
        emptyMessage={t('inventory.noItemsFound')}
        emptyAction={{ label: t('inventory.addItem'), onClick: openAdd }}
      />

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-navy-900">{editId ? t('inventory.editItem') : t('inventory.addInventoryItem')}</h3>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div><label className="form-label">{t('inventory.nameRequired')}</label><input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="form-label">{t('inventory.category')}</label><input className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} /></div>
                <div>
                  <label className="form-label">{t('inventory.unit')}</label>
                  <select className="form-select" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                    <option value="piece">{t('inventory.unitPiece')}</option><option value="kg">{t('inventory.unitKg')}</option><option value="gram">{t('inventory.unitGram')}</option>
                    <option value="litre">{t('inventory.unitLitre')}</option><option value="pack">{t('inventory.unitPack')}</option><option value="box">{t('inventory.unitBox')}</option>
                    <option value="set">{t('inventory.unitSet')}</option><option value="pair">{t('inventory.unitPair')}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="form-label">{t('inventory.currentStock')}</label><input type="number" min="0" className="form-input" value={form.current_stock} onChange={e => setForm(f => ({ ...f, current_stock: e.target.value }))} /></div>
                <div><label className="form-label">{t('inventory.reorderAt')}</label><input type="number" min="0" className="form-input" value={form.reorder_level} onChange={e => setForm(f => ({ ...f, reorder_level: e.target.value }))} /></div>
                <div><label className="form-label">{t('inventory.unitPriceAmount')}</label><input type="number" step="0.01" min="0" className="form-input" value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} /></div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('common.saving') : t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
