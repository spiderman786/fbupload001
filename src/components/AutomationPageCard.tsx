import { ChevronRight, Download, ExternalLink, Loader2, Music2, Share2, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AutomationPage } from '../api/client'
import { AutomationStatusBadge } from './HealthStatusBadge'
import { formatAddedDate, formatDurationSince } from '../lib/formatDuration'
import { facebookPagePublicUrl, sourcePublicUrl } from '../lib/publicProfileUrl'

type Props = {
  page: AutomationPage
  onDelete: (id: string) => void
  deleting?: boolean
  sources?: { id: string; username: string; platform: string }[]
  assignedSourceId?: string
  onAssignSource?: (pageId: string, sourceId: string) => void
}

function platformLabel(platform: string) {
  const map: Record<string, string> = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    facebook: 'Facebook',
  }
  return map[platform] ?? platform
}

function StatCell({ label, value, tone }: { label: string; value: number; tone?: 'default' | 'danger' }) {
  return (
    <div className="text-center">
      <p className={`font-display text-lg font-bold ${tone === 'danger' && value > 0 ? 'text-red-600' : ''}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}

export function AutomationPageCard({
  page,
  onDelete,
  deleting,
  sources,
  assignedSourceId,
  onAssignSource,
}: Props) {
  const gained = page.followersGained ?? 0
  const gainedClass = gained >= 0 ? 'text-primary' : 'text-red-600'
  const initial = (page.name?.trim()?.[0] ?? '?').toUpperCase()
  const detailPath = `/facebook/auto-download-upload/${page.id}`
  const stats = page.stats ?? {
    total: { posted: 0, pending: 0, failed: 0 },
    today: { pending: 0, posted: 0, failed: 0 },
  }
  const sourcePlatform = page.sourcePlatform ?? sources?.find((s) => s.id === assignedSourceId)?.platform
  const scrape = page.scrape

  function scrapeLine() {
    if (!scrape || scrape.status === 'none') return null
    if (scrape.status === 'pending_scrap') {
      const catalog =
        scrape.catalogTotal != null && scrape.catalogTotal > 0
          ? `${scrape.totalScraped} / ${scrape.catalogTotal}`
          : `${scrape.totalScraped} scraped`
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          <Loader2 className="h-3 w-3 animate-spin" />
          Scraping · {catalog}
        </span>
      )
    }
    if (scrape.status === 'scraping_pending') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
          <Download className="h-3 w-3" />
          Scraping pending
        </span>
      )
    }
    if (scrape.totalScraped > 0) {
      const suffix = scrape.catalogTotal ? ` / ${scrape.catalogTotal}` : ''
      return (
        <span className="text-[10px] text-muted-foreground">
          {scrape.totalScraped.toLocaleString()}
          {suffix} reels in queue
        </span>
      )
    }
    return null
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link to={detailPath} className="truncate font-semibold hover:text-primary hover:underline">
                {page.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{page.metaPageId}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <AutomationStatusBadge status={page.status} healthStatus={page.healthStatus ?? 'completed'} />
              <button
                type="button"
                onClick={() => onDelete(page.id)}
                disabled={deleting}
                className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
                title="Remove page"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <Link
                to={detailPath}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Open page details"
              >
                <ChevronRight className="h-5 w-5" />
              </Link>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Followers</p>
              <p className="font-display text-xl font-bold">{page.followers}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Gained</p>
              <p className={`font-display text-xl font-bold ${gainedClass}`}>
                {gained >= 0 ? '+' : ''}
                {gained.toLocaleString()}
              </p>
            </div>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Starting {page.reelsStarted.toLocaleString()} · Added {formatAddedDate(page.createdAt)} ·{' '}
            {formatDurationSince(page.createdAt)}
          </p>

          <div className="mt-3 space-y-2 border-t border-border pt-3">
            {page.facebookAccountName ? (
              <p className="text-xs text-muted-foreground">
                via <span className="font-medium text-foreground">{page.facebookAccountName}</span>
              </p>
            ) : null}

            <a
              href={facebookPagePublicUrl(page.metaPageId)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs transition hover:border-primary/30 hover:bg-muted/40"
            >
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Share2 className="h-3.5 w-3.5 text-primary" />
                Facebook Page
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>

            {page.sourceUsername ? (
              <a
                href={sourcePublicUrl(sourcePlatform ?? 'instagram', page.sourceUsername)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs transition hover:border-primary/30 hover:bg-muted/40"
              >
                <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                  {sourcePlatform === 'tiktok' ? (
                    <Music2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                  <span className="truncate">
                    {sourcePlatform ? `${platformLabel(sourcePlatform)}: ` : ''}@
                    {page.sourceUsername.replace(/^@/, '')}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {scrapeLine()}
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                    Synced
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </a>
            ) : onAssignSource && sources && sources.length > 0 ? (
              <div className="space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Synced account
                </label>
                <select
                  value={assignedSourceId ?? ''}
                  onChange={(e) => onAssignSource(page.id, e.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                >
                  <option value="">Select source to sync…</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {platformLabel(s.platform)}: @{s.username.replace(/^@/, '')}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No source synced — assign in page Settings → Source</p>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
            <div className="rounded-lg border border-border bg-muted/20 px-2 py-2">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total Stats</p>
              <div className="grid grid-cols-3 gap-1">
                <StatCell label="Posted" value={stats.total.posted} />
                <StatCell label="Pending" value={stats.total.pending} />
                <StatCell label="Failed" value={stats.total.failed} tone="danger" />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 px-2 py-2">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Today&apos;s Stats</p>
              <div className="grid grid-cols-3 gap-1">
                <StatCell label="Pending" value={stats.today.pending} />
                <StatCell label="Posted" value={stats.today.posted} />
                <StatCell label="Failed" value={stats.today.failed} tone="danger" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
