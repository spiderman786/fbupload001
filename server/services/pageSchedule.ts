import { db } from '../db.js'
import { getCurrentTimeHHMM, getTodayDateInTimezone } from '../utils/timezone.js'
import { canPagePostToday } from './pageQuota.js'
import { claimQueuedJobForPublish } from './reelQueue.js'
import { createAutomationJob } from './automationPipeline.js'
import { enqueueJob } from './jobQueue.js'

function parseScheduleTimes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function enqueueScheduledPublish(agencyId: string, userId: string, pageId: string) {
  if (!canPagePostToday(pageId)) return

  const inflight = db
    .prepare(`
      SELECT id FROM reel_jobs
      WHERE target_page_id = ? AND status IN ('pending', 'downloading', 'publishing')
      LIMIT 1
    `)
    .get(pageId)
  if (inflight) return

  const queuedJobId = claimQueuedJobForPublish(pageId, 'scheduled')
  if (queuedJobId) {
    enqueueJob(queuedJobId)
    return
  }

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

    enqueueScheduledPublish(page.agency_id, page.user_id, page.id)
    db.prepare('UPDATE page_automation_settings SET last_schedule_fire = ? WHERE page_id = ?').run(fireKey, page.id)
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
