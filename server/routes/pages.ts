import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import { formatFollowersTotal, parseFollowers } from '../utils/followers.js'
import { seedFollowerBaseline, syncAgencyFollowers } from '../services/followerSync.js'
import { parsePagination } from '../utils/pagination.js'
import type { AgencyRequest } from '../utils/agency.js'
import {
  getPageDetail,
  getPageQueue,
  getPageFailedPosts,
  getPageFailedReasons,
  getPageReelsHistory,
  getAgencyPage,
} from '../services/pageDetail.js'
import { getPageInsights } from '../services/pageInsights.js'
import { upsertPageAutomationSettings, getPageAutomationSettings } from '../services/pageAutomationSettings.js'

export const pagesRouter = Router()
pagesRouter.use(authMiddleware, requireVerified, agencyMiddleware)

function mapPage(row: Record<string, unknown>) {
  const dailyReelLimit = Number(row.daily_reel_limit ?? 6)
  const reelsPostedToday = Number(row.reels_posted_today ?? 0)
  return {
    id: row.id,
    metaPageId: row.meta_page_id,
    name: row.name,
    followers: row.followers,
    status: row.status,
    healthStatus: row.health_status ?? 'completed',
    followersGained: row.followers_gained ?? 0,
    reelsPostedToday,
    dailyReelLimit,
    reelsRemainingToday: row.status === 'active' ? Math.max(0, dailyReelLimit - reelsPostedToday) : 0,
    lastPublishedAt: row.last_published_at,
    createdAt: row.created_at,
    lastFollowersSyncAt: row.last_followers_sync_at ?? null,
  }
}

pagesRouter.get('/', (req: AgencyRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM facebook_pages WHERE agency_id = ? ORDER BY created_at DESC')
    .all(req.agency!.id) as Record<string, unknown>[]
  res.json({ pages: rows.map(mapPage) })
})

pagesRouter.get('/hub', (req: AgencyRequest, res) => {
  const agencyId = req.agency!.id
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'all'
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest'
  const { page, perPage, offset } = parsePagination(req.query as Record<string, unknown>)

  let where = 'WHERE p.agency_id = ?'
  const params: unknown[] = [agencyId]

  if (search) {
    where += ' AND (p.name LIKE ? OR p.meta_page_id LIKE ?)'
    params.push(`%${search}%`, `%${search}%`)
  }

  if (statusFilter === 'active') {
    where += " AND p.status = 'active' AND p.health_status = 'completed'"
  } else if (statusFilter === 'inactive') {
    where += " AND p.status = 'paused'"
  } else if (statusFilter !== 'all') {
    where += ' AND p.health_status = ?'
    params.push(statusFilter)
  }

  const orderBy: Record<string, string> = {
    newest: 'p.created_at DESC',
    oldest: 'p.created_at ASC',
    name: 'p.name ASC',
    gained: 'p.followers_gained DESC',
    followers: 'p.followers_count DESC',
  }
  const orderClause = orderBy[sort] ?? orderBy.newest

  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM facebook_pages p ${where}`)
    .get(...params) as { count: number }

  const query = `
    SELECT p.*,
      COALESCE(
        (SELECT s.username FROM page_source_assignments a
          JOIN source_accounts s ON s.id = a.source_account_id
          WHERE a.page_id = p.id),
        (SELECT s.username FROM reel_jobs r
          JOIN source_accounts s ON s.id = r.source_account_id
          WHERE r.target_page_id = p.id
          ORDER BY r.created_at DESC LIMIT 1)
      ) AS source_username,
      (SELECT s.platform FROM page_source_assignments a
          JOIN source_accounts s ON s.id = a.source_account_id
          WHERE a.page_id = p.id) AS source_platform,
      (SELECT COALESCE(fa.display_name, fa.meta_user_id)
          FROM facebook_accounts fa WHERE fa.id = p.facebook_account_id) AS facebook_account_name,
      (SELECT COUNT(*) FROM reel_jobs WHERE target_page_id = p.id) AS reels_started,
      (SELECT COUNT(*) FROM reel_jobs WHERE target_page_id = p.id AND status = 'published') AS total_posted,
      (SELECT COUNT(*) FROM reel_jobs WHERE target_page_id = p.id AND status IN ('pending','downloading','publishing')) AS total_pending,
      (SELECT COUNT(*) FROM reel_jobs WHERE target_page_id = p.id AND status = 'failed') AS total_failed,
      (SELECT COUNT(*) FROM reel_jobs WHERE target_page_id = p.id AND status = 'published' AND date(completed_at) = date('now')) AS today_posted,
      (SELECT COUNT(*) FROM reel_jobs WHERE target_page_id = p.id AND status = 'failed' AND date(completed_at) = date('now')) AS today_failed,
      (SELECT COUNT(*) FROM reel_jobs WHERE target_page_id = p.id AND status IN ('pending','downloading','publishing') AND date(created_at) = date('now')) AS today_pending
    FROM facebook_pages p
    ${where}
    ORDER BY ${orderClause}
    LIMIT ? OFFSET ?
  `
  const rows = db.prepare(query).all(...params, perPage, offset) as Record<string, unknown>[]

  let pages = rows.map((row) => ({
    ...mapPage(row),
    sourceUsername: (row.source_username as string | null) ?? null,
    sourcePlatform: (row.source_platform as string | null) ?? null,
    facebookAccountName: (row.facebook_account_name as string | null) ?? null,
    reelsStarted: Number(row.reels_started ?? 0),
    followersNumeric: Number(row.followers_count ?? parseFollowers(String(row.followers ?? '0'))),
    stats: {
      total: {
        posted: Number(row.total_posted ?? 0),
        pending: Number(row.total_pending ?? 0),
        failed: Number(row.total_failed ?? 0),
      },
      today: {
        pending: Number(row.today_pending ?? 0),
        posted: Number(row.today_posted ?? 0),
        failed: Number(row.today_failed ?? 0),
      },
    },
  }))

  if (sort === 'followers') {
    pages = pages.sort((a, b) => b.followersNumeric - a.followersNumeric)
  }

  const statsRow = db
    .prepare(`
      SELECT
        COUNT(*) as total_pages,
        COALESCE(SUM(followers_count), 0) as total_followers_raw,
        COALESCE(SUM(followers_gained), 0) as followers_gained,
        MAX(last_followers_sync_at) as last_followers_sync_at
      FROM facebook_pages WHERE agency_id = ?
    `)
    .get(agencyId) as {
      total_pages: number
      total_followers_raw: number
      followers_gained: number
      last_followers_sync_at: string | null
    }

  const totalFollowers = Number(statsRow.total_followers_raw)

  const totalCount = Number(countRow.count)
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage))

  res.json({
    stats: {
      totalPages: statsRow.total_pages,
      followersGained: statsRow.followers_gained,
      totalFollowers,
      totalFollowersLabel: formatFollowersTotal(totalFollowers),
      lastFollowersSyncAt: statsRow.last_followers_sync_at,
    },
    pages,
    pagination: {
      page,
      perPage,
      totalCount,
      totalPages,
    },
  })
})

pagesRouter.post('/sync-followers', requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const result = await syncAgencyFollowers(req.agency!.id)
  res.json({
    message: `Synced ${result.synced} page${result.synced !== 1 ? 's' : ''}${result.failed ? `, ${result.failed} failed` : ''}`,
    ...result,
  })
})

function requirePage(req: AgencyRequest, pageId: string) {
  const page = getAgencyPage(pageId, req.agency!.id)
  if (!page) return null
  return page
}

pagesRouter.get('/:id/detail', (req: AgencyRequest, res) => {
  const detail = getPageDetail(req.params.id, req.agency!.id)
  if (!detail) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  res.json(detail)
})

pagesRouter.get('/:id/insights', async (req: AgencyRequest, res) => {
  if (!requirePage(req, req.params.id)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 28))
  const settings = getPageAutomationSettings(req.params.id)
  const insights = await getPageInsights(req.params.id, days, settings.hashtags)
  res.json({ insights })
})

pagesRouter.get('/:id/queue', (req: AgencyRequest, res) => {
  if (!requirePage(req, req.params.id)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  res.json({ queue: getPageQueue(req.params.id) })
})

pagesRouter.get('/:id/failed-posts', (req: AgencyRequest, res) => {
  if (!requirePage(req, req.params.id)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  res.json({
    posts: getPageFailedPosts(req.params.id),
    reasons: getPageFailedReasons(req.params.id),
  })
})

pagesRouter.get('/:id/reels', (req: AgencyRequest, res) => {
  if (!requirePage(req, req.params.id)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  res.json({
    queue: getPageQueue(req.params.id),
    history: getPageReelsHistory(req.params.id),
  })
})

pagesRouter.patch('/:id/automation-settings', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  if (!requirePage(req, req.params.id)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  const { postsPerDay, postingLogic, timezone, scheduleTimes, hashtags } = req.body ?? {}
  const settings = upsertPageAutomationSettings(req.params.id, {
    postsPerDay: postsPerDay !== undefined ? Number(postsPerDay) : undefined,
    postingLogic: postingLogic !== undefined ? String(postingLogic) : undefined,
    timezone: timezone !== undefined ? String(timezone) : undefined,
    scheduleTimes: Array.isArray(scheduleTimes) ? scheduleTimes.map(String) : undefined,
    hashtags: Array.isArray(hashtags) ? hashtags.map(String) : undefined,
  })
  res.json({ settings })
})

pagesRouter.patch('/:id', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { status, dailyReelLimit } = req.body ?? {}
  const page = db
    .prepare('SELECT * FROM facebook_pages WHERE id = ? AND agency_id = ?')
    .get(req.params.id, req.agency!.id)

  if (!page) {
    res.status(404).json({ error: 'Page not found' })
    return
  }

  if (status && !['active', 'paused'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' })
    return
  }

  if (dailyReelLimit !== undefined) {
    const limit = Number(dailyReelLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 24) {
      res.status(400).json({ error: 'Daily reel limit must be between 1 and 24' })
      return
    }
    db.prepare('UPDATE facebook_pages SET daily_reel_limit = ? WHERE id = ?').run(limit, req.params.id)
  }

  if (status) {
    db.prepare('UPDATE facebook_pages SET status = ? WHERE id = ?').run(status, req.params.id)
  }

  const updated = db.prepare('SELECT * FROM facebook_pages WHERE id = ?').get(req.params.id) as Record<string, unknown>
  res.json({ page: mapPage(updated) })
})

pagesRouter.delete('/:id', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const result = db
    .prepare('DELETE FROM facebook_pages WHERE id = ? AND agency_id = ?')
    .run(req.params.id, req.agency!.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  res.json({ message: 'Page removed' })
})

pagesRouter.post('/demo', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const id = uuid()
  const names = ['Fitness Motivation Daily', 'Tech Tips Hub', 'Cooking Shorts']
  const name = names[Math.floor(Math.random() * names.length)]
  const count = Math.floor(Math.random() * 20_000 + 1_000)
  db.prepare(`
    INSERT INTO facebook_pages (id, user_id, agency_id, meta_page_id, name, followers, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(id, req.user!.id, req.agency!.id, `demo_${uuid().slice(0, 8)}`, name, `${Math.floor(count / 1000)}.${Math.floor(Math.random() * 9)}K`)
  seedFollowerBaseline(id, count)

  const page = db.prepare('SELECT * FROM facebook_pages WHERE id = ?').get(id) as Record<string, unknown>
  res.status(201).json({ page: mapPage(page) })
})
