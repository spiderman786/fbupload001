import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { getPageAutomationSettings } from './pageAutomationSettings.js'
import { isSourceActiveFlag } from '../utils/sourceActive.js'
import { healSourceAssignment } from './sourceAccounts.js'

export type QueueJobType = 'direct' | 'inapp' | 'scheduled' | 'prefill'

export function maxQueuePerPage(): number {
  return Number(process.env.PREFILL_MAX_QUEUE_PER_PAGE ?? 50)
}

export function isPrefillEnabled(): boolean {
  return process.env.PREFILL_ENABLED !== 'false'
}

export function countQueuedForPage(pageId: string): number {
  return (
    db.prepare("SELECT COUNT(*) as c FROM reel_jobs WHERE target_page_id = ? AND status = 'queued'").get(pageId) as {
      c: number
    }
  ).c
}

export function countPrefillInflight(pageId: string): number {
  return (
    db
      .prepare(`
        SELECT COUNT(*) as c FROM reel_jobs
        WHERE target_page_id = ? AND job_type = 'prefill' AND status IN ('pending', 'downloading')
      `)
      .get(pageId) as { c: number }
  ).c
}

/** Queue target equals the page posts-per-day setting (each page maintains its own backlog). */
export function getPageQueueTarget(pageId: string): number {
  const page = db.prepare('SELECT daily_reel_limit FROM facebook_pages WHERE id = ?').get(pageId) as
    | { daily_reel_limit: number }
    | undefined
  if (!page) return 0

  const settings = getPageAutomationSettings(pageId)
  const dailyLimit = Number(page.daily_reel_limit ?? settings.postsPerDay)
  return Math.min(maxQueuePerPage(), Math.max(0, dailyLimit))
}

/** @deprecated use getPageQueueTarget */
export function getPrefillTarget(pageId: string): number {
  return getPageQueueTarget(pageId)
}

/** True when this page already has a publish pipeline in flight (prefill downloads excluded). */
export function pageHasInflightPublishJob(pageId: string): boolean {
  const inflight = db
    .prepare(`
      SELECT id FROM reel_jobs
      WHERE target_page_id = ?
        AND status IN ('pending', 'downloading', 'publishing')
        AND job_type != 'prefill'
      LIMIT 1
    `)
    .get(pageId)
  return Boolean(inflight)
}

/** Atomically move oldest queued reel to publishing and return its job id. */
export function claimQueuedJobForPublish(pageId: string, jobType: QueueJobType): string | null {
  return db.transaction(() => {
    if (pageHasInflightPublishJob(pageId)) return null

    for (let attempt = 0; attempt < 20; attempt++) {
      const row = db
        .prepare(`
          SELECT id FROM reel_jobs
          WHERE target_page_id = ? AND status = 'queued'
          ORDER BY created_at ASC
          LIMIT 1
        `)
        .get(pageId) as { id: string } | undefined

      if (!row) return null

      if (pageHasInflightPublishJob(pageId)) return null

      const result = db
        .prepare(`
          UPDATE reel_jobs SET status = 'publishing', job_type = ?
          WHERE id = ? AND status = 'queued'
        `)
        .run(jobType, row.id)

      if (result.changes > 0) return row.id
    }
    return null
  })()
}

export function createPrefillJob(agencyId: string, userId: string, pageId: string): string {
  const id = uuid()
  const assignment = db
    .prepare('SELECT source_account_id FROM page_source_assignments WHERE page_id = ?')
    .get(pageId) as { source_account_id: string } | undefined

  db.prepare(`
    INSERT INTO reel_jobs (id, user_id, agency_id, source_account_id, target_page_id, status, job_type)
    VALUES (?, ?, ?, ?, ?, 'pending', 'prefill')
  `).run(id, userId, agencyId, assignment?.source_account_id ?? null, pageId)

  return id
}

export function fillPagePrefillQueue(page: {
  id: string
  agency_id: string
  user_id: string
}): string[] {
  if (!isPrefillEnabled()) return []

  const target = getPageQueueTarget(page.id)
  const current = countQueuedForPage(page.id) + countPrefillInflight(page.id)
  const need = Math.max(0, target - current)
  const created: string[] = []

  for (let i = 0; i < need; i++) {
    created.push(createPrefillJob(page.agency_id, page.user_id, page.id))
  }

  return created
}

export function listActivePagesWithSource() {
  return db
    .prepare(`
      SELECT p.id, p.agency_id, p.user_id
      FROM facebook_pages p
      INNER JOIN page_source_assignments a ON a.page_id = p.id
      INNER JOIN source_accounts s ON s.id = a.source_account_id AND s.is_active = 1
      WHERE p.status = 'active' AND p.health_status = 'completed'
    `)
    .all() as { id: string; agency_id: string; user_id: string }[]
}

export type PrefillSkipReason =
  | 'no_source'
  | 'page_paused'
  | 'source_inactive'
  | 'health_blocked'
  | 'zero_target'

export function resolvePrefillPage(pageId: string, agencyId?: string):
  | { eligible: true; page: { id: string; agency_id: string; user_id: string } }
  | { eligible: false; reason: PrefillSkipReason; message: string } {
  if (agencyId) {
    healSourceAssignment(pageId, agencyId)
  }

  const row = db
    .prepare(`
      SELECT p.id, p.agency_id, p.user_id, p.status, p.health_status, s.is_active as source_active, s.username as source_username
      FROM facebook_pages p
      LEFT JOIN page_source_assignments a ON a.page_id = p.id
      LEFT JOIN source_accounts s ON s.id = a.source_account_id
      WHERE p.id = ?
    `)
    .get(pageId) as
    | {
        id: string
        agency_id: string
        user_id: string
        status: string
        health_status: string
        source_active: number | null
        source_username: string | null
      }
    | undefined

  if (!row?.id || row.source_active == null) {
    return { eligible: false, reason: 'no_source', message: 'No source assigned — assign a creator to start scraping' }
  }
  if (row.status !== 'active') {
    return {
      eligible: false,
      reason: 'page_paused',
      message: 'Page automation is paused — turn automation on to download reels',
    }
  }
  if (!isSourceActiveFlag(row.source_active)) {
    const handle = row.source_username?.replace(/^@/, '') ?? 'creator'
    return {
      eligible: false,
      reason: 'source_inactive',
      message: `Source @${handle} is disabled — click Enable under Source Accounts, then refresh this page`,
    }
  }
  if (row.health_status !== 'completed') {
    return {
      eligible: false,
      reason: 'health_blocked',
      message: `Page needs attention (${row.health_status}) before scraping can continue`,
    }
  }

  const target = getPageQueueTarget(pageId)
  if (target <= 0) {
    return {
      eligible: false,
      reason: 'zero_target',
      message: 'Posts per day is set to 0 — increase it in Settings to fill the download queue',
    }
  }

  return { eligible: true, page: { id: row.id, agency_id: row.agency_id, user_id: row.user_id } }
}
