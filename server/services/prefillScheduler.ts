import cron from 'node-cron'
import { enqueueJob } from './jobQueue.js'
import { fillPagePrefillQueue, getPageQueueTarget, isPrefillEnabled, listActivePagesWithSource } from './reelQueue.js'
import { trimPageQueueToLimit } from './queueActions.js'

let prefilling = false

/** Trim or fill the download queue so it matches the page posts-per-day setting. */
export async function syncPagePrefillQueue(pageId: string, agencyId: string) {
  if (!isPrefillEnabled()) return { trimmed: 0, created: 0, target: 0 }

  const target = getPageQueueTarget(pageId)
  const trimmed = await trimPageQueueToLimit(pageId, agencyId, target)

  const page = listActivePagesWithSource().find((p) => p.id === pageId)
  if (!page) return { trimmed, created: 0, target }

  let created = 0
  for (const jobId of fillPagePrefillQueue(page)) {
    enqueueJob(jobId)
    created++
  }

  if (trimmed > 0 || created > 0) {
    console.log(`[prefill] Page ${pageId}: target=${target}, trimmed=${trimmed}, queued=${created} new download(s)`)
  }

  return { trimmed, created, target }
}

export function tickPrefillQueueForPage(pageId: string, agencyId?: string) {
  if (!isPrefillEnabled()) return 0

  const page = listActivePagesWithSource().find((p) => p.id === pageId)
  if (!page) return 0

  void syncPagePrefillQueue(pageId, agencyId ?? page.agency_id).catch((err) =>
    console.warn('[prefill] sync failed:', pageId, err instanceof Error ? err.message : err),
  )
  return 0
}

export function tickPrefillQueue() {
  if (!isPrefillEnabled() || prefilling) return
  prefilling = true
  void (async () => {
    try {
      for (const page of listActivePagesWithSource()) {
        await syncPagePrefillQueue(page.id, page.agency_id)
      }
    } catch (err) {
      console.warn('[prefill] tick failed:', err instanceof Error ? err.message : err)
    } finally {
      prefilling = false
    }
  })()
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
