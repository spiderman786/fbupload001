import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import { formatFollowersTotal, parseFollowers } from '../utils/followers.js'
import { seedFollowerBaseline, syncAgencyFollowers } from '../services/followerSync.js'
import type { AgencyRequest } from '../utils/agency.js'

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

  let query = `
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
      (SELECT COUNT(*) FROM reel_jobs WHERE target_page_id = p.id) AS reels_started
    FROM facebook_pages p
    WHERE p.agency_id = ?
  `
  const params: unknown[] = [agencyId]

  if (search) {
    query += ' AND (p.name LIKE ? OR p.meta_page_id LIKE ?)'
    params.push(`%${search}%`, `%${search}%`)
  }

  if (statusFilter === 'active') {
    query += " AND p.status = 'active' AND p.health_status = 'completed'"
  } else if (statusFilter === 'inactive') {
    query += " AND p.status = 'paused'"
  } else if (statusFilter !== 'all') {
    query += ' AND p.health_status = ?'
    params.push(statusFilter)
  }

  const orderBy: Record<string, string> = {
    newest: 'p.created_at DESC',
    oldest: 'p.created_at ASC',
    name: 'p.name ASC',
    gained: 'p.followers_gained DESC',
    followers: 'p.followers_count DESC',
  }
  query += ` ORDER BY ${orderBy[sort] ?? orderBy.newest}`

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[]

  let pages = rows.map((row) => ({
    ...mapPage(row),
    sourceUsername: (row.source_username as string | null) ?? null,
    reelsStarted: Number(row.reels_started ?? 0),
    followersNumeric: Number(row.followers_count ?? parseFollowers(String(row.followers ?? '0'))),
  }))

  if (sort === 'followers') {
    pages = pages.sort((a, b) => b.followersNumeric - a.followersNumeric)
  }

  const allPages = db
    .prepare('SELECT followers_count, followers, followers_gained, last_followers_sync_at FROM facebook_pages WHERE agency_id = ?')
    .all(agencyId) as {
      followers_count: number | null
      followers: string
      followers_gained: number
      last_followers_sync_at: string | null
    }[]

  const totalFollowers = allPages.reduce(
    (sum, p) => sum + (p.followers_count ?? parseFollowers(p.followers)),
    0,
  )
  const followersGained = allPages.reduce((sum, p) => sum + (p.followers_gained ?? 0), 0)
  const lastFollowersSyncAt = allPages.reduce<string | null>((latest, p) => {
    if (!p.last_followers_sync_at) return latest
    if (!latest || p.last_followers_sync_at > latest) return p.last_followers_sync_at
    return latest
  }, null)

  res.json({
    stats: {
      totalPages: allPages.length,
      followersGained,
      totalFollowers,
      totalFollowersLabel: formatFollowersTotal(totalFollowers),
      lastFollowersSyncAt,
    },
    pages,
  })
})

pagesRouter.post('/sync-followers', requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const result = await syncAgencyFollowers(req.agency!.id)
  res.json({
    message: `Synced ${result.synced} page${result.synced !== 1 ? 's' : ''}${result.failed ? `, ${result.failed} failed` : ''}`,
    ...result,
  })
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
