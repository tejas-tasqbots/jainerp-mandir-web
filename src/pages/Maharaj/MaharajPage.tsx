import { useEffect, useState } from 'react'
import { Search, Sparkles, MapPin, Link2, X, Clock, Check, Ban } from 'lucide-react'
import { api } from '../../lib/api'
import { LocationPicker } from '../../components/LocationPicker'
import { StateSelect, CitySelect } from '../../components/GeoSelect'

interface Maharaj { id: string; name: string; type: string; samuday?: string; city?: string; state?: string; current_city?: string; photo_url?: string; note?: string; maharaj_id?: string }
interface Proposal { id: string; maharaj_name: string; place: string; city?: string; status: string; created_at: string; decision_note?: string }

export function MaharajPage() {
  const [tab, setTab] = useState<'linked' | 'directory' | 'proposals'>('linked')
  const [linked, setLinked] = useState<Maharaj[]>([])
  const [directory, setDirectory] = useState<Maharaj[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [q, setQ] = useState('')
  const [proposeFor, setProposeFor] = useState<Maharaj | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => { loadLinked(); loadProposals() }, [])
  useEffect(() => { if (tab === 'directory') searchDirectory() }, [tab])

  async function loadLinked() { try { const { data } = await api.get('/maharaj/linked'); setLinked(data.data ?? data ?? []) } catch { /* */ } }
  async function loadProposals() { try { const { data } = await api.get('/maharaj/proposals'); setProposals(data.data ?? data ?? []) } catch { /* */ } }
  async function searchDirectory() {
    try { const { data } = await api.get('/maharaj/directory', { params: { q } }); setDirectory((data.data?.rows ?? data.data ?? data.rows ?? [])) } catch { /* */ }
  }

  async function link(m: Maharaj, note?: string) {
    try { await api.post('/maharaj/link', { maharaj_id: m.id, note }); setMsg(`Linked ${m.name}`); await loadLinked() } catch { setMsg('Could not link') }
  }
  async function unlink(linkId: string) {
    try { await api.delete(`/maharaj/linked/${linkId}`); await loadLinked() } catch { /* */ }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={20} className="text-brand-red" />
        <h1 className="text-lg font-bold text-navy-900">Maharaj / Mataji</h1>
      </div>

      <div className="flex gap-2 mb-4">
        {(['linked', 'directory', 'proposals'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
            {t === 'linked' ? 'Linked to Temple' : t === 'directory' ? 'Directory' : 'My Proposals'}
          </button>
        ))}
      </div>

      {msg && <div className="card p-3 text-sm text-slate-700 mb-3">{msg}</div>}

      {tab === 'linked' && (
        <div className="space-y-2">
          {linked.length === 0 && <div className="card p-6 text-center text-slate-400 text-sm">No ascetics linked yet. Add from the Directory — they'll show on your temple's devotee page.</div>}
          {linked.map(m => (
            <div key={m.id} className="card p-4 flex items-center gap-3">
              <Avatar m={m} />
              <div className="flex-1">
                <p className="font-semibold text-slate-800 text-sm">{m.name}</p>
                <p className="text-xs text-slate-400">{m.samuday} {m.note && `· ${m.note}`}</p>
              </div>
              <button onClick={() => setProposeFor(m)} className="btn-secondary btn-sm"><MapPin size={13} /> Propose Location</button>
              <button onClick={() => unlink(m.id)} className="text-slate-400 hover:text-brand-red p-1"><X size={16} /></button>
            </div>
          ))}
        </div>
      )}

      {tab === 'directory' && (
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="form-input pl-9" placeholder="Search verified Maharaj/Mataji by name or samuday…"
              value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchDirectory()} />
          </div>
          <div className="space-y-2">
            {directory.map(m => {
              const already = linked.some(l => l.maharaj_id === m.id)
              return (
                <div key={m.id} className="card p-4 flex items-center gap-3">
                  <Avatar m={m} />
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800 text-sm">{m.name}</p>
                    <p className="text-xs text-slate-400">{m.samuday} {m.current_city && `· at ${m.current_city}`}</p>
                  </div>
                  <button disabled={already} onClick={() => link(m)} className={`btn-sm ${already ? 'btn-secondary opacity-50' : 'btn-primary'}`}>
                    <Link2 size={13} /> {already ? 'Linked' : 'Link'}
                  </button>
                </div>
              )
            })}
            {directory.length === 0 && <p className="text-center text-slate-400 text-sm py-4">No verified profiles found.</p>}
          </div>
        </div>
      )}

      {tab === 'proposals' && (
        <div className="space-y-2">
          {proposals.length === 0 && <div className="card p-6 text-center text-slate-400 text-sm">No location proposals yet.</div>}
          {proposals.map(p => (
            <div key={p.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{p.maharaj_name}</p>
                  <p className="text-xs text-slate-400">{p.place}{p.city ? `, ${p.city}` : ''}</p>
                </div>
                <span className={`badge ${p.status === 'approved' ? 'badge-green' : p.status === 'rejected' ? 'badge-red' : 'badge-yellow'}`}>
                  {p.status === 'approved' ? <><Check size={11} /> Approved</> : p.status === 'rejected' ? <><Ban size={11} /> Rejected</> : <><Clock size={11} /> Pending</>}
                </span>
              </div>
              {p.decision_note && <p className="text-xs text-slate-400 mt-1 italic">{p.decision_note}</p>}
            </div>
          ))}
        </div>
      )}

      {proposeFor && (
        <ProposeModal
          maharaj={proposeFor}
          onClose={() => setProposeFor(null)}
          onDone={() => { setProposeFor(null); setMsg('Location proposed — awaiting the representative’s approval.'); setTab('proposals'); loadProposals() }}
        />
      )}
    </div>
  )
}

function Avatar({ m }: { m: Maharaj }) {
  return (
    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center overflow-hidden flex-shrink-0">
      {m.photo_url ? <img src={m.photo_url} alt={m.name} className="w-full h-full object-cover" /> : <Sparkles size={16} className="text-amber-600" />}
    </div>
  )
}

function ProposeModal({ maharaj, onClose, onDone }: {
  maharaj: Maharaj; onClose: () => void; onDone: () => void
}) {
  const [f, setF] = useState<any>({ place: '', city: '', state: '', pincode: '', from_date: '', to_date: '', chaturmas: false, notes: '', lat: null, lng: null })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!f.place.trim()) { setErr('Place is required'); return }
    setSaving(true); setErr('')
    try {
      await api.post(`/maharaj/${maharaj.id}/propose-location`, f)
      onDone()
    } catch (e: any) { setErr(e?.response?.data?.error?.message || 'Failed to propose') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[88vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-navy-900">Propose Location — {maharaj.name}</h3>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <p className="text-xs text-slate-400 mb-3">This is sent to the representative for approval. It becomes the current location only once they approve.</p>
        <div className="space-y-3">
          <div><label className="form-label">Place / Venue *</label><input className="form-input" value={f.place} onChange={e => setF({ ...f, place: e.target.value })} placeholder="e.g. Shree Jain Derasar" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="form-label">State</label>
              <StateSelect value={f.state} onChange={s => setF({ ...f, state: s, city: '' })} />
            </div>
            <div><label className="form-label">City</label>
              <CitySelect state={f.state} value={f.city} onChange={c => setF({ ...f, city: c })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="form-label">From</label><input type="date" className="form-input" value={f.from_date} onChange={e => setF({ ...f, from_date: e.target.value })} /></div>
            <div><label className="form-label">To</label><input type="date" className="form-input" value={f.to_date} onChange={e => setF({ ...f, to_date: e.target.value })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.chaturmas} onChange={e => setF({ ...f, chaturmas: e.target.checked })} className="accent-brand-red" /> Chaturmas at our mandir</label>
          <LocationPicker lat={f.lat} lng={f.lng} onChange={(lat, lng) => setF({ ...f, lat, lng })} height={200} />
          <div><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <button onClick={submit} disabled={saving} className="btn-primary w-full justify-center py-2.5">{saving ? 'Sending…' : 'Send Proposal'}</button>
        </div>
      </div>
    </div>
  )
}
