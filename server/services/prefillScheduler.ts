import cron from 'node-cron'
import { enqueueJob } from './jobQueue.js'
import {
  countActivePagesWithSource,
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
import { PREFILL_PAGES_BATCH_SIZE } from '../utils/pagination.js'

let prefilling = false
let prefillOffset = 0

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
      const total = countActivePagesWithSource()
      if (total === 0) return

      const batchSize = Math.max(50, PREFILL_PAGES_BATCH_SIZE)
      const startOffset = prefillOffset
      const pages = listActivePagesWithSource({ limit: batchSize, offset: prefillOffset })
      if (!pages.length) {
        prefillOffset = 0
        return
      }

      let created = 0
      for (const page of pages) {
        const result = await syncPagePrefillQueue(page.id, page.agency_id)
        created += result.created
      }

      prefillOffset += pages.length
      if (prefillOffset >= total) prefillOffset = 0

      if (created > 0) {
        console.log(
          `[prefill] Batch offset=${startOffset}/${total} size=${pages.length} new_downloads=${created}`,
        )
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

  console.log(
    `[prefill] Pre-download queue scheduler started (${cronExpr}, batch=${PREFILL_PAGES_BATCH_SIZE})`,
  )
}
