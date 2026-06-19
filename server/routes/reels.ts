import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware } from '../middleware/agency.js'
import type { AgencyRequest } from '../utils/agency.js'

export const reelsRouter = Router()
reelsRouter.use(authMiddleware, requireVerified, agencyMiddleware)

function mapJob(row: Record<string, unknown>) {
  return {
    id: row.id,
    sourceAccountId: row.source_account_id,
    targetPageId: row.target_page_id,
    status: row.status,
    sourceUrl: row.source_url,
    metaPostId: row.meta_post_id,
    tokensCharged: row.tokens_charged,
    errorMessage: row.error_message,
    scheduledFor: row.scheduled_for,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    pageName: row.page_name ?? null,
    sourceUsername: row.source_username ?? null,
    jobType: row.job_type ?? 'scheduled',
    sourceReelId: row.source_reel_id ?? null,
    metadataStripped: Boolean(row.metadata_stripped),
    localFilePath: row.local_file_path ?? null,
    cleanedFilePath: row.cleaned_file_path ?? null,
  }
}

reelsRouter.get('/', (req: AgencyRequest, res) => {
  const rows = db
    .prepare(`
      SELECT r.*, p.name as page_name, s.username as source_username
      FROM reel_jobs r
      LEFT JOIN facebook_pages p ON p.id = r.target_page_id
      LEFT JOIN source_accounts s ON s.id = r.source_account_id
      WHERE r.agency_id = ?
      ORDER BY r.created_at DESC
      LIMIT 100
    `)
    .all(req.agency!.id) as Record<string, unknown>[]
  res.json({ jobs: rows.map(mapJob) })
})

reelsRouter.get('/stats', (req: AgencyRequest, res) => {
  const agencyId = req.agency!.id
  const today = new Date().toISOString().slice(0, 10)

  const publishedToday = db
    .prepare(`
      SELECT COUNT(*) as count FROM reel_jobs
      WHERE agency_id = ? AND status = 'published' AND date(completed_at) = date(?)
    `)
    .get(agencyId, today) as { count: number }

  const activePages = db
    .prepare("SELECT COUNT(*) as count FROM facebook_pages WHERE agency_id = ? AND status = 'active'")
    .get(agencyId) as { count: number }

  const activeSources = db
    .prepare('SELECT COUNT(*) as count FROM source_accounts WHERE agency_id = ? AND is_active = 1')
    .get(agencyId) as { count: number }

  res.json({
    publishedToday: publishedToday.count,
    activePages: activePages.count,
    activeSources: activeSources.count,
  })
})
