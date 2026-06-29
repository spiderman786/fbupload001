import cron from 'node-cron'
import { db } from '../db.js'
import { createAutomationJob } from './automationPipeline.js'
import { canPagePostToday } from './pageQuota.js'
import { enqueueJob } from './jobQueue.js'
import { claimQueuedJobForPublish, countQueuedForPage, pageHasInflightPublishJob } from './reelQueue.js'
import { dedupeQueuedJobsForPageSync } from './queueActions.js'
import { syncAllUsersFollowers } from './followerSync.js'
import { resetAllDailyQuotas } from './pageQuota.js'
import { runMaintenance } from './cleanup.js'
import { processPageAutomationSchedules } from './pageSchedule.js'
import { DEFAULT_SCHEDULE_TIMEZONE, getCurrentTimeHHMM, normalizeHHMM } from '../utils/timezone.js'
import { tickTimezoneQuotaResets } from '../utils/pageDayStats.js'
import { SCHEDULER_PAGES_BATCH_SIZE } from '../utils/pagination.js'

const scheduleOffsets = new Map<string, number>()

let scheduling = false

function enqueuePageJob(
  agencyId: string,
  userId: string,
  pageId: string,
  jobType: 'direct' | 'inapp' | 'scheduled',
  scheduledFor?: string,
) {
  if (!canPagePostToday(pageId)) return
  if (pageHasInflightPublishJob(pageId)) return

  dedupeQueuedJobsForPageSync(pageId, agencyId)

  const queuedJobId = claimQueuedJobForPublish(pageId, jobType)
  if (queuedJobId) {
    enqueueJob(queuedJobId)
    return
  }

  if (countQueuedForPage(pageId) > 0) return

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
    if (normalizeHHMM(slot.time as string) !== currentTime) continue

    const claimed = db
      .prepare(`
        UPDATE schedule_slots
        SET status = 'completed', last_run_at = datetime('now')
        WHERE id = ? AND status = 'upcoming'
      `)
      .run(slot.id as string)
    if (claimed.changes === 0) continue

    const pageIds = (
      db.prepare('SELECT page_id FROM schedule_slot_pages WHERE slot_id = ?').all(slot.id as string) as {
        page_id: string
      }[]
    ).map((r) => r.page_id)

    const activePages = db
      .prepare(`
        SELECT id FROM facebook_pages
        WHERE agency_id = ? AND status = 'active' AND health_status = 'completed'
        ORDER BY id
        LIMIT ? OFFSET ?
      `)
      .all(slot.agency_id as string, SCHEDULER_PAGES_BATCH_SIZE, scheduleOffsets.get(slot.agency_id as string) ?? 0) as {
        id: string
      }[]

    const agencyKey = slot.agency_id as string
    const totalActive = db
      .prepare(`
        SELECT COUNT(*) as count FROM facebook_pages
        WHERE agency_id = ? AND status = 'active' AND health_status = 'completed'
      `)
      .get(agencyKey) as { count: number }
    const nextOffset = (scheduleOffsets.get(agencyKey) ?? 0) + SCHEDULER_PAGES_BATCH_SIZE
    scheduleOffsets.set(agencyKey, nextOffset >= totalActive.count ? 0 : nextOffset)

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

    setTimeout(() => {
      db.prepare("UPDATE schedule_slots SET status = 'upcoming' WHERE id = ?").run(slot.id)
    }, 60_000)
  }
}

function tickScheduler() {
  if (scheduling) return
  scheduling = true
  try {
    tickTimezoneQuotaResets()
    processScheduledSlots('direct')
    processScheduledSlots('inapp')
    processPageAutomationSchedules()
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
