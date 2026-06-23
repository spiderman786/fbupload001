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

function claimNextJobId(): string | null {
  return db.transaction(() => {
    const publishing = db
      .prepare(`
        SELECT id FROM reel_jobs
        WHERE status = 'publishing'
        ORDER BY created_at ASC
        LIMIT 1
      `)
      .get() as { id: string } | undefined

    if (publishing) return publishing.id

    const pending = db
      .prepare(`
        SELECT id FROM reel_jobs
        WHERE status = 'pending'
          AND (scheduled_for IS NULL OR scheduled_for <= datetime('now'))
        ORDER BY
          CASE job_type WHEN 'direct' THEN 0 WHEN 'prefill' THEN 1 ELSE 2 END,
          created_at ASC
        LIMIT 1
      `)
      .get() as { id: string } | undefined

    if (!pending) return null

    const result = db
      .prepare(`UPDATE reel_jobs SET status = 'downloading' WHERE id = ? AND status = 'pending'`)
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
