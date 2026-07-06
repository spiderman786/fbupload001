import { db } from '../db.js'
import { getCurrentTimeHHMM, normalizeHHMM } from '../utils/timezone.js'
import { buildScheduleFireKey, requestPageScheduledPublish } from './pagePublishScheduler.js'
import {
  computeNextPublishAfterFire,
  scheduleTimesDueNow,
  utcNowText,
} from './scheduleIndex.js'

const DUE_PAGES_LIMIT = Number(process.env.SCHEDULER_DUE_PAGES_LIMIT ?? 2500)

function parseScheduleTimes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).map(normalizeHHMM) : []
  } catch {
    return []
  }
}

export function refreshPageNextPublishAt(pageId: string) {
  const row = db
    .prepare('SELECT timezone, schedule_times FROM page_automation_settings WHERE page_id = ?')
    .get(pageId) as { timezone: string; schedule_times: string } | undefined
  if (!row) return
  const next = computeNextPublishAfterFire(row.timezone, row.schedule_times, new Date())
  db.prepare('UPDATE page_automation_settings SET next_publish_at = ? WHERE page_id = ?').run(next, pageId)
}

/** Publish from queue at each page's configured local schedule time (indexed for 10k+ pages). */
export function processPageAutomationSchedules() {
  const now = utcNowText()
  const pages = db
    .prepare(`
      SELECT p.id, p.agency_id, p.user_id, pas.timezone, pas.schedule_times, pas.posting_logic, pas.last_schedule_fire
      FROM facebook_pages p
      INNER JOIN page_automation_settings pas ON pas.page_id = p.id
      INNER JOIN page_source_assignments a ON a.page_id = p.id
      WHERE p.status = 'active' AND p.health_status = 'completed'
        AND (pas.next_publish_at IS NULL OR pas.next_publish_at <= ?)
      ORDER BY (pas.next_publish_at IS NULL) DESC, pas.next_publish_at ASC
      LIMIT ?
    `)
    .all(now, DUE_PAGES_LIMIT) as {
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

    const dueNow = scheduleTimesDueNow(tz, page.schedule_times)
    if (!dueNow) continue

    const currentTime = getCurrentTimeHHMM(tz)
    if (!times.includes(currentTime)) continue

    const fireKey = buildScheduleFireKey(page.id, tz)
    if (page.last_schedule_fire === fireKey) continue

    const fired = requestPageScheduledPublish(page.agency_id, page.user_id, page.id, 'scheduled', { fireKey })
    if (fired) {
      const next = computeNextPublishAfterFire(tz, page.schedule_times, new Date())
      db.prepare('UPDATE page_automation_settings SET next_publish_at = ? WHERE page_id = ?').run(next, page.id)
    }
  }
}

export { generateRandomScheduleTimes } from './pageScheduleRandom.js'
