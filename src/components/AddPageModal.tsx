import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Plus, Search, X } from 'lucide-react'
import { api } from '../api/client'
import { COMMON_TIMEZONES } from '../config/timezones'
import { parseCsvSourceMappings } from '../lib/parseSourceUrl'
import { useToast } from '../context/ToastContext'
import { getApiError } from '../lib/apiError'

type AddMode = 'single' | 'bulk' | 'csv'

type FbAccount = {
  id: string
  meta_user_id: string
  display_name: string | null
  connected_at: string
  byoc_label: string | null
}

type FbPage = {
  id: string
  name: string
  followers?: string
  fanCount: number
  accountId: string
}

type SelectedPage = { accountId: string; metaPageId: string; name: string; followers?: string }

type CsvRow = { metaPageId: string; sourceUsername: string; platform: string; sourceUrl?: string }

const MODAL_PAGE_SIZE = 10
const CONNECT_BATCH_SIZE = 500
const SOURCE_PLATFORMS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'facebook', label: 'Facebook' },
]

function accountLabel(acc: FbAccount) {
  return acc.display_name?.trim() || `Account ${acc.meta_user_id.slice(-6)}`
}

function PostsPerDayGrid({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Posts Per Day</p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`rounded-lg border px-2 py-2 text-xs font-semibold uppercase ${
              value === n ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
            }`}
          >
            {n} {n === 1 ? 'post' : 'posts'}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Selected: {value} post{value !== 1 ? 's' : ''} per day</p>
    </div>
  )
}

export function AddPageModal({ open, onClose, onComplete }: { open: boolean; onClose: () => void; onComplete: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<AddMode>('single')
  const [wizardStep, setWizardStep] = useState(1)
  const [accounts, setAccounts] = useState<FbAccount[]>([])
  const [pagesByAccount, setPagesByAccount] = useState<Record<string, FbPage[]>>({})
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [loadingPages, setLoadingPages] = useState(false)
  const [accountSearch, setAccountSearch] = useState('')
  const [pageSearch, setPageSearch] = useState('')
  const [pageListPage, setPageListPage] = useState(1)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [selectedPages, setSelectedPages] = useState<SelectedPage[]>([])
  const [postsPerDay, setPostsPerDay] = useState(3)
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
  )
  const [sourcePlatform, setSourcePlatform] = useState('instagram')
  const [sourceUsername, setSourceUsername] = useState('')
  const [csvText, setCsvText] = useState('')
  const [saving, setSaving] = useState(false)
  const [existingSources, setExistingSources] = useState<{ id: string; username: string; platform: string }[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState('')

  const totalSteps = mode === 'single' ? 2 : 3

  const stepTitle = useMemo(() => {
    if (mode === 'single') return wizardStep === 1 ? 'Select Page' : 'Configure Settings'
    if (wizardStep === 1) return mode === 'csv' ? 'Select Accounts & Pages' : 'Select Pages'
    if (wizardStep === 2) return mode === 'csv' ? 'Paste Source URLs' : 'Configure Source & Settings'
    return 'Review & Start'
  }, [mode, wizardStep])

  const resetWizard = useCallback(() => {
    setMode('single')
    setWizardStep(1)
    setSelectedAccountId('')
    setSelectedAccountIds([])
    setSelectedPages([])
    setAccountSearch('')
    setPageSearch('')
    setPageListPage(1)
    setPostsPerDay(3)
    setSourceUsername('')
    setCsvText('')
    setSelectedSourceId('')
  }, [])

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const res = await api.facebook.accounts()
      setAccounts(res.accounts as FbAccount[])
      const srcRes = await api.sources.list()
      setExistingSources(srcRes.sources.filter((s) => s.isActive).map((s) => ({ id: s.id, username: s.username, platform: s.platform })))
      const first = res.accounts[0]?.id ?? ''
      setSelectedAccountId(first)
      if (first) {
        setLoadingPages(true)
        const pagesRes = await api.facebook.accountPages(first)
        setPagesByAccount({ [first]: pagesRes.pages.map((p) => ({ ...p, accountId: first })) })
      }
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load Facebook accounts'))
    } finally {
      setLoadingAccounts(false)
      setLoadingPages(false)
    }
  }, [toast])

  useEffect(() => {
    if (open) {
      resetWizard()
      loadAccounts()
    }
  }, [open, loadAccounts, resetWizard])

  async function loadPagesForAccounts(accountIds: string[]) {
    setLoadingPages(true)
    try {
      const next: Record<string, FbPage[]> = { ...pagesByAccount }
      for (const id of accountIds) {
        if (next[id]) continue
        const pagesRes = await api.facebook.accountPages(id)
        next[id] = pagesRes.pages.map((p) => ({ ...p, accountId: id }))
      }
      setPagesByAccount(next)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load pages'))
    } finally {
      setLoadingPages(false)
    }
  }

  async function selectAccount(accountId: string) {
    setSelectedAccountId(accountId)
    setPageListPage(1)
    if (!pagesByAccount[accountId]) {
      setLoadingPages(true)
      try {
        const pagesRes = await api.facebook.accountPages(accountId)
        setPagesByAccount((prev) => ({
          ...prev,
          [accountId]: pagesRes.pages.map((p) => ({ ...p, accountId })),
        }))
      } catch (err) {
        toast.error(getApiError(err, 'Failed to load pages for this account'))
      } finally {
        setLoadingPages(false)
      }
    }
  }

  function toggleBulkAccount(accountId: string) {
    setSelectedAccountIds((prev) => {
      const next = prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
      if (next.length) loadPagesForAccounts(next.filter((id) => !pagesByAccount[id]))
      return next
    })
    setPageListPage(1)
  }

  function selectAllAccounts() {
    const ids = filteredAccounts.map((a) => a.id)
    setSelectedAccountIds(ids)
    loadPagesForAccounts(ids.filter((id) => !pagesByAccount[id]))
  }

  const filteredAccounts = accounts.filter((acc) => {
    const q = accountSearch.toLowerCase()
    return (
      accountLabel(acc).toLowerCase().includes(q) ||
      acc.meta_user_id.includes(q) ||
      (acc.byoc_label ?? '').toLowerCase().includes(q)
    )
  })

  const visiblePages: FbPage[] = useMemo(() => {
    if (mode === 'single') {
      return (pagesByAccount[selectedAccountId] ?? []).filter((p) => {
        const q = pageSearch.toLowerCase()
        return p.name.toLowerCase().includes(q) || p.id.includes(q)
      })
    }
    const accountIds = selectedAccountIds.length ? selectedAccountIds : []
    const merged = accountIds.flatMap((id) => pagesByAccount[id] ?? [])
    return merged.filter((p) => {
      const q = pageSearch.toLowerCase()
      return p.name.toLowerCase().includes(q) || p.id.includes(q)
    })
  }, [mode, pagesByAccount, selectedAccountId, selectedAccountIds, pageSearch])

  const pagedVisiblePages = visiblePages.slice(
    (pageListPage - 1) * MODAL_PAGE_SIZE,
    pageListPage * MODAL_PAGE_SIZE,
  )
  const pageListTotalPages = Math.max(1, Math.ceil(visiblePages.length / MODAL_PAGE_SIZE))

  function isPageSelected(page: FbPage) {
    return selectedPages.some((p) => p.accountId === page.accountId && p.metaPageId === page.id)
  }

  function togglePage(page: FbPage) {
    const key = { accountId: page.accountId, metaPageId: page.id, name: page.name, followers: page.followers }
    if (mode === 'single') {
      setSelectedPages([key])
      return
    }
    setSelectedPages((prev) =>
      prev.some((p) => p.accountId === page.accountId && p.metaPageId === page.id)
        ? prev.filter((p) => !(p.accountId === page.accountId && p.metaPageId === page.id))
        : [...prev, key],
    )
  }

  function selectAllVisiblePages() {
    const toAdd = visiblePages.map((p) => ({
      accountId: p.accountId,
      metaPageId: p.id,
      name: p.name,
      followers: p.followers,
    }))
    if (mode === 'single') {
      setSelectedPages(toAdd.slice(0, 1))
      return
    }
    setSelectedPages((prev) => {
      const map = new Map(prev.map((p) => [`${p.accountId}:${p.metaPageId}`, p]))
      for (const p of toAdd) map.set(`${p.accountId}:${p.metaPageId}`, p)
      return [...map.values()]
    })
  }

  function getCsvMappings() {
    return parseCsvSourceMappings(csvText, selectedPages, sourcePlatform)
  }

  function parseCsvRows(): CsvRow[] {
    return getCsvMappings().rows
  }

  function normalizeUsername(value: string) {
    return value.replace(/^@/, '').trim().toLowerCase()
  }

  async function ensureSource(platform: string, username: string) {
    const clean = username.replace(/^@/, '').trim()
    if (!clean) return null
    const existing = (await api.sources.list()).sources.find(
      (s) => s.platform === platform && normalizeUsername(s.username) === normalizeUsername(clean),
    )
    if (existing) return existing.id
    const { source } = await api.sources.create({ platform, username: clean })
    return source.id
  }

  async function resolveSourceId(): Promise<string | null> {
    if (selectedSourceId) return selectedSourceId
    if (sourceUsername.trim()) return ensureSource(sourcePlatform, sourceUsername)
    return null
  }

  async function finishAdd() {
    setSaving(true)
    try {
      const connectedIds: string[] = []
      const metaToInternal = new Map<string, string>()
      const grouped = new Map<string, string[]>()
      for (const p of selectedPages) {
        const list = grouped.get(p.accountId) ?? []
        list.push(p.metaPageId)
        grouped.set(p.accountId, list)
      }

      for (const [accountId, pageIds] of grouped) {
        for (let i = 0; i < pageIds.length; i += CONNECT_BATCH_SIZE) {
          const batch = pageIds.slice(i, i + CONNECT_BATCH_SIZE)
          const res = await api.facebook.connectPages(accountId, batch)
          connectedIds.push(...res.ids)
          for (const row of res.connectedPages ?? []) {
            metaToInternal.set(row.metaPageId, row.id)
          }
        }
      }

      if (!connectedIds.length) {
        throw { error: 'No pages were connected. Try reconnecting the Facebook account under Accounts.' }
      }

      for (const pageId of connectedIds) {
        await api.pages.updateAutomationSettings(pageId, { postsPerDay, timezone })
      }

      if (mode === 'single' || mode === 'bulk') {
        const sourceId = await resolveSourceId()
        if (sourceId) {
          for (const pageId of connectedIds) {
            await api.automation.assignSource(pageId, sourceId)
          }
        }
      } else {
        const csvRows = parseCsvRows()
        for (const row of csvRows) {
          const pageId = metaToInternal.get(row.metaPageId)
          if (!pageId) continue
          const sourceId = await ensureSource(row.platform, row.sourceUsername)
          if (sourceId) await api.automation.assignSource(pageId, sourceId)
        }
      }

      toast.success(`Started automation for ${connectedIds.length} page(s)`)
      onComplete()
      onClose()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to add pages'))
    } finally {
      setSaving(false)
    }
  }

  function canProceedStep1() {
    if (mode === 'single') return selectedPages.length === 1 && selectedAccountId
    if (mode === 'bulk') return selectedPages.length > 0 && selectedAccountIds.length > 0
    return selectedPages.length > 0
  }

  function canProceedStep2() {
    if (mode === 'csv') {
      const { rows, errors } = getCsvMappings()
      return rows.length > 0 && rows.length <= selectedPages.length && errors.length === 0
    }
    if (mode === 'bulk') return sourceUsername.trim().length > 0
    return true
  }

  function handleNext() {
    if (wizardStep === 1 && !canProceedStep1()) {
      toast.error(mode === 'single' ? 'Select one page to continue' : 'Select at least one page')
      return
    }
    if (wizardStep === 2 && mode !== 'single' && !canProceedStep2()) {
      const { errors } = mode === 'csv' ? getCsvMappings() : { errors: [] as string[] }
      toast.error(
        errors[0] ??
          (mode === 'csv'
            ? 'Paste one source URL per line (or page_id, source_url rows) for each selected page'
            : 'Enter a source username'),
      )
      return
    }
    if (wizardStep >= totalSteps) {
      finishAdd()
      return
    }
    setWizardStep((s) => s + 1)
  }

  if (!open) return null

  const csvPreview = mode === 'csv' ? getCsvMappings() : { rows: [] as CsvRow[], errors: [] as string[] }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
        <div className="border-b border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Plus className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-display text-2xl font-bold">Add New Page</h3>
                <p className="text-sm text-muted-foreground">
                  Step {wizardStep} of {totalSteps}: {stepTitle}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(wizardStep / totalSteps) * 100}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-muted/40 p-1">
            {([
              ['single', 'Single Add'],
              ['bulk', 'Bulk Add'],
              ['csv', 'Multi-Account + CSV'],
            ] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m)
                  setWizardStep(1)
                  setSelectedPages([])
                  setSelectedAccountIds([])
                  setPageListPage(1)
                }}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {wizardStep === 1 && (
            <div className="space-y-3">
              <span className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-medium">
                {selectedPages.length} page{selectedPages.length !== 1 ? 's' : ''} selected
              </span>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {mode === 'bulk' ? 'Select Facebook Accounts' : 'Select Facebook Account'}
                    </p>
                    {mode === 'bulk' && (
                      <button type="button" onClick={selectAllAccounts} className="text-xs font-medium text-primary hover:underline">
                        Select all accounts
                      </button>
                    )}
                  </div>
                  <input
                    type="search"
                    placeholder="Search connected accounts..."
                    className="mb-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                  />
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {loadingAccounts ? (
                      <p className="text-xs text-muted-foreground">Loading accounts...</p>
                    ) : (
                      filteredAccounts.map((acc) => {
                        const active =
                          mode === 'single' ? selectedAccountId === acc.id : selectedAccountIds.includes(acc.id)
                        return (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => (mode === 'single' ? selectAccount(acc.id) : toggleBulkAccount(acc.id))}
                            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${
                              active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                            }`}
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold">
                              {accountLabel(acc).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{accountLabel(acc)}</p>
                              <p className="truncate text-xs text-muted-foreground">{acc.meta_user_id}</p>
                            </div>
                            {active && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                          </button>
                        )
                      })
                    )}
                    {!loadingAccounts && !filteredAccounts.length && (
                      <p className="text-xs text-muted-foreground">No Facebook accounts connected yet.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Select Managed Page{mode === 'single' ? '' : 's'}</p>
                    {mode !== 'single' && (
                      <div className="flex gap-2">
                        <button type="button" onClick={selectAllVisiblePages} className="text-xs font-medium text-primary hover:underline">
                          Select all pages
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedPages([])}
                          disabled={!selectedPages.length}
                          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="relative mb-2">
                    <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      placeholder="Search pages..."
                      className="h-10 w-full rounded-md border border-border bg-background pr-3 pl-9 text-sm"
                      value={pageSearch}
                      onChange={(e) => {
                        setPageSearch(e.target.value)
                        setPageListPage(1)
                      }}
                    />
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {loadingPages ? (
                      <p className="text-xs text-muted-foreground">Loading pages...</p>
                    ) : (
                      pagedVisiblePages.map((p) => {
                        const checked = isPageSelected(p)
                        return (
                          <button
                            key={`${p.accountId}:${p.id}`}
                            type="button"
                            onClick={() => togglePage(p)}
                            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${
                              checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                            }`}
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold">
                              {p.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{p.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {p.id} · {p.followers ?? p.fanCount ?? 0} followers
                              </p>
                            </div>
                            {checked && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
                          </button>
                        )
                      })
                    )}
                    {!loadingPages && !visiblePages.length && (
                      <p className="text-xs text-muted-foreground">No pages available for selected account(s).</p>
                    )}
                  </div>
                  {pageListTotalPages > 1 && (
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <button
                        type="button"
                        disabled={pageListPage <= 1}
                        onClick={() => setPageListPage((p) => p - 1)}
                        className="rounded border border-border px-2 py-1 disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="text-muted-foreground">
                        Page {pageListPage} of {pageListTotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={pageListPage >= pageListTotalPages}
                        onClick={() => setPageListPage((p) => p + 1)}
                        className="rounded border border-border px-2 py-1 disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {wizardStep === 2 && mode === 'single' && (
            <div className="space-y-6">
              <span className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-medium">
                {selectedPages.length} page selected
              </span>
              <div>
                <p className="mb-2 text-sm font-semibold">Source account</p>
                {existingSources.length ? (
                  <select
                    value={selectedSourceId}
                    onChange={(e) => setSelectedSourceId(e.target.value)}
                    className="mb-3 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  >
                    <option value="">Select existing source (optional)…</option>
                    {existingSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.username} ({s.platform})
                      </option>
                    ))}
                  </select>
                ) : null}
                <p className="mb-2 text-xs text-muted-foreground">Or add a new source username</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    value={sourcePlatform}
                    onChange={(e) => setSourcePlatform(e.target.value)}
                    className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                  >
                    {SOURCE_PLATFORMS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <input
                    value={sourceUsername}
                    onChange={(e) => setSourceUsername(e.target.value)}
                    placeholder="@username"
                    className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                  />
                </div>
              </div>
              <PostsPerDayGrid value={postsPerDay} onChange={setPostsPerDay} />
              <div>
                <p className="mb-2 text-sm font-semibold">Timezone</p>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {wizardStep === 2 && mode !== 'single' && (
            <div className="space-y-6">
              <span className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-medium">
                {selectedPages.length} page{selectedPages.length !== 1 ? 's' : ''} selected
              </span>
              {mode === 'csv' && (
                <div>
                  <p className="mb-2 text-sm font-semibold">Source URLs</p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Paste one profile URL per line — username and platform are detected automatically. URLs are matched to
                    selected pages in order. Or use CSV: page_id, source_url
                  </p>
                  <textarea
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder={`https://instagram.com/creator/reels\nhttps://tiktok.com/@creator2\n1085756071292311,https://youtube.com/@creator3`}
                    className="h-40 w-full rounded-md border border-border bg-background p-3 font-mono text-xs"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {csvPreview.rows.length} source mapping(s) parsed
                    {csvPreview.errors.length ? ` · ${csvPreview.errors.length} error(s)` : ''}
                  </p>
                  {csvPreview.rows.length > 0 && (
                    <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3 text-xs">
                      {csvPreview.rows.map((row) => (
                        <li key={row.metaPageId}>
                          <span className="font-medium">{row.metaPageId}</span>
                          {' → '}
                          <span className="text-primary">@{row.sourceUsername.replace(/^@/, '')}</span>
                          <span className="text-muted-foreground"> ({row.platform})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {csvPreview.errors.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-red-600">
                      {csvPreview.errors.map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {mode === 'bulk' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-semibold">Platform</p>
                  <select
                    value={sourcePlatform}
                    onChange={(e) => setSourcePlatform(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  >
                    {SOURCE_PLATFORMS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold">Source Identity</p>
                  <input
                    value={sourceUsername}
                    onChange={(e) => setSourceUsername(e.target.value)}
                    placeholder="@username"
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  />
                </div>
              </div>
              )}
              <PostsPerDayGrid value={postsPerDay} onChange={setPostsPerDay} />
              <div>
                <p className="mb-2 text-sm font-semibold">Timezone</p>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {wizardStep === 3 && mode !== 'single' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
                <p className="font-semibold">Ready to start automation</p>
                <ul className="mt-3 space-y-1 text-muted-foreground">
                  <li>{selectedPages.length} Facebook page(s)</li>
                  {mode === 'bulk' && (
                    <li>
                      Source: @{sourceUsername.replace(/^@/, '')} ({sourcePlatform})
                    </li>
                  )}
                  {mode === 'csv' && (
                    <li>{csvPreview.rows.length} source URL mapping(s) with auto-detected usernames</li>
                  )}
                  <li>{postsPerDay} posts per day · {timezone}</li>
                </ul>
              </div>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                {(mode === 'csv' ? csvPreview.rows : selectedPages.map((p) => ({ metaPageId: p.metaPageId, name: p.name }))).map(
                  (item) => (
                  <li
                    key={'sourceUsername' in item ? `${item.metaPageId}-${item.sourceUsername}` : item.metaPageId}
                    className="rounded-lg border border-border px-3 py-2"
                  >
                    {'sourceUsername' in item ? (
                      <>
                        {item.metaPageId} → @{item.sourceUsername.replace(/^@/, '')} ({item.platform})
                      </>
                    ) : (
                      <>
                        {item.name} · {item.metaPageId}
                      </>
                    )}
                  </li>
                ),
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border p-5">
          <button
            type="button"
            onClick={() => (wizardStep > 1 ? setWizardStep((s) => s - 1) : onClose())}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            {wizardStep > 1 ? 'Back' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={saving || (wizardStep === 1 && !canProceedStep1())}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving
              ? 'Starting...'
              : wizardStep >= totalSteps
                ? 'Start Automation'
                : wizardStep === 2 && mode === 'single'
                  ? 'Start Automation'
                  : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
