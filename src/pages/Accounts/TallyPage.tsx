import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, ArrowUpFromLine, FileDown, History, Link2, Loader2, Plug, Save, Upload } from 'lucide-react'
import { api, apiErrorMessage, currentFY, fmtPaise } from '../../lib/api'
import { FySelect } from '../../components/FySelect'
import { useToast } from '../../components/kit/Toast'

/**
 * TallyPrime (2026-10-21): the trust's journal out to the CA's Tally, and the
 * CA's ledgers, openings and adjustment journals back in.
 *
 * In a browser: download the XML for Tally's Import, upload Tally's XML to
 * read it back. In the desktop apps (online and offline): the same, plus a
 * live link to TallyPrime's XML server on this PC or the LAN, through the
 * desktop's `electronAPI.tallyPost` (a page cannot reach Tally directly).
 */

type Tab = 'export' | 'names' | 'import' | 'history'
type What = 'masters' | 'vouchers' | 'both'

interface TallyBridge { tallyPost?: (url: string, xml: string) => Promise<{ ok: boolean; status?: number; body?: string; error?: string }> }
function tallyBridge(): TallyBridge['tallyPost'] | null {
  const w = window as unknown as { electronAPI?: TallyBridge }
  return w.electronAPI?.tallyPost ?? null
}

interface Settings { company_name: string | null; tally_url: string }
interface MapRow {
  ledger_account_id: string; code: string; name: string; kind: string; group: string | null; is_cash: boolean
  tally_name: string | null; tally_group: string | null; exported_as: string; exported_under: string | null
}
interface ExportRes {
  xml: string; filename: string; fy: string; from: string; to: string; what: What; company: string | null
  counts: { groups: number; ledgers: number; vouchers: number; by_type: Record<string, number>; openings_skipped: number }
  masters_xml: string | null; vouchers_xml: string | null
}
interface PushRes {
  created: number; altered: number; errors: number; line_errors: string[]
  vouchers_sent?: number; vouchers_taken?: number; educational_dates?: boolean
}
interface LogRow {
  id: string; direction: string; what: string; fy: string | null; from_date: string | null; to_date: string | null
  masters: number; vouchers: number; created: number; altered: number; errors: number; created_at: string; actor_name: string | null
}
interface ImportPreview {
  fy: string; commit: boolean
  masters: { total: number; mapped: number; matched: number; create: number; skip_cash: number
    rows: { tally: string; parent: string; kind: string; is_cash: boolean; code: string | null; action: string; opening_paise: number }[] }
  openings: { already_imported: boolean; lines: number; debit_paise: number; credit_paise: number
    cash_compare: { tally: string; tally_opening_paise: number; jainerp_account: string | null; jainerp_opening_paise: number | null; differs: boolean | null }[] }
  vouchers: { total: number; import: number; by_status: Record<string, number>
    rows: { key: string; date: string | null; type: string; number: string | null; narration: string; total_paise: number; status: string }[] }
  ledgers_created?: number; mapped?: number; vouchers_imported?: number
}

/** Tally took fewer vouchers than were sent - it can say ERRORS 0 and still drop them. */
const pushShort = (p: PushRes) => (p.vouchers_sent ?? 0) > 0 && (p.vouchers_taken ?? 0) < (p.vouchers_sent ?? 0)

function downloadXml(xml: string, filename: string) {
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const readFile = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => {
    const buf = r.result as ArrayBuffer
    const b = new Uint8Array(buf)
    // Tally writes its XML files in UTF-16 (with a BOM) unless told otherwise.
    const enc = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : 'utf-8'
    resolve(new TextDecoder(enc).decode(buf))
  }
  r.onerror = () => reject(r.error)
  r.readAsArrayBuffer(f)
})

export function TallyPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const bridge = tallyBridge()
  const [tab, setTab] = useState<Tab>('export')
  const [fy, setFy] = useState(currentFY())
  const [settings, setSettings] = useState<Settings>({ company_name: null, tally_url: 'http://localhost:9000' })
  const [company, setCompany] = useState('')
  const [tallyUrl, setTallyUrl] = useState('http://localhost:9000')
  const [companies, setCompanies] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // export
  const [what, setWhat] = useState<What>('both')
  const [skipOpenings, setSkipOpenings] = useState(false)
  const [lastExport, setLastExport] = useState<ExportRes['counts'] | null>(null)
  const [push, setPush] = useState<PushRes | null>(null)

  // names
  const [rows, setRows] = useState<MapRow[]>([])
  const [edits, setEdits] = useState<Record<string, { tally_name: string; tally_group: string }>>({})
  const [filter, setFilter] = useState('')

  // import
  const [opt, setOpt] = useState({ masters: true, openings: false, vouchers: false, cash_vouchers: false })
  const [srcXml, setSrcXml] = useState<{ groups_xml?: string; ledgers_xml?: string; vouchers_xml?: string }>({})
  const [preview, setPreview] = useState<ImportPreview | null>(null)

  const [log, setLog] = useState<LogRow[]>([])

  useEffect(() => {
    api.get('/tally/settings').then((r) => {
      const s = r.data.data as Settings
      setSettings(s)
      setCompany(s.company_name ?? '')
      setTallyUrl(s.tally_url ?? 'http://localhost:9000')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'names') loadNames()
    if (tab === 'history') api.get('/tally/log').then((r) => setLog(r.data.data ?? [])).catch(() => setLog([]))
    setError(null)
  }, [tab])

  async function loadNames() {
    try {
      const r = await api.get('/tally/mapping')
      setRows(r.data.data ?? [])
      setEdits({})
    } catch (e) {
      setError(apiErrorMessage(e, t('tally.loadFailed')))
    }
  }

  async function saveSettings() {
    setBusy('settings')
    try {
      const r = await api.put('/tally/settings', { company_name: company, tally_url: tallyUrl })
      setSettings(r.data.data)
      toast.success(t('tally.saved'))
    } catch (e) {
      setError(apiErrorMessage(e, t('tally.saveFailed')))
    } finally { setBusy(null) }
  }

  async function sendToTally(xml: string): Promise<string> {
    if (!bridge) throw new Error(t('tally.desktopOnly'))
    const r = await bridge(tallyUrl, xml)
    if (!r.ok || !r.body) throw new Error(r.error || t('tally.noAnswer'))
    return r.body
  }

  async function testConnection() {
    setBusy('test'); setError(null); setCompanies(null)
    try {
      const req = (await api.get('/tally/requests')).data.data as { companies: string }
      const answer = await sendToTally(req.companies)
      const list = (await api.post('/tally/companies', { xml: answer })).data.data.companies as string[]
      setCompanies(list)
      // The saved name may not be one Tally has open: pick what the list shows.
      if (list.length && !list.includes(company)) setCompany(list[0])
      toast.success(t('tally.connected', { count: list.length }))
    } catch (e) {
      setError(e instanceof Error && !('isAxiosError' in e) ? e.message : apiErrorMessage(e, t('tally.noAnswer')))
    } finally { setBusy(null) }
  }

  const exportQuery = () => `/tally/export?fy=${fy}&what=${what}${skipOpenings ? '&openings=skip' : ''}${company ? `&company=${encodeURIComponent(company)}` : ''}`

  async function download() {
    setBusy('download'); setError(null)
    try {
      const r = (await api.get(exportQuery())).data.data as ExportRes
      downloadXml(r.xml, r.filename)
      setLastExport(r.counts)
    } catch (e) {
      setError(apiErrorMessage(e, t('tally.exportFailed')))
    } finally { setBusy(null) }
  }

  async function pushNow() {
    setBusy('push'); setError(null); setPush(null)
    try {
      const r = (await api.get(exportQuery())).data.data as ExportRes
      setLastExport(r.counts)
      const responses: string[] = []
      // Masters first: a voucher's ledgers must exist in Tally before it.
      if (r.masters_xml) responses.push(await sendToTally(r.masters_xml))
      if (r.vouchers_xml && r.counts.vouchers > 0) responses.push(await sendToTally(r.vouchers_xml))
      const res = (await api.post('/tally/push-result', {
        responses, fy: r.fy, from: r.from, to: r.to, what: r.what, company: r.company,
        masters: r.counts.groups + r.counts.ledgers, vouchers: r.counts.vouchers,
      })).data.data as PushRes
      setPush(res)
      if (res.errors || pushShort(res)) toast.error(t('tally.pushedWithErrors', { count: res.errors || (res.vouchers_sent ?? 0) - (res.vouchers_taken ?? 0) }))
      else toast.success(t('tally.pushed', { created: res.created, altered: res.altered }))
    } catch (e) {
      setError(e instanceof Error && !('isAxiosError' in e) ? e.message : apiErrorMessage(e, t('tally.pushFailed')))
    } finally { setBusy(null) }
  }

  async function saveNames() {
    const changed = Object.entries(edits).map(([id, v]) => ({ ledger_account_id: id, tally_name: v.tally_name, tally_group: v.tally_group }))
    if (!changed.length) return
    setBusy('names'); setError(null)
    try {
      const r = await api.put('/tally/mapping', { rows: changed })
      setRows(r.data.data ?? [])
      setEdits({})
      toast.success(t('tally.saved'))
    } catch (e) {
      setError(apiErrorMessage(e, t('tally.saveFailed')))
    } finally { setBusy(null) }
  }

  async function readFromTally() {
    setBusy('read'); setError(null); setPreview(null)
    try {
      const req = (await api.get(`/tally/requests?fy=${fy}${company ? `&company=${encodeURIComponent(company)}` : ''}`)).data.data as
        { groups: string; ledgers: string; vouchers: string }
      const next: typeof srcXml = {}
      next.groups_xml = await sendToTally(req.groups)
      next.ledgers_xml = await sendToTally(req.ledgers)
      if (opt.vouchers) next.vouchers_xml = await sendToTally(req.vouchers)
      setSrcXml(next)
      await runImport(false, next)
    } catch (e) {
      setError(e instanceof Error && !('isAxiosError' in e) ? e.message : apiErrorMessage(e, t('tally.noAnswer')))
    } finally { setBusy(null) }
  }

  async function onFile(kind: 'ledgers_xml' | 'vouchers_xml', f: File | undefined) {
    if (!f) return
    if (f.size > 9_000_000) { setError(t('tally.fileTooBig')); return }
    const text = await readFile(f)
    setSrcXml((s) => ({ ...s, [kind]: text, ...(kind === 'ledgers_xml' ? { groups_xml: text } : {}) }))
    setPreview(null)
  }

  async function runImport(commit: boolean, xml = srcXml) {
    setBusy(commit ? 'commit' : 'preview'); setError(null)
    try {
      const r = (await api.post('/tally/import', { fy, company: company || undefined, ...opt, ...xml, commit })).data.data as ImportPreview
      setPreview(r)
      if (commit) {
        toast.success(t('tally.imported', { ledgers: r.ledgers_created ?? 0, vouchers: r.vouchers_imported ?? 0 }))
        setPreview(null)
        setSrcXml({})
      }
    } catch (e) {
      setError(apiErrorMessage(e, t('tally.importFailed')))
    } finally { setBusy(null) }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? rows.filter((r) => `${r.code} ${r.name} ${r.exported_as} ${r.group ?? ''}`.toLowerCase().includes(q)) : rows
  }, [rows, filter])

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'export', label: t('tally.tabExport'), icon: <ArrowUpFromLine size={14} /> },
    { id: 'names', label: t('tally.tabNames'), icon: <Link2 size={14} /> },
    { id: 'import', label: t('tally.tabImport'), icon: <ArrowDownToLine size={14} /> },
    { id: 'history', label: t('tally.tabHistory'), icon: <History size={14} /> },
  ]
  const hasSource = !!(srcXml.ledgers_xml || srcXml.vouchers_xml)

  return (
    <div className="space-y-4" data-testid="tally-page">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-navy-900 flex items-center gap-2"><Plug size={18} /> {t('tally.title')}</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-500" htmlFor="tally-fy">{t('accounts.fy')}</label>
          <FySelect value={fy} onChange={(v) => { setFy(v); setPreview(null) }} />
        </div>
      </div>
      <p className="text-sm text-slate-600 max-w-3xl">{t('tally.intro')}</p>

      <div className="card px-6 py-4 space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="form-label" htmlFor="tally-company">{t('tally.company')}</label>
            {companies && companies.length > 0 ? (
              <select id="tally-company" className="form-select" value={company} onChange={(e) => setCompany(e.target.value)}>
                {companies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <input id="tally-company" className="form-input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t('tally.companyHint')} />
            )}
          </div>
          {bridge && (
            <div>
              <label className="form-label" htmlFor="tally-url">{t('tally.address')}</label>
              <input id="tally-url" className="form-input" value={tallyUrl} onChange={(e) => setTallyUrl(e.target.value)} />
            </div>
          )}
          <div className="flex items-end gap-2">
            <button className="btn-secondary btn-sm" onClick={() => void saveSettings()} disabled={busy !== null}
              data-testid="tally-save-settings">
              <Save size={14} /> {t('common.save')}
            </button>
            {bridge && (
              <button className="btn-secondary btn-sm" onClick={() => void testConnection()} disabled={busy !== null} data-testid="tally-test">
                {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} {t('tally.test')}
              </button>
            )}
          </div>
        </div>
        {!bridge && <p className="text-xs text-slate-500" data-testid="tally-browser-note">{t('tally.browserNote')}</p>}
        {settings.company_name && !companies && <p className="text-xs text-slate-500">{t('tally.savedCompany', { name: settings.company_name })}</p>}
      </div>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {tabs.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)} data-testid={`tally-tab-${x.id}`}
            className={`px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap ${tab === x.id ? 'border-brand-orange text-navy-900 font-semibold' : 'border-transparent text-slate-500'}`}>
            {x.icon} {x.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-brand-red bg-red-50 rounded px-3 py-2" data-testid="tally-error">{error}</p>}

      {tab === 'export' && (
        <div className="card px-6 py-4 space-y-4">
          <div className="flex flex-wrap gap-4">
            {(['both', 'masters', 'vouchers'] as What[]).map((w) => (
              <label key={w} className="flex items-center gap-2 text-sm">
                <input type="radio" name="tally-what" checked={what === w} onChange={() => setWhat(w)} /> {t(`tally.what_${w}`)}
              </label>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={skipOpenings} onChange={(e) => setSkipOpenings(e.target.checked)} className="mt-1" />
            <span>{t('tally.skipOpenings')}<span className="block text-xs text-slate-500">{t('tally.skipOpeningsHint')}</span></span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" onClick={() => void download()} disabled={busy !== null} data-testid="tally-download">
              {busy === 'download' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} {t('tally.download')}
            </button>
            {bridge && (
              <button className="btn-primary btn-sm" onClick={() => void pushNow()} disabled={busy !== null} data-testid="tally-push">
                {busy === 'push' ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpFromLine size={14} />} {t('tally.push')}
              </button>
            )}
          </div>
          {lastExport && (
            <p className="text-sm text-slate-700" data-testid="tally-export-counts">
              {t('tally.exportCounts', { groups: lastExport.groups, ledgers: lastExport.ledgers, vouchers: lastExport.vouchers })}
              {' '}{Object.entries(lastExport.by_type).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </p>
          )}
          {push && (
            <div className={`text-sm rounded px-3 py-2 ${push.errors || pushShort(push) || push.line_errors.length ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-900'}`} data-testid="tally-push-result">
              {t('tally.pushResult', { created: push.created, altered: push.altered, errors: push.errors })}
              {pushShort(push) && (
                <p className="font-semibold mt-1" data-testid="tally-push-short">
                  {t('tally.pushShort', { taken: push.vouchers_taken ?? 0, sent: push.vouchers_sent ?? 0 })}
                </p>
              )}
              {push.educational_dates && <p className="mt-1" data-testid="tally-educational">{t('tally.educationalHint')}</p>}
              {push.line_errors.length > 0 && <ul className="list-disc ml-5 mt-1">{push.line_errors.slice(0, 10).map((l, i) => <li key={i}>{l}</li>)}</ul>}
            </div>
          )}
          <details className="text-sm text-slate-600">
            <summary className="cursor-pointer font-medium">{t('tally.howTitle')}</summary>
            <ol className="list-decimal ml-5 mt-2 space-y-1">
              <li>{t('tally.how1')}</li>
              <li>{t('tally.how2')}</li>
              <li>{t('tally.how3')}</li>
              <li>{t('tally.how4')}</li>
            </ol>
          </details>
        </div>
      )}

      {tab === 'names' && (
        <div className="card px-6 py-4 space-y-3">
          <p className="text-sm text-slate-600">{t('tally.namesHint')}</p>
          <div className="flex items-center gap-2">
            <input className="form-input max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('tally.search')} />
            <button className="btn-primary btn-sm" onClick={() => void saveNames()} disabled={busy !== null || !Object.keys(edits).length} data-testid="tally-save-names">
              <Save size={14} /> {t('common.save')}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500 border-b">
                <th className="py-2 pr-2">{t('tally.colLedger')}</th>
                <th className="py-2 pr-2">{t('tally.colTallyName')}</th>
                <th className="py-2 pr-2">{t('tally.colTallyGroup')}</th>
              </tr></thead>
              <tbody>
                {shown.map((r) => {
                  const e = edits[r.ledger_account_id]
                  return (
                    <tr key={r.ledger_account_id} className="border-b last:border-0" data-testid={`tally-map-${r.code}`}>
                      <td className="py-1.5 pr-2"><span className="text-slate-400 mr-1">{r.code}</span>{r.name}</td>
                      <td className="py-1.5 pr-2">
                        <input className="form-input py-1" value={e?.tally_name ?? r.tally_name ?? ''} placeholder={r.exported_as}
                          onChange={(ev) => setEdits((s) => ({ ...s, [r.ledger_account_id]: { tally_name: ev.target.value, tally_group: e?.tally_group ?? r.tally_group ?? '' } }))} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input className="form-input py-1" value={e?.tally_group ?? r.tally_group ?? ''} placeholder={r.exported_under ?? ''}
                          onChange={(ev) => setEdits((s) => ({ ...s, [r.ledger_account_id]: { tally_name: e?.tally_name ?? r.tally_name ?? '', tally_group: ev.target.value } }))} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'import' && (
        <div className="card px-6 py-4 space-y-4">
          <p className="text-sm text-slate-600">{t('tally.importHint')}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {(['masters', 'openings', 'vouchers', 'cash_vouchers'] as const).map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={opt[k]} disabled={k === 'cash_vouchers' && !opt.vouchers}
                  onChange={(e) => { setOpt((o) => ({ ...o, [k]: e.target.checked })); setPreview(null) }} data-testid={`tally-opt-${k}`} />
                <span>{t(`tally.opt_${k}`)}<span className="block text-xs text-slate-500">{t(`tally.opt_${k}_hint`)}</span></span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {bridge && (
              <button className="btn-primary btn-sm" onClick={() => void readFromTally()} disabled={busy !== null} data-testid="tally-read">
                {busy === 'read' ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />} {t('tally.readFromTally')}
              </button>
            )}
            <label className="text-sm">
              <span className="form-label">{t('tally.fileMasters')}</span>
              <input type="file" accept=".xml,text/xml" onChange={(e) => void onFile('ledgers_xml', e.target.files?.[0])} data-testid="tally-file-masters" />
            </label>
            <label className="text-sm">
              <span className="form-label">{t('tally.fileDaybook')}</span>
              <input type="file" accept=".xml,text/xml" onChange={(e) => void onFile('vouchers_xml', e.target.files?.[0])} data-testid="tally-file-daybook" />
            </label>
            <button className="btn-secondary btn-sm" onClick={() => void runImport(false)} disabled={busy !== null || !hasSource} data-testid="tally-preview">
              {busy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {t('tally.preview')}
            </button>
          </div>

          {preview && (
            <div className="space-y-3" data-testid="tally-preview-result">
              <div className="grid sm:grid-cols-3 gap-2 text-sm">
                <div className="bg-slate-50 rounded p-2">
                  <div className="font-semibold">{t('tally.pvLedgers', { count: preview.masters.total })}</div>
                  <div>{t('tally.pvLedgersSplit', { mapped: preview.masters.mapped + preview.masters.matched, create: preview.masters.create, cash: preview.masters.skip_cash })}</div>
                </div>
                <div className="bg-slate-50 rounded p-2">
                  <div className="font-semibold">{t('tally.pvOpenings')}</div>
                  <div>{preview.openings.already_imported ? t('tally.pvOpeningsDone') : t('tally.pvOpeningsLines', { count: preview.openings.lines, dr: fmtPaise(preview.openings.debit_paise), cr: fmtPaise(preview.openings.credit_paise) })}</div>
                </div>
                <div className="bg-slate-50 rounded p-2">
                  <div className="font-semibold">{t('tally.pvVouchers', { count: preview.vouchers.total })}</div>
                  <div>{t('tally.pvVouchersImport', { count: preview.vouchers.import })}</div>
                  <div className="text-xs text-slate-500">{Object.entries(preview.vouchers.by_status).map(([k, v]) => `${t(`tally.st_${k}`)}: ${v}`).join(' · ')}</div>
                </div>
              </div>
              {preview.openings.cash_compare.some((c) => c.differs) && (
                <div className="text-sm bg-amber-50 text-amber-900 rounded px-3 py-2">
                  {t('tally.cashDiffers')}
                  <ul className="list-disc ml-5">
                    {preview.openings.cash_compare.filter((c) => c.differs).map((c) => (
                      <li key={c.tally}>{c.tally}: Tally {fmtPaise(c.tally_opening_paise)} / JainERP {fmtPaise(c.jainerp_opening_paise ?? 0)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.masters.create > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer">{t('tally.pvNewLedgers', { count: preview.masters.create })}</summary>
                  <ul className="list-disc ml-5">
                    {preview.masters.rows.filter((r) => r.action === 'create').slice(0, 200).map((r) => <li key={r.tally}>{r.tally} <span className="text-slate-500">({r.parent})</span></li>)}
                  </ul>
                </details>
              )}
              <button className="btn-primary btn-sm" onClick={() => void runImport(true)} disabled={busy !== null} data-testid="tally-commit">
                {busy === 'commit' ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />} {t('tally.commit')}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="card px-6 py-4 overflow-x-auto">
          {log.length === 0 ? <p className="text-sm text-slate-500">{t('tally.noHistory')}</p> : (
            <table className="w-full text-sm" data-testid="tally-history">
              <thead><tr className="text-left text-slate-500 border-b">
                <th className="py-2 pr-2">{t('tally.colWhen')}</th><th className="py-2 pr-2">{t('tally.colWhat')}</th>
                <th className="py-2 pr-2">{t('accounts.fy')}</th><th className="py-2 pr-2">{t('tally.colCounts')}</th><th className="py-2 pr-2">{t('tally.colBy')}</th>
              </tr></thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(l.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                    <td className="py-1.5 pr-2">{t(`tally.dir_${l.direction}`)} · {t(`tally.what_${l.what}`)}</td>
                    <td className="py-1.5 pr-2">{l.fy ?? '—'}</td>
                    <td className="py-1.5 pr-2">{t('tally.logCounts', { masters: l.masters, vouchers: l.vouchers, created: l.created, altered: l.altered, errors: l.errors })}</td>
                    <td className="py-1.5 pr-2">{l.actor_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
