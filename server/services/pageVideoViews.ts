import { db } from '../db.js'
import { isFacebookConfigured } from './facebook.js'

export const ESTIMATED_VIEWS_PER_REEL = 850

const GRAPH = 'https://graph.facebook.com/v21.0'

export function incrementPageVideoViews(pageId: string, amount = ESTIMATED_VIEWS_PER_REEL) {
  db.prepare(`
    UPDATE facebook_pages
    SET video_views_total = COALESCE(video_views_total, 0) + ?
    WHERE id = ?
  `).run(amount, pageId)
}

export function estimatePageVideoViews(pageId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM reel_jobs WHERE target_page_id = ? AND status = 'published'`,
    )
    .get(pageId) as { c: number }
  return row.c * ESTIMATED_VIEWS_PER_REEL
}

export async function fetchPageVideoViewsFromGraph(
  agencyId: string,
  metaPageId: string,
  pageAccessToken: string | null,
): Promise<number | null> {
  const isMock = !isFacebookConfigured(agencyId) || pageAccessToken?.startsWith('mock_')
  if (isMock || !pageAccessToken) return null

  const since = Math.floor(Date.now() / 1000) - 28 * 86400
  const until = Math.floor(Date.now() / 1000)
  const params = new URLSearchParams({
    metric: 'page_video_views',
    period: 'day',
    since: String(since),
    until: String(until),
    access_token: pageAccessToken,
  })

  try {
    const res = await fetch(`${GRAPH}/${metaPageId}/insights?${params}`)
    const data = (await res.json()) as {
      data?: { name: string; values: { value: number }[] }[]
      error?: { message: string }
    }
    if (!res.ok || data.error || !data.data?.length) return null
    const metric = data.data.find((m) => m.name === 'page_video_views')
    if (!metric) return null
    return metric.values.reduce((sum, v) => sum + Number(v.value ?? 0), 0)
  } catch {
    return null
  }
}

export async function syncPageVideoViews(page: {
  id: string
  agency_id?: string | null
  user_id: string
  meta_page_id: string
  page_access_token: string | null
}): Promise<number> {
  const agencyId =
    page.agency_id ??
    (
      db.prepare('SELECT agency_id FROM facebook_pages WHERE id = ?').get(page.id) as
        | { agency_id: string }
        | undefined
    )?.agency_id ??
    page.user_id

  const graphViews = await fetchPageVideoViewsFromGraph(agencyId, page.meta_page_id, page.page_access_token)
  const estimate = estimatePageVideoViews(page.id)
  const current = (
    db.prepare('SELECT COALESCE(video_views_total, 0) as total FROM facebook_pages WHERE id = ?').get(page.id) as
      | { total: number }
      | undefined
  )?.total ?? 0

  const next = Math.max(current, graphViews ?? 0, estimate)
  db.prepare('UPDATE facebook_pages SET video_views_total = ? WHERE id = ?').run(next, page.id)
  return next
}

export function backfillPageVideoViews() {
  const pages = db.prepare('SELECT id FROM facebook_pages').all() as { id: string }[]
  for (const page of pages) {
    const current = (
      db.prepare('SELECT COALESCE(video_views_total, 0) as total FROM facebook_pages WHERE id = ?').get(page.id) as
        | { total: number }
        | undefined
    )?.total ?? 0
    if (current > 0) continue
    const estimate = estimatePageVideoViews(page.id)
    if (estimate > 0) {
      db.prepare('UPDATE facebook_pages SET video_views_total = ? WHERE id = ?').run(estimate, page.id)
    }
  }
}
