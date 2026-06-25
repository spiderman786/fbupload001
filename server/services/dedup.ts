import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { isMockSourceUrl } from '../utils/reelIdentity.js'

const ACTIVE_JOB_STATUSES = "('pending', 'downloading', 'queued', 'publishing', 'failed')"

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

function isSourceUrlTakenOnPage(pageId: string, sourceUrl: string, excludeJobId?: string): boolean {
  if (isMockSourceUrl(sourceUrl)) return false

  const posted = db
    .prepare('SELECT id FROM posted_reels WHERE page_id = ? AND source_url = ? LIMIT 1')
    .get(pageId, sourceUrl)
  if (posted) return true

  const row = db
    .prepare(`
      SELECT id FROM reel_jobs
      WHERE target_page_id = ? AND source_url = ?
        AND status IN ${ACTIVE_JOB_STATUSES}
        AND (? IS NULL OR id != ?)
      LIMIT 1
    `)
    .get(pageId, sourceUrl, excludeJobId ?? null, excludeJobId ?? null)
  return Boolean(row)
}

/** True when this page already posted, skipped, queued, or is downloading this source reel. */
export function isReelConsumedByPage(
  pageId: string,
  sourceReelId: string,
  excludeJobId?: string,
  sourceUrl?: string | null,
): boolean {
  if (isReelAlreadyPosted(pageId, sourceReelId)) return true

  if (sourceUrl && isSourceUrlTakenOnPage(pageId, sourceUrl, excludeJobId)) return true

  const row = db
    .prepare(`
      SELECT id FROM reel_jobs
      WHERE target_page_id = ? AND source_reel_id = ?
        AND status IN ${ACTIVE_JOB_STATUSES}
        AND (? IS NULL OR id != ?)
      LIMIT 1
    `)
    .get(pageId, sourceReelId, excludeJobId ?? null, excludeJobId ?? null)
  return Boolean(row)
}

/** Atomically claim a reel id for a job so parallel prefills cannot pick the same video. */
export function tryReserveReelForJob(
  pageId: string,
  jobId: string,
  sourceReelId: string,
  sourceUrl?: string | null,
): boolean {
  return db.transaction(() => {
    if (isReelConsumedByPage(pageId, sourceReelId, jobId, sourceUrl)) return false
    const result = db
      .prepare(`
        UPDATE reel_jobs SET source_reel_id = ?, source_url = COALESCE(?, source_url)
        WHERE id = ? AND (source_reel_id IS NULL OR source_reel_id = ?)
      `)
      .run(sourceReelId, sourceUrl ?? null, jobId, sourceReelId)
    return result.changes > 0
  })()
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

/** Remember skipped reels so discovery moves to the next video on the source feed. */
export function recordSkippedReel(params: {
  agencyId: string
  pageId: string
  sourceAccountId: string | null
  sourceReelId: string
  sourceUrl?: string | null
  jobId: string
}) {
  if (!params.sourceAccountId) return
  db.prepare(`
    INSERT OR IGNORE INTO posted_reels (id, agency_id, page_id, source_account_id, source_reel_id, source_url, meta_post_id, job_id)
    VALUES (?, ?, ?, ?, ?, ?, 'skipped', ?)
  `).run(
    uuid(),
    params.agencyId,
    params.pageId,
    params.sourceAccountId,
    params.sourceReelId,
    params.sourceUrl ?? null,
    params.jobId,
  )
}

export function purgePostedReelsOlderThanDays(days: number) {
  db.prepare(`DELETE FROM posted_reels WHERE posted_at < datetime('now', ?)`).run(`-${days} days`)
}
