import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, History } from 'lucide-react'
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
}

const STATUS_CLASS: Record<string, string> = {
  delivered: 'badge-green',
  sent: 'badge-green',
  queued: 'badge-amber',
  failed: 'badge-red',
  skipped: 'badge-gray',
}

/** Settings → Messages: which notifications go out, and what actually went out (plan §17). */
export function MessagesTab() {
  const { t } = useTranslation()
  const toast = useToast()
  const [view, setView] = useState<'templates' | 'log'>('templates')

  const [templates, setTemplates] = useState<Template[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [savingKey, setSavingKey] = useState('')

  const [rows, setRows] = useState<OutboxRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingLog, setLoadingLog] = useState(true)
  const [search, setSearch] = useState('')
  const [filterState, setFilterState] = useState<Record<string, ColumnFilterState>>({})

  useEffect(() => { loadTemplates() }, [])
  useEffect(() => { if (view === 'log') loadLog() }, [view, page, search, filterState])

  async function loadTemplates() {
    setLoadingTemplates(true)
    try {
      const { data } = await api.get('/comms/templates')
      setTemplates(data.data?.templates ?? [])
    } catch {
      setTemplates([])
    } finally {
      setLoadingTemplates(false)
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

  const columns: ColumnDef<OutboxRow>[] = [
    {
      key: 'created_at', label: t('common.date'),
      render: r => <span className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString('en-IN')}</span>,
    },
    { key: 'recipient', label: t('settings.messages.recipient'), render: r => <span className="font-medium">{r.recipient}</span> },
    {
      key: 'template_key', label: t('settings.messages.message'),
      render: r => <span className="text-slate-600">{t(`settings.messages.tpl.${r.template_key}`, r.template_key)}</span>,
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
                  {templates.filter(x => x.group === group).map(tpl => (
                    <div key={tpl.key} className="flex items-center gap-4 px-4 py-2.5 border-b border-slate-100 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{t(`settings.messages.tpl.${tpl.key}`, tpl.key)}</div>
                        <div className="text-xs text-slate-400">
                          {t('settings.messages.sentCount', { count: tpl.sent_30d })}
                          {tpl.failed_30d > 0 && (
                            <span className="text-red-600 ml-2">{t('settings.messages.failedCount', { count: tpl.failed_30d })}</span>
                          )}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                        <input type="checkbox" checked={tpl.enabled} disabled={savingKey === tpl.key}
                          onChange={() => toggle(tpl)} />
                        {tpl.enabled ? t('settings.messages.on') : t('settings.messages.off')}
                      </label>
                    </div>
                  ))}
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
