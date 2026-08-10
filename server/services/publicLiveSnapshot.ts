import { db } from '../db.js'

export type PublicLiveEvent = {
  id: string
  kind: 'published' | 'publishing' | 'queued' | 'failed'
  label: string
  at: string
}

export type PublicLiveSnapshot = {
  pagesSynced: number
  activeUsers: number
  followersGained: number
  totalViews: number
  publishedLastHour: number
  events: PublicLiveEvent[]
  serverTime: string
}

const CACHE_TTL_MS = 3000

let cached: { at: number; payload: PublicLiveSnapshot } | null = null

function eventKind(status: string): PublicLiveEvent['kind'] {
  if (status === 'published') return 'published'
  if (status === 'publishing' || status === 'downloading') return 'publishing'
  if (status === 'failed') return 'failed'
  return 'queued'
}

function eventLabel(kind: PublicLiveEvent['kind']): string {
  switch (kind) {
    case 'published':
      return 'Page published a reel'
    case 'publishing':
      return 'Page is publishing a reel'
    case 'failed':
      return 'Publish retry queued'
    default:
      return 'Page queued a reel'
  }
}

function buildSnapshot(): PublicLiveSnapshot {
  const pagesSynced = (db.prepare('SELECT COUNT(*) as c FROM facebook_pages').get() as { c: number }).c

  const activeUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c

  const followersGained = (
    db.prepare('SELECT COALESCE(SUM(followers_gained), 0) as total FROM facebook_pages').get() as {
      total: number
    }
  ).total

  const totalViews = (
    db.prepare('SELECT COALESCE(SUM(video_views_total), 0) as total FROM facebook_pages').get() as {
      total: number
    }
  ).total

  const publishedLastHour = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM reel_jobs
         WHERE status = 'published'
           AND completed_at >= datetime('now', '-1 hour')`,
      )
      .get() as { c: number }
  ).c

  const rows = db
    .prepare(
      `SELECT id, status, COALESCE(completed_at, created_at) as at
       FROM reel_jobs
       WHERE status IN ('published', 'publishing', 'downloading', 'queued', 'pending', 'failed')
       ORDER BY COALESCE(completed_at, created_at) DESC
       LIMIT 8`,
    )
    .all() as { id: string | number; status: string; at: string }[]

  const events: PublicLiveEvent[] = rows.map((row, index) => {
    const kind = eventKind(String(row.status))
    const at = String(row.at)
    return {
      id: `evt-${kind}-${at}-${index}`,
      kind,
      label: eventLabel(kind),
      at,
    }
  })

  return {
    pagesSynced,
    activeUsers,
    followersGained,
    totalViews,
    publishedLastHour,
    events,
    serverTime: new Date().toISOString(),
  }
}

export function getPublicLiveSnapshot(): PublicLiveSnapshot {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.payload
  }
  const payload = buildSnapshot()
  cached = { at: now, payload }
  return payload
}
