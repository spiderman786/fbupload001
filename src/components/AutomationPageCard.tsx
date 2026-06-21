import { ExternalLink, Share2, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AutomationPage } from '../api/client'
import { AutomationStatusBadge } from './HealthStatusBadge'
import { formatAddedDate, formatDurationSince } from '../lib/formatDuration'

type Props = {
  page: AutomationPage
  onDelete: (id: string) => void
  deleting?: boolean
  sources?: { id: string; username: string; platform: string }[]
  assignedSourceId?: string
  onAssignSource?: (pageId: string, sourceId: string) => void
  onDailyLimitChange?: (pageId: string, limit: number) => void
  savingLimit?: boolean
}

export function AutomationPageCard({
  page,
  onDelete,
  deleting,
  sources,
  assignedSourceId,
  onAssignSource,
  onDailyLimitChange,
  savingLimit,
}: Props) {
  const gained = page.followersGained ?? 0
  const gainedClass = gained >= 0 ? 'text-primary' : 'text-red-600'
  const dailyLimit = page.dailyReelLimit ?? 6
  const postedToday = page.reelsPostedToday ?? 0
  const remaining = page.reelsRemainingToday ?? Math.max(0, dailyLimit - postedToday)

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/facebook/auto-download-upload/${page.id}`}
            className="truncate font-semibold hover:text-primary hover:underline"
          >
            {page.name}
          </Link>
          <p className="text-xs text-muted-foreground">{page.metaPageId}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AutomationStatusBadge status={page.status} healthStatus={page.healthStatus ?? 'completed'} />
          <button
            type="button"
            onClick={() => onDelete(page.id)}
            disabled={deleting}
            className="rounded-lg border border-border p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
            title="Remove page"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4">
        <div>
          <p className="text-xs text-muted-foreground">Followers</p>
          <p className="font-display text-lg font-bold">{page.followers}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Gained</p>
          <p className={`font-display text-lg font-bold ${gainedClass}`}>
            {gained >= 0 ? '+' : ''}
            {gained.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Daily reels</p>
          <p className="text-xs font-medium">
            {postedToday}/{dailyLimit} posted · {remaining} left
          </p>
        </div>
        {onDailyLimitChange ? (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Limit/day</label>
            <select
              value={dailyLimit}
              disabled={savingLimit}
              onChange={(e) => onDailyLimitChange(page.id, Number(e.target.value))}
              className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-50"
            >
              {[6, 8, 10, 12, 15, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {n} reels/day
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Started {page.reelsStarted.toLocaleString()} · Added {formatAddedDate(page.createdAt)} ·{' '}
        {formatDurationSince(page.createdAt)}
      </p>

      <div className="mt-3 space-y-2">
        {sources && sources.length > 0 && onAssignSource ? (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Source account</label>
            <select
              value={assignedSourceId ?? ''}
              onChange={(e) => onAssignSource(page.id, e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="">Select source...</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.username} ({s.platform})</option>
              ))}
            </select>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {page.sourceUsername ? (
              <>via <span className="font-medium text-foreground">{page.sourceUsername}</span></>
            ) : (
              'No source linked — add sources in Source Accounts tab'
            )}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          <Share2 className="h-3 w-3 text-primary" />
          Facebook Page
        </span>
        <Link
          to={`/facebook/auto-download-upload/${page.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open details
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}
