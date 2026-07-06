import { db } from '../db.js'
import { computeNextPublishAt } from './scheduleIndex.js'

export function backfillNextPublishAtIndex(): number {
  const rows = db
    .prepare('SELECT page_id, timezone, schedule_times FROM page_automation_settings WHERE next_publish_at IS NULL')
    .all() as { page_id: string; timezone: string; schedule_times: string }[]

  if (!rows.length) return 0

  const update = db.prepare('UPDATE page_automation_settings SET next_publish_at = ? WHERE page_id = ?')
  for (const row of rows) {
    update.run(computeNextPublishAt(row.timezone, row.schedule_times), row.page_id)
  }
  console.log(`[scheduler] Backfilled next_publish_at for ${rows.length} page(s)`)
  return rows.length
}
