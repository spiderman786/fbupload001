import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Plus, RefreshCw, Search } from 'lucide-react'
import { api, type AutomationPage, type SourceAccount } from '../../api/client'
import { AutomationPageCard } from '../../components/AutomationPageCard'
import { AddPageModal } from '../../components/AddPageModal'
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

const SYNC_STALE_MS = 60 * 60 * 1000
const HUB_PAGE_SIZE = 50
const AUTO_SYNC_MAX_PAGES = 500

function formatSyncLabel(iso: string | null | undefined): string {
  if (!iso) return 'Never synced from Facebook'
  return `Last synced ${new Date(iso).toLocaleString()}`
}

export function AutoDownloadUploadPage() {
  const toast = useToast()
  const { isAdmin, canWrite } = useAgencyRole()
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
  const [sources, setSources] = useState<SourceAccount[]>([])
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [addOpen, setAddOpen] = useState(false)

  const loadSources = useCallback(async () => {
    try {
      const { sources: s } = await api.sources.list()
      setSources(s.filter((src) => src.isActive))
    } catch {
      /* hub still works without sources list */
    }
  }, [])

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
    if (tab === 'pages') loadSources()
  }, [tab, loadSources])

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
            {isAdmin && (
              <span className="block text-xs text-primary/90">
                Admin account: no page limit — connect any number via Single, Bulk, or CSV.
              </span>
            )}
          </p>
        </div>
        {tab === 'pages' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
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
        <SourcesPage embedded onSourcesChanged={loadSources} />
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
                <div className="grid gap-4 sm:grid-cols-2">
                  {pages.map((page) => (
                    <AutomationPageCard
                      key={page.id}
                      page={page}
                      onDelete={handleDelete}
                      deleting={deletingId === page.id}
                      sources={sources.map((s) => ({ id: s.id, username: s.username, platform: s.platform }))}
                      assignedSourceId={assignments[page.id]}
                      onAssignSource={canWrite ? handleAssignSource : undefined}
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

      <AddPageModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onComplete={() => {
          setHubPage(1)
          load()
        }}
      />
    </div>
  )
}
