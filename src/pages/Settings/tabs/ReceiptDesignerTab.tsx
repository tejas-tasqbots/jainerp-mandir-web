import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Check, Copy, Plus, Send, Trash2, X } from 'lucide-react'
import { api } from '../../../lib/api'
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
 *
 * ── WHY THIS IS A CARD AND NO LONGER A TAB ──────────────────────────────────
 * It was its own Settings tab beside "Receipt Settings", and the client's words
 * were "why this has too tab for receipt setting and your design as this receipt
 * only". They were right: both tabs answer "what does my receipt look like",
 * both carried their own live preview of the same document, and a trust that
 * finished a design had to change tabs to select it. It is now the last card of
 * the Design step, under the gallery of our designs, and it shares that screen's
 * preview instead of running a second one.
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

export function ReceiptDesignerCard({
  accent,
  onUseDesign,
  selectedTemplate,
  onPreview,
}: {
  /** The trust's brand colour, offered as the starting accent for a new design. */
  accent?: string
  /** Select `custom` as the receipt design on the enclosing settings form. */
  onUseDesign?: () => void
  /** So the card can say whether the approved design is the one being printed. */
  selectedTemplate?: string
  /**
   * The definition currently being edited, or null when the editor is closed.
   *
   * This card does NOT render its own preview. The screen it sits on already has
   * a 420px live preview of the same document, and running a second one cost the
   * editor a third of its width — three nested columns left every field about
   * 180px wide and every label wrapped over four lines.
   */
  onPreview?: (def: ReceiptDefinition | null, docKind: 'donation' | 'stay' | 'hall') => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const confirm = useConfirm()

  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
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
    } catch {
      // A trust whose plan or role does not include the designer simply has no
      // designs; the card says so rather than showing a permanent error.
      setDrafts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const current = useMemo(() => drafts.find(d => d.id === selected) ?? null, [drafts, selected])
  const issue = useMemo(() => definitionIssue(def), [def])
  const approved = useMemo(() => drafts.filter(d => d.status === 'approved'), [drafts])
  const frozen = !!current && !isEditable(current)

  function openDraft(draft: Draft) {
    setSelected(draft.id)
    setName(draft.name)
    setDocKind(draft.doc_kind)
    // A stored definition may have been written by an older build; fall back
    // rather than putting the editor into an unrenderable state.
    setDef(definitionIssue(draft.definition) ? defaultDefinition() : draft.definition)
    setOpen(true)
  }

  function startNew() {
    setSelected(null)
    setName(t('designer.untitled'))
    setDocKind('donation')
    // Starts in the trust's own colour rather than ours. A new design that opens
    // navy when the trust's receipts are maroon looks like a different product.
    setDef({ ...defaultDefinition(), accent: (accent || '#0D1B2E').toUpperCase() })
    setOpen(true)
  }

  /* ── The preview lives on the screen, not in this card ──────────────────
     `buildReceiptHtml` with `template: 'custom'` is exactly what a counter
     prints, so the enclosing settings screen can render this definition in the
     preview it already has — and does, while the editor is open. Reporting it
     upward rather than drawing it here is what gives the fields their width
     back; it also means an admin compares their design against the same pane
     they use for everything else, at 420px instead of 300. */
  useEffect(() => {
    onPreview?.(open ? def : null, docKind)
  }, [open, def, docKind, onPreview])

  // Closing the card, or leaving the step, must put the preview back to the
  // trust's actual receipt — otherwise a half-finished draft goes on being
  // previewed as though it were what prints.
  useEffect(() => () => { onPreview?.(null, 'donation') }, [onPreview])

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
    if (created) openDraft(created)
    toast.success(t('designer.newVersion', { version: created?.version ?? '' }))
  }

  async function remove(draft: Draft) {
    if (!(await confirm({
      message: t('designer.confirmDelete', { name: draft.name }), danger: true,
    }))) return
    try {
      await api.delete(`/receipt-templates/${draft.id}`)
      if (selected === draft.id) { setSelected(null); setOpen(false) }
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
    <div className="card" data-testid="designer-card">
      <div className="card-header flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">{t('designer.heading')}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{t('designer.subheading')}</p>
        </div>
        <button type="button" onClick={startNew} className="btn-secondary btn-sm ml-auto">
          <Plus size={13} /> {t('designer.new')}
        </button>
      </div>

      <div className="card-body space-y-3">
        {/* An APPROVED design is a design the trust can print, so it is offered
            the same way our designs are in the gallery above rather than being a
            row in a list a trust has to know to read. Selecting it was the thing
            that required changing tabs. */}
        {approved.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {approved.map(d => (
              <button
                key={d.id} type="button"
                onClick={() => { onUseDesign?.(); toast.success(t('designer.nowPrinting', { name: d.name })) }}
                className={`relative rounded-lg border p-2.5 text-left transition-all ${
                  selectedTemplate === 'custom'
                    ? 'border-navy-900 ring-2 ring-navy-900 bg-navy-50'
                    : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
                }`}
                data-testid={`design-use-${d.id}`}
              >
                {selectedTemplate === 'custom' && (
                  <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-navy-900 text-white">
                    <Check size={12} />
                  </span>
                )}
                <p className="text-sm font-semibold text-slate-800">{d.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t(`designer.kind.${d.doc_kind}`)} · v{d.version}
                </p>
                <p className="mt-1 text-[11px] font-medium text-navy-700">
                  {selectedTemplate === 'custom' ? t('designer.inUse') : t('designer.useThis')}
                </p>
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-400">{t('common.loading')}</p>
        ) : !drafts.length ? (
          <p className="text-sm text-slate-500">{t('designer.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {drafts.map(d => (
              <li key={d.id} className="flex items-center gap-2 py-2" data-testid={`design-${d.id}`}>
                <button
                  type="button" onClick={() => openDraft(d)}
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

        {/* ── The editor, with its own preview beside it ────────────────────
            Only mounted when a design is open. It used to be permanently on
            screen under the list, which is how a trust with no designs met a
            twenty-control form it had not asked for. */}
        {open && (
          <div className="rounded-lg border border-slate-200">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
              <h4 className="text-sm font-semibold">
                {current ? current.name : t('designer.newHeading')}
              </h4>
              <button
                type="button" onClick={() => setOpen(false)}
                className="ml-auto p-1 text-slate-400 hover:text-slate-700"
                aria-label={t('common.close')}
              ><X size={14} /></button>
            </div>

            {/* WHY the fields are dead, said on the fields. A submitted or
                approved design is frozen and the editor showed that only as a
                small note above the card — so it read as a broken form whose
                preview would not update. */}
            {frozen && (
              <div className="border-b border-amber-100 bg-amber-50 px-3 py-2" data-testid="design-frozen">
                <p className="text-[11px] leading-relaxed text-amber-800">
                  {current?.status === 'pending'
                    ? t('designer.frozenPending')
                    : t('designer.frozenApproved')}
                </p>
                <button
                  type="button" onClick={() => current && void duplicate(current)}
                  className="btn-secondary btn-sm mt-2"
                ><Copy size={12} /> {t('designer.startVersion')}</button>
              </div>
            )}

            {current?.status === 'rejected' && current.review_note ? (
              <div className="border-b border-red-100 bg-red-50 px-3 py-2" data-testid="design-review-note">
                <p className="text-xs font-semibold text-red-800">{t('designer.rejectedHeading')}</p>
                <p className="mt-1 text-xs text-red-700">{current.review_note}</p>
              </div>
            ) : null}

            <div className="p-3">
              <fieldset className="space-y-4 min-w-0" disabled={frozen}>
                <div className="grid gap-3 sm:grid-cols-2">
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

                <div className="grid gap-3 sm:grid-cols-2">
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

                {/* ── Blocks: what appears, and in what order ─────────────── */}
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

                {/* ── This design's own title and line ─────────────────────
                    Only these two, and on purpose: every OTHER printed word is
                    changed in the Wording step, which applies to every design
                    at once and needs no approval. Putting a second copy of the
                    vocabulary here would mean a trust maintaining two. */}
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
                  <p className="text-[11px] text-slate-500">{t('designer.wordingElsewhere')}</p>
                </div>

                {issue ? <p className="text-xs text-red-700" data-testid="design-issue">{issue}</p> : null}
              </fieldset>
            </div>

            {!frozen && (
              <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5">
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
        )}
      </div>
    </div>
  )
}

/** The API's own message, which says what a validator refused and why. */
function apiMessage(e: unknown): string {
  const r = e as { response?: { data?: { message?: string; error?: { message?: string } } } }
  return r?.response?.data?.message || r?.response?.data?.error?.message || ''
}
