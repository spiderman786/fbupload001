import React, { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Film,
  Link2,
  Music2,
  Settings2,
  Share2,
  TrendingUp,
  User,
  ExternalLink,
} from 'lucide-react'
import { api, type PageDetail, type PageInsightsPayload, type PageQueueItem } from '../../api/client'
import { AutomationStatusBadge } from '../../components/HealthStatusBadge'
import { ReelsQueueWorkspace } from '../../components/ReelsQueueWorkspace'
import { ScrapeStatusBanner } from '../../components/ScrapeStatusBanner'
import { SwitchSourceModal } from '../../components/SwitchSourceModal'
import { formatAddedDate, formatDurationSince } from '../../lib/formatDuration'
import { facebookPagePublicUrl, sourcePublicUrl } from '../../lib/publicProfileUrl'
import { useToast } from '../../context/ToastContext'
import { useAgencyRole } from '../../context/AuthContext'
import { getApiError } from '../../lib/apiError'

type MainTab = 'overview' | 'insights' | 'reels' | 'failed' | 'settings'
type SettingsTab = 'automation' | 'connections' | 'source' | 'identity'

function platformLabel(platform: string) {
  const map: Record<string, string> = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    facebook: 'Facebook',
  }
  return map[platform] ?? platform
}

function OverviewStat({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string
  value: string | number
  sub: string
  icon: React.ElementType
  tone?: 'primary' | 'success' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-600'
      : tone === 'warning'
        ? 'text-amber-600'
        : tone === 'danger'
          ? 'text-red-600'
          : 'text-primary'
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={`mt-1 font-display text-3xl font-bold ${toneClass}`}>{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        </div>
        <Icon className={`h-5 w-5 shrink-0 ${toneClass}`} />
      </div>
    </div>
  )
}

function MiniBarChart({ data, keys, colors }: { data: Record<string, number | string>[]; keys: string[]; colors: string[] }) {
  const max = Math.max(...data.flatMap((d) => keys.map((k) => Number(d[k] ?? 0))), 1)
  return (
    <div className="flex h-40 items-end gap-0.5">
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col justify-end gap-0.5" title={String(d.day)}>
          {keys.map((k, ki) => (
            <div
              key={k}
              className="w-full rounded-t"
              style={{ height: `${(Number(d[k] ?? 0) / max) * 100}%`, minHeight: Number(d[k]) ? 2 : 0, background: colors[ki] }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function AduPageDetailPage() {
  const { pageId } = useParams<{ pageId: string }>()
  const toast = useToast()
  const { canWrite } = useAgencyRole()
  const [tab, setTab] = useState<MainTab>('overview')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('automation')
  const [detail, setDetail] = useState<PageDetail | null>(null)
  const [insights, setInsights] = useState<PageInsightsPayload | null>(null)
  const [insightsError, setInsightsError] = useState<string | null>(null)
  const [insightDays, setInsightDays] = useState(28)
  const [queue, setQueue] = useState<PageQueueItem[]>([])
  const [queueRefreshing, setQueueRefreshing] = useState(false)
  const [failed, setFailed] = useState<{ id: string; errorMessage: string | null; completedAt: string | null; retryCount: number }[]>([])
  const [reasons, setReasons] = useState<{ errorMessage: string; count: number; lastAt: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [editSettings, setEditSettings] = useState(false)
  const [form, setForm] = useState({ postsPerDay: 3, postingLogic: 'dailyrandom', timezone: 'America/New_York', scheduleTimes: '' })
  const [switchSourceOpen, setSwitchSourceOpen] = useState(false)
  const [retryingScrape, setRetryingScrape] = useState(false)

  const loadDetail = useCallback(async () => {
    if (!pageId) return
    setLoading(true)
    try {
      const d = await api.pages.detail(pageId)
      setDetail(d)
      setForm({
        postsPerDay: d.settings.postsPerDay,
        postingLogic: d.settings.postingLogic,
        timezone: d.settings.timezone,
        scheduleTimes: d.settings.scheduleTimes.join(', '),
      })
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load page'))
    } finally {
      setLoading(false)
    }
  }, [pageId, toast])

  const loadQueue = useCallback(async () => {
    if (!pageId) return
    setQueueRefreshing(true)
    try {
      const r = await api.pages.reels(pageId)
      setQueue(r.queue)
    } catch {
      /* ignore */
    } finally {
      setQueueRefreshing(false)
    }
  }, [pageId])

  const refreshQueueAndDetail = useCallback(() => {
    void loadQueue()
    void loadDetail()
  }, [loadQueue, loadDetail])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  useEffect(() => {
    if (!pageId) return
    if (tab === 'insights') {
      setInsightsError(null)
      api.pages
        .insights(pageId, insightDays)
        .then((r) => setInsights(r.insights))
        .catch((err) => {
          setInsights(null)
          setInsightsError(getApiError(err, 'Failed to load insights'))
        })
    }
    if (tab === 'overview' || tab === 'reels') {
      loadQueue()
    }
    if (tab === 'failed' || tab === 'overview') {
      api.pages.failedPosts(pageId).then((r) => {
        setFailed(r.posts)
        setReasons(r.reasons)
      }).catch(() => {})
    }
  }, [pageId, tab, insightDays, loadQueue])

  async function retryScrape() {
    if (!pageId || !canWrite) return
    setRetryingScrape(true)
    try {
      const result = await api.pages.retryScrape(pageId)
      toast.success(
        result.created > 0
          ? `Source enabled — started ${result.created} download${result.created !== 1 ? 's' : ''}`
          : 'Source enabled — scrape restarted',
      )
      await loadDetail()
      await loadQueue()
    } catch (err) {
      toast.error(getApiError(err, 'Could not restart scrape'))
    } finally {
      setRetryingScrape(false)
    }
  }

  async function toggleAutomation() {
    if (!pageId || !detail) return
    const next = detail.page.status === 'active' ? 'paused' : 'active'
    try {
      await api.pages.update(pageId, { status: next })
      toast.success(next === 'active' ? 'Automation enabled' : 'Automation paused')
      loadDetail()
    } catch (err) {
      toast.error(getApiError(err, 'Update failed'))
    }
  }

  async function saveSettings(opts?: { regenerateRandomTimes?: boolean }) {
    if (!pageId) return
    const isFixed = form.postingLogic === 'fixed'
    try {
      const result = await api.pages.updateAutomationSettings(pageId, {
        postsPerDay: form.postsPerDay,
        postingLogic: form.postingLogic,
        timezone: form.timezone,
        scheduleTimes: isFixed ? form.scheduleTimes.split(/[,;\s]+/).filter(Boolean) : undefined,
        regenerateRandomTimes: opts?.regenerateRandomTimes,
      })
      setForm((f) => ({
        ...f,
        scheduleTimes: result.settings.scheduleTimes.join(', '),
      }))
      toast.success(
        result.queueSync
          ? `Settings saved — queue synced to ${result.queueSync.target} reel${result.queueSync.target !== 1 ? 's' : ''}`
          : 'Settings saved',
      )
      setEditSettings(false)
      loadDetail()
    } catch (err) {
      toast.error(getApiError(err, 'Save failed'))
    }
  }

  async function regenerateRandomTimes() {
    if (!pageId) return
    try {
      const result = await api.pages.updateAutomationSettings(pageId, {
        postsPerDay: form.postsPerDay,
        postingLogic: 'dailyrandom',
        timezone: form.timezone,
        regenerateRandomTimes: true,
      })
      setForm((f) => ({
        ...f,
        postingLogic: 'dailyrandom',
        scheduleTimes: result.settings.scheduleTimes.join(', '),
      }))
      toast.success('Random posting times generated')
      loadDetail()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to generate times'))
    }
  }

  async function handleSourceSwitched() {
    await loadDetail()
    if (tab === 'overview' || tab === 'reels') loadQueue()
  }

  if (loading && !detail) {
    return <div className="flex h-48 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
  }
  if (!detail || !pageId) {
    return <p className="text-muted-foreground">Page not found. <Link to="/facebook/auto-download-upload" className="text-primary">Back to hub</Link></p>
  }

  const { page, stats, settings, source, scrape, facebookIdentity } = detail
  const initial = (page.name?.trim()?.[0] ?? '?').toUpperCase()
  const mainTabs: { id: MainTab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'insights', label: 'Insights', icon: BarChart3 },
    { id: 'reels', label: 'Reels', icon: Film },
    { id: 'failed', label: 'Failed Posts Reasons', icon: AlertTriangle },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ]

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
              {initial}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-bold">{page.name}</h1>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {page.status === 'active' ? 'Active posting' : 'Paused'}
                </span>
                <AutomationStatusBadge status={page.status} healthStatus={page.healthStatus ?? 'completed'} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Internal ID: {page.metaPageId}</p>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:max-w-xs">
                <div>
                  <p className="text-xs text-muted-foreground">{page.followers} followers</p>
                </div>
                <div>
                  <p className={`text-xs font-medium ${(page.followersGained ?? 0) >= 0 ? 'text-primary' : 'text-red-600'}`}>
                    {(page.followersGained ?? 0) >= 0 ? '+' : ''}
                    {page.followersGained ?? 0} gained
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Starting {page.reelsStarted.toLocaleString()} · Added {formatAddedDate(page.createdAt)} ·{' '}
                {formatDurationSince(page.createdAt)}
              </p>
              <div className="mt-3 flex max-w-md flex-col gap-2">
                <a
                  href={facebookPagePublicUrl(page.metaPageId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-2 rounded-md border border-border bg-muted/60 px-2.5 py-1.5 text-xs transition hover:border-primary/30 hover:bg-muted"
                >
                  <span className="inline-flex items-center gap-1 font-medium">
                    <Share2 className="h-3.5 w-3.5 text-primary" />
                    Facebook Page
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </a>
                {source ? (
                  <a
                    href={sourcePublicUrl(source.platform, source.username)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-between gap-2 rounded-md border border-border bg-muted/60 px-2.5 py-1.5 text-xs font-medium transition hover:border-primary/30 hover:bg-muted"
                  >
                    <span className="inline-flex items-center gap-1">
                      {source.platform === 'tiktok' ? (
                        <Music2 className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Share2 className="h-3.5 w-3.5 text-primary" />
                      )}
                      {platformLabel(source.platform)}: @{source.username.replace(/^@/, '')}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                ) : null}
              </div>
              {facebookIdentity ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  via <span className="font-medium text-foreground">{facebookIdentity.name}</span>
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <Link
              to="/facebook/auto-download-upload"
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Hub
            </Link>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Automation
              <button
                type="button"
                onClick={toggleAutomation}
                className={`relative h-6 w-11 rounded-full transition ${page.status === 'active' ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${page.status === 'active' ? 'left-5' : 'left-0.5'}`} />
              </button>
            </label>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {mainTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
              tab === t.id ? 'border-primary bg-primary/5 text-primary shadow-sm' : 'border-border bg-card hover:bg-muted/50'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <OverviewStat
              label="Total Pending"
              value={stats.total.reelsReady}
              sub="Reels ready for posting"
              icon={Clock}
              tone="primary"
            />
            <OverviewStat
              label="Total Posted"
              value={stats.total.successfulAutomations}
              sub="Successful automations"
              icon={CheckCircle2}
              tone="success"
            />
            <OverviewStat
              label="Require Attention"
              value={stats.total.requireAttention}
              sub="Health or recent failures"
              icon={AlertTriangle}
              tone="warning"
            />
            <OverviewStat
              label="Net Growth"
              value={`+${stats.total.netGrowth.toLocaleString()}`}
              sub="Net growth since page onboarding"
              icon={TrendingUp}
              tone="success"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <OverviewStat
              label="Remaining Today"
              value={stats.today.remainingScheduled}
              sub="Remaining scheduled posts today"
              icon={Clock}
            />
            <OverviewStat
              label="Published Today"
              value={stats.today.publishedToday}
              sub="Published since page local midnight"
              icon={CheckCircle2}
              tone="success"
            />
            <OverviewStat
              label="Errors Today"
              value={stats.today.errorsToday}
              sub="Errors since page local midnight"
              icon={AlertTriangle}
              tone={stats.today.errorsToday > 0 ? 'danger' : undefined}
            />
          </div>

          <ScrapeStatusBanner
            scrape={scrape}
            totalScraped={stats.total.totalScraped}
            onRetry={canWrite ? retryScrape : undefined}
            retrying={retryingScrape}
          />

          {pageId ? (
            <ReelsQueueWorkspace
              pageId={pageId}
              queue={queue}
              canWrite={canWrite}
              defaultHashtags={settings.hashtags}
              onRefresh={refreshQueueAndDetail}
              refreshing={queueRefreshing}
            />
          ) : null}

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Failed Posts</h2>
            {failed.length ? (
              <ul className="mt-4 space-y-2">
                {failed.slice(0, 5).map((f) => (
                  <li key={f.id} className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{f.errorMessage}</li>
                ))}
              </ul>
            ) : (
              <>
                <h3 className="mt-4 font-medium">No Failed Posts Found</h3>
                <p className="text-sm text-muted-foreground">
                  All systems are operating normally. There are no failed publish attempts recorded for this page.
                </p>
              </>
            )}
          </section>
        </div>
      )}

      {tab === 'insights' && insightsError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{insightsError}</div>
      )}

      {tab === 'insights' && !insightsError && insights && (
        <div className="space-y-6">
          <div className="flex gap-2">
            {[7, 14, 28, 90].map((d) => (
              <button key={d} type="button" onClick={() => setInsightDays(d)} className={`rounded-full px-3 py-1 text-xs ${insightDays === d ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                {d} Days
              </button>
            ))}
            <span className="ml-auto inline-flex items-center gap-2 text-xs">
              {insights.graphLive ? (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-semibold text-primary">Live from Meta</span>
              ) : insights.source === 'mixed' ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-800">Partial Meta data</span>
              ) : (
                <span className="text-muted-foreground">Estimated from jobs</span>
              )}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Total Audience', value: insights.summary.totalAudience.toLocaleString(), sub: `${insights.summary.totalAudience} likes` },
              { label: 'Page Reach', value: insights.summary.pageReach.toLocaleString(), sub: 'Unique views in period' },
              { label: 'Total Engagements', value: insights.summary.totalEngagements.toLocaleString(), sub: 'Interactions in period' },
              { label: 'Video Views (3S+)', value: insights.summary.videoViews3s.toLocaleString(), sub: 'Views in period' },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="font-display text-2xl font-bold">{c.value}</p>
                <p className="text-xs text-muted-foreground">{c.sub}</p>
              </div>
            ))}
          </div>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Audience Demographics</h2>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">Top Countries</p>
                {insights.demographics.countries.map((c) => (
                  <div key={c.name} className="mb-2">
                    <div className="flex justify-between text-sm"><span>{c.name}</span><span>{c.count} ({c.pct}%)</span></div>
                    <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${c.pct}%` }} /></div>
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Top Cities</p>
                {insights.demographics.cities.map((c) => (
                  <p key={c.name} className="text-sm text-muted-foreground">{c.name}: {c.count}</p>
                ))}
              </div>
            </div>
          </section>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Reach &amp; Profile Views</h2>
            <MiniBarChart data={insights.reachSeries} keys={['profileViews', 'uniqueReach']} colors={['#10b981', '#94a3b8']} />
          </section>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Follower Growth</h2>
            <MiniBarChart data={insights.followerGrowth} keys={['gained', 'lost']} colors={['#10b981', '#ef4444']} />
          </section>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Video Performance</h2>
            <MiniBarChart data={insights.videoPerformance} keys={['views3s', 'views30s']} colors={['#3b82f6', '#ec4899']} />
          </section>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Engagement &amp; Reactions Breakdown</h2>
            <MiniBarChart data={insights.engagementBreakdown} keys={['likes', 'loves', 'hahas']} colors={['#3b82f6', '#ec4899', '#eab308']} />
          </section>
          <div className="flex flex-wrap gap-2">
            {insights.hashtags.map((h) => (
              <span key={h} className="rounded-full bg-muted px-3 py-1 text-xs">{h}</span>
            ))}
          </div>
        </div>
      )}

      {tab === 'reels' && pageId && (
        <ReelsQueueWorkspace
          pageId={pageId}
          queue={queue}
          canWrite={canWrite}
          defaultHashtags={settings.hashtags}
          onRefresh={loadQueue}
          refreshing={queueRefreshing}
          layout="workspace"
        />
      )}

      {tab === 'failed' && (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Failure Reasons</h2>
            <ul className="mt-3 space-y-3">
              {reasons.map((r) => (
                <li key={r.errorMessage} className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <p className="font-medium text-red-800">{r.count}× {r.errorMessage}</p>
                  <p className="text-xs text-red-600">Last: {r.lastAt ? new Date(r.lastAt).toLocaleString() : '—'}</p>
                </li>
              ))}
              {!reasons.length && <p className="text-sm text-muted-foreground">No failure reasons recorded</p>}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">Recent Failed Posts</h2>
            <ul className="mt-3 space-y-2">
              {failed.map((f) => (
                <li key={f.id} className="text-sm">
                  <p className="text-red-700">{f.errorMessage}</p>
                  <p className="text-xs text-muted-foreground">Retries: {f.retryCount} · {f.completedAt ? new Date(f.completedAt).toLocaleString() : ''}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-4">
          <div className="flex gap-2 border-b border-border">
            {([
              ['automation', 'Automation', Calendar],
              ['connections', 'Connections', Link2],
              ['source', 'Source', Film],
              ['identity', 'Identity', User],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSettingsTab(id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm ${settingsTab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          {settingsTab === 'automation' && (
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Posting Settings</h2>
                  <p className="text-sm text-muted-foreground">Manage frequency and localized posting times</p>
                </div>
                <button type="button" onClick={() => setEditSettings((v) => !v)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                  {editSettings ? 'Cancel' : 'Edit'}
                </button>
              </div>
              {editSettings ? (
                <div className="mt-4 space-y-4">
                  <label className="block text-sm">
                    Posts per day
                    <input
                      type="number"
                      min={1}
                      max={12}
                      className="mt-1 h-9 w-full rounded-md border px-3"
                      value={form.postsPerDay}
                      onChange={(e) => setForm({ ...form, postsPerDay: Number(e.target.value) })}
                    />
                  </label>
                  <div>
                    <p className="mb-2 text-sm font-medium">Posting logic</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ['dailyrandom', 'Random daily times'],
                        ['fixed', 'Fixed schedule times'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setForm({ ...form, postingLogic: value })}
                          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                            form.postingLogic === value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {form.postingLogic === 'dailyrandom' ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <p className="text-xs text-muted-foreground">Random times auto-generate for each day&apos;s post count.</p>
                        <button type="button" onClick={regenerateRandomTimes} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">
                          Regenerate random times
                        </button>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">Posts publish at the exact local times you set below.</p>
                    )}
                  </div>
                  <label className="block text-sm">
                    Timezone
                    <input className="mt-1 h-9 w-full rounded-md border px-3" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    Schedule times (comma separated, 24h — e.g. 03:33, 09:15, 16:00)
                    <input
                      className="mt-1 h-9 w-full rounded-md border px-3"
                      value={form.scheduleTimes}
                      onChange={(e) => setForm({ ...form, scheduleTimes: e.target.value })}
                      disabled={form.postingLogic === 'dailyrandom'}
                    />
                  </label>
                  {form.postingLogic === 'dailyrandom' && form.scheduleTimes ? (
                    <div className="flex flex-wrap gap-2">
                      {form.scheduleTimes.split(/[,;\s]+/).filter(Boolean).map((t) => (
                        <span key={t} className="rounded-full bg-muted px-2.5 py-1 text-xs">{t}</span>
                      ))}
                    </div>
                  ) : null}
                  <button type="button" onClick={() => saveSettings()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">Save</button>
                </div>
              ) : (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div><p className="text-xs text-muted-foreground">POSTS PER DAY</p><p className="font-semibold">{settings.postsPerDay} Posts</p></div>
                  <div>
                    <p className="text-xs text-muted-foreground">LOGIC</p>
                    <p className="font-semibold">{settings.postingLogic === 'fixed' ? 'Fixed schedule times' : 'Random daily times'}</p>
                  </div>
                  <div><p className="text-xs text-muted-foreground">TIMEZONE</p><p className="font-semibold">{settings.timezone}</p></div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-muted-foreground">SCHEDULED TIMES (LOCAL)</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {settings.scheduleTimes.map((t) => (
                        <span key={t} className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {settingsTab === 'connections' && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="font-semibold">Facebook Identity</h2>
              <p className="text-sm text-muted-foreground">The Facebook account used to manage this page</p>
              {facebookIdentity ? (
                <div className="mt-4 rounded-lg border border-border p-4">
                  <p className="font-medium">{facebookIdentity.name}</p>
                  <p className="text-sm text-muted-foreground">UID: {facebookIdentity.uid}</p>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">No linked Facebook account — connect under Accounts</p>
              )}
            </section>
          )}

          {settingsTab === 'source' && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="font-semibold">Update Content Source</h2>
              <p className="text-sm text-muted-foreground">Reels are downloaded from this account and posted to your page.</p>
              <div className="mt-4 rounded-lg border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Source</p>
                {source ? (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="font-medium">@{source.username.replace(/^@/, '')}</p>
                      {source.scrapeLabel && source.scrapeStatus !== 'idle' ? (
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          source.scrapeStatus === 'scraping_error'
                            ? 'bg-red-100 text-red-700'
                            : source.scrapeStatus === 'pending_scrap' || source.scrapeStatus === 'scraping_pending'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-muted text-muted-foreground'
                        }`}>
                          {source.scrapeLabel}
                        </span>
                      ) : null}
                      {page.healthStatus === 'source_exhausted' ? (
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          Completed
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground capitalize">{source.platform} · {source.isActive ? 'Active' : 'Disabled'}</p>
                    {source.scrapeError ? (
                      <p className="mt-2 text-xs text-red-600">{source.scrapeError}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No source assigned yet.</p>
                )}
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => setSwitchSourceOpen(true)}
                    className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Update Content Source
                  </button>
                ) : null}
              </div>
            </section>
          )}

          {settingsTab === 'identity' && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="font-semibold">Page Identity</h2>
              <p className="mt-2 font-medium">{page.name}</p>
              <p className="text-sm text-muted-foreground">Meta Page ID: {page.metaPageId}</p>
              <p className="text-sm text-muted-foreground">Followers: {page.followers} · Gained: +{page.followersGained}</p>
            </section>
          )}
        </div>
      )}
      {pageId ? (
        <SwitchSourceModal
          open={switchSourceOpen}
          pageId={pageId}
          currentSource={source}
          onClose={() => setSwitchSourceOpen(false)}
          onComplete={handleSourceSwitched}
        />
      ) : null}
    </div>
  )
}