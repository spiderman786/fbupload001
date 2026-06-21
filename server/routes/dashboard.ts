import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware } from '../middleware/agency.js'
import { isFacebookConfiguredForAgency } from '../services/byoc.js'
import type { AgencyRequest } from '../utils/agency.js'

export const dashboardRouter = Router()
dashboardRouter.use(authMiddleware, requireVerified, agencyMiddleware)

dashboardRouter.get('/stats', (req: AgencyRequest, res) => {
  const agencyId = req.agency!.id

  const agency = db.prepare('SELECT token_balance FROM agencies WHERE id = ?').get(agencyId) as {
    token_balance: number
  }

  const totalPages = db
    .prepare('SELECT COUNT(*) as count FROM facebook_pages WHERE agency_id = ?')
    .get(agencyId) as { count: number }

  const activePages = db
    .prepare("SELECT COUNT(*) as count FROM facebook_pages WHERE agency_id = ? AND status = 'active' AND health_status = 'completed'")
    .get(agencyId) as { count: number }

  const followersGained = db
    .prepare('SELECT COALESCE(SUM(followers_gained), 0) as total FROM facebook_pages WHERE agency_id = ?')
    .get(agencyId) as { total: number }

  const inAppPending = db
    .prepare("SELECT COUNT(*) as count FROM reel_jobs WHERE agency_id = ? AND status IN ('pending', 'downloading', 'publishing')")
    .get(agencyId) as { count: number }

  const directScheduled = db
    .prepare("SELECT COUNT(*) as count FROM schedule_slots WHERE agency_id = ? AND status = 'upcoming'")
    .get(agencyId) as { count: number }

  const needsAttention = db
    .prepare("SELECT COUNT(*) as count FROM facebook_pages WHERE agency_id = ? AND health_status != 'completed'")
    .get(agencyId) as { count: number }

  res.json({
    tokenBalance: agency.token_balance,
    connectedPages: totalPages.count,
    activePages: activePages.count,
    followersGained: followersGained.total,
    inAppPending: inAppPending.count,
    directScheduled: directScheduled.count,
    needsAttention: needsAttention.count,
    updatedAt: new Date().toISOString(),
  })
})

dashboardRouter.get('/onboarding', (req: AgencyRequest, res) => {
  const agencyId = req.agency!.id

  const agency = db.prepare('SELECT token_balance FROM agencies WHERE id = ?').get(agencyId) as {
    token_balance: number
  }

  const facebookPages = (
    db.prepare('SELECT COUNT(*) as count FROM facebook_pages WHERE agency_id = ?').get(agencyId) as { count: number }
  ).count

  const aduPages = (
    db
      .prepare('SELECT COUNT(*) as count FROM page_source_assignments WHERE agency_id = ?')
      .get(agencyId) as { count: number }
  ).count

  const steps = {
    tokenBalanceReady: agency.token_balance > 0,
    byocConnected: isFacebookConfiguredForAgency(agencyId),
    facebookAccountAdded: facebookPages > 0,
    aduPageAdded: aduPages > 0,
  }

  const completedCount = Object.values(steps).filter(Boolean).length
  const complete = completedCount === 4

  res.json({ steps, complete, completedCount, totalSteps: 4 })
})

dashboardRouter.get('/attention', (req: AgencyRequest, res) => {
  const { filter, search } = req.query
  let query = 'SELECT * FROM facebook_pages WHERE agency_id = ?'
  const params: unknown[] = [req.agency!.id]

  if (filter === 'needs_fix') {
    query += " AND health_status != 'completed'"
  } else if (filter === 'completed') {
    query += " AND health_status = 'completed'"
  }

  if (search && typeof search === 'string') {
    query += ' AND name LIKE ?'
    params.push(`%${search}%`)
  }

  query += " ORDER BY CASE health_status WHEN 'completed' THEN 1 ELSE 0 END, name ASC LIMIT 50"

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[]

  res.json({
    pages: rows.map((row) => ({
      id: row.id,
      name: row.name,
      healthStatus: row.health_status,
      status: row.status,
      followers: row.followers,
      followersGained: row.followers_gained,
    })),
  })
})

dashboardRouter.get('/usage.csv', (req: AgencyRequest, res) => {
  const agencyId = req.agency!.id
  const jobs = db
    .prepare(`
      SELECT r.created_at, r.status, r.tokens_charged, r.error_message, p.name as page_name, s.username as source
      FROM reel_jobs r
      LEFT JOIN facebook_pages p ON p.id = r.target_page_id
      LEFT JOIN source_accounts s ON s.id = r.source_account_id
      WHERE r.agency_id = ?
      ORDER BY r.created_at DESC
      LIMIT 500
    `)
    .all(agencyId) as Record<string, unknown>[]

  const header = 'Date,Page,Source,Status,Tokens Charged,Error\n'
  const rows = jobs
    .map(
      (j) => {
        const err = String(j.error_message ?? '').replace(/"/g, '""')
        return `${j.created_at},${j.page_name ?? ''},${j.source ?? ''},${j.status},${j.tokens_charged},"${err}"`
      },
    )
    .join('\n')

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="usage.csv"')
  res.send(header + rows)
})
