import { db, getDatabaseKind } from '../db.js'
import { runAutomationJob, failAutomationJob } from './automationPipeline.js'
import { touchWorkerHeartbeat } from './workerHeartbeat.js'
import { reclaimStuckJobs } from './stuckJobReclaim.js'
import { resolveWorkerConcurrency, resolveWorkerPollMs } from '../utils/workerRuntime.js'

const CONCURRENCY = resolveWorkerConcurrency()
const POLL_MS = resolveWorkerPollMs()

let activeCount = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
let reclaimTimer: ReturnType<typeof setInterval> | null = null

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

const JOB_ORDER = `
  ORDER BY
    CASE j.job_type WHEN 'direct' THEN 0 WHEN 'prefill' THEN 1 ELSE 2 END,
    j.created_at ASC
`

function claimNextJobIdSqlite(): string | null {
  return db.transaction(() => {
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
          UPDATE reel_jobs
          SET status = 'downloading', claimed_at = datetime('now')
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
        ${JOB_ORDER}
        LIMIT 1
      `)
      .get() as { id: string } | undefined

    if (!pending) return null

    const result = db
      .prepare(`
        UPDATE reel_jobs
        SET status = 'downloading', claimed_at = datetime('now')
        WHERE id = ? AND status = 'pending' AND (meta_post_id IS NULL OR meta_post_id = '')
      `)
      .run(pending.id)

    return result.changes > 0 ? pending.id : null
  })()
}

/** Postgres: row-lock candidate jobs so multi-replica workers cannot double-claim the same page. */
function claimNextJobIdPostgres(): string | null {
  return db.transaction(() => {
    const publishing = db
      .prepare(`
        WITH candidate AS (
          SELECT j.id FROM reel_jobs j
          WHERE j.status = 'publishing'
            AND (j.meta_post_id IS NULL OR j.meta_post_id = '')
            AND NOT EXISTS (${PAGE_PUBLISH_BUSY})
          ORDER BY j.created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE reel_jobs
        SET status = 'downloading', claimed_at = datetime('now')
        WHERE id IN (SELECT id FROM candidate)
        RETURNING id
      `)
      .get() as { id: string } | undefined

    if (publishing?.id) return publishing.id

    const pending = db
      .prepare(`
        WITH candidate AS (
          SELECT j.id FROM reel_jobs j
          WHERE j.status = 'pending'
            AND (j.meta_post_id IS NULL OR j.meta_post_id = '')
            AND (j.scheduled_for IS NULL OR j.scheduled_for <= datetime('now'))
            AND (
              j.job_type = 'prefill'
              OR NOT EXISTS (${PAGE_PUBLISH_BUSY})
            )
          ${JOB_ORDER}
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE reel_jobs
        SET status = 'downloading', claimed_at = datetime('now')
        WHERE id IN (SELECT id FROM candidate)
        RETURNING id
      `)
      .get() as { id: string } | undefined

    return pending?.id ?? null
  })()
}

function claimNextJobId(): string | null {
  return getDatabaseKind() === 'postgres' ? claimNextJobIdPostgres() : claimNextJobIdSqlite()
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
  reclaimTimer = setInterval(reclaimStuckJobs, 5 * 60 * 1000)
  reclaimStuckJobs()
  pollQueue()
  touchWorkerHeartbeat(0)
  console.log(`[queue] Worker pool started (concurrency=${CONCURRENCY}, poll=${POLL_MS}ms)`)
}

export function stopJobQueue() {
  if (pollTimer) clearInterval(pollTimer)
  if (reclaimTimer) clearInterval(reclaimTimer)
  pollTimer = null
  reclaimTimer = null
}
