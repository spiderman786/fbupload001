import { db } from '../db.js'
import { runAutomationJob, failAutomationJob } from './automationPipeline.js'
import { touchWorkerHeartbeat } from './workerHeartbeat.js'

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 20)
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1000)

let activeCount = 0
let pollTimer: ReturnType<typeof setInterval> | null = null

export function getActiveJobCount() {
  return activeCount
}

const PAGE_PUBLISH_BUSY = `
  SELECT 1 FROM reel_jobs busy
  WHERE busy.target_page_id = j.target_page_id
    AND busy.id != j.id
    AND busy.status IN ('pending', 'downloading', 'publishing')
    AND busy.job_type != 'prefill'
    AND (busy.meta_post_id IS NULL OR busy.meta_post_id = '')
`

function claimNextJobId(): string | null {
  return db.transaction(() => {
    // Only one active publish worker per page — prevents draining the whole queue at once.
    const publishing = db
      .prepare(`
        SELECT j.id FROM reel_jobs j
        WHERE j.status = 'publishing'
          AND (j.meta_post_id IS NULL OR j.meta_post_id = '')
          AND NOT EXISTS (${PAGE_PUBLISH_BUSY})
        ORDER BY j.created_at ASC
        LIMIT 1
      `)
      .get() as { id: string } | undefined

    if (publishing) {
      const claimed = db
        .prepare(`
          UPDATE reel_jobs SET status = 'downloading'
          WHERE id = ? AND status = 'publishing' AND (meta_post_id IS NULL OR meta_post_id = '')
        `)
        .run(publishing.id)
      if (claimed.changes > 0) return publishing.id
    }

    const pending = db
      .prepare(`
        SELECT j.id FROM reel_jobs j
        WHERE j.status = 'pending'
          AND (j.meta_post_id IS NULL OR j.meta_post_id = '')
          AND (j.scheduled_for IS NULL OR j.scheduled_for <= datetime('now'))
          AND (
            j.job_type = 'prefill'
            OR NOT EXISTS (${PAGE_PUBLISH_BUSY})
          )
        ORDER BY
          CASE j.job_type WHEN 'direct' THEN 0 WHEN 'prefill' THEN 1 ELSE 2 END,
          j.created_at ASC
        LIMIT 1
      `)
      .get() as { id: string } | undefined

    if (!pending) return null

    const result = db
      .prepare(`
        UPDATE reel_jobs SET status = 'downloading'
        WHERE id = ? AND status = 'pending' AND (meta_post_id IS NULL OR meta_post_id = '')
      `)
      .run(pending.id)

    return result.changes > 0 ? pending.id : null
  })()
}

async function runJob(jobId: string) {
  activeCount++
  touchWorkerHeartbeat(activeCount)
  try {
    await runAutomationJob(jobId)
  } catch (err) {
    failAutomationJob(jobId, err instanceof Error ? err.message : 'Unknown error')
  } finally {
    activeCount--
    touchWorkerHeartbeat(activeCount)
  }
}

function pollQueue() {
  touchWorkerHeartbeat(activeCount)
  while (activeCount < CONCURRENCY) {
    const jobId = claimNextJobId()
    if (!jobId) break
    void runJob(jobId)
  }
}

export function enqueueJob(jobId: string) {
  pollQueue()
  return jobId
}

export function startJobQueue() {
  if (pollTimer) return
  pollTimer = setInterval(pollQueue, POLL_MS)
  pollQueue()
  touchWorkerHeartbeat(0)
  console.log(`[queue] Worker pool started (concurrency=${CONCURRENCY}, poll=${POLL_MS}ms)`)
}

export function stopJobQueue() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
