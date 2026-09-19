import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Copy, Plus, Send, Trash2, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { buildReceiptHtml, type ReceiptData } from '../../../lib/printReceipt'
import {
  DEFINITION_BLOCKS, DEFINITION_DENSITIES, DEFINITION_FONTS, DEFINITION_FRAMES,
  defaultDefinition, definitionIssue, MAX_TEXT_LEN, REQUIRED_BLOCKS,
  type DefinitionBlock, type ReceiptDefinition,
} from '../../../lib/receiptDefinition'
import { useToast } from '../../../components/kit/Toast'
import { useConfirm } from '../../../components/ConfirmDialog'

/**
 * Where a trust designs its own receipt.
 *
 * ── WHAT THIS DELIBERATELY IS NOT ───────────────────────────────────────────
 * It is not an HTML or CSS editor, and that is not a limitation of the UI — it
 * is the security model. A receipt is written into a same-origin iframe here
 * and rendered by headless Chromium inside devotee-api; trust-authored markup
 * in either place is stored XSS and a request-forgery primitive. So a trust
 * composes from a fixed vocabulary of blocks and our renderer draws it. See
 * `receiptDefinition.ts`.
 *
 * ── AND WHAT THE FLOW IS ────────────────────────────────────────────────────
 *   draft --submit--> pending --(super admin)--> approved
 *
 * A design cannot print until a super admin has seen it. Editing an approved
 * design does not touch it: "Start a new version" makes a fresh draft and the
 * approved one keeps printing until the new one is approved in its place — so
 * a trust is never mid-edit on the receipt its donors are receiving.
 */

interface Draft {
  id: string
  doc_kind: 'donation' | 'stay' | 'hall'
  name: string
  definition: ReceiptDefinition
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'superseded'
  version: number
  based_on: string | null
  submitted_at: string | null
  reviewed_at: string | null
  review_note: string | null
  updated_at: string
}

const DOC_KINDS = ['donation', 'stay', 'hall'] as const

/** A design that is pending or approved is frozen; the rest are editable. */
const isEditable = (d: Draft) => d.status === 'draft' || d.status === 'rejected'

export function ReceiptDesignerTab() {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [def, setDef] = useState<ReceiptDefinition>(() => defaultDefinition())
  const [docKind, setDocKind] = useState<(typeof DOC_KINDS)[number]>('donation')
  const [lang, setLang] = useState('en')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/receipt-templates')
      setDrafts(r.data.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const current = useMemo(() => drafts.find(d => d.id === selected) ?? null, [drafts, selected])
  const issue = useMemo(() => definitionIssue(def), [def])

  function open(draft: Draft) {
    setSelected(draft.id)
    setName(draft.name)
    setDocKind(draft.doc_kind)
    // A stored definition may have been written by an older build; fall back
    // rather than putting the editor into an unrenderable state.
    setDef(definitionIssue(draft.definition) ? defaultDefinition() : draft.definition)
  }

  function startNew() {
    setSelected(null)
    setName(t('designer.untitled'))
    setDocKind('donation')
    setDef(defaultDefinition())
  }

  /* ── The live preview: the SAME renderer the printer uses ────────────────
     Not a mock-up of the design — `buildReceiptHtml` with `template: 'custom'`
     is exactly what a counter prints, so what an admin approves for submission
     is what a reviewer will see and what a donor will receive. */
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    const sample: ReceiptData = {
      receipt_number: docKind === 'stay' ? 'ROOM/2025-26/000042' : 'DON/2025-26/000001',
      date: new Date().toISOString(),
      is_voided: false,
      kind: docKind === 'donation' ? 'donation' : 'service',
      doc_title: docKind === 'stay' ? 'Room Receipt' : docKind === 'hall' ? 'Hall Receipt' : null,
      donor: {
        name: 'Ayush Kasliwal', mobile: '+919876543210',
        address: '12 Sample Street, Surat, Gujarat, 395001',
        pan_masked: 'ABXXXXX34C', pan_full: null,
      },
      category: docKind === 'stay' ? 'Dharamshala — Room 101' : 'General Donation',
      amount_paise: docKind === 'stay' ? 336000 : 150000,
      payment_mode: 'cash',
      is_80g_eligible: docKind === 'donation',
      payments: [{ payment_mode: 'cash', amount_paise: docKind === 'stay' ? 336000 : 150000, reference_no: null, paid_on: new Date().toISOString() }],
      lines: docKind === 'stay'
        ? [{ label: 'Room 101 (AC, sleeps 2)', qty: '2 nights × ₹1,500.00', amount_paise: 300000 }]
        : null,
      tax: docKind === 'stay' ? { cgst_paise: 8000, sgst_paise: 8000, igst_paise: 0 } : null,
      meta: docKind === 'stay'
        ? {
          room_number: '101', nights: 2, persons: 3,
          check_in_date: '2026-09-19', check_out_date: '2026-09-21',
          checked_in_at: '2026-09-19T09:00:00.000Z',
          checked_out_at: '2026-09-21T04:30:00.000Z',
          guest_id_type: 'aadhaar', guest_id_last4: '9012',
          paid_paise: 336000, due_paise: 0,
        }
        : null,
      mandir: {
        name: t('designer.sampleTrust'),
        address: '12 Mandir Marg, Beawar, Rajasthan, 305901',
        mobile: '+91 98765 43210', email: 'info@jainmandir.org',
        pan: 'AAAAB1234C', reg_80g_number: '80G/2024/001',
        registration_number: 'SOC/2015/BEAWAR/000123',
        show_80g: true, show_gstin: true, show_logo: false,
        eighty_g_enabled: true, gst_enabled: false,
        upi_id: 'jaintrust@upi', bank_account_name: t('designer.sampleTrust'),
        bank_account_no: '123456789012', bank_ifsc: 'SBIN0001234',
        bank_name: 'State Bank of India',
        primary_color: def.accent,
        template: 'custom',
        template_definition: def,
        receipt_paper: 'a4', receipt_copies: 'single',
        receipt_language: lang, receipt_show_upi_qr: false,
        footer: null,
      },
    }
    const html = buildReceiptHtml(sample)
      .replace('<script>window.onload=()=>{window.print()}</script>', '')
    doc.open()
    doc.write(html)
    doc.close()
  }, [def, docKind, lang, t])

  const used = new Set(def.blocks)
  const unused = DEFINITION_BLOCKS.filter(b => !used.has(b))

  function moveBlock(i: number, by: -1 | 1) {
    const next = [...def.blocks]
    const j = i + by
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setDef({ ...def, blocks: next })
  }

  async function save() {
    if (issue) { toast.error(issue); return }
    setSaving(true)
    try {
      if (current) {
        await api.patch(`/receipt-templates/${current.id}`, { name, definition: def })
      } else {
        const r = await api.post('/receipt-templates', { doc_kind: docKind, name, definition: def })
        setSelected(r.data.data?.id ?? null)
      }
      toast.success(t('designer.saved'))
      await load()
    } catch (e: unknown) {
      toast.error(apiMessage(e) || t('designer.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    if (!current) return
    if (!(await confirm({
      title: t('designer.confirmSubmitTitle'),
      message: t('designer.confirmSubmit'),
      confirmLabel: t('designer.submit'),
    }))) return
    try {
      await api.post(`/receipt-templates/${current.id}/submit`, {})
      toast.success(t('designer.submitted'))
      await load()
    } catch (e: unknown) {
      toast.error(apiMessage(e) || t('designer.saveFailed'))
    }
  }

  async function duplicate(draft: Draft) {
    const r = await api.post(`/receipt-templates/${draft.id}/duplicate`, {})
    await load()
    const created = r.data.data
    if (created) open(created)
    toast.success(t('designer.newVersion', { version: created?.version ?? '' }))
  }

  async function remove(draft: Draft) {
    if (!(await confirm({
      message: t('designer.confirmDelete', { name: draft.name }), danger: true,
    }))) return
    try {
      await api.delete(`/receipt-templates/${draft.id}`)
      if (selected === draft.id) startNew()
      await load()
    } catch (e: unknown) {
      toast.error(apiMessage(e) || t('designer.saveFailed'))
    }
  }

  const badgeClass: Record<Draft['status'], string> = {
    draft: 'bg-slate-100 text-slate-600',
    pending: 'bg-amber-50 text-amber-700',
    approved: 'bg-emerald-50 text-emerald-700',
    rejected: 'bg-red-50 text-red-700',
    superseded: 'bg-slate-50 text-slate-400',
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="space-y-4">
        {/* ── The trust's designs ─────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header flex items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-sm">{t('designer.heading')}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{t('designer.subheading')}</p>
            </div>
            <button type="button" onClick={startNew} className="btn-secondary btn-sm">
              <Plus size={13} /> {t('designer.new')}
            </button>
          </div>
          <div className="card-body">
            {loading ? (
              <p className="text-sm text-slate-400">{t('common.loading')}</p>
            ) : !drafts.length ? (
              <p className="text-sm text-slate-500">{t('designer.empty')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {drafts.map(d => (
                  <li key={d.id} className="flex items-center gap-2 py-2" data-testid={`design-${d.id}`}>
                    <button
                      type="button" onClick={() => open(d)}
                      className={`flex-1 text-left ${selected === d.id ? 'font-semibold' : ''}`}
                    >
                      <span className="text-sm">{d.name}</span>
                      <span className="ml-2 text-[11px] text-slate-400">
                        {t(`designer.kind.${d.doc_kind}`)} · v{d.version}
                      </span>
                    </button>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass[d.status]}`}>
                      {t(`designer.status.${d.status}`)}
                    </span>
                    {/* An approved design is changed by starting a version, never
                        in place — the approved one keeps printing meanwhile. */}
                    {!isEditable(d) && (
                      <button
                        type="button" onClick={() => void duplicate(d)}
                        className="p-1 text-slate-400 hover:text-navy-700"
                        title={t('designer.startVersion')} aria-label={t('designer.startVersion')}
                      ><Copy size={13} /></button>
                    )}
                    {d.status !== 'approved' && (
                      <button
                        type="button" onClick={() => void remove(d)}
                        className="p-1 text-slate-400 hover:text-red-600"
                        title={t('common.delete')} aria-label={t('common.delete')}
                      ><Trash2 size={13} /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* A reviewer's note is the only way a trust learns what to change. */}
        {current?.status === 'rejected' && current.review_note ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3" data-testid="design-review-note">
            <p className="text-xs font-semibold text-red-800">{t('designer.rejectedHeading')}</p>
            <p className="mt-1 text-xs text-red-700">{current.review_note}</p>
          </div>
        ) : null}
        {current?.status === 'pending' ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-800">{t('designer.pendingHeading')}</p>
          </div>
        ) : null}

        {/* ── The editor ──────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-sm">
              {current ? current.name : t('designer.newHeading')}
            </h3>
          </div>
          <fieldset className="card-body space-y-4" disabled={!!current && !isEditable(current)}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">{t('designer.name')}</label>
                <input
                  className="form-input" value={name} maxLength={80}
                  data-testid="design-name"
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">{t('designer.forDocument')}</label>
                <select
                  className="form-select" value={docKind} data-testid="design-doc-kind"
                  disabled={!!current}
                  onChange={e => setDocKind(e.target.value as (typeof DOC_KINDS)[number])}
                >
                  {DOC_KINDS.map(k => <option key={k} value={k}>{t(`designer.kind.${k}`)}</option>)}
                </select>
                {current ? <p className="form-hint">{t('designer.docKindLocked')}</p> : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">{t('designer.accent')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color" className="h-9 w-14 rounded border border-slate-200"
                    value={def.accent} data-testid="design-accent"
                    onChange={e => setDef({ ...def, accent: e.target.value.toUpperCase() })}
                  />
                  <code className="text-xs text-slate-500">{def.accent}</code>
                </div>
              </div>
              <div>
                <label className="form-label">{t('designer.font')}</label>
                <select
                  className="form-select" value={def.font}
                  onChange={e => setDef({ ...def, font: e.target.value as ReceiptDefinition['font'] })}
                >
                  {DEFINITION_FONTS.map(f => <option key={f} value={f}>{t(`designer.fontOpt.${f}`)}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">{t('designer.frame')}</label>
                <select
                  className="form-select" value={def.frame}
                  onChange={e => setDef({ ...def, frame: e.target.value as ReceiptDefinition['frame'] })}
                >
                  {DEFINITION_FRAMES.map(f => <option key={f} value={f}>{t(`designer.frameOpt.${f}`)}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">{t('designer.density')}</label>
                <select
                  className="form-select" value={def.density}
                  onChange={e => setDef({ ...def, density: e.target.value as ReceiptDefinition['density'] })}
                >
                  {DEFINITION_DENSITIES.map(d => <option key={d} value={d}>{t(`designer.densityOpt.${d}`)}</option>)}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox" className="form-checkbox" checked={def.header_align === 'center'}
                  onChange={e => setDef({ ...def, header_align: e.target.checked ? 'center' : 'left' })}
                />
                <span className="text-sm text-slate-700">{t('designer.centerHeader')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox" className="form-checkbox" checked={def.amount_emphasis}
                  onChange={e => setDef({ ...def, amount_emphasis: e.target.checked })}
                />
                <span className="text-sm text-slate-700">{t('designer.emphasiseAmount')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox" className="form-checkbox" checked={def.show_qr}
                  onChange={e => setDef({ ...def, show_qr: e.target.checked })}
                />
                <span className="text-sm text-slate-700">{t('designer.showQr')}</span>
              </label>
            </div>

            {/* ── Blocks: what appears, and in what order ─────────────────── */}
            <div>
              <label className="form-label">{t('designer.blocks')}</label>
              <p className="form-hint mb-2">{t('designer.blocksHint')}</p>
              <ul className="rounded-md border border-slate-200 divide-y divide-slate-100">
                {def.blocks.map((b, i) => (
                  <li key={b} className="flex items-center gap-1 px-2 py-1.5" data-testid={`block-${b}`}>
                    <span className="flex-1 text-xs">{t(`designer.block.${b}`)}</span>
                    <button
                      type="button" onClick={() => moveBlock(i, -1)} disabled={i === 0}
                      className="p-1 text-slate-400 hover:text-navy-700 disabled:opacity-30"
                      aria-label={t('designer.moveUp')}
                    ><ArrowUp size={12} /></button>
                    <button
                      type="button" onClick={() => moveBlock(i, 1)} disabled={i === def.blocks.length - 1}
                      className="p-1 text-slate-400 hover:text-navy-700 disabled:opacity-30"
                      aria-label={t('designer.moveDown')}
                    ><ArrowDown size={12} /></button>
                    {/* A receipt without these is not a receipt — the API
                        refuses it, so they cannot be removed here either. */}
                    {REQUIRED_BLOCKS.includes(b) ? (
                      <span className="w-6 text-center text-[10px] text-slate-300" title={t('designer.blockRequired')}>•</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDef({ ...def, blocks: def.blocks.filter(x => x !== b) })}
                        className="p-1 text-slate-400 hover:text-red-600"
                        aria-label={t('designer.removeBlock')}
                      ><X size={12} /></button>
                    )}
                  </li>
                ))}
              </ul>
              {unused.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unused.map(b => (
                    <button
                      key={b} type="button"
                      onClick={() => setDef({ ...def, blocks: [...def.blocks, b as DefinitionBlock] })}
                      className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:border-navy-400"
                    ><Plus size={10} className="inline" /> {t(`designer.block.${b}`)}</button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* ── The trust's own words ───────────────────────────────────── */}
            <div className="space-y-3 rounded-md bg-slate-50 p-3">
              <div className="flex items-center gap-2">
                <label className="form-label mb-0">{t('designer.yourWords')}</label>
                <select
                  className="form-select w-auto text-xs" value={lang}
                  onChange={e => setLang(e.target.value)} data-testid="design-lang"
                >
                  {['en', 'hi', 'mr', 'gu', 'kn', 'ta', 'te'].map(l => (
                    <option key={l} value={l}>{l.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">{t('designer.titleOverride')}</label>
                <input
                  className="form-input" maxLength={MAX_TEXT_LEN}
                  value={(def.title as Record<string, string>)[lang] ?? ''}
                  data-testid="design-title"
                  onChange={e => setDef({ ...def, title: { ...def.title, [lang]: e.target.value } })}
                  placeholder={t('designer.titlePlaceholder')}
                />
                <p className="form-hint">{t('designer.titleHint')}</p>
              </div>
              <div>
                <label className="form-label">{t('designer.ownLine')}</label>
                <textarea
                  className="form-input" rows={2} maxLength={MAX_TEXT_LEN}
                  value={(def.custom_text as Record<string, string>)[lang] ?? ''}
                  data-testid="design-custom-text"
                  onChange={e => setDef({ ...def, custom_text: { ...def.custom_text, [lang]: e.target.value } })}
                  placeholder={t('designer.ownLinePlaceholder')}
                />
                <p className="form-hint">{t('designer.noMarkupHint')}</p>
              </div>
            </div>

            {issue ? <p className="text-xs text-red-700" data-testid="design-issue">{issue}</p> : null}
          </fieldset>

          {(!current || isEditable(current)) && (
            <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-2">
              <button
                type="button" onClick={() => void save()} disabled={saving || !!issue}
                className="btn-primary btn-sm" data-testid="design-save"
              >{saving ? t('common.saving') : t('common.save')}</button>
              {current ? (
                <button
                  type="button" onClick={() => void submit()} disabled={saving || !!issue}
                  className="btn-secondary btn-sm" data-testid="design-submit"
                ><Send size={13} /> {t('designer.submit')}</button>
              ) : null}
              <p className="ml-auto text-[11px] text-slate-400">{t('designer.approvalNote')}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Live preview ────────────────────────────────────────────────────
          The real renderer, not a mock-up: what is previewed here is what a
          counter prints and what a donor is sent. */}
      <div className="card lg:sticky lg:top-4 self-start">
        <div className="card-header">
          <h3 className="font-semibold text-sm">{t('designer.preview')}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{t('designer.previewHint')}</p>
        </div>
        <div className="bg-slate-100 p-3">
          <div className="bg-white rounded shadow-sm overflow-hidden ring-1 ring-slate-200" style={{ height: '560px' }}>
            <iframe
              ref={iframeRef} title={t('designer.preview')} sandbox="allow-same-origin"
              className="w-full h-full border-0"
              style={{ zoom: 0.6, height: '933px', transformOrigin: 'top left' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/** The API's own message, which says what a validator refused and why. */
function apiMessage(e: unknown): string {
  const r = e as { response?: { data?: { message?: string; error?: { message?: string } } } }
  return r?.response?.data?.message || r?.response?.data?.error?.message || ''
}
