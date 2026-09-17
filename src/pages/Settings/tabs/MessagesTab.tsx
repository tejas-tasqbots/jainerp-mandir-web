import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, History, Languages, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { api } from '../../../lib/api'
import { useToast } from '../../../components/kit/Toast'
import { DataTable, type ColumnDef, type ColumnFilterState } from '../../../components/kit/DataTable'

interface Template {
  key: string
  group: string
  channel: string
  enabled: boolean
  sent_30d: number
  failed_30d: number
  header: string
  footer: string
  button: string | null
  has_pdf: boolean
  preview: string
  review_status: string
  rejection_reason: string | null
  sends_as: { mode: 'catalog' | 'legacy' | 'raw'; language: string } | null
}

interface LanguageInfo {
  code: string
  name: string
  native: string
  total: number
  approved: number
  pending: number
  rejected: number
}

interface OutboxRow {
  id: string
  channel: string
  recipient: string
  template_key: string
  status: string
  error: string | null
  attempts: number
  created_at: string
  sent_at: string | null
  delivered_at: string | null
  language: string | null
}

const STATUS_CLASS: Record<string, string> = {
  delivered: 'badge-green',
  sent: 'badge-green',
  queued: 'badge-amber',
  failed: 'badge-red',
  skipped: 'badge-gray',
}

/** WhatsApp's own formatting: *bold* and _italic_, newlines kept. */
function waText(text: string): ReactNode[] {
  return text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, i) => {
    if (/^\*[^*\n]+\*$/.test(part)) return <strong key={i}>{part.slice(1, -1)}</strong>
    if (/^_[^_\n]+_$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** The message as a donor sees it: a WhatsApp bubble with header, body, footer and button. */
function WhatsAppPreview({ tpl }: { tpl: Template }) {
  return (
    <div className="rounded-lg p-3" style={{ background: '#EFEAE2' }}>
      <div className="max-w-md bg-white rounded-lg shadow-sm overflow-hidden text-[13px] leading-relaxed text-slate-800">
        <div className="px-3 pt-2.5 pb-2">
          {tpl.header && <div className="font-semibold mb-1">{tpl.header}</div>}
          <div className="whitespace-pre-wrap">{waText(tpl.preview)}</div>
          <div className="text-[11px] text-slate-400 mt-1.5">{tpl.footer}</div>
        </div>
        {tpl.button && (
          <div className="border-t border-slate-100 py-2 text-center text-[13px] font-medium inline-flex w-full items-center justify-center gap-1.5" style={{ color: '#027EB5' }}>
            <ExternalLink size={13} /> {tpl.button}
          </div>
        )}
      </div>
    </div>
  )
}

/** Settings → Messages: which notifications go out, in which language, and what actually went out (plan §17). */
export function MessagesTab() {
  const { t } = useTranslation()
  const toast = useToast()
  const [view, setView] = useState<'templates' | 'log'>('templates')

  const [templates, setTemplates] = useState<Template[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [openKey, setOpenKey] = useState('')

  const [languages, setLanguages] = useState<LanguageInfo[]>([])
  const [savedLanguage, setSavedLanguage] = useState('en')
  // null until the saved language arrives, so the previews are fetched once,
  // in that language, instead of in English and then again.
  const [language, setLanguage] = useState<string | null>(null)
  const [savingLanguage, setSavingLanguage] = useState(false)

  const [rows, setRows] = useState<OutboxRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingLog, setLoadingLog] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  useEffect(() => {
    let cancelled = false
    api.get('/comms/settings')
      .then(({ data }) => {
        if (cancelled) return
        const s = data.data ?? {}
        setLanguages(s.languages ?? [])
        setSavedLanguage(s.message_language ?? 'en')
        setLanguage(s.message_language ?? 'en')
      })
      .catch(() => { if (!cancelled) { setLanguages([]); setLanguage('en') } })
    return () => { cancelled = true }
  }, [])
  // Previews follow the dropdown, so a trust can read the Gujarati messages
  // before deciding to send in Gujarati.
  useEffect(() => { if (language) loadTemplates(language) }, [language])
  useEffect(() => { if (view === 'log') loadLog() }, [view, page, search, filterState])

  async function loadTemplates(lang: string) {
    setLoadingTemplates(true)
    try {
      const { data } = await api.get(`/comms/templates?lang=${encodeURIComponent(lang)}`)
      setTemplates(data.data?.templates ?? [])
    } catch {
      setTemplates([])
    } finally {
      setLoadingTemplates(false)
    }
  }

  async function saveLanguage() {
    setSavingLanguage(true)
    try {
      if (!language) return
    const { data } = await api.patch('/comms/settings', { message_language: language })
      setSavedLanguage(data.data?.message_language ?? language)
      setLanguages(data.data?.languages ?? languages)
      toast.success(t('settings.messages.language.saved'))
    } catch {
      toast.error(t('common.saveFailed'))
    } finally {
      setSavingLanguage(false)
    }
  }

  async function loadLog() {
    setLoadingLog(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' })
      if (search.trim()) params.set('q', search.trim())
      const status = filterState.status?.values
      if (status?.length === 1) params.set('status', status[0])
      const { data } = await api.get(`/comms/outbox?${params}`)
      setRows(data.data ?? [])
      setTotal(data.meta?.total ?? 0)
    } catch {
      setRows([])
      setTotal(0)
    } finally {
      setLoadingLog(false)
    }
  }

  async function toggle(tpl: Template) {
    setSavingKey(tpl.key)
    // Optimistic — a switch that lags behind the click feels broken.
    setTemplates(ts => ts.map(x => (x.key === tpl.key ? { ...x, enabled: !x.enabled } : x)))
    try {
      await api.patch(`/comms/templates/${tpl.key}`, { enabled: !tpl.enabled })
    } catch {
      setTemplates(ts => ts.map(x => (x.key === tpl.key ? { ...x, enabled: tpl.enabled } : x)))
      toast.error(t('common.saveFailed'))
    } finally {
      setSavingKey('')
    }
  }

  const groups = Array.from(new Set(templates.map(x => x.group)))
  const selected = languages.find(l => l.code === language)
  const languageName = (code: string) => {
    const l = languages.find(x => x.code === code)
    return l ? (l.code === 'en' ? l.name : `${l.native} (${l.name})`) : code
  }

  /** What a send does right now, in words — "Goes out in English until Hindi is approved". */
  function sendsAsText(tpl: Template): { text: string; tone: 'ok' | 'wait' } {
    const as = tpl.sends_as
    if (!as) return { text: t('settings.messages.language.notSendable'), tone: 'wait' }
    if (as.mode === 'catalog' && as.language === language) {
      return { text: t('settings.messages.language.sendsIn', { language: languageName(as.language) }), tone: 'ok' }
    }
    if (as.mode === 'catalog') {
      return { text: t('settings.messages.language.englishUntil', { language: languageName(language ?? 'en') }), tone: 'wait' }
    }
    return { text: t('settings.messages.language.oldUntil'), tone: 'wait' }
  }

  const columns: ColumnDef<OutboxRow>[] = [
    {
      key: 'created_at', label: t('common.date'),
      render: r => <span className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString('en-IN')}</span>,
    },
    { key: 'recipient', label: t('settings.messages.recipient'), render: r => <span className="font-medium">{r.recipient}</span> },
    {
      key: 'template_key', label: t('settings.messages.message'),
      render: r => (
        <span className="text-slate-600">
          {t(`settings.messages.tpl.${r.template_key}`, r.template_key)}
          {r.language && <span className="ml-1.5 text-[10px] uppercase text-slate-400">{r.language}</span>}
        </span>
      ),
    },
    { key: 'channel', label: t('settings.messages.channel'), render: r => <span className="badge-gray">{r.channel}</span> },
    {
      key: 'status', label: t('common.status'),
      filter: {
        kind: 'enum', param: 'status',
        options: ['queued', 'sent', 'delivered', 'failed', 'skipped'].map(s => ({
          value: s, label: t(`settings.messages.status.${s}`, s),
        })),
      },
      render: r => (
        <span className={STATUS_CLASS[r.status] ?? 'badge-gray'} title={r.error ?? undefined}>
          {t(`settings.messages.status.${r.status}`, r.status)}
        </span>
      ),
    },
  ]

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">{t('settings.messages.heading')}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{t('settings.messages.subheading')}</p>
      </div>

      <div className="card" data-testid="message-language-card">
        <div className="card-header">
          <h3 className="font-semibold text-sm inline-flex items-center gap-1.5">
            <Languages size={15} /> {t('settings.messages.language.heading')}
          </h3>
        </div>
        <div className="card-body space-y-3">
          <p className="text-sm text-slate-500">{t('settings.messages.language.help')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem]">
              <label className="form-label" htmlFor="message-language">{t('settings.messages.language.label')}</label>
              <select id="message-language" className="form-select" value={language ?? ''} disabled={!language} onChange={e => setLanguage(e.target.value)}>
                {(languages.length ? languages : [{ code: 'en', name: 'English', native: 'English' } as LanguageInfo]).map(l => (
                  <option key={l.code} value={l.code}>{l.code === 'en' ? l.name : `${l.native} — ${l.name}`}</option>
                ))}
              </select>
            </div>
            <button type="button" className="btn-primary" disabled={savingLanguage || !language || language === savedLanguage} onClick={saveLanguage}>
              {savingLanguage ? t('settings.saving') : t('settings.messages.language.save')}
            </button>
            {language && language !== savedLanguage && (
              <span className="text-xs text-slate-500">
                {t('settings.messages.language.currently', { language: languageName(savedLanguage) })}
              </span>
            )}
          </div>
          {selected && selected.code !== 'en' && (
            selected.approved >= selected.total ? (
              <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                {t('settings.messages.language.allApproved', { language: languageName(selected.code) })}
              </p>
            ) : (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {t('settings.messages.language.partlyApproved', {
                  language: languageName(selected.code), approved: selected.approved, total: selected.total,
                })}
              </p>
            )
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setView('templates')}
          className={`px-3 py-1.5 text-sm rounded-md font-medium inline-flex items-center gap-1.5 ${
            view === 'templates' ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
          <MessageSquare size={14} /> {t('settings.messages.whatWeSend')}
        </button>
        <button type="button" onClick={() => setView('log')}
          className={`px-3 py-1.5 text-sm rounded-md font-medium inline-flex items-center gap-1.5 ${
            view === 'log' ? 'bg-navy-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
          <History size={14} /> {t('settings.messages.log')}
        </button>
      </div>

      {view === 'templates' ? (
        loadingTemplates ? (
          <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-24 bg-slate-100 rounded animate-pulse" />)}</div>
        ) : (
          <>
            {groups.map(group => (
              <div key={group} className="card">
                <div className="card-header">
                  <h3 className="font-semibold text-sm">{t(`settings.messages.group.${group}`, group)}</h3>
                </div>
                <div className="card-body p-0">
                  {templates.filter(x => x.group === group).map(tpl => {
                    const open = openKey === tpl.key
                    const sends = sendsAsText(tpl)
                    return (
                      <div key={tpl.key} className="border-b border-slate-100 last:border-0" data-testid={`tpl-${tpl.key}`}>
                        <div className="flex items-center gap-4 px-4 py-2.5">
                          <button type="button" onClick={() => setOpenKey(open ? '' : tpl.key)}
                            className="flex-1 min-w-0 text-left" aria-expanded={open}>
                            <div className="text-sm font-medium inline-flex items-center gap-1">
                              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {t(`settings.messages.tpl.${tpl.key}`, tpl.key)}
                              {tpl.has_pdf && <span className="badge-gray ml-1.5 text-[10px]">PDF</span>}
                            </div>
                            <div className="text-xs text-slate-400 ml-[18px]">
                              {t('settings.messages.sentCount', { count: tpl.sent_30d })}
                              {tpl.failed_30d > 0 && (
                                <span className="text-red-600 ml-2">{t('settings.messages.failedCount', { count: tpl.failed_30d })}</span>
                              )}
                              <span className={`ml-2 ${sends.tone === 'ok' ? 'text-green-700' : 'text-amber-700'}`}>· {sends.text}</span>
                            </div>
                          </button>
                          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                            <input type="checkbox" checked={tpl.enabled} disabled={savingKey === tpl.key}
                              onChange={() => toggle(tpl)} />
                            {tpl.enabled ? t('settings.messages.on') : t('settings.messages.off')}
                          </label>
                        </div>
                        {open && (
                          <div className="px-4 pb-3 space-y-2">
                            <WhatsAppPreview tpl={tpl} />
                            {tpl.review_status === 'rejected' && tpl.rejection_reason && (
                              <p className="text-xs text-red-600">{t('settings.messages.language.rejected', { reason: tpl.rejection_reason })}</p>
                            )}
                            <p className="text-xs text-slate-400">{t('settings.messages.language.sampleNote')}</p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            <p className="text-xs text-slate-500">{t('settings.messages.otpNote')}</p>
          </>
        )
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          loading={loadingLog}
          searchValue={search}
          onSearchChange={v => { setSearch(v); setPage(1) }}
          searchPlaceholder={t('settings.messages.searchPlaceholder')}
          filterState={filterState}
          onFilterChange={(key, s) => {
            setFilterState(prev => { const next = { ...prev }; if (s) next[key] = s; else delete next[key]; return next })
            setPage(1)
          }}
          onClearFilters={() => { setFilterState({}); setSearch(''); setPage(1) }}
          page={page}
          limit={50}
          total={total}
          onPageChange={setPage}
          viewKey="settings-messages-log"
          emptyMessage={t('settings.messages.noMessages')}
        />
      )}
    </div>
  )
}
