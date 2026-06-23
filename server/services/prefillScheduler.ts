import cron from 'node-cron'
import { enqueueJob } from './jobQueue.js'
import { fillPagePrefillQueue, isPrefillEnabled, listActivePagesWithSource } from './reelQueue.js'

let prefilling = false

export function tickPrefillQueue() {
  if (!isPrefillEnabled() || prefilling) return
  prefilling = true
  try {
    let totalCreated = 0
    for (const page of listActivePagesWithSource()) {
      for (const jobId of fillPagePrefillQueue(page)) {
        enqueueJob(jobId)
        totalCreated++
      }
    }
    if (totalCreated > 0) {
      console.log(`[prefill] Queued ${totalCreated} pre-download job(s)`)
    }
  } finally {
    prefilling = false
  }
}

export function startPrefillScheduler() {
  if (!isPrefillEnabled()) {
    console.log('[prefill] Pre-download queue disabled (PREFILL_ENABLED=false)')
    return
  }

  const cronExpr = process.env.PREFILL_CRON ?? '*/3 * * * *'
  cron.schedule(cronExpr, tickPrefillQueue)

  setTimeout(() => {
    tickPrefillQueue()
    console.log('[prefill] Initial queue fill triggered')
  }, 15_000)

  console.log(`[prefill] Pre-download queue scheduler started (${cronExpr})`)
}
