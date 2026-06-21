import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import fs from 'fs'
import path from 'path'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { requirePlatformAdmin, type PlatformAdminRequest } from '../middleware/platformAdmin.js'
import { isPlatformAdminEmail } from '../services/platformAdmin.js'
import { getJobLogs } from '../services/jobLog.js'
import { writeOpsAudit, listOpsAudit } from '../services/opsAudit.js'
import { listRecentAlerts, runOpsAlertChecks } from '../services/opsAlerts.js'
import { getProxyPoolStats } from '../services/proxyPool.js'
import { readWorkerHeartbeat } from '../services/workerHeartbeat.js'
import { enqueueJob } from '../services/jobQueue.js'
import { setAgencyCookie, buildSessionPayload } from '../utils/agency.js'

export const opsRouter = Router()

const guard = [authMiddleware, requireVerified, requirePlatformAdmin] as const

opsRouter.get('/me', authMiddleware, requireVerified, (req: PlatformAdminRequest, res) => {
  res.json({ platformAdmin: Boolean(req.user && isPlatformAdminEmail(req.user.email)) })
})

opsRouter.get('/overview', ...guard, (_req, res) => {
  const today = new Date().toISOString().slice(0, 10)
  const agencies = db.prepare('SELECT COUNT(*) as c FROM agencies').get() as { c: number }
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
  const pages = db.prepare('SELECT COUNT(*) as c FROM facebook_pages').get() as { c: number }
  const activePages = db
    .prepare("SELECT COUNT(*) as c FROM facebook_pages WHERE status = 'active'")
    .get() as { c: number }
  const pendingJobs = db
    .prepare("SELECT COUNT(*) as c FROM reel_jobs WHERE status IN ('pending','downloading','publishing')")
    .get() as { c: number }
  const publishedToday = db
    .prepare("SELECT COUNT(*) as c FROM reel_jobs WHERE status = 'published' AND date(completed_at) = date(?)")
    .get(today) as { c: number }
  const failedToday = db
    .prepare("SELECT COUNT(*) as c FROM reel_jobs WHERE status = 'failed' AND date(completed_at) = date(?)")
    .get(today) as { c: number }
  const tokensSold = db
    .prepare("SELECT COALESCE(SUM(amount),0) as t FROM token_transactions WHERE amount > 0")
    .get() as { t: number }
  const tokensUsed = db
    .prepare("SELECT COALESCE(SUM(ABS(amount)),0) as t FROM token_transactions WHERE type = 'publish_debit'")
    .get() as { t: number }

  res.json({
    agencies: agencies.c,
    users: users.c,
    pages: pages.c,
    activePages: activePages.c,
    pendingJobs: pendingJobs.c,
    publishedToday: publishedToday.c,
    failedToday: failedToday.c,
    tokensSold: tokensSold.t,
    tokensUsed: tokensUsed.t,
    proxy: getProxyPoolStats(),
    worker: readWorkerHeartbeat(),
  })
})

opsRouter.get('/agencies', ...guard, (_req, res) => {
  const rows = db
    .prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM facebook_pages p WHERE p.agency_id = a.id) as page_count,
        (SELECT COUNT(*) FROM agency_members m WHERE m.agency_id = a.id) as member_count,
        (SELECT email FROM users u JOIN agency_members m ON m.user_id = u.id WHERE m.agency_id = a.id AND m.role = 'owner' LIMIT 1) as owner_email
      FROM agencies a
      ORDER BY a.created_at DESC
    `)
    .all()
  res.json({ agencies: rows })
})

opsRouter.get('/agencies/:id', ...guard, (req, res) => {
  const agency = db.prepare('SELECT * FROM agencies WHERE id = ?').get(req.params.id)
  if (!agency) {
    res.status(404).json({ error: 'Agency not found' })
    return
  }
  const pages = db.prepare('SELECT * FROM facebook_pages WHERE agency_id = ?').all(req.params.id)
  const sources = db.prepare('SELECT * FROM source_accounts WHERE agency_id = ?').all(req.params.id)
  const members = db
    .prepare(`
      SELECT u.email, u.full_name, m.role, m.created_at
      FROM agency_members m JOIN users u ON u.id = m.user_id
      WHERE m.agency_id = ?
    `)
    .all(req.params.id)
  const notes = db
    .prepare(`
      SELECT n.*, u.email as admin_email FROM agency_ops_notes n
      JOIN users u ON u.id = n.admin_user_id
      WHERE n.agency_id = ? ORDER BY n.created_at DESC LIMIT 20
    `)
    .all(req.params.id)
  res.json({ agency, pages, sources, members, notes })
})

opsRouter.post('/agencies/:id/notes', ...guard, (req: PlatformAdminRequest, res) => {
  const note = String(req.body?.note ?? '').trim()
  if (!note) {
    res.status(400).json({ error: 'Note required' })
    return
  }
  const id = uuid()
  db.prepare('INSERT INTO agency_ops_notes (id, agency_id, admin_user_id, note) VALUES (?, ?, ?, ?)').run(
    id,
    req.params.id,
    req.user!.id,
    note,
  )
  writeOpsAudit(req.user!.id, 'agency_note', 'agency', req.params.id, { note })
  res.json({ id, note })
})

opsRouter.post('/agencies/:id/credit-tokens', ...guard, (req: PlatformAdminRequest, res) => {
  const amount = Number(req.body?.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'Invalid amount' })
    return
  }
  const agency = db.prepare('SELECT id, token_balance FROM agencies WHERE id = ?').get(req.params.id) as
    | { id: string; token_balance: number }
    | undefined
  if (!agency) {
    res.status(404).json({ error: 'Agency not found' })
    return
  }
  db.prepare('UPDATE agencies SET token_balance = token_balance + ? WHERE id = ?').run(amount, req.params.id)
  const owner = db
    .prepare("SELECT user_id FROM agency_members WHERE agency_id = ? AND role = 'owner' LIMIT 1")
    .get(req.params.id) as { user_id: string } | undefined
  if (owner) {
    db.prepare(`
      INSERT INTO token_transactions (id, user_id, agency_id, amount, type, note)
      VALUES (?, ?, ?, ?, 'purchase', ?)
    `).run(uuid(), owner.user_id, req.params.id, amount, `Ops credit by ${req.user!.email}`)
  }
  writeOpsAudit(req.user!.id, 'credit_tokens', 'agency', req.params.id, { amount })
  res.json({ tokenBalance: agency.token_balance + amount })
})

opsRouter.get('/pages', ...guard, (req, res) => {
  const { status, health } = req.query
  let sql = `
    SELECT p.*, a.name as agency_name
    FROM facebook_pages p
    JOIN agencies a ON a.id = p.agency_id
    WHERE 1=1
  `
  const params: unknown[] = []
  if (status) {
    sql += ' AND p.status = ?'
    params.push(status)
  }
  if (health) {
    sql += ' AND p.health_status = ?'
    params.push(health)
  }
  sql += ' ORDER BY (p.last_published_at IS NULL), p.last_published_at DESC LIMIT 200'
  res.json({ pages: db.prepare(sql).all(...params) })
})

opsRouter.patch('/pages/:id', ...guard, (req: PlatformAdminRequest, res) => {
  const status = req.body?.status as string | undefined
  if (status && !['active', 'paused'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' })
    return
  }
  if (status) db.prepare('UPDATE facebook_pages SET status = ? WHERE id = ?').run(status, req.params.id)
  writeOpsAudit(req.user!.id, 'update_page', 'page', req.params.id, { status })
  res.json({ ok: true })
})

opsRouter.get('/jobs', ...guard, (req, res) => {
  const { status, agencyId, limit = '100' } = req.query
  let sql = `
    SELECT r.*, p.name as page_name, s.username as source_username, a.name as agency_name
    FROM reel_jobs r
    LEFT JOIN facebook_pages p ON p.id = r.target_page_id
    LEFT JOIN source_accounts s ON s.id = r.source_account_id
    LEFT JOIN agencies a ON a.id = r.agency_id
    WHERE 1=1
  `
  const params: unknown[] = []
  if (status) {
    sql += ' AND r.status = ?'
    params.push(status)
  }
  if (agencyId) {
    sql += ' AND r.agency_id = ?'
    params.push(agencyId)
  }
  sql += ' ORDER BY r.created_at DESC LIMIT ?'
  params.push(Math.min(500, Number(limit) || 100))
  res.json({ jobs: db.prepare(sql).all(...params) })
})

opsRouter.get('/jobs/:id', ...guard, (req, res) => {
  const job = db
    .prepare(`
      SELECT r.*, p.name as page_name, s.username as source_username, a.name as agency_name
      FROM reel_jobs r
      LEFT JOIN facebook_pages p ON p.id = r.target_page_id
      LEFT JOIN source_accounts s ON s.id = r.source_account_id
      LEFT JOIN agencies a ON a.id = r.agency_id
      WHERE r.id = ?
    `)
    .get(req.params.id)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  res.json({ job, logs: getJobLogs(req.params.id) })
})

opsRouter.post('/jobs/:id/retry', ...guard, (req: PlatformAdminRequest, res) => {
  const job = db.prepare('SELECT id FROM reel_jobs WHERE id = ?').get(req.params.id)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  db.prepare(`
    UPDATE reel_jobs SET status = 'pending', error_message = NULL, completed_at = NULL WHERE id = ?
  `).run(req.params.id)
  enqueueJob(req.params.id)
  writeOpsAudit(req.user!.id, 'retry_job', 'job', req.params.id)
  res.json({ ok: true })
})

opsRouter.get('/analytics', ...guard, (req, res) => {
  const days = Math.min(30, Number(req.query.days) || 14)
  const daily = db
    .prepare(`
      SELECT date(completed_at) as day,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM reel_jobs
      WHERE completed_at >= datetime('now', ?)
      GROUP BY date(completed_at)
      ORDER BY day ASC
    `)
    .all(`-${days} days`)

  const byPlatform = db
    .prepare(`
      SELECT s.platform, COUNT(*) as jobs,
        SUM(CASE WHEN r.status = 'published' THEN 1 ELSE 0 END) as published,
        SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM reel_jobs r
      JOIN source_accounts s ON s.id = r.source_account_id
      WHERE r.created_at >= datetime('now', '-14 days')
      GROUP BY s.platform
    `)
    .all()

  const topErrors = db
    .prepare(`
      SELECT error_message, COUNT(*) as count FROM reel_jobs
      WHERE status = 'failed' AND error_message IS NOT NULL
        AND created_at >= datetime('now', '-7 days')
      GROUP BY error_message ORDER BY count DESC LIMIT 10
    `)
    .all()

  const agencyActivity = db
    .prepare(`
      SELECT a.name, a.token_balance,
        (SELECT COUNT(*) FROM reel_jobs j WHERE j.agency_id = a.id AND j.status = 'published' AND j.created_at >= datetime('now', '-7 days')) as published_7d
      FROM agencies a ORDER BY published_7d DESC LIMIT 15
    `)
    .all()

  res.json({ daily, byPlatform, topErrors, agencyActivity, days })
})

opsRouter.get('/audit', ...guard, (req, res) => {
  res.json({ audit: listOpsAudit(Number(req.query.limit) || 100) })
})

opsRouter.get('/alerts', ...guard, (_req, res) => {
  res.json({ alerts: listRecentAlerts() })
})

opsRouter.post('/alerts/run-checks', ...guard, async (_req, res) => {
  await runOpsAlertChecks()
  res.json({ ok: true, alerts: listRecentAlerts(10) })
})

opsRouter.get('/system', ...guard, (_req, res) => {
  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'fbuploadpro.db')
  let dbSize = 0
  try {
    dbSize = fs.statSync(dbPath).size
  } catch {
    /* ignore */
  }
  const oldestPending = db
    .prepare(`
      SELECT id, created_at FROM reel_jobs WHERE status = 'pending'
      ORDER BY created_at ASC LIMIT 1
    `)
    .get() as { id: string; created_at: string } | undefined

  res.json({
    worker: readWorkerHeartbeat(),
    proxy: getProxyPoolStats(),
    dbPath,
    dbSizeBytes: dbSize,
    oldestPendingJob: oldestPending ?? null,
    nodeVersion: process.version,
    uptimeSec: Math.floor(process.uptime()),
  })
})

opsRouter.post('/impersonate/:agencyId', ...guard, (req: PlatformAdminRequest, res) => {
  const agency = db.prepare('SELECT id FROM agencies WHERE id = ?').get(req.params.agencyId)
  if (!agency) {
    res.status(404).json({ error: 'Agency not found' })
    return
  }
  writeOpsAudit(req.user!.id, 'impersonate', 'agency', req.params.agencyId)
  setAgencyCookie(res, req.params.agencyId)
  res.json(buildSessionPayload(req.user!.id, req.params.agencyId))
})
