import { db } from '../db.js'
import { createAutomationJob, type JobType } from './automationPipeline.js'
import { canPagePostToday } from './pageQuota.js'
import { enqueueJob } from './jobQueue.js'
import { claimQueuedJobForPublish, countQueuedForPage, pageHasInflightPublishJob } from './reelQueue.js'
import { dedupeQueuedJobsForPageSync } from './queueActions.js'
import { ensurePageAutomationSettings } from './pageAutomationSettings.js'
import { getTodayDateInTimezone, getCurrentTimeHHMM } from '../utils/timezone.js'

/** Atomically claim this page's schedule slot so multi-path schedulers cannot double-fire. */
export function tryClaimScheduleFire(pageId: string, fireKey: string): boolean {
  const result = db
    .prepare(`
      UPDATE page_automation_settings
      SET last_schedule_fire = ?
      WHERE page_id = ?
        AND (last_schedule_fire IS NULL OR last_schedule_fire != ?)
    `)
    .run(fireKey, pageId, fireKey)
  return result.changes > 0
}

export function buildScheduleFireKey(pageId: string, timezone: string): string {
  const tz = timezone || 'America/New_York'
  return `${pageId}:${getTodayDateInTimezone(tz)}:${getCurrentTimeHHMM(tz)}`
}

function pageHasAutomationSettings(pageId: string): boolean {
  return Boolean(
    db.prepare('SELECT page_id FROM page_automation_settings WHERE page_id = ?').get(pageId),
  )
}

/**
 * Single entry point for all scheduled publish triggers (legacy slots + per-page automation).
 * Guarantees at most one publish enqueue per page per local minute.
 */
export function requestPageScheduledPublish(
  agencyId: string,
  userId: string,
  pageId: string,
  jobType: JobType,
  options?: { fireKey?: string; skipFireClaim?: boolean },
): boolean {
  if (!canPagePostToday(pageId)) return false

  ensurePageAutomationSettings(pageId)

  const settings = db
    .prepare('SELECT timezone, last_schedule_fire FROM page_automation_settings WHERE page_id = ?')
    .get(pageId) as { timezone: string; last_schedule_fire: string | null } | undefined

  const fireKey = options?.fireKey ?? buildScheduleFireKey(pageId, settings?.timezone ?? 'America/New_York')

  if (!options?.skipFireClaim) {
    if (settings?.last_schedule_fire === fireKey) return false
    if (!tryClaimScheduleFire(pageId, fireKey)) return false
  }

  return Boolean(enqueuePagePublishJob(agencyId, userId, pageId, jobType))
}

/** Enqueue one publish for a page — used by direct-post and after fire claim. Returns job id when queued. */
export function enqueuePagePublishJob(
  agencyId: string,
  userId: string,
  pageId: string,
  jobType: JobType,
  scheduledFor?: string,
): string | null {
  if (!canPagePostToday(pageId)) return null

  const jobId = db.transaction(() => {
    if (pageHasInflightPublishJob(pageId)) return null

    dedupeQueuedJobsForPageSync(pageId, agencyId)

    const queuedJobId = claimQueuedJobForPublish(pageId, jobType)
    if (queuedJobId) return queuedJobId

    if (countQueuedForPage(pageId) > 0) return null
    if (pageHasInflightPublishJob(pageId)) return null

    return createAutomationJob(agencyId, userId, pageId, jobType, undefined, scheduledFor)
  })()

  if (!jobId) return null
  enqueueJob(jobId)
  return jobId
}

/** Legacy schedule_slots should not run when per-page automation settings own the schedule. */
export function shouldUseLegacyScheduleSlot(pageId: string): boolean {
  return !pageHasAutomationSettings(pageId)
}
