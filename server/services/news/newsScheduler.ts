import cron from 'node-cron'
import { db } from '../../db.js'
import { getCurrentTimeHHMM } from '../../utils/timezone.js'
import { pollAllFeeds, publishNewsItem } from './newsPipeline.js'
import { parseJsonArray } from './types.js'

let polling = false
let publishing = false

function applyOffset(time: string, offsetMinutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h! * 60 + m! + offsetMinutes
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0')
  const mm = String(wrapped % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

async function runPublishCycle() {
  if (publishing) return
  publishing = true
  try {
    const settings = db
      .prepare(`
        SELECT pns.*, fp.meta_page_id
        FROM page_news_settings pns
        JOIN facebook_pages fp ON fp.id = pns.page_id
        WHERE pns.is_active = 1 AND pns.auto_publish = 1 AND fp.status = 'active'
      `)
      .all() as Record<string, unknown>[]

    for (const row of settings) {
      const tz = String(row.timezone ?? 'America/New_York')
      const offset = Number(row.schedule_offset_minutes ?? 0)
      const times = parseJsonArray(row.schedule_times as string, ['07:30', '10:00', '13:00', '16:00']).map((t) =>
        applyOffset(t, offset),
      )
      const now = getCurrentTimeHHMM(tz)
      if (!times.includes(now)) continue

      const pageId = String(row.page_id)
      const item = db
        .prepare(`
          SELECT id FROM news_items
          WHERE page_id = ? AND status = 'ready'
          ORDER BY created_at ASC
          LIMIT 1
        `)
        .get(pageId) as { id: string } | undefined

      if (!item) continue

      try {
        await publishNewsItem(item.id)
        console.log(`[news] Published item ${item.id} for page ${pageId}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Publish failed'
        db.prepare(`UPDATE news_items SET status = 'failed', error_message = ? WHERE id = ?`).run(msg, item.id)
        console.error(`[news] Publish failed ${item.id}:`, msg)
      }
    }
  } catch (err) {
    console.error('[news] Publish cycle error:', err)
  } finally {
    publishing = false
  }
}

async function runPollCycle() {
  if (polling) return
  polling = true
  try {
    const result = await pollAllFeeds()
    if (result.created > 0) {
      console.log(`[news] Polled ${result.feeds} feeds, created ${result.created} items`)
    }
  } catch (err) {
    console.error('[news] Poll cycle error:', err)
  } finally {
    polling = false
  }
}

export function startNewsScheduler() {
  const pollCron = process.env.NEWS_POLL_CRON ?? '*/15 * * * *'
  cron.schedule(pollCron, () => {
    void runPollCycle()
  })

  cron.schedule('* * * * *', () => {
    void runPublishCycle()
  })

  console.log(`[news] Scheduler started (poll: ${pollCron}, publish: every minute)`)
}
