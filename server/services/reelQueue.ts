import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { getPageAutomationSettings } from './pageAutomationSettings.js'
import { getPageQuota } from './pageQuota.js'

export type QueueJobType = 'direct' | 'inapp' | 'scheduled' | 'prefill'

export function maxQueuePerPage(): number {
  return Number(process.env.PREFILL_MAX_QUEUE_PER_PAGE ?? 50)
}

export function initialPrefillBurst(): number {
  return Number(process.env.PREFILL_INITIAL_BURST ?? 12)
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

export function getPrefillTarget(pageId: string): number {
  const page = db.prepare('SELECT daily_reel_limit FROM facebook_pages WHERE id = ?').get(pageId) as
    | { daily_reel_limit: number }
    | undefined
  if (!page) return 0

  const settings = getPageAutomationSettings(pageId)
  const dailyLimit = Number(page.daily_reel_limit ?? settings.postsPerDay)
  const { remaining: remainingToday } = getPageQuota(pageId)

  // Keep today's remaining slots plus one full day buffer (Pro-style backlog).
  return Math.min(maxQueuePerPage(), remainingToday + dailyLimit)
}

/** Atomically move oldest queued reel to publishing and return its job id. */
export function claimQueuedJobForPublish(pageId: string, jobType: QueueJobType): string | null {
  return db.transaction(() => {
    const row = db
      .prepare(`
        SELECT id FROM reel_jobs
        WHERE target_page_id = ? AND status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      `)
      .get(pageId) as { id: string } | undefined

    if (!row) return null

    const result = db
      .prepare(`
        UPDATE reel_jobs SET status = 'publishing', job_type = ?
        WHERE id = ? AND status = 'queued'
      `)
      .run(jobType, row.id)

    return result.changes > 0 ? row.id : null
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

export function fillPagePrefillQueue(
  page: {
    id: string
    agency_id: string
    user_id: string
  },
  options?: { burst?: boolean },
): string[] {
  if (!isPrefillEnabled()) return []

  let target = getPrefillTarget(page.id)
  if (options?.burst) {
    target = Math.min(maxQueuePerPage(), Math.max(target, initialPrefillBurst()))
  }

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
