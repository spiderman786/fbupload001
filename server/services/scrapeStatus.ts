import { db } from '../db.js'
import { applyPageHealthFromError, inferHealthStatusFromError } from './pageHealth.js'
import { resolvePrefillPage, type PrefillSkipReason } from './reelQueue.js'
import { healSourceAssignment, relinkAssignmentsToSource } from './sourceAccounts.js'
import { userFacingDownloadError } from '../utils/downloadErrors.js'

export type ScrapeStatusKey =
  | 'none'
  | 'scraping_pending'
  | 'pending_scrap'
  | 'scraping_error'
  | 'idle'

export type PageScrapeInfo = {
  status: ScrapeStatusKey
  label: string
  totalScraped: number
  catalogTotal: number | null
  errorMessage: string | null
  inflightDownloads: number
}

const STATUS_LABELS: Record<ScrapeStatusKey, string> = {
  none: 'No source',
  scraping_pending: 'Scraping Pending',
  pending_scrap: 'Pending Scrap',
  scraping_error: 'Scraping Error',
  idle: 'Ready',
}

function countTotalScraped(pageId: string, sourceAccountId: string): number {
  const posted = (
    db
      .prepare('SELECT COUNT(*) as c FROM posted_reels WHERE page_id = ? AND source_account_id = ?')
      .get(pageId, sourceAccountId) as { c: number }
  ).c
  const queued = (
    db
      .prepare(`
        SELECT COUNT(*) as c FROM reel_jobs
        WHERE target_page_id = ? AND source_account_id = ? AND status = 'queued'
      `)
      .get(pageId, sourceAccountId) as { c: number }
  ).c
  const inflight = (
    db
      .prepare(`
        SELECT COUNT(*) as c FROM reel_jobs
        WHERE target_page_id = ? AND source_account_id = ?
          AND status IN ('pending', 'downloading') AND job_type = 'prefill'
      `)
      .get(pageId, sourceAccountId) as { c: number }
  ).c
  return posted + queued + inflight
}

function countInflightPrefill(pageId: string): number {
  return (
    db
      .prepare(`
        SELECT COUNT(*) as c FROM reel_jobs
        WHERE target_page_id = ? AND job_type = 'prefill'
          AND status IN ('pending', 'downloading')
      `)
      .get(pageId) as { c: number }
  ).c
}

export function getPageScrapeInfo(pageId: string, agencyId?: string): PageScrapeInfo | null {
  if (agencyId) {
    healSourceAssignment(pageId, agencyId)
  }
  maybeRecoverStaleScrapePending(pageId)

  const row = db
    .prepare(`
      SELECT a.source_account_id, a.scrape_status, a.scrape_error, a.catalog_total
      FROM page_source_assignments a
      WHERE a.page_id = ?
    `)
    .get(pageId) as
    | { source_account_id: string; scrape_status: string | null; scrape_error: string | null; catalog_total: number | null }
    | undefined

  if (!row) {
    return {
      status: 'none',
      label: STATUS_LABELS.none,
      totalScraped: 0,
      catalogTotal: null,
      errorMessage: null,
      inflightDownloads: 0,
    }
  }

  const inflight = countInflightPrefill(pageId)
  const totalScraped = countTotalScraped(pageId, row.source_account_id)
  const resolved = resolvePrefillPage(pageId, agencyId)

  if (!resolved.eligible) {
    return {
      status: 'scraping_error',
      label: STATUS_LABELS.scraping_error,
      totalScraped,
      catalogTotal: row.catalog_total != null ? Number(row.catalog_total) : null,
      errorMessage: resolved.message,
      inflightDownloads: inflight,
    }
  }

  if (row.scrape_error) {
    clearScrapeError(pageId)
  }

  let status: ScrapeStatusKey = 'idle'
  if (inflight > 0) {
    status = 'pending_scrap'
  } else if (row.scrape_status === 'scraping_pending') {
    status = 'scraping_pending'
  }

  return {
    status,
    label: STATUS_LABELS[status],
    totalScraped,
    catalogTotal: row.catalog_total != null ? Number(row.catalog_total) : null,
    errorMessage: null,
    inflightDownloads: inflight,
  }
}

export function markSourceScrapingPending(pageId: string) {
  db.prepare(`
    UPDATE page_source_assignments
    SET scrape_status = 'scraping_pending', scrape_error = NULL, source_assigned_at = datetime('now')
    WHERE page_id = ?
  `).run(pageId)
  db.prepare("UPDATE facebook_pages SET health_status = 'completed' WHERE id = ?").run(pageId)
}

export function clearScrapeError(pageId: string) {
  db.prepare(`
    UPDATE page_source_assignments SET scrape_status = 'idle', scrape_error = NULL WHERE page_id = ?
  `).run(pageId)
}

export function revivePagesForSource(sourceAccountId: string, agencyId: string) {
  const pages = db
    .prepare(`
      SELECT page_id FROM page_source_assignments
      WHERE source_account_id = ?
    `)
    .all(sourceAccountId) as { page_id: string }[]

  for (const { page_id: pageId } of pages) {
    clearScrapeError(pageId)
    markSourceScrapingPending(pageId)
    healSourceAssignment(pageId, agencyId)
    void import('./reelQueue.js').then(({ createPrefillJob, resolvePrefillPage }) => {
      void import('./jobQueue.js').then(({ enqueueJob }) => {
        const resolved = resolvePrefillPage(pageId, agencyId)
        if (!resolved.eligible) return
        enqueueJob(createPrefillJob(resolved.page.agency_id, resolved.page.user_id, pageId))
      })
    })
  }

  return pages.length
}

export async function retryPageScrape(pageId: string, agencyId: string) {
  const assignment = db
    .prepare('SELECT source_account_id FROM page_source_assignments WHERE page_id = ?')
    .get(pageId) as { source_account_id: string } | undefined
  if (!assignment) throw new Error('No source assigned to this page')

  healSourceAssignment(pageId, agencyId)
  const current = db
    .prepare('SELECT source_account_id FROM page_source_assignments WHERE page_id = ?')
    .get(pageId) as { source_account_id: string }
  const sourceId = current.source_account_id

  db.prepare(`
    UPDATE source_accounts SET is_active = 1, consecutive_failures = 0 WHERE id = ?
  `).run(sourceId)
  relinkAssignmentsToSource(sourceId, agencyId)
  clearScrapeError(pageId)
  markSourceScrapingPending(pageId)

  const { syncPagePrefillQueue } = await import('./prefillScheduler.js')
  return syncPagePrefillQueue(pageId, agencyId)
}

export function markScrapeIdle(pageId: string) {
  db.prepare(`
    UPDATE page_source_assignments SET scrape_status = 'idle' WHERE page_id = ?
  `).run(pageId)
}

function isInvalidUsernameError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('invalid username') ||
    lower.includes('user not found') ||
    lower.includes('does not exist') ||
    lower.includes('unable to extract') ||
    lower.includes('account not found') ||
    lower.includes('http error 404') ||
    lower.includes('username')
  )
}

function isSourceExhaustedError(message: string): boolean {
  return message.includes('No new reels found') || message.includes('already posted to this page')
}

export function handlePrefillDiscoveryFailure(pageId: string, sourceAccountId: string, message: string) {
  const source = db
    .prepare('SELECT platform FROM source_accounts WHERE id = ?')
    .get(sourceAccountId) as { platform: string } | undefined
  const friendly = userFacingDownloadError(message, source?.platform ?? '')

  applyPageHealthFromError(pageId, message, 'scrape')

  if (isInvalidUsernameError(message)) {
    db.prepare(`
      UPDATE page_source_assignments SET scrape_status = 'scraping_error', scrape_error = ? WHERE page_id = ?
    `).run(friendly.slice(0, 500), pageId)
    db.prepare("UPDATE facebook_pages SET health_status = 'invalid_username' WHERE id = ?").run(pageId)
    return
  }

  const scrapeHealth = inferHealthStatusFromError(message, 'scrape')
  if (scrapeHealth === 'creator_suspended') {
    db.prepare(`
      UPDATE page_source_assignments SET scrape_status = 'scraping_error', scrape_error = ? WHERE page_id = ?
    `).run(friendly.slice(0, 500), pageId)
    db.prepare("UPDATE facebook_pages SET health_status = 'creator_suspended' WHERE id = ?").run(pageId)
    return
  }

  if (isSourceExhaustedError(message)) {
    const queued = (
      db.prepare("SELECT COUNT(*) as c FROM reel_jobs WHERE target_page_id = ? AND status = 'queued'").get(pageId) as {
        c: number
      }
    ).c
    const inflight = countInflightPrefill(pageId)
    if (queued === 0 && inflight <= 1) {
      db.prepare(`
        UPDATE page_source_assignments SET scrape_status = 'idle', scrape_error = NULL WHERE page_id = ?
      `).run(pageId)
      db.prepare("UPDATE facebook_pages SET health_status = 'source_exhausted' WHERE id = ?").run(pageId)
    }
    return
  }

  db.prepare(`
    UPDATE page_source_assignments SET scrape_status = 'scraping_error', scrape_error = ? WHERE page_id = ?
  `).run(friendly.slice(0, 500), pageId)
}

export function handlePrefillSuccess(pageId: string) {
  db.prepare(`
    UPDATE page_source_assignments SET scrape_status = 'idle', scrape_error = NULL WHERE page_id = ?
  `).run(pageId)
}

const TRANSIENT_PREFILL_BLOCKS: PrefillSkipReason[] = ['source_inactive', 'page_paused', 'zero_target', 'no_source']

export function notePrefillBlocked(pageId: string, message: string, reason?: PrefillSkipReason) {
  if (reason && TRANSIENT_PREFILL_BLOCKS.includes(reason)) return
  db.prepare(`
    UPDATE page_source_assignments
    SET scrape_status = 'scraping_error', scrape_error = ?
    WHERE page_id = ?
  `).run(message.slice(0, 500), pageId)
}

const SCRAPE_PENDING_STALE_MS = Number(process.env.SCRAPE_PENDING_STALE_MS ?? 3 * 60 * 1000)

/** Retry or surface an error when scrape was marked pending but prefill never started. */
export function maybeRecoverStaleScrapePending(pageId: string) {
  const row = db
    .prepare(`
      SELECT scrape_status, scrape_error, source_assigned_at
      FROM page_source_assignments
      WHERE page_id = ?
    `)
    .get(pageId) as
    | { scrape_status: string | null; scrape_error: string | null; source_assigned_at: string | null }
    | undefined

  if (!row || row.scrape_status !== 'scraping_pending' || row.scrape_error) return
  if (countInflightPrefill(pageId) > 0) return

  const assignedAt = row.source_assigned_at ? Date.parse(row.source_assigned_at.replace(' ', 'T') + 'Z') : NaN
  const ageMs = Number.isFinite(assignedAt) ? Date.now() - assignedAt : SCRAPE_PENDING_STALE_MS + 1
  if (ageMs < SCRAPE_PENDING_STALE_MS) return

  const page = db.prepare('SELECT agency_id FROM facebook_pages WHERE id = ?').get(pageId) as
    | { agency_id: string }
    | undefined
  if (!page) return

  void import('./prefillScheduler.js').then(({ syncPagePrefillQueue }) =>
    syncPagePrefillQueue(pageId, page.agency_id).catch((err) =>
      console.warn('[scrape] stale recovery failed:', pageId, err instanceof Error ? err.message : err),
    ),
  )
}

export function reactivateSourceForRescrape(pageId: string) {
  db.prepare(`
    UPDATE page_source_assignments
    SET scrape_status = 'scraping_pending', scrape_error = NULL, source_assigned_at = datetime('now'), catalog_total = NULL
    WHERE page_id = ?
  `).run(pageId)
  db.prepare("UPDATE facebook_pages SET health_status = 'completed' WHERE id = ?").run(pageId)
  void import('./reelDiscovery.js').then(({ probeSourceCatalog }) =>
    probeSourceCatalog(pageId).catch((err) => console.warn('[catalog] probe failed:', err)),
  )
  void import('./prefillScheduler.js').then(async ({ syncPagePrefillQueue }) => {
    const row = db.prepare('SELECT agency_id FROM facebook_pages WHERE id = ?').get(pageId) as
      | { agency_id: string }
      | undefined
    if (row) await syncPagePrefillQueue(pageId, row.agency_id)
  })
}
