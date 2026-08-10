import { db } from '../db.js'

const DEFAULT_STUCK_MINUTES = Number(process.env.WORKER_STUCK_JOB_MINUTES ?? 45)

/** Reset jobs left in downloading/publishing after a worker crash so pages are not blocked forever. */
export function reclaimStuckJobs(stuckMinutes = DEFAULT_STUCK_MINUTES): number {
  const result = db
    .prepare(`
      UPDATE reel_jobs
      SET status = 'pending',
          error_message = COALESCE(error_message, 'Reclaimed after worker timeout')
      WHERE status IN ('downloading', 'publishing')
        AND (meta_post_id IS NULL OR meta_post_id = '')
        AND COALESCE(claimed_at, created_at) < datetime('now', ?)
    `)
    .run(`-${stuckMinutes} minutes`)

  if (result.changes > 0) {
    console.log(`[queue] Reclaimed ${result.changes} stuck job(s) older than ${stuckMinutes}m`)
  }
  return result.changes
}
