import cron from 'node-cron'
import { db } from '../db.js'
import { createAutomationJob } from './automationPipeline.js'
import { canPagePostToday } from './pageQuota.js'
import { enqueueJob } from './jobQueue.js'
import { syncAllUsersFollowers } from './followerSync.js'
import { resetAllDailyQuotas } from './pageQuota.js'
import { runMaintenance } from './cleanup.js'
import { DEFAULT_SCHEDULE_TIMEZONE, getCurrentTimeHHMM } from '../utils/timezone.js'

let scheduling = false

function enqueuePageJob(
  agencyId: string,
  userId: string,
  pageId: string,
  jobType: 'direct' | 'inapp' | 'scheduled',
  scheduledFor?: string,
) {
  if (!canPagePostToday(pageId)) return

  const pending = db
    .prepare(`
      SELECT id FROM reel_jobs
      WHERE target_page_id = ? AND status IN ('pending', 'downloading', 'publishing')
      LIMIT 1
    `)
    .get(pageId)

  if (pending) return

  const jobId = createAutomationJob(agencyId, userId, pageId, jobType, undefined, scheduledFor)
  enqueueJob(jobId)
}

function processScheduledSlots(mode: 'direct' | 'inapp') {
  const now = new Date()
  const slots = db
    .prepare("SELECT * FROM schedule_slots WHERE status = 'upcoming' AND publish_mode = ?")
    .all(mode) as Record<string, unknown>[]

  for (const slot of slots) {
    const tz = (slot.timezone as string) || DEFAULT_SCHEDULE_TIMEZONE
    const currentTime = getCurrentTimeHHMM(tz)
    if (slot.time !== currentTime) continue
    const pageIds = (
      db.prepare('SELECT page_id FROM schedule_slot_pages WHERE slot_id = ?').all(slot.id as string) as {
        page_id: string
      }[]
    ).map((r) => r.page_id)

    const activePages = db
      .prepare(`
        SELECT id FROM facebook_pages
        WHERE agency_id = ? AND status = 'active' AND health_status = 'completed'
      `)
      .all(slot.agency_id as string) as { id: string }[]

    const targets = pageIds.length ? activePages.filter((p) => pageIds.includes(p.id)) : activePages

    for (const page of targets) {
      enqueuePageJob(
        slot.agency_id as string,
        slot.user_id as string,
        page.id,
        mode === 'inapp' ? 'inapp' : 'scheduled',
        now.toISOString(),
      )
    }

    db.prepare("UPDATE schedule_slots SET status = 'completed', last_run_at = datetime('now') WHERE id = ?").run(slot.id)
    setTimeout(() => {
      db.prepare("UPDATE schedule_slots SET status = 'upcoming' WHERE id = ?").run(slot.id)
    }, 60_000)
  }
}

function tickScheduler() {
  if (scheduling) return
  scheduling = true
  try {
    processScheduledSlots('direct')
    processScheduledSlots('inapp')
  } finally {
    scheduling = false
  }
}

export function startScheduler() {
  cron.schedule('* * * * *', tickScheduler)

  cron.schedule(
    '0 0 * * *',
    () => {
      resetAllDailyQuotas()
      console.log(`[scheduler] Daily reel quotas reset (${DEFAULT_SCHEDULE_TIMEZONE})`)
    },
    { timezone: DEFAULT_SCHEDULE_TIMEZONE },
  )

  cron.schedule('0 */6 * * *', () => {
    syncAllUsersFollowers()
      .then(() => console.log('[scheduler] Follower counts synced'))
      .catch((err) => console.error('[scheduler] Follower sync failed', err))
  })

  cron.schedule('0 3 * * *', () => {
    runMaintenance()
  })

  console.log('[scheduler] Slot scheduler + daily reset + cleanup crons started')
}
