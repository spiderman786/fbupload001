import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock,
  Coins,
  Download,
  Globe,
  Plus,
  RefreshCw,
  Server,
  TrendingUp,
  Users,
} from 'lucide-react'
import { api } from '../../api/client'
import { QUICK_LINKS } from '../../config/dashboardNav'
import { HealthStatusBadge } from '../../components/HealthStatusBadge'
import { ProxyPoolUploadPanel } from '../../components/ProxyPoolUploadPanel'
import { useAuth, useAgencyRole } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

type DashboardStats = {
  tokenBalance: number
  connectedPages: number
  activePages: number
  followersGained: number
  inAppPending: number
  directScheduled: number
  needsAttention: number
  updatedAt: string
}

type AttentionPage = {
  id: string
  name: string
  healthStatus: string
  status: string
  followers: string
}

export function OverviewPage() {
  const { user } = useAuth()
  const { isOwner } = useAgencyRole()
  const toast = useToast()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [attention, setAttention] = useState<AttentionPage[]>([])
  const [filter, setFilter] = useState<'all' | 'needs_fix' | 'completed'>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [s, a] = await Promise.all([
        api.dashboard.stats(),
        api.dashboard.attention({ filter: filter === 'all' ? undefined : filter, search: search || undefined }),
      ])
      setStats(s)
      setAttention(a.pages)
    } catch (err) {
      const msg = getApiError(err, 'Failed to load dashboard')
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [filter, search, toast])

  useEffect(() => { load() }, [load])

  const updatedLabel = stats?.updatedAt
    ? new Date(stats.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : ''

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Welcome, {user?.fullName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor automation health and page status at a glance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/dashboard/usage.csv"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <Download className="h-4 w-4" />
            Download usage CSV
          </a>
          <Link
            to="/add-tokens"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Tokens
          </Link>
        </div>
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{loadError}</p>
      )}

      {isOwner && (
        <section className="rounded-xl border-2 border-primary/25 bg-primary/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Download proxies</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Upload your Webshare (or other) proxy list here — one IP per line. Required for Instagram/TikTok downloads at scale.
          </p>
          <ProxyPoolUploadPanel />
          <Link to="/settings/proxy-pool" className="mt-3 inline-block text-sm text-primary hover:underline">
            View full proxy pool status →
          </Link>
        </section>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Updated {updatedLabel}</span>
        <button onClick={load} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'Token Balance', value: stats?.tokenBalance ?? 0, sub: 'Available for automation', icon: Coins },
          { label: 'Connected Pages', value: stats?.connectedPages ?? 0, sub: `Active: ${stats?.activePages ?? 0} / ${stats?.connectedPages ?? 0} accounts`, icon: Globe },
          { label: 'Followers Gained', value: stats?.followersGained ?? 0, sub: 'Net change across all pages', icon: TrendingUp },
          { label: 'InApp Pending', value: stats?.inAppPending ?? 0, sub: 'Queued for in-app publish', icon: Users, link: '/facebook/jobs' },
          { label: 'Direct Scheduled', value: stats?.directScheduled ?? 0, sub: 'Scheduled via Graph API', icon: CalendarClock },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <stat.icon className="h-4 w-4 text-primary" />
            </div>
            {'link' in stat && stat.link ? (
              <Link to={stat.link} className="font-display mt-2 block text-2xl font-bold tracking-tight hover:text-primary">
                {loading ? '—' : stat.value.toLocaleString()}
              </Link>
            ) : (
              <p className="font-display mt-2 text-2xl font-bold tracking-tight">
                {loading ? '—' : stat.value.toLocaleString()}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Needs Attention */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Needs Attention ({stats?.needsAttention ?? 0})
              </h2>
              {(stats?.needsAttention ?? 0) > 0 && (
                <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                  {stats?.needsAttention} Pages Not Active
                </span>
              )}
            </div>
            <input
              type="search"
              placeholder="Search pages..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm sm:w-56"
            />
          </div>
          <div className="mt-3 flex gap-2">
            {(['all', 'needs_fix', 'completed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                  filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {f === 'needs_fix' ? 'Needs Fix' : f}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-border">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : attention.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No pages yet.{' '}
              <Link to="/facebook/accounts" className="text-primary hover:underline">Connect Facebook accounts</Link>
            </p>
          ) : (
            attention.map((page) => (
              <div key={page.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium">{page.name}</p>
                  <p className="text-xs text-muted-foreground">{page.followers} followers</p>
                </div>
                <HealthStatusBadge status={page.healthStatus} />
              </div>
            ))
          )}
        </div>

        {attention.length > 0 && (
          <div className="border-t border-border px-5 py-3 flex flex-wrap gap-4">
            <Link to="/facebook/auto-download-upload" className="text-sm font-medium text-primary hover:underline">
              View all on ADU hub →
            </Link>
            <Link to="/facebook/jobs" className="text-sm font-medium text-primary hover:underline">
              View reel jobs →
            </Link>
          </div>
        )}
      </section>

      {/* Quick Links */}
      <section>
        <h2 className="mb-4 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Quick Links</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.filter((link) => !('ownerOnly' in link && link.ownerOnly) || isOwner).map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md"
            >
              <link.icon className="mb-3 h-5 w-5 text-primary" />
              <p className="font-semibold">{link.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{link.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
