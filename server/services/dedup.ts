import { v4 as uuid } from 'uuid'
import { db } from '../db.js'

export function isReelAlreadyPosted(pageId: string, sourceReelId: string): boolean {
  const row = db
    .prepare('SELECT id FROM posted_reels WHERE page_id = ? AND source_reel_id = ?')
    .get(pageId, sourceReelId)
  return Boolean(row)
}

export function isReelPostedForSource(sourceAccountId: string, sourceReelId: string): boolean {
  const row = db
    .prepare('SELECT id FROM posted_reels WHERE source_account_id = ? AND source_reel_id = ? LIMIT 1')
    .get(sourceAccountId, sourceReelId)
  return Boolean(row)
}

export function recordPostedReel(params: {
  agencyId: string
  pageId: string
  sourceAccountId: string
  sourceReelId: string
  sourceUrl: string
  metaPostId: string
  jobId: string
}) {
  db.prepare(`
    INSERT OR IGNORE INTO posted_reels (id, agency_id, page_id, source_account_id, source_reel_id, source_url, meta_post_id, job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuid(),
    params.agencyId,
    params.pageId,
    params.sourceAccountId,
    params.sourceReelId,
    params.sourceUrl,
    params.metaPostId,
    params.jobId,
  )
}

export function purgePostedReelsOlderThanDays(days: number) {
  db.prepare(`DELETE FROM posted_reels WHERE posted_at < datetime('now', ?)`).run(`-${days} days`)
}
