import cron from 'node-cron'
import { enqueueJob } from './jobQueue.js'
import {
  countPrefillInflight,
  countQueuedForPage,
  fillPagePrefillQueue,
  getPageQueueTarget,
  isPrefillEnabled,
  listActivePagesWithSource,
  resolvePrefillPage,
  type PrefillSkipReason,
} from './reelQueue.js'
import { trimPageQueueToLimit } from './queueActions.js'
import { clearScrapeError, markScrapeIdle, notePrefillBlocked } from './scrapeStatus.js'

let prefilling = false

export type PrefillSyncResult = {
  trimmed: number
  created: number
  target: number
  skipped?: PrefillSkipReason | 'prefill_disabled'
}

/** Trim or fill the download queue so it matches the page posts-per-day setting. */
export async function syncPagePrefillQueue(pageId: string, agencyId: string): Promise<PrefillSyncResult> {
  if (!isPrefillEnabled()) return { trimmed: 0, created: 0, target: 0, skipped: 'prefill_disabled' }

  const target = getPageQueueTarget(pageId)
  const trimmed = await trimPageQueueToLimit(pageId, agencyId, target)

  const resolved = resolvePrefillPage(pageId, agencyId)
  if (resolved.eligible === false) {
    notePrefillBlocked(pageId, resolved.message, resolved.reason)
    return { trimmed, created: 0, target, skipped: resolved.reason }
  }

  clearScrapeError(pageId)

  let created = 0
  for (const jobId of fillPagePrefillQueue(resolved.page)) {
    enqueueJob(jobId)
    created++
  }

  if (created > 0) {
    console.log(`[prefill] Page ${pageId}: target=${target}, trimmed=${trimmed}, queued=${created} new download(s)`)
  } else if (
    target > 0 &&
    countQueuedForPage(pageId) === 0 &&
    countPrefillInflight(pageId) === 0
  ) {
    markScrapeIdle(pageId)
  } else if (trimmed > 0) {
    console.log(`[prefill] Page ${pageId}: target=${target}, trimmed=${trimmed}`)
  }

  return { trimmed, created, target }
}

export async function tickPrefillQueueForPage(pageId: string, agencyId?: string) {
  if (!isPrefillEnabled()) return { trimmed: 0, created: 0, target: 0, skipped: 'prefill_disabled' as const }

  const resolved = resolvePrefillPage(pageId, agencyId ?? undefined)
  if (!resolved.eligible) {
    return syncPagePrefillQueue(pageId, agencyId ?? '')
  }

  return syncPagePrefillQueue(pageId, agencyId ?? resolved.page.agency_id)
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
