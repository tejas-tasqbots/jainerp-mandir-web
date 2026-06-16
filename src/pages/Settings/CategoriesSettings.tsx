import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'

interface Category { id: string; name: string; is_80g_eligible?: boolean; is_active?: boolean }

function CategoryPanel({
  title, resource, has80g,
}: { title: string; resource: string; has80g?: boolean }) {
  const [items, setItems] = useState<Category[]>([])
  const [newName, setNewName] = useState('')
  const [new80g, setNew80g] = useState(true)
  const [adding, setAdding] = useState(false)

  useEffect(() => { load() }, [resource])

  function load() {
    api.get(`/${resource}?limit=200`)
      .then(r => setItems(r.data.data || []))
      .catch(() => {})
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true)
    try {
      await api.post(`/${resource}`, { name: newName.trim(), ...(has80g ? { is_80g_eligible: new80g } : {}) })
      setNewName('')
      setNew80g(true)
      load()
    } finally {
      setAdding(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this category?')) return
    await api.delete(`/${resource}/${id}`).catch(() => {})
    load()
  }

  return (
    <div className="card flex flex-col">
      <div className="card-header"><h3 className="font-semibold text-sm">{title}</h3></div>
      <div className="card-body flex-1 space-y-1 max-h-80 overflow-y-auto">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50 group">
            <span className="text-sm">{item.name}</span>
            <button onClick={() => remove(item.id)}
              className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">No categories yet</p>}
      </div>
      <div className="px-4 py-3 border-t border-slate-100">
        <form onSubmit={add} className="space-y-2">
          <input className="form-input text-sm" placeholder="New category name..."
            value={newName} onChange={e => setNewName(e.target.value)} />
          {has80g && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" className="w-3.5 h-3.5 accent-navy-900" checked={new80g}
                onChange={e => setNew80g(e.target.checked)} />
              80G eligible
            </label>
          )}
          <button type="submit" disabled={adding || !newName.trim()} className="btn-primary btn-sm w-full">
            <Plus size={13} /> Add
          </button>
        </form>
      </div>
    </div>
  )
}

export function CategoriesSettings() {
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold text-navy-900">Category Management</h1>
      <div className="grid grid-cols-2 gap-4">
        <CategoryPanel title="Donation Categories" resource="donation-categories" has80g />
        <CategoryPanel title="Expense Categories" resource="expense-categories" />
      </div>
    </div>
  )
}
