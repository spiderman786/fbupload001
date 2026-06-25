import { db } from '../db.js'
import { applyPageHealthFromError, inferHealthStatusFromError } from './pageHealth.js'

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

export function getPageScrapeInfo(pageId: string): PageScrapeInfo | null {
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
  let status: ScrapeStatusKey = 'idle'

  if (row.scrape_error) {
    status = 'scraping_error'
  } else if (inflight > 0) {
    status = 'pending_scrap'
  } else if (row.scrape_status === 'scraping_pending') {
    status = 'scraping_pending'
  } else {
    status = 'idle'
  }

  return {
    status,
    label: STATUS_LABELS[status],
    totalScraped,
    catalogTotal: row.catalog_total != null ? Number(row.catalog_total) : null,
    errorMessage: row.scrape_error,
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
  applyPageHealthFromError(pageId, message, 'scrape')

  if (isInvalidUsernameError(message)) {
    db.prepare(`
      UPDATE page_source_assignments SET scrape_status = 'scraping_error', scrape_error = ? WHERE page_id = ?
    `).run(message.slice(0, 500), pageId)
    db.prepare("UPDATE facebook_pages SET health_status = 'invalid_username' WHERE id = ?").run(pageId)
    return
  }

  const scrapeHealth = inferHealthStatusFromError(message, 'scrape')
  if (scrapeHealth === 'creator_suspended') {
    db.prepare(`
      UPDATE page_source_assignments SET scrape_status = 'scraping_error', scrape_error = ? WHERE page_id = ?
    `).run(message.slice(0, 500), pageId)
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
  }
}

export function handlePrefillSuccess(pageId: string) {
  db.prepare(`
    UPDATE page_source_assignments SET scrape_status = 'idle', scrape_error = NULL WHERE page_id = ?
  `).run(pageId)
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
  void import('./prefillScheduler.js').then(async ({ tickPrefillQueueForPage }) => {
    const row = db.prepare('SELECT agency_id FROM facebook_pages WHERE id = ?').get(pageId) as
      | { agency_id: string }
      | undefined
    if (row) tickPrefillQueueForPage(pageId, row.agency_id)
  })
}
