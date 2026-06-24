import { db } from '../db.js'
import { countPageJobsToday, getPageTimezone, syncPagePostedToday } from '../utils/pageDayStats.js'

export function getPageQuota(pageId: string): { posted: number; limit: number; remaining: number } {
  const row = db
    .prepare('SELECT daily_reel_limit, status FROM facebook_pages WHERE id = ?')
    .get(pageId) as { daily_reel_limit: number; status: string } | undefined

  if (!row) return { posted: 0, limit: 0, remaining: 0 }

  const limit = row.daily_reel_limit ?? 6
  const posted = countPageJobsToday(pageId, getPageTimezone(pageId), 'published')
  const remaining = row.status === 'active' ? Math.max(0, limit - posted) : 0

  return { posted, limit, remaining }
}

export function canPagePostToday(pageId: string): boolean {
  const q = getPageQuota(pageId)
  return q.remaining > 0
}

export function resetAllDailyQuotas() {
  db.prepare('UPDATE facebook_pages SET reels_posted_today = 0').run()
}

export function refreshPagePostedToday(pageId: string) {
  return syncPagePostedToday(pageId)
}
