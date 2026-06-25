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
import { getPageScrapeInfo } from '../services/scrapeStatus.js'
import { getPageInsights } from '../services/pageInsights.js'
import { upsertPageAutomationSettings, getPageAutomationSettings } from '../services/pageAutomationSettings.js'
import { generateRandomScheduleTimes } from '../services/pageSchedule.js'
import {
  getQueuedJobForPage,
  updateQueuedCaption,
  removeQueuedJob,
  resolveQueueMediaPath,
  ensureQueueThumbnail,
  refreshQueueItemMedia,
  refreshMissingQueuePreviews,
  dedupeQueuedJobsForPage,
} from '../services/queueActions.js'
import { getTodayStatsForPages } from '../utils/pageDayStats.js'
import { getPageQuota } from '../services/pageQuota.js'
import path from 'path'
import { getSignedPreviewUrl, isR2Enabled, pipeQueueFileToResponse } from '../services/r2Storage.js'

export const pagesRouter = Router()
pagesRouter.use(authMiddleware, requireVerified, agencyMiddleware)

function mapPage(row: Record<string, unknown>, todayOverride?: { posted: number; failed: number; pending: number }) {
  const dailyReelLimit = Number(row.daily_reel_limit ?? 6)
  const quota = todayOverride
    ? {
        reelsPostedToday: todayOverride.posted,
        reelsRemainingToday: row.status === 'active' ? Math.max(0, dailyReelLimit - todayOverride.posted) : 0,
      }
    : (() => {
        const q = getPageQuota(row.id as string)
        return { reelsPostedToday: q.posted, reelsRemainingToday: row.status === 'active' ? q.remaining : 0 }
      })()
  return {
    id: row.id,
    metaPageId: row.meta_page_id,
    name: row.name,
    followers: row.followers,
    status: row.status,
    healthStatus: row.health_status ?? 'completed',
    followersGained: row.followers_gained ?? 0,
    reelsPostedToday: quota.reelsPostedToday,
    dailyReelLimit,
    reelsRemainingToday: quota.reelsRemainingToday,
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
      (SELECT COUNT(*) FROM reel_jobs WHERE target_page_id = p.id AND status = 'queued') AS total_pending,
      (SELECT COUNT(*) FROM reel_jobs WHERE target_page_id = p.id AND status = 'failed') AS total_failed
    FROM facebook_pages p
    ${where}
    ORDER BY ${orderClause}
    LIMIT ? OFFSET ?
  `
  const rows = db.prepare(query).all(...params, perPage, offset) as Record<string, unknown>[]
  const pageIds = rows.map((row) => row.id as string)
  const todayByPage = getTodayStatsForPages(pageIds)

  let pages = rows.map((row) => {
    const today = todayByPage.get(row.id as string) ?? { posted: 0, failed: 0, pending: 0 }
    const scrape = getPageScrapeInfo(row.id as string)
    return {
      ...mapPage(row, today),
      sourceUsername: (row.source_username as string | null) ?? null,
      sourcePlatform: (row.source_platform as string | null) ?? null,
      facebookAccountName: (row.facebook_account_name as string | null) ?? null,
      reelsStarted: Number(row.reels_started ?? 0),
      followersNumeric: Number(row.followers_count ?? parseFollowers(String(row.followers ?? '0'))),
      scrape: scrape ?? {
        status: 'none' as const,
        label: 'No source',
        totalScraped: 0,
        catalogTotal: null,
        errorMessage: null,
        inflightDownloads: 0,
      },
      stats: {
        total: {
          posted: Number(row.total_posted ?? 0),
          pending: Number(row.total_pending ?? 0),
          failed: Number(row.total_failed ?? 0),
        },
        today: {
          pending: today.pending,
          posted: today.posted,
          failed: today.failed,
        },
      },
    }
  })

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

pagesRouter.get('/:id/queue', async (req: AgencyRequest, res) => {
  if (!requirePage(req, req.params.id)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  res.json({ queue: await getPageQueue(req.params.id) })
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

pagesRouter.get('/:id/reels', async (req: AgencyRequest, res) => {
  if (!requirePage(req, req.params.id)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  res.json({
    queue: await getPageQueue(req.params.id),
    history: getPageReelsHistory(req.params.id),
  })
})

pagesRouter.get('/:pageId/queue/:jobId/preview', async (req: AgencyRequest, res) => {
  const pageId = req.params.pageId
  if (!requirePage(req, pageId)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  const job = getQueuedJobForPage(req.params.jobId, pageId, req.agency!.id)
  if (!job) {
    res.status(404).json({ error: 'Queued reel not found' })
    return
  }
  const kind = req.query.type === 'thumb' ? 'thumbnail' : 'video'
  const r2Key =
    kind === 'thumbnail' ? (job.r2_thumb_key as string | null) : (job.r2_video_key as string | null)
  if (r2Key && isR2Enabled()) {
    if (req.query.direct === '1') {
      const signed = await getSignedPreviewUrl(r2Key)
      res.redirect(302, signed)
      return
    }
    const ext = kind === 'thumbnail' ? path.extname(r2Key).toLowerCase() : '.mp4'
    const type =
      kind === 'thumbnail'
        ? ext === '.webp'
          ? 'image/webp'
          : 'image/jpeg'
        : 'video/mp4'
    try {
      await pipeQueueFileToResponse(r2Key, res, type)
      return
    } catch (err) {
      console.warn('[preview] R2 stream failed:', r2Key, err)
      res.status(404).json({ error: 'Media not available in CDN' })
      return
    }
  }

  let filePath =
    kind === 'thumbnail'
      ? await ensureQueueThumbnail(job, req.params.jobId)
      : resolveQueueMediaPath(job, 'video')
  if (!filePath) {
    res.status(404).json({ error: 'Media not available' })
    return
  }
  const ext = path.extname(filePath).toLowerCase()
  const type =
    kind === 'thumbnail'
      ? ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg'
      : 'video/mp4'
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', type)
  res.sendFile(path.resolve(filePath))
})

pagesRouter.patch('/:pageId/queue/:jobId', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const pageId = req.params.pageId
  if (!requirePage(req, pageId)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  const { caption } = req.body ?? {}
  if (typeof caption !== 'string') {
    res.status(400).json({ error: 'caption is required' })
    return
  }
  try {
    const saved = updateQueuedCaption(req.params.jobId, pageId, req.agency!.id, caption)
    res.json({ caption: saved })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Update failed' })
  }
})

pagesRouter.delete('/:pageId/queue/:jobId', requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const pageId = req.params.pageId
  if (!requirePage(req, pageId)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  try {
    await removeQueuedJob(req.params.jobId, pageId, req.agency!.id)
    const { tickPrefillQueue } = await import('../services/prefillScheduler.js')
    tickPrefillQueue()
    res.json({ message: 'Removed from queue' })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Delete failed' })
  }
})

pagesRouter.post('/:pageId/queue/:jobId/refresh', requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const pageId = req.params.pageId
  if (!requirePage(req, pageId)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  try {
    const result = await refreshQueueItemMedia(req.params.jobId, pageId, req.agency!.id)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Refresh failed' })
  }
})

pagesRouter.post('/:pageId/queue/refresh-missing', requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const pageId = req.params.pageId
  if (!requirePage(req, pageId)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  try {
    const result = await refreshMissingQueuePreviews(pageId, req.agency!.id)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Refresh failed' })
  }
})

pagesRouter.post('/:pageId/queue/dedupe', requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const pageId = req.params.pageId
  if (!requirePage(req, pageId)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  try {
    const result = await dedupeQueuedJobsForPage(pageId, req.agency!.id)
    const { tickPrefillQueue } = await import('../services/prefillScheduler.js')
    tickPrefillQueue()
    res.json({ message: `Removed ${result.removed} duplicate${result.removed !== 1 ? 's' : ''}`, ...result })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Dedupe failed' })
  }
})

pagesRouter.post('/:pageId/queue/:jobId/skip', requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const pageId = req.params.pageId
  if (!requirePage(req, pageId)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  try {
    await removeQueuedJob(req.params.jobId, pageId, req.agency!.id)
    const { tickPrefillQueue } = await import('../services/prefillScheduler.js')
    tickPrefillQueue()
    res.json({ message: 'Skipped — next reel will pre-download' })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Skip failed' })
  }
})

pagesRouter.patch('/:id/automation-settings', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  if (!requirePage(req, req.params.id)) {
    res.status(404).json({ error: 'Page not found' })
    return
  }
  const { postsPerDay, postingLogic, timezone, scheduleTimes, hashtags, regenerateRandomTimes } = req.body ?? {}
  const current = getPageAutomationSettings(req.params.id)
  let nextTimes = Array.isArray(scheduleTimes) ? scheduleTimes.map(String) : undefined

  if (regenerateRandomTimes === true) {
    const count = postsPerDay !== undefined ? Number(postsPerDay) : current.postsPerDay
    nextTimes = generateRandomScheduleTimes(count)
  } else if (postingLogic === 'dailyrandom' && postingLogic !== current.postingLogic && !nextTimes) {
    nextTimes = generateRandomScheduleTimes(postsPerDay !== undefined ? Number(postsPerDay) : current.postsPerDay)
  }

  const settings = upsertPageAutomationSettings(req.params.id, {
    postsPerDay: postsPerDay !== undefined ? Number(postsPerDay) : undefined,
    postingLogic: postingLogic !== undefined ? String(postingLogic) : undefined,
    timezone: timezone !== undefined ? String(timezone) : undefined,
    scheduleTimes: nextTimes,
    hashtags: Array.isArray(hashtags) ? hashtags.map(String) : undefined,
  })

  if (nextTimes || scheduleTimes) {
    db.prepare('UPDATE page_automation_settings SET last_schedule_fire = NULL WHERE page_id = ?').run(req.params.id)
  }

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
