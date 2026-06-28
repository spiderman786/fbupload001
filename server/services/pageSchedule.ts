import { db } from '../db.js'
import { getCurrentTimeHHMM, getTodayDateInTimezone } from '../utils/timezone.js'
import { canPagePostToday } from './pageQuota.js'
import { claimQueuedJobForPublish, countQueuedForPage } from './reelQueue.js'
import { createAutomationJob } from './automationPipeline.js'
import { enqueueJob } from './jobQueue.js'
import { dedupeQueuedJobsForPageSync } from './queueActions.js'

function parseScheduleTimes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/** Atomically claim this page's schedule slot so multi-instance deploys cannot double-fire. */
function tryClaimScheduleFire(pageId: string, fireKey: string): boolean {
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

function pageHasInflightPublish(pageId: string): boolean {
  const inflight = db
    .prepare(`
      SELECT id FROM reel_jobs
      WHERE target_page_id = ? AND status IN ('pending', 'downloading', 'publishing')
      LIMIT 1
    `)
    .get(pageId)
  return Boolean(inflight)
}

function enqueueScheduledPublish(agencyId: string, userId: string, pageId: string) {
  if (!canPagePostToday(pageId)) return
  if (pageHasInflightPublish(pageId)) return

  dedupeQueuedJobsForPageSync(pageId, agencyId)

  const queuedJobId = claimQueuedJobForPublish(pageId, 'scheduled')
  if (queuedJobId) {
    enqueueJob(queuedJobId)
    return
  }

  // Queue may still have rows if another worker claimed the head item — never spawn a parallel pipeline job.
  if (countQueuedForPage(pageId) > 0) return

  const jobId = createAutomationJob(agencyId, userId, pageId, 'scheduled', undefined, new Date().toISOString())
  enqueueJob(jobId)
}

/** Publish from queue at each page's configured local schedule time. */
export function processPageAutomationSchedules() {
  const pages = db
    .prepare(`
      SELECT p.id, p.agency_id, p.user_id, pas.timezone, pas.schedule_times, pas.posting_logic, pas.last_schedule_fire
      FROM facebook_pages p
      INNER JOIN page_automation_settings pas ON pas.page_id = p.id
      INNER JOIN page_source_assignments a ON a.page_id = p.id
      WHERE p.status = 'active' AND p.health_status = 'completed'
    `)
    .all() as {
      id: string
      agency_id: string
      user_id: string
      timezone: string
      schedule_times: string
      posting_logic: string
      last_schedule_fire: string | null
    }[]

  for (const page of pages) {
    const tz = page.timezone || 'America/New_York'
    const times = parseScheduleTimes(page.schedule_times)
    if (!times.length) continue

    const currentTime = getCurrentTimeHHMM(tz)
    if (!times.includes(currentTime)) continue

    const fireKey = `${getTodayDateInTimezone(tz)}:${currentTime}`
    if (page.last_schedule_fire === fireKey) continue
    if (!tryClaimScheduleFire(page.id, fireKey)) continue

    enqueueScheduledPublish(page.agency_id, page.user_id, page.id)
  }
}

export function generateRandomScheduleTimes(count: number): string[] {
  const times = new Set<string>()
  const target = Math.max(1, Math.min(12, count))
  while (times.size < target) {
    const h = Math.floor(Math.random() * 24)
    const m = Math.floor(Math.random() * 60)
    times.add(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  return Array.from(times).sort()
}
