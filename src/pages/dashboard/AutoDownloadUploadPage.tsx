import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Download, Plus, RefreshCw, Search, X } from 'lucide-react'
import { api, type AutomationPage, type SourceAccount } from '../../api/client'
import { AutomationPageCard } from '../../components/AutomationPageCard'
import { SourcesPage } from './SourcesPage'
import { useToast } from '../../context/ToastContext'
import { useAgencyRole } from '../../context/AuthContext'
import { getApiError } from '../../lib/apiError'
import {
  PAGE_SORT_OPTIONS,
  PAGE_STATUS_FILTERS,
  type PageSort,
  type PageStatusFilter,
} from '../../config/pageStatuses'

type Tab = 'pages' | 'sources'
type AddMode = 'single' | 'bulk' | 'csv'
type FbAccount = {
  id: string
  meta_user_id: string
  connected_at: string
  byoc_credential_id: string | null
  byoc_label: string | null
  byoc_app_id: string | null
}
type FbPage = { id: string; name: string; followers?: string; fanCount: number }

const SYNC_STALE_MS = 60 * 60 * 1000
const HUB_PAGE_SIZE = 50
const CONNECT_BATCH_SIZE = 500
const AUTO_SYNC_MAX_PAGES = 500

function formatSyncLabel(iso: string | null | undefined): string {
  if (!iso) return 'Never synced from Facebook'
  return `Last synced ${new Date(iso).toLocaleString()}`
}

export function AutoDownloadUploadPage() {
  const toast = useToast()
  const { isOwner } = useAgencyRole()
  const autoSynced = useRef(false)
  const [tab, setTab] = useState<Tab>('pages')
  const [pages, setPages] = useState<AutomationPage[]>([])
  const [stats, setStats] = useState({
    totalPages: 0,
    followersGained: 0,
    totalFollowersLabel: '0',
    lastFollowersSyncAt: null as string | null,
  })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<PageStatusFilter>('all')
  const [sort, setSort] = useState<PageSort>('newest')
  const [hubPage, setHubPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, perPage: HUB_PAGE_SIZE, totalCount: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [savingLimitId, setSavingLimitId] = useState<string | null>(null)
  const [sources, setSources] = useState<SourceAccount[]>([])
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddMode>('single')
  const [accounts, setAccounts] = useState<FbAccount[]>([])
  const [accountSearch, setAccountSearch] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [accountPages, setAccountPages] = useState<FbPage[]>([])
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([])
  const [csvPageIds, setCsvPageIds] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addSaving, setAddSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [data, src, asn] = await Promise.all([
        api.pages.hub({ search: search || undefined, status, sort, page: hubPage, perPage: HUB_PAGE_SIZE }),
        api.sources.list(),
        api.automation.assignments(),
      ])
      setPages(data.pages)
      setStats(data.stats)
      setPagination(data.pagination)
      setSources(src.sources.filter((s) => s.isActive))
      const map: Record<string, string> = {}
      for (const a of asn.assignments) map[a.pageId] = a.sourceId
      setAssignments(map)
    } catch (err) {
      const msg = getApiError(err, 'Failed to load automation pages')
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [search, status, sort, hubPage, toast])

  useEffect(() => {
    setHubPage(1)
  }, [search, status, sort])

  const syncFromFacebook = useCallback(
    async (silent = false) => {
      setSyncing(true)
      try {
        const res = await api.pages.syncFollowers()
        if (!silent) toast.success(res.message)
        if (res.failed > 0 && res.errors[0]) toast.error(res.errors[0])
        await load()
      } catch (err) {
        if (!silent) toast.error(getApiError(err, 'Follower sync failed'))
      } finally {
        setSyncing(false)
      }
    },
    [load, toast],
  )

  useEffect(() => {
    const timer = window.setTimeout(load, search ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [load, search])

  useEffect(() => {
    if (autoSynced.current || tab !== 'pages' || loading || stats.totalPages === 0) return
    if (stats.totalPages > AUTO_SYNC_MAX_PAGES) return

    const stale =
      !stats.lastFollowersSyncAt ||
      Date.now() - new Date(stats.lastFollowersSyncAt).getTime() > SYNC_STALE_MS

    if (stale) {
      autoSynced.current = true
      syncFromFacebook(true)
    }
  }, [loading, stats.totalPages, stats.lastFollowersSyncAt, tab, syncFromFacebook])

  async function handleDelete(id: string) {
    if (!confirm('Remove this page from automation?')) return
    setDeletingId(id)
    try {
      await api.pages.delete(id)
      setPages((prev) => prev.filter((p) => p.id !== id))
      setStats((prev) => ({
        ...prev,
        totalPages: Math.max(0, prev.totalPages - 1),
      }))
      toast.success('Page removed')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to remove page'))
    } finally {
      setDeletingId(null)
    }
  }

  async function handleAssignSource(pageId: string, sourceId: string) {
    if (!sourceId) return
    try {
      await api.automation.assignSource(pageId, sourceId)
      setAssignments((prev) => ({ ...prev, [pageId]: sourceId }))
      const src = sources.find((s) => s.id === sourceId)
      setPages((prev) =>
        prev.map((p) => (p.id === pageId ? { ...p, sourceUsername: src?.username ?? p.sourceUsername } : p)),
      )
      toast.success('Source assigned to page')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to assign source'))
    }
  }

  async function handleDailyLimitChange(pageId: string, dailyReelLimit: number) {
    setSavingLimitId(pageId)
    try {
      const { page } = await api.pages.update(pageId, { dailyReelLimit })
      setPages((prev) =>
        prev.map((p) =>
          p.id === pageId
            ? {
                ...p,
                dailyReelLimit: page.dailyReelLimit ?? dailyReelLimit,
                reelsRemainingToday:
                  page.reelsRemainingToday ??
                  Math.max(0, dailyReelLimit - (page.reelsPostedToday ?? p.reelsPostedToday ?? 0)),
              }
            : p,
        ),
      )
      toast.success(`Daily limit set to ${dailyReelLimit} reels`)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to update daily limit'))
    } finally {
      setSavingLimitId(null)
    }
  }

  async function openAddModal() {
    setAddOpen(true)
    setAddLoading(true)
    setSelectedPageIds([])
    setCsvPageIds('')
    try {
      const res = await api.facebook.accounts()
      setAccounts(res.accounts)
      const first = res.accounts[0]?.id ?? ''
      setSelectedAccountId(first)
      if (first) {
        const pagesRes = await api.facebook.accountPages(first)
        setAccountPages(pagesRes.pages)
      } else {
        setAccountPages([])
      }
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load Facebook accounts'))
    } finally {
      setAddLoading(false)
    }
  }

  async function selectAccount(accountId: string) {
    setSelectedAccountId(accountId)
    setSelectedPageIds([])
    setAddLoading(true)
    try {
      const pagesRes = await api.facebook.accountPages(accountId)
      setAccountPages(pagesRes.pages)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load pages for this account'))
    } finally {
      setAddLoading(false)
    }
  }

  async function handleAddPages() {
    if (!selectedAccountId) return
    let pageIds = selectedPageIds
    if (addMode === 'csv') {
      pageIds = csvPageIds
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter(Boolean)
    }
    if (!pageIds.length) {
      toast.error('Select at least one page')
      return
    }

    setAddSaving(true)
    try {
      let totalConnected = 0
      let totalSkipped = 0
      for (let i = 0; i < pageIds.length; i += CONNECT_BATCH_SIZE) {
        const batch = pageIds.slice(i, i + CONNECT_BATCH_SIZE)
        const res = await api.facebook.connectPages(selectedAccountId, batch)
        totalConnected += res.pagesConnected
        totalSkipped += res.skipped ?? 0
      }
      const skippedNote = totalSkipped > 0 ? ` (${totalSkipped} ID(s) not accessible)` : ''
      toast.success(`Added ${totalConnected} page(s) to automation${skippedNote}`)
      setAddOpen(false)
      setHubPage(1)
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to add pages'))
    } finally {
      setAddSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
            <Download className="h-5 w-5 text-primary" />
          </div>
          <h1 className="font-display text-2xl font-bold">Auto Download/Upload</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connected Facebook pages for automated reel download and posting.
            {isOwner && (
              <span className="block text-xs text-primary/90">
                Owner account: no page limit — connect any number via Single, Bulk, or CSV.
              </span>
            )}
          </p>
        </div>
        {tab === 'pages' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              Add Page
            </button>
            {stats.totalPages > 0 && (
              <button
                type="button"
                onClick={() => syncFromFacebook()}
                disabled={syncing}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing...' : 'Sync from Facebook'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-b border-border">
        {(
          [
            ['pages', 'Automation Pages'],
            ['sources', 'Source Accounts'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sources' ? (
        <SourcesPage embedded />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: 'TOTAL PAGES', value: stats.totalPages.toLocaleString() },
              { label: 'FOLLOWERS GAINED', value: stats.followersGained.toLocaleString() },
              { label: 'TOTAL FOLLOWERS', value: stats.totalFollowersLabel },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground">{stat.label}</p>
                <p className="font-display mt-2 text-3xl font-bold tracking-tight">
                  {loading && pages.length === 0 ? '—' : stat.value}
                </p>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">{formatSyncLabel(stats.lastFollowersSyncAt)}</p>

          <section className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-sm font-semibold">
                Automation Pages ({stats.totalPages} page{stats.totalPages !== 1 ? 's' : ''})
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1 sm:flex-none">
                  <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    placeholder="Search pages..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-background pr-3 pl-9 text-sm sm:w-56"
                  />
                </div>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as PageStatusFilter)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                >
                  {PAGE_STATUS_FILTERS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as PageSort)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                >
                  {PAGE_SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={load}
                  className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-muted"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {loadError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{loadError}</p>
            )}

            {loading && pages.length === 0 ? (
              <div className="flex h-48 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : pages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-16 text-center">
                <p className="text-muted-foreground">No pages match your filters.</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Connect Facebook pages under{' '}
                  <a href="/facebook/accounts" className="text-primary hover:underline">
                    Accounts
                  </a>{' '}
                  to start automation.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {pages.map((page) => (
                    <AutomationPageCard
                      key={page.id}
                      page={page}
                      onDelete={handleDelete}
                      deleting={deletingId === page.id}
                      sources={sources.map((s) => ({ id: s.id, username: s.username, platform: s.platform }))}
                      assignedSourceId={assignments[page.id]}
                      onAssignSource={handleAssignSource}
                      onDailyLimitChange={handleDailyLimitChange}
                      savingLimit={savingLimitId === page.id}
                    />
                  ))}
                </div>
                {pagination.totalPages > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <p className="text-xs text-muted-foreground">
                      Showing {(pagination.page - 1) * pagination.perPage + 1}–
                      {Math.min(pagination.page * pagination.perPage, pagination.totalCount)} of{' '}
                      {pagination.totalCount.toLocaleString()} pages
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pagination.page <= 1 || loading}
                        onClick={() => setHubPage((p) => Math.max(1, p - 1))}
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-muted-foreground">
                        Page {pagination.page} of {pagination.totalPages}
                      </span>
                      <button
                        type="button"
                        disabled={pagination.page >= pagination.totalPages || loading}
                        onClick={() => setHubPage((p) => p + 1)}
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-border bg-background p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="font-display text-2xl font-bold">Add New Page</h3>
                <p className="text-sm text-muted-foreground">Step 1 of 2: Select Page</p>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 h-2 rounded-full bg-muted">
              <div className="h-2 w-1/2 rounded-full bg-primary" />
            </div>

            <div className="mb-3 grid grid-cols-3 overflow-hidden rounded-xl border border-border">
              {([
                ['single', 'Single Add'],
                ['bulk', 'Bulk Add'],
                ['csv', 'Multi-Account + CSV'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAddMode(mode)}
                  className={`px-3 py-2 text-sm font-medium ${
                    addMode === mode ? 'bg-primary/10 text-primary' : 'bg-background hover:bg-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border p-3">
                <p className="mb-2 text-sm font-semibold">Select Facebook Account</p>
                <input
                  type="search"
                  placeholder="Search connected accounts..."
                  className="mb-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                />
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {accounts
                    .filter((acc) => acc.meta_user_id.toLowerCase().includes(accountSearch.toLowerCase()))
                    .map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => selectAccount(acc.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                        selectedAccountId === acc.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                      }`}
                    >
                      <p className="font-medium">{acc.meta_user_id}</p>
                      <p className="text-xs text-muted-foreground">
                        {acc.byoc_label ? `${acc.byoc_label} · ` : ''}
                        Connected {new Date(acc.connected_at).toLocaleDateString()}
                      </p>
                    </button>
                    ))}
                  {!accounts.length && <p className="text-xs text-muted-foreground">No Facebook accounts connected yet.</p>}
                </div>
              </div>

              <div className="rounded-xl border border-border p-3">
                <p className="mb-2 text-sm font-semibold">Select Page</p>
                {addMode === 'csv' ? (
                  <textarea
                    value={csvPageIds}
                    onChange={(e) => setCsvPageIds(e.target.value)}
                    placeholder="Paste page IDs separated by comma/new line"
                    className="h-48 w-full rounded-md border border-border bg-background p-3 text-sm"
                  />
                ) : (
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {addLoading ? (
                      <p className="text-xs text-muted-foreground">Loading pages...</p>
                    ) : (
                      accountPages.map((p) => {
                        const checked = selectedPageIds.includes(p.id)
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              if (addMode === 'single') {
                                setSelectedPageIds([p.id])
                                return
                              }
                              setSelectedPageIds((prev) =>
                                prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                              )
                            }}
                            className={`w-full rounded-lg border px-3 py-2 text-left ${
                              checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium">{p.name}</p>
                                <p className="text-xs text-muted-foreground">{p.id}</p>
                              </div>
                              {checked && <Check className="h-4 w-4 text-primary" />}
                            </div>
                          </button>
                        )
                      })
                    )}
                    {!addLoading && !accountPages.length && (
                      <p className="text-xs text-muted-foreground">No pages available for this account.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddPages}
                disabled={addSaving || !selectedAccountId}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {addSaving ? 'Adding...' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
