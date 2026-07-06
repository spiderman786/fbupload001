import { db } from '../db.js'
import { getCurrentTimeHHMM, normalizeHHMM } from '../utils/timezone.js'
import { buildScheduleFireKey, requestPageScheduledPublish } from './pagePublishScheduler.js'

function parseScheduleTimes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
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
    const times = parseScheduleTimes(page.schedule_times).map(normalizeHHMM)
    if (!times.length) continue

    const currentTime = getCurrentTimeHHMM(tz)
    if (!times.includes(currentTime)) continue

    const fireKey = buildScheduleFireKey(page.id, tz)
    if (page.last_schedule_fire === fireKey) continue

    requestPageScheduledPublish(page.agency_id, page.user_id, page.id, 'scheduled', { fireKey })
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
