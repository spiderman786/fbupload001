import { db } from '../db.js'
import { getPageAutomationSettings } from '../services/pageAutomationSettings.js'
import { DEFAULT_SCHEDULE_TIMEZONE, getCurrentTimeHHMM, getTodayDateInTimezone } from './timezone.js'

export function getPageTimezone(pageId: string): string {
  return getPageAutomationSettings(pageId).timezone || DEFAULT_SCHEDULE_TIMEZONE
}

export function formatDateInTimezone(iso: string | null, timezone: string): string | null {
  if (!iso) return null
  const normalized = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(normalized))
}

export function isTimestampTodayInTimezone(iso: string | null, timezone: string): boolean {
  if (!iso) return false
  return formatDateInTimezone(iso, timezone) === getTodayDateInTimezone(timezone)
}

export function countPageJobsToday(
  pageId: string,
  timezone: string,
  status: 'published' | 'failed' | 'queued',
): number {
  const today = getTodayDateInTimezone(timezone)
  const dateField = status === 'queued' ? 'created_at' : 'completed_at'
  const rows = db
    .prepare(`SELECT ${dateField} as ts FROM reel_jobs WHERE target_page_id = ? AND status = ?`)
    .all(pageId, status) as { ts: string | null }[]
  return rows.filter((r) => r.ts && formatDateInTimezone(r.ts, timezone) === today).length
}

export function getPageTodayStats(pageId: string) {
  const tz = getPageTimezone(pageId)
  return {
    timezone: tz,
    publishedToday: countPageJobsToday(pageId, tz, 'published'),
    errorsToday: countPageJobsToday(pageId, tz, 'failed'),
    queuedToday: countPageJobsToday(pageId, tz, 'queued'),
  }
}

export function syncPagePostedToday(pageId: string): number {
  const count = getPageTodayStats(pageId).publishedToday
  db.prepare('UPDATE facebook_pages SET reels_posted_today = ? WHERE id = ?').run(count, pageId)
  return count
}

export function getTodayStatsForPages(pageIds: string[]) {
  const result = new Map<string, { posted: number; failed: number; pending: number }>()
  for (const id of pageIds) result.set(id, { posted: 0, failed: 0, pending: 0 })
  if (!pageIds.length) return result

  const tzByPage = new Map(pageIds.map((id) => [id, getPageTimezone(id)]))
  const placeholders = pageIds.map(() => '?').join(',')
  const jobs = db
    .prepare(`
      SELECT target_page_id, status, completed_at, created_at FROM reel_jobs
      WHERE target_page_id IN (${placeholders}) AND status IN ('published', 'failed', 'queued')
    `)
    .all(...pageIds) as {
      target_page_id: string
      status: string
      completed_at: string | null
      created_at: string | null
    }[]

  for (const job of jobs) {
    const tz = tzByPage.get(job.target_page_id)
    const bucket = result.get(job.target_page_id)
    if (!tz || !bucket) continue
    if (job.status === 'queued' && isTimestampTodayInTimezone(job.created_at, tz)) bucket.pending++
    if (job.status === 'published' && isTimestampTodayInTimezone(job.completed_at, tz)) bucket.posted++
    if (job.status === 'failed' && isTimestampTodayInTimezone(job.completed_at, tz)) bucket.failed++
  }

  return result
}

const quotaResetMarkers = new Map<string, string>()

export function getDistinctPageTimezones(): string[] {
  const rows = db
    .prepare(`
      SELECT DISTINCT COALESCE(s.timezone, ?) as tz
      FROM facebook_pages p
      LEFT JOIN page_automation_settings s ON s.page_id = p.id
    `)
    .all(DEFAULT_SCHEDULE_TIMEZONE) as { tz: string }[]
  return rows.map((r) => r.tz)
}

export function resetPageQuotasForTimezone(timezone: string) {
  const pages = db
    .prepare(`
      SELECT p.id FROM facebook_pages p
      LEFT JOIN page_automation_settings s ON s.page_id = p.id
      WHERE COALESCE(s.timezone, ?) = ?
    `)
    .all(DEFAULT_SCHEDULE_TIMEZONE, timezone) as { id: string }[]

  for (const page of pages) {
    db.prepare('UPDATE facebook_pages SET reels_posted_today = 0 WHERE id = ?').run(page.id)
  }
}

/** Reset daily quotas at local midnight for each page timezone. */
export function tickTimezoneQuotaResets() {
  for (const tz of getDistinctPageTimezones()) {
    const today = getTodayDateInTimezone(tz)
    if (quotaResetMarkers.get(tz) === today) continue
    if (getCurrentTimeHHMM(tz) !== '00:00') continue
    resetPageQuotasForTimezone(tz)
    quotaResetMarkers.set(tz, today)
  }
}
