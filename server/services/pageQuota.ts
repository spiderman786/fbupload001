import { db } from '../db.js'

export function getPageQuota(pageId: string): { posted: number; limit: number; remaining: number } {
  const row = db
    .prepare('SELECT reels_posted_today, daily_reel_limit, status FROM facebook_pages WHERE id = ?')
    .get(pageId) as { reels_posted_today: number; daily_reel_limit: number; status: string } | undefined

  if (!row) return { posted: 0, limit: 0, remaining: 0 }

  const limit = row.daily_reel_limit ?? 6
  const posted = row.reels_posted_today ?? 0
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
